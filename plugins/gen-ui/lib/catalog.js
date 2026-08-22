/**
 * The arxa gen-UI component catalogue — the HOST half's list, and the
 * authority on what the model is allowed to name.
 *
 * This file is the security model. A2UI's guarantee is "agents can only name
 * components the client already trusts", and the host enforces it here:
 * `validateComponents` rejects an unknown name at tool-execute time, so an
 * out-of-catalogue component never reaches the browser.
 *
 * HONEST CAVEAT — this is not literally one shared list. `lib/client.js` is a
 * hand-written `__ModuleLoader__` factory with no bundler, so it cannot import
 * this module; it carries its own `RENDERERS` map and its own `DEFAULT_RUNGS`.
 * Two lists that must be edited together. Divergence is survivable, not
 * silent: a name here without a renderer there draws a visible
 * "not in this build's catalogue" placeholder, and a renderer there without a
 * name here is unreachable because the host rejects the call. Adding a
 * component means editing BOTH files — that two-step is the actual contract.
 *
 * Kept to five, per plan decision 23: three driven by real arxa need (rung
 * ladder, choice, diff) plus two primitives so a surface can carry prose.
 * Resist growing it speculatively — an unused component is a renderer nobody
 * has looked at.
 *
 * Props are documented here rather than schema-enforced per component: the
 * tool's `components` parameter is `type: 'json'` because A2UI props vary by
 * component, and a per-component schema union would be a second source of
 * truth. The renderers treat every prop as untrusted and default it.
 */

/** @typedef {{ props: string, summary: string }} CatalogEntry */

/** @type {Record<string, CatalogEntry>} */
export const CATALOG = {
  Heading: {
    props: '{ text: string, level?: 1 | 2 | 3 }',
    summary: 'A section heading. Use at most one level-1 per surface.',
  },
  Text: {
    props: '{ text: string, tone?: "normal" | "muted" }',
    summary: 'A paragraph of prose. No markdown — plain text only.',
  },
  Choice: {
    props: '{ prompt: string, options: Array<{ id: string, label: string, description?: string }>, allowMultiple?: boolean }',
    summary: 'Ask the user to pick. The selection is recorded host-side and '
      + 'survives reload; read it back with the same tool call id.',
  },
  Diff: {
    props: '{ path: string, before: string, after: string }',
    summary: 'A before/after comparison of one file or value, rendered as a '
      + 'line-by-line diff.',
  },
  RungLadder: {
    props: '{ url: string, rungs?: Array<{ label: string, w: number, h: number }> }',
    summary: 'Live viewport ladder — iframes `url` at each rung size, scaled to '
      + 'fit. Defaults to the appbox rungs (mobile/tablet/desktop).',
  },
}

/** The appbox viewport ladder, mirrored from the design panel. */
export const DEFAULT_RUNGS = [
  { label: 'mobile', w: 390, h: 844 },
  { label: 'tablet', w: 744, h: 1133 },
  { label: 'desktop', w: 1280, h: 832 },
]

/** A2UI protocol version. Pinned to what `kit/genui_bridge` accepts on the
 * wire (`appBoxKitA2uiVersion` in appbox_kit_a2ui_message.dart) so one
 * vocabulary spans the thread UI and generated Flutter apps. */
export const A2UI_VERSION = 'v0.9'

/** Catalogue id carried in `createSurface`. Namespaced so a future second
 * catalogue (or a third-party one) is distinguishable on the wire. */
export const CATALOG_ID = 'arxa/thread@1'

/** Component names, for the tool description and host-side validation. */
export const COMPONENT_NAMES = Object.keys(CATALOG)

/**
 * Validate an author-supplied component list against the catalogue.
 * @param {unknown} components - the tool's `components` argument.
 * @returns {string[]} human-readable problems; empty means valid.
 */
export function validateComponents (components) {
  if (!Array.isArray(components) || components.length === 0) {
    return ['`components` must be a non-empty array.']
  }
  const problems = []
  const seen = new Set()
  components.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`components[${i}] must be an object.`)
      return
    }
    const { id, component } = entry
    if (typeof id !== 'string' || id.length === 0) {
      problems.push(`components[${i}].id must be a non-empty string.`)
    } else if (seen.has(id)) {
      problems.push(`components[${i}].id "${id}" is duplicated; ids must be unique within a surface.`)
    } else {
      seen.add(id)
    }
    if (typeof component !== 'string' || !(component in CATALOG)) {
      problems.push(`components[${i}].component ${JSON.stringify(component)} is not in the catalogue.`
        + ` Known components: ${COMPONENT_NAMES.join(', ')}.`)
    }
  })
  return problems
}

/**
 * Canonical A2UI v0.9 envelopes for one surface.
 *
 * Wire form is exactly `{version, <verb>: {...}}` with one verb per envelope,
 * matching AppBoxKitA2uiMessage.toJson(). Emitted as an array because a
 * surface is at minimum createSurface + updateComponents.
 * @param {string} surfaceId - unique id for this surface.
 * @param {unknown[]} components - validated component objects.
 * @param {unknown} dataModel - optional initial data model.
 * @returns {object[]} canonical envelopes.
 */
export function toA2uiMessages (surfaceId, components, dataModel) {
  const messages = [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: CATALOG_ID, sendDataModel: dataModel !== undefined } },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ]
  if (dataModel !== undefined) {
    messages.push({ version: A2UI_VERSION, updateDataModel: { surfaceId, value: dataModel } })
  }
  return messages
}

/** The strict sandbox: an opaque origin, no cookies, no storage, no DOM reach. */
export const STRICT_SANDBOX = 'allow-scripts allow-forms'

/** The strict sandbox plus the frame's own origin — still cross-origin to us. */
export const SAME_ORIGIN_SANDBOX = 'allow-scripts allow-forms allow-same-origin'

/**
 * Which `sandbox` a RungLadder iframe gets for `url`.
 *
 * Without `allow-same-origin` a framed page runs on an OPAQUE origin: its own
 * fetches, cookies and storage all fail the same-origin policy, so a
 * server-rendered app (every `appbox design serve` artifact) boots into a blank
 * frame and logs "Unsafe attempt to load URL ... Domains, protocols and ports
 * must match". That is why the ladder rendered black while the design panel —
 * whose iframe carries NO sandbox because its URL is operator-typed — was fine.
 * The difference is provenance: this URL arrives in model-supplied tool args.
 *
 * Granting `allow-same-origin` unconditionally would be the hole the strict
 * sandbox was there to close. MDN's escape is CONDITIONAL: `allow-scripts`
 * plus `allow-same-origin` lets a document drop its own sandbox only "when the
 * embedded document has the same origin as the embedding page". So the grant is
 * safe exactly when the target is somewhere else, and that is what this decides.
 *
 * Three ways this goes wrong, all closed here:
 *  - a RELATIVE url (`/admin`) resolves against our own page, so it must parse
 *    with a base or it silently looks foreign;
 *  - `data:`/`javascript:` URLs have origin `"null"`, which is `!==` ours — a
 *    naive difference check would GRANT them;
 *  - hostname, not origin, is the comparison: cookies ignore the port, so
 *    `arxa.studio.localhost:9999` could read the studio's cookies.
 * Anything unparseable fails closed.
 *
 * @param {unknown} url - the model-supplied `url` prop.
 * @param {string} selfHref - the embedding page's href (`window.location.href`).
 * @returns {string} the `sandbox` attribute value.
 */
export function sandboxFor (url, selfHref) {
  if (typeof url !== 'string' || url.trim() === '') return STRICT_SANDBOX
  let target, self
  try {
    target = new URL(url, selfHref)
    self = new URL(selfHref)
  } catch { return STRICT_SANDBOX }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return STRICT_SANDBOX
  if (target.hostname === '' || target.hostname === self.hostname) return STRICT_SANDBOX
  return SAME_ORIGIN_SANDBOX
}
