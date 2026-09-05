// Load-time patch for dsh-client-connection's loopback classifier — BOTH
// copies of it.
//
// dsh pins the privileged /api plane (settings.*, credentials.*,
// agentPreset.*, host.*, llm.discoverModels) to LOOPBACK hostnames — by
// design, and rightly. But its classifier accepts only the exact strings
// "localhost" / "[::1]" / 127.x.x.x, while RFC 6761 and the WHATWG URL spec
// define every *.localhost name as loopback (OS resolvers and browsers both
// send arxa.studio.localhost to 127.0.0.1 — verified 2026-08-21). The same
// predicate exists twice:
//
//  1. HOST side (lib/index.js) — the /api fence. Patched via a
//     registerHooks load transform.
//  2. BROWSER side (lib/client.js) — `connection.isLoopback`, which the
//     models/settings/deliverables pages branch on to show privileged UI.
//     That file is served as a static asset (dsh-client-modules reads it
//     with node:fs), so it is patched at the fs seam, length-preserved so
//     the served bytes and the content-hash rev stay consistent.
//
// This is a semantic correction of one predicate — not a fork: arxa pins
// @deepseek-ai/* exactly, and if a dep bump rewrites the needle both paths
// throw at boot instead of silently shipping a broken (or silently
// widened) fence.
import { registerHooks, syncBuiltinESMExports } from 'node:module'
import fs from 'node:fs'

const NEEDLE = 'if (hostname === "localhost" || hostname === "[::1]") return true;'
const WIDE = 'if (/(^|\\.)localhost$|^\\[::1\\]$/.test(hostname)) return true;'
if (WIDE.length > NEEDLE.length) throw new Error('arxa: loopback patch grew past its needle — repad')
const PATCH = WIDE + ' '.repeat(NEEDLE.length - WIDE.length)

const missing = (where) => new Error(`arxa: loopback-localhost patch needle missing in ${where} — `
  + 'dsh-client-connection changed shape; re-verify the /api fence before bumping the pin')

// 1. Host copy, via the module loader.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.includes('dsh-client-connection/lib/index.js')) return result
    const source = result.source?.toString()
    if (source === undefined || !source.includes(NEEDLE)) throw missing('lib/index.js')
    return { ...result, source: source.replaceAll(NEEDLE, PATCH) }
  },
})

// 2. Browser copy, at the fs seam it is served through.
const CLIENT_SUFFIX = 'dsh-client-connection/lib/client.js'
function maybePatch(path, data) {
  if (typeof path !== 'string' || !path.endsWith(CLIENT_SUFFIX)) return data
  const text = data.toString()
  if (!text.includes(NEEDLE)) throw missing('lib/client.js')
  const patched = text.replaceAll(NEEDLE, PATCH)
  return typeof data === 'string' ? patched : Buffer.from(patched)
}
const origReadFile = fs.promises.readFile
fs.promises.readFile = async function (path, ...rest) {
  return maybePatch(path, await origReadFile.call(this, path, ...rest))
}
const origReadFileSync = fs.readFileSync
fs.readFileSync = function (path, ...rest) {
  return maybePatch(path, origReadFileSync.call(this, path, ...rest))
}
// dsh-client-modules reads bundles through `import { readFileSync } from 'node:fs'` — a NAMED
// ESM binding, which assigning over fs.readFileSync does not move. Without this sync the browser
// got the stock predicate (found live 2026-09-06: connection.isLoopback false at
// arxa.studio.localhost, settings mirror "memory", Models page "settings are unavailable in this
// browser"). bin/selftest.loopback-patch.mjs pins it.
syncBuiltinESMExports()
