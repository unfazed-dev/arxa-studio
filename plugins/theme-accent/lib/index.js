/**
 * arxa-theme-accent (host half) — the accent choice's SERVER side.
 *
 * The accent used to live ONLY in each browser's localStorage, so the phone's
 * webview (separate device, separate storage) always rendered the DEFAULT
 * blue — the desktop's choice never crossed devices. The engine is the source
 * of truth now; the client half treats localStorage as an instant cache.
 *
 *   GET /__arxa/theme-accent → 200 { accent: "#12D49A" | null }
 *   PUT /__arxa/theme-accent  body { accent } → 200 { accent } | 400
 *
 * Persistence: ~/.arxa/theme-accent.json (the studio config home — the same
 * ARXA_HOME convention as organisation.json). Durable across desktop
 * restarts AND sidecar re-materialization: the engine cache dir is
 * ephemeral, the config home is not. Only the three fixed swatches the
 * client half renders are accepted, so a stray writer cannot repaint the
 * studio with arbitrary values. Zero-dep by plugin convention.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'arxa-theme-accent'
// D84 cold-boot fix: webServer is a cordis SERVICE, and apply() reads it
// synchronously. Without declaring it here cordis refuses the property
// access — "cannot get property \"webServer\" without inject" — which killed
// the WHOLE engine boot on the first cold profile re-materialization
// (engine.log 2026-08-30: every boot of payload cf18c6018985 died here).
// Every sibling plugin (approvals, arxa-sidebar, waiting-page) declares its
// services; theme-accent was the lone omission.
export const inject = ['webServer']

const SWATCHES = ['#0EBAE4', '#0EE4E0', '#12D49A']

/** The accent file: $ARXA_HOME/theme-accent.json, defaulting to ~/.arxa —
 * mirroring plugins/workspace/lib/root.js's arxaHome(). */
export function accentFilePath(env = process.env) {
  const home = env.ARXA_HOME || path.join(os.homedir(), '.arxa')
  return path.join(home, 'theme-accent.json')
}

/** Read/validate/persist seam. fs importable for tests. */
export function createAccentStore(env = process.env) {
  return {
    read() {
      try {
        const data = JSON.parse(fs.readFileSync(accentFilePath(env), 'utf8'))
        return SWATCHES.includes(data?.accent) ? data.accent : null
      } catch {
        return null // missing or corrupt file = never chose (or junk) → null
      }
    },
    write(accent) {
      if (!SWATCHES.includes(accent)) {
        throw new Error('accent must be one of ' + SWATCHES.join(', '))
      }
      const file = accentFilePath(env)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify({ accent }, null, 2) + '\n')
      return accent
    },
  }
}

export function apply(ctx, opts = {}) {
  const store = opts.store ?? createAccentStore()

  const json = (res, status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  // D84: ONE registration per path. dsh-host-webserver keys routes by
  // (kind, path) — method is NOT part of the key and a second exact
  // registration of the same path throws ("duplicate exact route"), which
  // killed the whole engine boot on the first pack against the current
  // webserver contract (engine.log 2026-08-30). The handler dispatches on
  // req.method instead.
  ctx.webServer.register({
    name: 'arxa-theme-accent-route',
    path: '/__arxa/theme-accent',
    kind: 'exact',
    handler: async (req, res) => {
      if (req.method === 'PUT') {
        try {
          const body = await new Promise((resolve, reject) => {
            let raw = ''
            req.on('data', (c) => {
              raw += c
              if (raw.length > 4096) reject(new Error('body too large'))
            })
            req.on('end', () => resolve(raw))
            req.on('error', reject)
          })
          const saved = store.write(JSON.parse(body)?.accent)
          json(res, 200, { accent: saved })
        } catch (e) {
          json(res, 400, { error: String(e?.message ?? e) })
        }
        return
      }
      try {
        json(res, 200, { accent: store.read() })
      } catch (e) {
        json(res, 500, { error: String(e?.message ?? e) })
      }
    },
  })
}
