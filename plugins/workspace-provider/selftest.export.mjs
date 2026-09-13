/**
 * Export/import bundle fidelity (task 13 step 7, §6) — the edge cases beyond
 * the conformance kit's round-trip section: hash-verify BEFORE mutation, ID
 * preservation vs ID map, member re-invites, read-only audit history with the
 * imported_from marker, migration pressure across pagination, and the rule
 * that no credential/entitlement material ever enters a bundle.
 *
 * Run: node plugins/workspace-provider/selftest.export.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalWorkspaceProvider } from './lib/local.js'
import { exportBundle, importBundle, verifyBundle } from './lib/export-bundle.js'
import { WorkspaceError } from './lib/errors.js'

let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const home = mkdtempSync(join(tmpdir(), 'arxa-ws-export-'))

try {
  const src = new LocalWorkspaceProvider({ home })

  // A source org with a little of everything.
  const org = await src.createOrg({ name: 'src-org', kind: 'agency' })
  await src.putRecord(org.id, 'tickets', 'keep-1', { title: 'one' })
  await src.putRecord(org.id, 'tickets', 'locked-2', { title: 'two' })
  await src.addMember(org.id, { email: 'invited@example.test', role: 'admin' })
  await src.appendAudit(org.id, { action: 'historical-event', note: 'before the move' })
  await src.putBlob(org.id, ['att', 'proof.bin'], Buffer.from('proof-bytes'))

  const dir = join(home, 'bundle')
  const { manifest } = await exportBundle(src, org.id, join(home, 'bundle'))

  // ---------------------------------------------- 1. manifest + hash coverage
  {
    assert.equal(manifest.bundle, 1)
    assert.equal(manifest.org.name, 'src-org')
    assert.ok(!('id' in manifest.org), 'org IDs are not portable — the manifest carries none')
    assert.equal(manifest.collections.tickets, 2)
    // members.json carries every member verbatim (emails + roles, §6); the
    // source owner row rides along and simply gets re-invited downstream.
    assert.ok(manifest.members.some((m) => m.email === 'invited@example.test' && m.role === 'admin'))
    for (const f of ['tickets.jsonl', 'audit.jsonl', 'members.json', 'storage/att/proof.bin'])
      assert.ok(manifest.hashes[f], 'every bundle file is hashed: ' + f)
    assert.doesNotThrow(() => verifyBundle(join(home, 'bundle')))
    ok('manifest: versioned, org by name (no id), per-file hashes, verify passes clean')
  }

  // ---------------------------------------------- 2. no credentials or license material
  {
    const raw = readFileSync(join(home, 'bundle', 'manifest.json'), 'utf8')
    for (const banned of ['token', 'credential', 'apikey', 'subscription', 'entitlement', 'machine'])
      assert.ok(!raw.toLowerCase().includes(banned), 'manifest must not mention ' + banned)
    ok('bundle hygiene: no token/credential/entitlement/subscription material')
  }

  // ---------------------------------------------- 3. tampered bundle: refuse BEFORE mutation
  {
    // Corrupt a record line AFTER export.
    const file = join(home, 'bundle', 'tickets.jsonl')
    writeFileSync(file, readFileSync(file, 'utf8').replace('one', 'TAMPERED'))
    let err = null
    const before = (await src.listOrgs()).length
    try { await importBundle(src, join(home, 'bundle')) } catch (e) { err = e }
    assert.ok(err instanceof WorkspaceError && err.code === 'invalid_request', 'tamper refused with a typed error')
    assert.match(err.message, /hash mismatch/)
    assert.equal((await src.listOrgs()).length, before, 'NOTHING was created — verification precedes every mutation')
    ok('tamper: hash mismatch → invalid_request, zero mutations on the target')
  }

  // ---------------------------------------------- 4. missing file: refuse whole
  {
    rmSync(join(home, 'bundle', 'members.json'))
    let err = null
    try { await verifyBundle(join(home, 'bundle')) } catch (e) { err = e }
    assert.ok(err instanceof WorkspaceError && err.message.includes('missing'))
    ok('missing bundle file: refused')
  }

  // Re-export a clean bundle for the import legs.
  rmSync(join(home, 'bundle'), { recursive: true, force: true })
  const clean = await exportBundle(src, org.id, join(home, 'bundle'))

  // ---------------------------------------------- 5. IDs preserved where accepted, mapped otherwise
  {
    // A target that refuses ONE caller-chosen id (models a backend that
    // rejects ids it considers reserved/server-assigned).
    const picky = {
      target: new LocalWorkspaceProvider({ home }),
      async putRecord (orgId, collection, id, doc, opts) {
        if (id === 'locked-2') throw new WorkspaceError('invalid_request', 'ids are server-assigned here')
        return this.target.putRecord(orgId, collection, id, doc, opts)
      },
    }
    // Route the rest of the interface through the inner provider with the new org.
    const innerPut = picky.putRecord.bind(picky)
    const delegate = new Proxy(picky.target, {
      get (t, prop) {
        if (prop === 'putRecord') return innerPut
        const v = t[prop]
        return typeof v === 'function' ? v.bind(t) : v
      },
    })
    const { orgId: newId, idMap } = await importBundle(delegate, join(home, 'bundle'))
    assert.equal((await delegate.getRecord(newId, 'tickets', 'keep-1')).doc.title, 'one', 'accepted id preserved verbatim')
    const mapped = idMap.records.tickets['locked-2']
    assert.ok(mapped && mapped.startsWith('locked-2-'), 'rejected id remapped: ' + mapped)
    assert.equal((await delegate.getRecord(newId, 'tickets', mapped)).doc.title, 'two', 'remapped record present under its new id')
    assert.equal(existsSync(join(home, 'bundle', 'id-map.json')), true, 'the map is written into the bundle for inspection')
    ok('IDs: preserved where accepted; remapped + id-map.json otherwise')
  }

  // ---------------------------------------------- 6. members re-invited, audit read-only history
  {
    const target = new LocalWorkspaceProvider({ home })
    const { orgId: newId } = await importBundle(target, join(home, 'bundle'))
    const members = await target.listMembers(newId)
    assert.ok(members.some((m) => m.email === 'invited@example.test' && m.role === 'admin'),
      'member re-invited through provider ops with the same role')
    const audit = await target.readAudit(newId)
    const row = audit.find((x) => x.action === 'historical-event')
    assert.ok(row, 'original audit history present')
    assert.equal(row.imported, true, 'marked imported')
    assert.equal(row.importedFrom, clean.manifest.exportedAt, 'marker carries the bundle origin')
    assert.equal(row.note, 'before the move', 'history fields survive verbatim')
    ok('members re-invited; audit imported read-only with imported_from marker')
  }

  // ---------------------------------------------- 7. migration pressure: past pagination
  {
    const big = await src.createOrg({ name: 'big', kind: 'studio' })
    const N = 300 // three default pages
    for (let i = 0; i < N; i++) await src.putRecord(big.id, 'chat_messages', 'msg-' + String(i).padStart(4, '0'), { i })
    const pdir = join(home, 'big-bundle')
    await exportBundle(src, big.id, pdir)
    assert.equal((await verifyBundle(pdir)).collections['chat_messages'], N, 'export paginated all records')
    const target = new LocalWorkspaceProvider({ home })
    const { orgId: newId } = await importBundle(target, pdir)
    let cursor; let count = 0
    do {
      const page = await target.listRecords(newId, 'chat_messages', { cursor })
      count += page.records.length
      cursor = page.nextCursor
    } while (cursor)
    assert.equal(count, N, 'import replays every record across pages')
    ok(`pressure: ${N} records export+import across pagination without loss`)
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`workspace-provider export bundle: ${n} checks green`)
