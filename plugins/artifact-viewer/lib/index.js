// Host half of arxa-artifact-viewer (D7 + D78-D87): the artifact viewer-editor.
// Task 1 skeleton — settings namespace only. The per-org GET-only file server
// (D7), read/write token classes (D7/D81), the engine write API (D81), and the
// external-change watcher (D86) land in later tasks of
// docs/plans/artifact-viewer-implementation.md.
//
// Imports resolve from the operator dsh install when the profile's copied
// node_modules lacks @deepseek-ai/* (same fallback dance as design-panel and
// pi-delegate — pnpm copies file: deps without their peers).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function fromDsh(pkg, sub) {
  try { return await import(pkg) } catch {
    return await import(pathToFileURL(join(
      homedir(), '.dsh', 'profiles', 'node_modules', pkg, sub)).href)
  }
}
const { installSettingsSection, settingsNamespace } =
  await fromDsh('@deepseek-ai/dsh-settings', 'lib/index.js')
const { default: z } = await fromDsh('@deepseek-ai/schemastery', 'lib/index.mjs')
import { createOrgServer } from './org-server.js'
import { startOrgFollow } from './follow.js'

export const name = 'arxa-artifact-viewer'

// D81 invariant: artifact URL tokens live at most 120 s, whatever settings say.
export const TOKEN_TTL_CEILING_SECONDS = 120

export function defaultSettings() {
  return { maxEditBytes: 5_000_000, tokenTtlSeconds: 120 }
}

const NS = settingsNamespace('arxa-artifact-viewer')
export const SCHEMA = z.object({
  maxEditBytes: z.number().min(1024).default(5_000_000).description(
    'Files above this size open read-only (D82 hard guard)'),
  tokenTtlSeconds: z.number().min(5).max(TOKEN_TTL_CEILING_SECONDS).default(120).description(
    'Artifact URL token lifetime in seconds; never above 120 (D7/D81)'),
})

let current = defaultSettings()
export function currentSettings() { return { ...current } }

// D7: exactly one per-org server, spawned on org mount, killed on org switch.
// verify: null until Task 3 plugs the read-token class — deny-default posture.
let follow = null
export function stopFollow() {
  const f = follow
  follow = null
  return f ? f.stop() : Promise.resolve()
}

function ensureFollow() {
  if (follow) return follow
  follow = startOrgFollow({
    env: process.env,
    createServer: (opts) => createOrgServer(opts),
    log: (m) => console.log('[arxa-artifact-viewer] ' + m),
  })
  return follow
}

export function apply(ctx, config) {
  const entry = { ...defaultSettings(), ...(config ?? {}) }
  if (entry.tokenTtlSeconds > TOKEN_TTL_CEILING_SECONDS) {
    entry.tokenTtlSeconds = TOKEN_TTL_CEILING_SECONDS
  }
  current = entry
  installSettingsSection(ctx, NS, SCHEMA, entry, {
    setSource: () => { /* host half reads currentSettings(); browser half reads settings.describe */ },
    onChange: (next) => { if (next && typeof next === 'object') current = { ...current, ...next } },
  })
  // Boot must survive a follow failure — a plugin throwing at apply() kills
  // the engine cold (theme-accent D84 lesson). Log loud, never crash.
  try { ensureFollow() } catch (err) {
    console.error('[arxa-artifact-viewer] follow startup failed: ' + (err && err.message))
  }
}
