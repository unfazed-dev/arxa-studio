import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopSessionFile, publishDesktopSession } from './lib/index.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const fakeConnection = { authenticatedUrl: (base) => `${base}/?token=TEST-TOKEN-123` }

// THE 2026-09-05 lockout: the desktop webview has no human to click the
// printed `dsh web:` URL — the launch token must reach the shell as a file.
const home = mkdtempSync(join(tmpdir(), 'arxa-desktop-session-'))
const env = { DSH_HOME: home }
const out = publishDesktopSession({ connection: fakeConnection, port: 7891, env, pid: 4242, at: new Date('2026-09-05T00:00:00Z') })
assert.equal(out.url, 'http://arxa.studio.localhost:7891/?token=TEST-TOKEN-123'); ok('the authenticated URL is built on the desktop authority and live port')
assert.equal(out.token, 'TEST-TOKEN-123'); ok('the bare token is extracted for shells that compose their own URL')
assert.equal(out.file, join(home, 'desktop-session.json'))
const doc = JSON.parse(readFileSync(out.file, 'utf8'))
assert.deepEqual(Object.keys(doc).sort(), ['at', 'pid', 'token', 'url'])
assert.equal(doc.token, 'TEST-TOKEN-123'); ok('the session file carries the token')
assert.equal(doc.pid, 4242)
assert.equal(doc.at, '2026-09-05T00:00:00.000Z')
assert.equal(existsSync(`${out.file}.tmp-4242`), false); ok('the write is atomic — no tmp file left behind')

// A second boot republishes over the first — one file, latest token wins.
const second = publishDesktopSession({ connection: { authenticatedUrl: (b) => `${b}/?token=SECOND` }, port: 7891, env, pid: 4343 })
assert.equal(JSON.parse(readFileSync(out.file, 'utf8')).token, 'SECOND'); ok('a reboot overwrites the stale token')

// Path resolution: DSH_HOME wins; without it the default is ~/.arxa/dsh.
assert.equal(desktopSessionFile({ DSH_HOME: '/x/y' }), '/x/y/desktop-session.json'); ok('DSH_HOME env is honored')
assert.ok(desktopSessionFile({}).endsWith(join('.arxa', 'dsh', 'desktop-session.json'))); ok('default home is ~/.arxa/dsh')
assert.equal(desktopSessionFile({ DSH_HOME: '  ' }).includes('/x/y'), false); ok('a blank DSH_HOME falls back, not to a relative path')

rmSync(home, { recursive: true, force: true })
console.log(`selftest.desktop-session: ${n} ok`)
