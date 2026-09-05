// The loopback patch must reach the bundle the way dsh-client-modules actually reads it:
// `import { readFileSync } from "node:fs"` — a named ESM binding. Assigning over
// `fs.readFileSync` alone does NOT move that binding (found live 2026-09-06: the browser got the
// stock predicate, `connection.isLoopback` was false at arxa.studio.localhost, the settings mirror
// went "memory", and the Models page read "settings are unavailable in this browser").
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const NEEDLE = 'if (hostname === "localhost" || hostname === "[::1]") return true;'
const tmp = mkdtempSync(join(tmpdir(), 'arxa-loopback-'))
const dir = join(tmp, 'node_modules/@deepseek-ai/dsh-client-connection/lib')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'client.js'), `function isLoopbackHostname(hostname) {\n\t${NEEDLE}\n}\n`)
const probe = join(tmp, 'probe.mjs')
writeFileSync(probe, `
import { readFileSync } from 'node:fs'
import fs from 'node:fs'
const p = ${JSON.stringify(join(dir, 'client.js'))}
const N = ${JSON.stringify(NEEDLE)}
console.log(JSON.stringify({
  named: !readFileSync(p).toString().includes(N),
  dflt: !fs.readFileSync(p).toString().includes(N),
  prom: !(await fs.promises.readFile(p)).toString().includes(N),
  same: readFileSync(p).length === fs.readFileSync(p).length,
}))`)
const r = spawnSync(process.execPath, ['--import', join(here, 'loopback-localhost-patch.mjs'), probe], { encoding: 'utf8' })
assert.equal(r.status, 0, r.stderr)
const out = JSON.parse(r.stdout.trim())
assert.equal(out.dflt, true, 'fs.readFileSync is patched')
assert.equal(out.prom, true, 'fs.promises.readFile is patched')
assert.equal(out.named, true, 'the NAMED ESM import of readFileSync is patched too — that is the one dsh-client-modules serves bundles through')
assert.equal(out.same, true, 'length-preserved so the content-hash rev stays consistent')
console.log('selftest.loopback-patch: 4 ok')
