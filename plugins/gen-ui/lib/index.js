/**
 * arxa-gen-ui, host half — stages 1 and 3 of
 * docs/plans/inline-generative-ui-in-dsh.md (app-box).
 *
 * Stage 1: one model-callable tool, `gen_ui`, whose validated output is a set
 * of canonical A2UI v0.9 envelopes. `presentCall`/`presentResult` give it a
 * decent card with ZERO client code, so the tool degrades honestly if the
 * browser half is ever absent.
 *
 * Stage 3: a generic RPC channel (`/arxa-gen-ui`) the browser half calls when
 * the user interacts, so a selection outlives the page. This is NOT
 * `ctx.connection.api.*` — that plane is closed to plugins; it is
 * `ctx.connection.rpc.handle`, the generic registry
 * (dsh-client-connection/lib/types/rpc.d.ts:15-23).
 *
 * `authority: 'loopback'` is deliberate and load-bearing. It resolves to an
 * empty trusted-host list (dsh-client-connection/lib/index.js:243) and funnels
 * into `isLoopbackHostname` at :189 — the SAME predicate that
 * bin/loopback-localhost-patch.mjs widens to accept `*.localhost`. So this
 * channel is reachable at arxa.studio.localhost only because arxa patches it;
 * if that patch is ever retired this must move to 'trusted-host' in the same
 * change. (The alternative, a plugin `ctx.webServer.register` route, is NOT
 * behind the Host-header fence at all — which is why it is not used here.)
 *
 * Selection state is deliberately in-memory and session-scoped: it is UI
 * memory, not a database. The durable record of what the agent rendered is
 * the tool result in the session log; the durable record of what the user
 * chose is the message they send next.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  CATALOG, COMPONENT_NAMES, toA2uiMessages, validateComponents,
} from './catalog.js'

// Same resolution dance as plugins/pi-delegate: arxa's own install first, else
// the operator install this machine already carries (read-only reuse).
const defineTool = await (async () => {
  try { return (await import('@deepseek-ai/dsh-tools')).defineTool } catch { /* not installed here */ }
  const op = join(homedir(), '.dsh', 'profiles', 'node_modules',
    '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  if (existsSync(op)) return (await import(pathToFileURL(op).href)).defineTool
  throw new Error('arxa-gen-ui: cannot resolve @deepseek-ai/dsh-tools')
})()

export const name = 'arxa-gen-ui'
export const inject = ['tools', 'connection']

// A channel is a single URL path segment: dsh enforces
// /^\/[A-Za-z0-9._~-]+$/ and reserves "/api" (dsh-client-connection
// lib/index.js:203,331). No nested path — "arxa/gen-ui" is rejected at boot.
const RPC_CHANNEL = '/arxa-gen-ui'

/** Catalogue reference the model reads in the tool description. */
const CATALOG_DOC = COMPONENT_NAMES
  .map((n) => `  - ${n} ${CATALOG[n].props}\n      ${CATALOG[n].summary}`)
  .join('\n')

export function apply (ctx, config = {}) {
  const maxComponents = config.maxComponents ?? 40

  // ---- Stage 3: interaction state + its channel -------------------------
  // surfaceId -> { componentId -> value }. Cleared when the process restarts;
  // see the header note on why this is not persisted.
  /** @type {Map<string, Record<string, unknown>>} */
  const selections = new Map()

  ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    // Every verb is an explicit allowlist entry. A generic "call anything"
    // bridge is the failure mode called out in plan decision 20 — a bridge is
    // invisible to CSP, so its narrowness IS the control.
    switch (endpoint) {
      case 'select': {
        const { surfaceId, componentId, value } = payload ?? {}
        if (typeof surfaceId !== 'string' || typeof componentId !== 'string') {
          return { ok: false, error: { message: 'select needs string surfaceId and componentId' } }
        }
        const surface = selections.get(surfaceId) ?? {}
        surface[componentId] = value
        selections.set(surfaceId, surface)
        return { ok: true, value: { surfaceId, selections: surface } }
      }
      case 'state': {
        const { surfaceId } = payload ?? {}
        if (typeof surfaceId !== 'string') {
          return { ok: false, error: { message: 'state needs a string surfaceId' } }
        }
        return { ok: true, value: { surfaceId, selections: selections.get(surfaceId) ?? {} } }
      }
      default:
        return { ok: false, error: { message: `arxa-gen-ui: unknown endpoint ${JSON.stringify(endpoint)}` } }
    }
  }, { authority: 'loopback' })

  // ---- Stage 1: the tool -------------------------------------------------
  ctx.tools.register(defineTool({
    name: 'gen_ui',
    description:
      'Render a live interactive UI surface inline in this conversation, instead of '
      + 'describing it in prose. Use when the answer IS a thing to look at or act on: '
      + 'a viewport preview, a choice for the user to make, a before/after comparison.\n\n'
      + 'You do not write HTML or code. You name components from a fixed catalogue and '
      + 'give them props; the client renders them with its own vetted widgets. '
      + 'Naming a component outside the catalogue is an error, not a fallback.\n\n'
      + `Catalogue:\n${CATALOG_DOC}\n\n`
      + 'Each entry in `components` is `{ "id": "<unique>", "component": "<name>", ...props }`. '
      + 'Components render in array order. Prefer one surface with a few components over '
      + 'several calls. To assemble or update a surface step by step, call again with the '
      + 'SAME `surfaceId` (the result receipt names it) and the client folds the calls into '
      + 'ONE card that grows in place — each call REPLACES the component list (A2UI '
      + 'updateComponents semantics), so always send the full list, never a delta.',
    parameters: {
      title: {
        type: 'string',
        description: 'Short card header describing what this surface shows.',
        required: true,
      },
      // `json` (not a nested object schema) because A2UI props vary per
      // component; a per-component union here would be a second source of
      // truth against lib/catalog.js. Validated in execute instead.
      components: {
        type: 'array',
        items: { type: 'json' },
        description: 'Component objects: { id, component, ...props }. See the catalogue above.',
        required: true,
      },
      dataModel: {
        type: 'json',
        description: 'Optional initial data model for the surface (A2UI updateDataModel).',
      },
      surfaceId: {
        type: 'string',
        description: 'Optional. Omit to start a NEW surface. To update or extend a surface '
          + 'you already emitted in this conversation, pass the SAME surfaceId again — the '
          + 'calls fold into one card that updates in place.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          surfaceId: { type: 'string', required: true, description: 'Unique id for this surface.' },
          title: { type: 'string', required: true, description: 'Card header.' },
          messages: {
            type: 'array',
            items: { type: 'json' },
            required: true,
            description: 'Canonical A2UI v0.9 envelopes.',
          },
        },
      },
      // What the MODEL reads back. Deliberately a receipt, not an echo: the
      // model already knows what it sent, and re-feeding the whole tree wastes
      // context and invites it to "correct" a surface that rendered fine.
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered surface ${value.surfaceId} — "${value.title}". `
          + 'It is now visible to the user in the conversation. Do not repeat its '
          + 'contents in prose. To update or extend this surface, call gen_ui again '
          + `with surfaceId "${value.surfaceId}" and the full new component list.`,
      }],
      // THE seam that makes stage 2 durable. `presentationMeta` is the
      // "pure replayable presentation metadata" that lands on the settled node
      // as `ToolResultNode.meta` (conversation.d.ts:161-187) — so the browser
      // half renders from persisted data and re-renders identically forever,
      // rather than re-parsing the model-facing content blocks.
      presentationMeta: (_args, value) => ({
        surfaceId: value.surfaceId,
        title: value.title,
        messages: value.messages,
      }),
    },
    // Stage 1 fallback cards: what the user sees with NO client plugin loaded.
    presentCall: (args) => ({
      card: 'generic',
      title: `Rendering UI — ${args.title}`,
      kind: 'other',
    }),
    presentResult: (args, _result) => ({
      card: 'generic',
      title: args.title,
      content: [{
        type: 'text',
        text: `Interactive surface with ${Array.isArray(args.components) ? args.components.length : 0} `
          + 'component(s). Open this conversation in the arxa studio web UI to interact with it.',
      }],
    }),
    async execute (args, exec) {
      const problems = validateComponents(args.components)
      if (args.components?.length > maxComponents) {
        problems.push(`components has ${args.components.length} entries; the cap is ${maxComponents}.`)
      }
      // Omitted/empty means "new surface". When given it must be URL- and
      // log-safe: it keys the durable selection record and the fold ledger.
      if (args.surfaceId !== undefined && args.surfaceId !== null && args.surfaceId !== ''
        && (typeof args.surfaceId !== 'string' || !/^[A-Za-z0-9._~-]{1,120}$/.test(args.surfaceId))) {
        problems.push('`surfaceId` must be 1-120 chars of [A-Za-z0-9._~-] when given.')
      }
      if (problems.length > 0) {
        // Throwing gives the model an isError result it can repair from —
        // A2UI's own repair-loop posture (kit/genui_bridge emits errors rather
        // than throwing for the same reason).
        throw new Error(`gen_ui: invalid surface.\n${problems.map((p) => `- ${p}`).join('\n')}`)
      }
      // callId is unique per tool call and is what the browser half keys its
      // durable selection state on, so the surface and its interactions share
      // one identity across reloads. A model-supplied surfaceId wins: that is
      // how a surface is UPDATED across calls (the client folds on it).
      const surfaceId = typeof args.surfaceId === 'string' &&
        /^[A-Za-z0-9._~-]{1,120}$/.test(args.surfaceId)
        ? args.surfaceId
        : (exec.callId ?? `surface-${Date.now()}`)
      return {
        surfaceId,
        title: args.title,
        messages: toA2uiMessages(surfaceId, args.components, args.dataModel),
      }
    },
  }))
}
