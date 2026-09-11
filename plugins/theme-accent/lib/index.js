/**
 * arxa-theme-accent (host half) — the palette choice's SERVER side.
 *
 * 0.3.0 (2026-09-11, grilled): the accent became a PALETTE. The engine file
 * is the cross-device source of truth (desktop + phone converge on the 5s
 * poll); each client's localStorage is an instant cache.
 *
 *   GET /__arxa/theme-accent/palette → 200 { palette, accent, name } | null
 *   PUT /__arxa/theme-accent/palette  body { palette, accent? } → 200 { palette, accent, name }
 *   GET /__arxa/theme-accent/contrast.js → the contrast engine (ESM), the
 *        ONE copy of lib/contrast.js — the client half imports it from here,
 *        so the served bytes and this module can never drift.
 *
 * Persistence: $ARXA_HOME/theme-palette.json (default ~/.arxa — the same
 * ARXA_HOME convention as organisation.json). Durable across desktop
 * restarts AND sidecar re-materialization: the engine cache dir is
 * ephemeral, the config home is not.
 *
 * Validation: palette = 2–10 UNIQUE hexes after normalization (coolors' own
 * bounds, lens-verified 2026-09-11 — 1 → 404, 11+ refused). The 0.2.5 fixed
 * swatch whitelist is GONE by design: arbitrary hexes are the feature. What
 * still holds: format + count + body cap are enforced, so a stray writer
 * cannot park junk in the config home. The NAME is best-effort: on PUT the
 * host fetches coolors.co/palette/<hexes> once and extracts the page <h1>
 * (verified live via the lens — "Mystic Evening" / "Fiery Forest"); any
 * failure answers null and the client labels the palette "Custom". The
 * feature is fully local-capable: no name, no network, palette still works.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'arxa-theme-accent'
// D84 cold-boot fix: webServer is a cordis SERVICE, and apply() reads it
// synchronously. Without declaring it here cordis refuses the property
// access — "cannot get property \"webServer\" without inject" — which killed
// the WHOLE engine boot on the first cold profile re-materialization
// (engine.log 2026-08-30: every boot of payload cf18c6018985 died here).
// Every sibling plugin (approvals, arxa-sidebar, waiting-page) declares its
// services.
export const inject = ['webServer']

const BODY_CAP = 4096
const NAME_MAX = 60

/** Normalize one hex token (#abc / abc / #aabbcc / aabbcc) → 'aabbcc', or null. */
const normHex = (x) => {
  let h = String(x ?? '').trim().toLowerCase().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('')
  return /^[0-9a-f]{6}$/.test(h) ? h : null
}

/** Validate a palette string ('1a1423-b75d69') → normalized string, or null.
 *  2–10 unique hexes — coolors' own URL bounds. */
export function validatePalette(palette) {
  if (typeof palette !== 'string' || palette.length > 71) return null
  const hexes = []
  for (const tok of palette.split('-')) {
    const h = normHex(tok)
    if (!h || hexes.includes(h)) return null
    hexes.push(h)
  }
  return hexes.length >= 2 && hexes.length <= 10 ? hexes.join('-') : null
}

/** Validate the full state shape; accent must be a member when present. */
export function validState(v) {
  if (!v || typeof v !== 'object') return null
  const palette = validatePalette(v.palette)
  if (!palette) return null
  const a = normHex(v.accent)
  const accent = a && palette.split('-').includes(a) ? '#' + a : null
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, NAME_MAX) : null
  return { palette, accent, name }
}

/** The palette file: $ARXA_HOME/theme-palette.json, defaulting to ~/.arxa —
 * mirroring plugins/workspace/lib/root.js's arxaHome(). */
export function paletteFilePath(env = process.env) {
  const home = env.ARXA_HOME || path.join(os.homedir(), '.arxa')
  return path.join(home, 'theme-palette.json')
}

/** Page headings that are NEVER a palette name (live-caught 2026-09-11:
 *  000814-…-ffd60a's h1 is the generic word "Palette" — an unnamed palette
 *  shows the page chrome, not a name → the card must read "Custom"). */
const GENERIC_NAMES = new Set(['palette', 'coolors'])

/** Best-effort coolors name: the pasted URL carries hexes only — the name
 *  rides in the page. One fetch, 6s cap, <h1> first (verified live via the
 *  lens 2026-09-11), og:title as the backup pattern. Never throws. */
export async function fetchPaletteName(palette, fetcher = fetch) {
  if (typeof fetcher !== 'function') return null
  try {
    const res = await fetcher('https://coolors.co/palette/' + palette, {
      signal: AbortSignal.timeout(6000),
      headers: { 'user-agent': 'arxa-studio-theme-accent/0.3' },
    })
    if (!res.ok) return null
    const html = (await res.text()).slice(0, 200_000)
    const h1 = /<h1[^>]*>([^<>]{2,80})<\/h1>/.exec(html)
    const og = /og:title"\s+content="([^"]{2,80})\s*-\s*Palette/.exec(html)
    const raw = (h1 && h1[1]) || (og && og[1]) || ''
    const name = raw.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()
    if (!name || GENERIC_NAMES.has(name.toLowerCase())) return null
    return name.slice(0, NAME_MAX)
  } catch {
    return null // offline / blocked / slow: the client says "Custom"
  }
}

/** Read/validate/persist seam. fs importable for tests; fetcher injectable. */
export function createPaletteStore(env = process.env, opts = {}) {
  return {
    read() {
      try {
        const data = JSON.parse(fs.readFileSync(paletteFilePath(env), 'utf8'))
        return validState(data)
      } catch {
        return null // missing or corrupt file = never chose (or junk) → null
      }
    },
    async write(v, fillName = true) {
      const s = validState(v)
      if (!s) throw new Error('palette must be 2-10 unique hex codes, joined with "-"')
      const file = paletteFilePath(env)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      // THE CHOICE LANDS FIRST (the deselect race, live-caught 2026-09-11):
      // the best-effort name fetch used to hold this write open for its
      // whole 6s timeout — and any GET in that window read the PREVIOUS
      // palette, so the client's 5s poll converged the old choice back and
      // REVERTED the pick the user had just made. Palette/accent hit the
      // disk before any network; the name fills in after, guardedly.
      fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n')
      if (fillName && !s.name) {
        // The generic-heading stop-list applies here too — an injected
        // fetcher must not be able to smuggle "Palette" in.
        try {
          const fetched = await (opts.fetchName ?? fetchPaletteName)(s.palette)
          const name = fetched && !GENERIC_NAMES.has(String(fetched).trim().toLowerCase())
            ? String(fetched).slice(0, NAME_MAX) : null
          if (name) {
            // A NEWER write may have landed while we fetched — attach the
            // name only if the file still holds THIS palette.
            try {
              const cur = validState(JSON.parse(fs.readFileSync(file, 'utf8')))
              if (cur && cur.palette === s.palette && !cur.name) {
                s.name = name
                fs.writeFileSync(file, JSON.stringify({ ...cur, name: s.name }, null, 2) + '\n')
              }
            } catch { /* raced out or unreadable: the name is dropped */ }
          }
        } catch { s.name = null }
      }
      return s
    },
  }
}

export function apply(ctx, opts = {}) {
  const store = opts.store ?? createPaletteStore()
  const engineSrc = opts.engineSrc
    ?? fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'contrast.js'), 'utf8')

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
  // webserver contract. The handlers dispatch on req.method instead.
  ctx.webServer.register({
    name: 'arxa-theme-palette-route',
    path: '/__arxa/theme-accent/palette',
    kind: 'exact',
    handler: async (req, res) => {
      if (req.method === 'PUT') {
        try {
          const body = await new Promise((resolve, reject) => {
            let raw = ''
            req.on('data', (c) => {
              raw += c
              if (raw.length > BODY_CAP) reject(new Error('body too large'))
            })
            req.on('end', () => resolve(raw))
            req.on('error', reject)
          })
          const saved = await store.write(JSON.parse(body))
          json(res, 200, saved)
        } catch (e) {
          json(res, 400, { error: String(e?.message ?? e) })
        }
        return
      }
      try {
        json(res, 200, store.read())
      } catch (e) {
        json(res, 500, { error: String(e?.message ?? e) })
      }
    },
  })

  // The contrast engine, served once — the client half imports this URL, so
  // lib/contrast.js stays the ONLY copy (host tests import it directly).
  ctx.webServer.register({
    name: 'arxa-theme-engine-route',
    path: '/__arxa/theme-accent/contrast.js',
    kind: 'exact',
    handler: async (req, res) => {
      res.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(engineSrc)
    },
  })
}
