// arxa-theme-accent selftest — run: node plugins/theme-accent/selftest.mjs
// Exercises the host half's routes against a fake ctx (the same shape the
// engine passes at boot: webServer.register + req/res pairs), and the
// persistence seam against a throwaway ARXA_HOME.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createAccentStore, accentFilePath, apply } from './lib/index.js'
import * as mod from './lib/index.js'

// 0. D84: webServer is a cordis SERVICE and apply() reads it synchronously —
// the module must declare inject or the engine boot dies cold on profile
// re-materialization ("cannot get property \"webServer\" without inject",
// engine.log 2026-08-30, every boot of payload cf18c6018985).
assert.deepEqual(mod.inject, ['webServer'], 'declares inject: ["webServer"]')

const env = { ...process.env, ARXA_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-accent-')) }

// 1. empty store reads null (never chose)
const store = createAccentStore(env)
assert.equal(store.read(), null, 'fresh home reads null')

// 2. write + read round-trip; junk rejected
assert.equal(store.write('#12D49A'), '#12D49A')
assert.equal(store.read(), '#12D49A', 'persisted accent reads back')
assert.throws(() => store.write('#FF0000'), /accent must be one of/, 'off-palette rejected')
assert.throws(() => store.write(undefined), /accent must be one of/, 'missing accent rejected')
assert.equal(fs.readFileSync(accentFilePath(env), 'utf8').includes('"accent": "#12D49A"'), true)

// 3. the route mounts ONCE and dispatches on req.method over fake req/res
// pairs (D84: dsh-host-webserver keys routes by (kind, path) — a second
// exact registration of the same path throws and kills the engine boot).
const routes = {}
const ctx = { webServer: { register(r) { routes[r.path] = r } } }
apply(ctx, { store })
assert.equal(Object.keys(routes).length, 1, 'exactly one registration for the path')
const route = routes['/__arxa/theme-accent']

function fakeRes() {
  let done
  const promise = new Promise((resolve) => { done = resolve })
  const res = {
    statusCode: 0, headers: null, body: '', done: promise,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body; done(this) },
  }
  return res
}
function fakeReq(raw, method = 'GET') {
  const req = { method, on(ev, fn) { if (ev === 'end') queueMicrotask(fn); if (ev === 'data' && raw) fn(raw) } }
  return req
}

let r1 = fakeRes()
await route.handler(fakeReq(), r1); r1 = await r1.done
assert.equal(r1.statusCode, 200)
assert.deepEqual(JSON.parse(r1.body), { accent: '#12D49A' }, 'GET serves the persisted accent')

let r2 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ accent: '#0EE4E0' }), 'PUT'), r2); r2 = await r2.done
assert.equal(r2.statusCode, 200)
assert.deepEqual(JSON.parse(r2.body), { accent: '#0EE4E0' })

let r3 = fakeRes()
await route.handler(fakeReq(), r3); r3 = await r3.done
assert.deepEqual(JSON.parse(r3.body), { accent: '#0EE4E0' }, 'GET reflects the PUT')

let r4 = fakeRes()
await route.handler(fakeReq(JSON.stringify({ accent: '#FF0000' }), 'PUT'), r4); r4 = await r4.done
assert.equal(r4.statusCode, 400, 'off-palette PUT is 400')

fs.rmSync(env.ARXA_HOME, { recursive: true, force: true })
console.log('arxa-theme-accent selftest: ALL GREEN')
