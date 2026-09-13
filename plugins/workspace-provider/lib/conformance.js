/**
 * The reusable conformance kit (task 13 step 4, §4 of the source plan) — the
 * contract's executable form. One kit, every provider: local passes the same
 * sections a network backend must pass; only cross-org isolation differs,
 * printing `n/a (single-user local store)` when the CALLER asserts the
 * provider is local (opts.localExempt) — the exemption is claimed, never
 * inferred, so a network provider can never silently "pass" section 3.
 *
 * Sections: auth, orgs-crud, members-roles, records-crud, pagination,
 * optimistic-conflict, audit-immutability, storage-blobs, realtime-or-polling,
 * idempotent-replay, migration-roundtrip, cross-org-isolation.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { COLLECTIONS } from './contract.js'
import { WorkspaceError } from './errors.js'
import { exportBundle, importBundle } from './export-bundle.js'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const redDetail = (e) => (e instanceof WorkspaceError
  ? e.code + ': ' + e.message
  : 'error: ' + (e?.message ?? String(e)))

const isCode = (e, ...codes) => e instanceof WorkspaceError && codes.includes(e.code)

async function expectCode (codes, fn) {
  try { await fn() } catch (e) {
    if (isCode(e, ...codes)) return e
    throw new Error('wrong error: expected ' + codes.join('|') + ', got ' + redDetail(e))
  }
  throw new Error('expected ' + codes.join('|') + ', nothing thrown')
}

/** Resolve once the predicate sees an event, or reject on timeout. */
const waitFor = (subscribe, ms, pred = () => true) => {
  const p = new Promise((resolve, reject) => {
    const stop = subscribe((ev) => {
      if (!pred(ev)) return
      stop(); clearTimeout(t); resolve(ev)
    })
    const t = setTimeout(() => { stop(); reject(new Error('no event within ' + ms + 'ms')) }, ms)
  })
  // If the section dies before this wait resolves (e.g. its write threw), the
  // timeout still fires later — swallow that orphan rejection instead of
  // killing the process as an unhandled one.
  p.catch(() => {})
  return p
}

export async function runConformance (provider, opts = {}) {
  const sections = []
  const section = async (id, fn) => {
    const details = []
    try {
      await fn((s) => details.push(s))
      sections.push({ id, status: 'green', details })
    } catch (e) {
      sections.push({ id, status: 'red', details: [...details, redDetail(e)] })
    }
  }

  // The shared scratch org most sections build on. A provider that cannot
  // even create one gets an honest red report instead of a crash — `provider
  // verify` must always be printable (dead backend, no session, whatever).
  let org
  try {
    org = await provider.createOrg({ name: 'conformance', kind: 'studio' })
  } catch (e) {
    sections.push({
      id: 'orgs-crud', status: 'red',
      details: ['cannot create a scratch org: ' + redDetail(e)],
    })
    return { sections, ok: false }
  }

  await section('auth', async (note) => {
    const s = await provider.currentSession()
    if (!s || typeof s.userId !== 'string') throw new Error('currentSession() returned no userId')
    note('currentSession → userId')
    if (opts.signIn !== undefined) {
      const events = []
      const stop = provider.onAuthStateChange((ev) => events.push(ev))
      try {
        await provider.signIn(...opts.signIn)
        await provider.signOut()
        if (events.length < 2 || events[0]?.userId !== s.userId || events[events.length - 1] !== null)
          throw new Error('onAuthStateChange did not fire session then null around sign-in/out')
        note('signIn → signOut fired onAuthStateChange')
      } finally { stop() }
    }
  })

  await section('orgs-crud', async (note) => {
    if (!org.id || org.name !== 'conformance') throw new Error('createOrg returned no org')
    const got = await provider.getOrg(org.id)
    if (got.name !== 'conformance') throw new Error('getOrg name mismatch')
    const updated = await provider.updateOrg(org.id, { name: 'conformance-2' })
    if (updated.name !== 'conformance-2') throw new Error('updateOrg did not apply')
    const listed = await provider.listOrgs()
    if (!listed.some((o) => o.id === org.id)) throw new Error('listOrgs missing the org')
    // Archive a DEDICATED org: the shared org is still needed below.
    const doomed = await provider.createOrg({ name: 'archived', kind: 'studio' })
    await provider.archiveOrg(doomed.id)
    await expectCode(['not_found'], () => provider.getOrg(doomed.id))
    note('create → get → update → list → archive → get=not_found')
  })

  await section('members-roles', async (note) => {
    // The org from orgs-crud was archived; make a fresh one.
    const o = await provider.createOrg({ name: 'members', kind: 'studio' })
    const billing = await provider.addMember(o.id, { email: 'b@example.test', role: 'billing' })
    // idempotent replay: same email + same role adds ONE member
    await provider.addMember(o.id, { email: 'b@example.test', role: 'billing' })
    let members = await provider.listMembers(o.id)
    if (members.filter((m) => m.email === 'b@example.test').length !== 1)
      throw new Error('duplicate addMember created a second member')
    await provider.setRole(o.id, billing.id, 'member')
    if ((await provider.listMembers(o.id)).find((m) => m.id === billing.id)?.role !== 'member')
      throw new Error('setRole did not apply')
    // the role vocabulary is fixed: providers may not invent roles
    await expectCode(['invalid_request'], () => provider.addMember(o.id, { email: 'x@example.test', role: 'superuser' }))
    // last-owner removal is rejected
    const sole = (await provider.listMembers(o.id)).find((m) => m.role === 'owner')
    await expectCode(['forbidden'], () => provider.removeMember(o.id, sole.id))
    note('add/dup-add/setRole/bad-role/last-owner rules hold')
  })

  await section('records-crud', async (note) => {
    const doc = { title: 't', body: 'b', n: 1 }
    const put = await provider.putRecord(org.id, 'tickets', 'rc-1', doc)
    if (typeof put.etag !== 'string' || put.etag.length === 0) throw new Error('putRecord returned no etag')
    const got = await provider.getRecord(org.id, 'tickets', 'rc-1')
    if (JSON.stringify(got.doc) !== JSON.stringify(doc)) throw new Error('getRecord doc mismatch')
    await expectCode(['invalid_request'], () => provider.putRecord(org.id, 'passwords', 'x', {}))
    await provider.deleteRecord(org.id, 'tickets', 'rc-1')
    await expectCode(['not_found'], () => provider.getRecord(org.id, 'tickets', 'rc-1'))
    note('put/get/delete round-trip; unknown collection invalid_request; deleted → not_found')
  })

  await section('pagination', async (note) => {
    for (let i = 0; i < 3; i++) await provider.putRecord(org.id, 'feedback', 'pg-' + i, { i })
    const p1 = await provider.listRecords(org.id, 'feedback', { limit: 2 })
    if (p1.records.length !== 2 || p1.nextCursor === null) throw new Error('page 1 not limited/cursored')
    const p2 = await provider.listRecords(org.id, 'feedback', { cursor: p1.nextCursor })
    const ids = [...p1.records, ...p2.records].map((r) => r.id).sort()
    if (ids.join() !== 'pg-0,pg-1,pg-2') throw new Error('pages lost or duplicated records: ' + ids.join())
    if (p2.nextCursor !== null) throw new Error('stream did not end with a null cursor')
    note('limit → cursor → end; union exactly the written records')
  })

  await section('optimistic-conflict', async (note) => {
    const r = await provider.putRecord(org.id, 'user_prefs', 'cf-1', { v: 1 })
    await provider.putRecord(org.id, 'user_prefs', 'cf-1', { v: 2 })
    const e = await expectCode(['conflict'], () => provider.putRecord(org.id, 'user_prefs', 'cf-1', { v: 3 }, { etag: r.etag }))
    note('stale If-Match surfaces conflict' + (e.requestId ? '' : ''))
  })

  await section('audit-immutability', async (note) => {
    await provider.appendAudit(org.id, { action: 'conformance-1' })
    await provider.appendAudit(org.id, { action: 'conformance-2' })
    const rows = await provider.readAudit(org.id)
    if (!rows.some((x) => x.action === 'conformance-1') || !rows.some((x) => x.action === 'conformance-2'))
      throw new Error('appended events missing from the audit read')
    for (const m of ['updateAudit', 'patchAudit', 'deleteAudit'])
      if (typeof provider[m] !== 'undefined') throw new Error('interface exposes ' + m + ' — audit must be append-only by shape')
    note('append + read; no mutation method exists on the interface')
  })

  await section('storage-blobs', async (note) => {
    const bytes = Buffer.from('conformance-blob-bytes')
    const up = await provider.putBlob(org.id, ['conf', 'x.bin'], bytes)
    if (up.sha256 !== sha256(bytes)) throw new Error('upload hash mismatch')
    const down = await provider.getBlob(org.id, ['conf', 'x.bin'])
    if (!down.equals(bytes)) throw new Error('blob bytes changed in transit')
    const url = await provider.signedUrl(org.id, ['conf', 'x.bin'])
    if (!url || typeof url.url !== 'string') throw new Error('no signed url')
    await provider.deleteBlob(org.id, ['conf', 'x.bin'])
    await expectCode(['not_found'], () => provider.getBlob(org.id, ['conf', 'x.bin']))
    note('upload(hash) → download(bytes) → signedUrl → delete → not_found')
  })

  await section('realtime-or-polling', async (note) => {
    const caps = await provider.capabilities()
    // Subscribe FIRST, then write: the wait resolves for BOTH delivery modes —
    // the in-process emitter (local) and the immediate-after-write poll (D35).
    const waiting = waitFor((cb) => provider.subscribe(org.id, 'chat_conversations', cb), 5000, (e) => e.id === 'rt-1')
    await provider.putRecord(org.id, 'chat_conversations', 'rt-1', { live: true })
    await waiting
    note(caps.realtime
      ? 'realtime advertised: subscribe delivered the write'
      : 'realtime absent: polling degradation delivered the write within the active window')
  })

  await section('idempotent-replay', async (note) => {
    const doc = { replay: true }
    const a = await provider.putRecord(org.id, 'requirements', 'idem-1', doc)
    const b = await provider.putRecord(org.id, 'requirements', 'idem-1', doc)
    if (a.etag !== b.etag) throw new Error('same document replaid to a different etag')
    note('identical PUT replays to the identical etag')
  })

  await section('migration-roundtrip', async (note) => {
    const o = await provider.createOrg({ name: 'migrating', kind: 'agency' })
    await provider.putRecord(o.id, 'tickets', 'm-1', { title: 'one' })
    await provider.putRecord(o.id, 'chat_messages', 'm-2', { text: 'two' })
    await provider.addMember(o.id, { email: 'mate@example.test', role: 'member' })
    await provider.appendAudit(o.id, { action: 'migrated' })
    await provider.putBlob(o.id, ['m', 'b.bin'], Buffer.from('blob-bytes'))
    const dir = opts.tmp ?? mkdtempSync(join(tmpdir(), 'arxa-ws-conf-'))
    const owned = !opts.tmp
    try {
      await exportBundle(provider, o.id, join(dir, 'src'))
      const target = opts.makeTarget ? await opts.makeTarget() : provider
      const { orgId: newId } = await importBundle(target, join(dir, 'src'))
      for (const [collection, id, doc] of [
        ['tickets', 'm-1', { title: 'one' }],
        ['chat_messages', 'm-2', { text: 'two' }],
      ]) {
        const got = await target.getRecord(newId, collection, id)
        if (JSON.stringify(got.doc) !== JSON.stringify(doc)) throw new Error(collection + ' doc changed across migration')
      }
      const members = await target.listMembers(newId)
      if (!members.some((m) => m.email === 'mate@example.test' && m.role === 'member'))
        throw new Error('member was not re-invited with the same role')
      const audit = await target.readAudit(newId)
      if (!audit.some((x) => x.action === 'migrated' && x.imported === true))
        throw new Error('audit history missing or not marked imported')
      if (typeof target.getBlob === 'function' && typeof provider.listBlobs === 'function') {
        // Blob migration rides provider blob ENUMERATION (the wire has no list
        // route); providers without it export records/members/audit only.
        const blob = await target.getBlob(newId, ['m', 'b.bin'])
        if (!blob.equals(Buffer.from('blob-bytes'))) throw new Error('blob bytes changed across migration')
      }
      note('export → import → deep-diff records/members/audit' + (typeof provider.listBlobs === 'function' ? '/blobs' : ''))
    } finally {
      if (owned) rmSync(dir, { recursive: true, force: true })
    }
  })

  if (opts.localExempt === true) {
    // §4 section 3: the local exemption is STATED, never printed as a green.
    sections.push({
      id: 'cross-org-isolation',
      status: 'n/a',
      details: ['n/a (single-user local store)'],
    })
  } else {
    await section('cross-org-isolation', async (note) => {
      if (!opts.crossOrg) throw new Error('network providers must pass cross-org isolation — supply a second user context')
      const { provider: other, orgId: orgB, recordId } = opts.crossOrg
      // Raw replay of A's calls against B's org: every one must fail server-side.
      await expectCode(['forbidden', 'not_found', 'unauthenticated'],
        () => provider.getRecord(orgB, 'tickets', recordId))
      await expectCode(['forbidden', 'not_found', 'unauthenticated'],
        () => provider.putRecord(orgB, 'tickets', 'idor-probe', { x: 1 }))
      await expectCode(['forbidden', 'not_found', 'unauthenticated'],
        () => provider.listRecords(orgB, 'tickets'))
      // List-endpoint leakage: A's own lists contain no B rows.
      const mine = await provider.listRecords(org.id, 'tickets', { limit: 500 })
      if (mine.records.some((r) => r.id === recordId)) throw new Error('org-A list leaked an org-B record id')
      note('raw get/put/list against org B all refused; no B ids in A lists')
    })
  }

  return { sections, ok: sections.every((s) => s.status !== 'red') }
}
