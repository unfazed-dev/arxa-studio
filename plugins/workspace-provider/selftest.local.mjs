/**
 * LocalWorkspaceProvider + the conformance kit, local leg (task 13 steps 4–5).
 *
 * The kit runs against the local provider with NO network, NO account, NO
 * database, NO environment variable — the CLAUDE.md local-first parity law:
 * the section list and the green/red semantics are identical to the network
 * run; only cross-org isolation prints `n/a (single-user local store)`.
 *
 * Run: node plugins/workspace-provider/selftest.local.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalWorkspaceProvider } from './lib/local.js'
import { runConformance } from './lib/conformance.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const tmp = mkdtempSync(join(tmpdir(), 'arxa-ws-local-'))

try {
  // ---------------------------------------------- 1. conformance, local leg
  const provider = new LocalWorkspaceProvider({ home: tmp })
  // localExempt is CLAIMED by the caller, never inferred by the kit.
  const report = await runConformance(provider, { tmp: join(tmp, 'bundle'), localExempt: true, signIn: [] })
  const byId = Object.fromEntries(report.sections.map((s) => [s.id, s]))
  const NA = 'cross-org-isolation'
  assert.equal(byId[NA].status, 'n/a', 'local is exempt from cross-org, and says so')
  assert.equal(byId[NA].details[0], 'n/a (single-user local store)', 'the exact §4 wording')
  for (const s of report.sections) {
    if (s.id === NA) continue
    assert.equal(s.status, 'green', s.id + ' → ' + s.details.join(' | '))
  }
  assert.equal(report.ok, true)
  ok('conformance: all sections green; cross-org prints n/a (single-user local store)')

  // ---------------------------------------------- 2. layout + permissions
  const root = join(tmp, 'workspace')
  assert.equal(statSync(root).mode & 0o777, 0o700, 'workspace root is 0700')
  const orgDirs = readdir0700(root)
  assert.ok(orgDirs.length >= 1, 'at least one org dir exists (the kit created orgs)')
  for (const d of orgDirs) assert.equal(statSync(join(root, d)).mode & 0o777, 0o700, 'per-org dir 0700')
  for (const d of orgDirs) {
    assert.ok(existsSync(join(root, d, 'org.json')), 'org.json document per org')
    assert.ok(existsSync(join(root, d, 'members.json')), 'members.json per org')
    JSON.parse(readFileSync(join(root, d, 'org.json'), 'utf8')) // atomic docs are valid JSON
  }
  ok('layout: <ARXA_HOME>/workspace/<orgId>/ with 0700 root and per-org dirs; JSON documents')

  // ---------------------------------------------- 3. audit is append-only JSONL
  {
    const p = new LocalWorkspaceProvider({ home: tmp })
    const org = await p.createOrg({ name: 'audit-org', kind: 'studio' })
    await p.appendAudit(org.id, { action: 'first' })
    await p.appendAudit(org.id, { action: 'second' })
    const lines = readFileSync(join(root, org.id, 'audit.jsonl'), 'utf8').trim().split('\n')
    assert.equal(lines.length, 2, 'one JSONL line per append')
    const [a, b] = lines.map((l) => JSON.parse(l))
    assert.equal(a.action, 'first'); assert.equal(b.action, 'second')
    assert.ok(typeof a.at === 'string' && a.at <= b.at, 'entries carry timestamps, ordered')
    // immutability is the interface SHAPE: no mutation method exists at all
    for (const m of ['updateAudit', 'patchAudit', 'deleteAudit']) assert.equal(typeof p[m], 'undefined')
    const read = await p.readAudit(org.id)
    assert.equal(read.length, 2)
    ok('audit: append-only JSONL, one line per event, read-only by interface shape')
  }

  // ---------------------------------------------- 4. zero config of any kind
  {
    // A provider with NO options beyond home boots and serves a full CRUD loop.
    const p = new LocalWorkspaceProvider({ home: tmp })
    const caps = await p.capabilities()
    assert.equal(caps.realtime, true, 'local realtime is the in-process emitter (better than polling)')
    assert.equal(caps.analytics, false, 'analytics degrades to the no-op sink')
    const org = await p.createOrg({ name: 'zero', kind: 'studio' })
    const r = await p.putRecord(org.id, 'tickets', 't1', { title: 'works offline' })
    assert.ok(typeof r.etag === 'string' && r.etag.length > 0)
    assert.equal((await p.getRecord(org.id, 'tickets', 't1')).doc.title, 'works offline')
    ok('zero-config: no network/account/database/env — CRUD works out of the box')
  }

  // ---------------------------------------------- 5. local realtime: in-process subscribe
  {
    const p = new LocalWorkspaceProvider({ home: tmp })
    const org = await p.createOrg({ name: 'rt', kind: 'studio' })
    const seen = []
    const stop = p.subscribe(org.id, 'tickets', (ev) => seen.push(ev))
    await p.putRecord(org.id, 'tickets', 'live', { title: 'push' })
    await p.deleteRecord(org.id, 'tickets', 'live')
    stop()
    await p.putRecord(org.id, 'tickets', 'after-stop', { title: 'no cb' })
    assert.equal(seen.length, 2, 'one event per write, none after unsubscribe')
    assert.equal(seen[0].type, 'put'); assert.equal(seen[0].id, 'live')
    assert.equal(seen[1].type, 'delete')
    ok('realtime: in-process emitter fires per write; unsubscribe stops delivery')
  }

  // ---------------------------------------------- 6. session contract (§1 local row)
  {
    const p = new LocalWorkspaceProvider({ home: tmp })
    const s = await p.currentSession()
    assert.equal(typeof s.userId, 'string')
    const events = []
    const stop = p.onAuthStateChange((ev) => events.push(ev))
    await p.signIn('token', {})
    await p.signOut()
    stop()
    assert.equal(events.length, 2, 'the no-op sign-in/out still fire onAuthStateChange')
    assert.equal(events[0].userId, s.userId)
    assert.equal(events[1], null)
    assert.equal((await p.currentSession()).userId, s.userId, 'local currentSession always returns the operator')
    ok('auth: single local user; signIn/signOut no-ops that still fire onAuthStateChange')
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

function readdir0700 (dir) {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
}

console.log(`workspace-provider local conformance: ${n} checks green`)
