// Host half of arxa-design-panel. Exposes the panel's one setting — the
// design-server URL — as the `arxa-design-panel` settings namespace via
// dsh's canonical settings-section wiring (0.1.2-rc.1 shape), so it appears in
// settings.describe and the browser card (client.js registers into
// `settings.plugin.item`) can read and settings.update it. The browser half
// ships via exports['./client'], discovered through the package.json
// dsh.client declaration.
//
// Imports resolve from the operator dsh install when the profile's copied
// node_modules lacks @deepseek-ai/* (same fallback dance as
// plugins/pi-delegate — pnpm copies file: deps without their peers).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function fromDsh(pkg, sub) {
  try { return await import(pkg) } catch {
    return await import(pathToFileURL(join(
      homedir(), '.dsh', 'profiles', 'node_modules', pkg, sub)).href)
  }
}
const { default: z } = await fromDsh('@deepseek-ai/schemastery', 'lib/index.mjs')

export const name = 'arxa-design-panel'

// dsh 0.1.2-rc.1 dropped the settingsNamespace() branding helper; the
// provider validates kebab-case itself, so the plain string is the namespace.
const NS = 'arxa-design-panel'
const SCHEMA = z.object({
  url: z.string().default('http://127.0.0.1:4319/').description(
    'Live arxa design server the panel iframes'),
})

export function apply(ctx, config) {
  const entry = { url: config?.url ?? 'http://127.0.0.1:4319/' }
  // dsh 0.1.2-rc.1: the exported installSettingsSection helper became the
  // service method SettingsProvider#installSection; the dynamic inject keeps
  // the old helper's optional-dependency behavior (no settings service
  // mounted = nothing registers, the composed entry still works).
  ctx.inject(['settings'], (sctx) => {
    sctx.settings.installSection(ctx, NS, SCHEMA, entry, {
      setSource: () => { /* value is consumed browser-side via settings.describe */ },
      onChange: () => {},
    })
  })
}
