// Phase 6 track (c) exit checks (docs/plans/file-organisation-implementation.md):
// mobile edit materializes exactly once with two desktops attached; the
// disjointness rule rejects tree-derivable tables; materializer failure
// is loud (typed, no silent skip); v1 outbox is online-only and no CRDT
// merge runs in the authoritative path; the whole rail works local-only
// with no database and no cairn (CLAUDE.md boundary); rail data survives
// an index-cache clear (it is not a derived cache); the cairn seam is
// one adapter file pinned to a recorded commit.
// Run: node plugins/cairn-rail/selftest.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DisjointnessError,
  MaterializeError,
  MaterializerClaimError,
  RailOfflineError,
  WireContractError,
  appendEdit,
  nextSeq,
  readEdits,
  railDir,
  materialize,
  appliedEditIds,
  pendingEdits,
  pushOutbox,
  PINNED_CAIRN_COMMIT,
  toReplicationEvent,
  fromReplicationEvent,
} from './lib/index.js'
import { openBackend } from '../workspace-index/lib/index.js'

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`ok   ${label}`)
  } catch (err) {
    failures += 1
    console.error(`FAIL ${label}\n     ${err.message}`)
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-rail-'))
const org = 'acme'
fs.mkdirSync(path.join(root, org, 'clients'), { recursive: true })

check('disjointness: tree-derivable table is rejected loudly', () => {
  assert.throws(
    () => appendEdit(root, org, { table: 'files_index', op: 'set-file', payload: {}, deviceId: 'phone1' }),
    DisjointnessError,
  )
  assert.equal(readEdits(root, org).length, 0, 'nothing appended')
})

check('edit log: append-only with stable per-device ids', () => {
  const e1 = appendEdit(root, org, {
    table: 'edit_log',
    op: 'set-file',
    payload: { project: 'clients', path: 'notes/from-phone.md', content: 'v1 from phone' },
    deviceId: 'phone1',
  })
  const e2 = appendEdit(root, org, {
    table: 'edit_log',
    op: 'set-file',
    payload: { project: 'clients', path: 'notes/from-phone.md', content: 'v2 from phone' },
    deviceId: 'phone1',
  })
  assert.equal(e1.editId, 'phone1:1')
  assert.equal(e2.editId, 'phone1:2')
  assert.equal(nextSeq(root, org, 'phone1'), 3, 'seq derived from log across reopens')
  assert.equal(nextSeq(root, org, 'phone2'), 1, 'seq is per-device')
})

check('materializer: applies pending edits, records tree-side facts', () => {
  const applied = materialize(root, org, 'deskA')
  assert.deepEqual(applied, ['phone1:1', 'phone1:2'])
  const file = path.join(root, org, 'clients', 'notes', 'from-phone.md')
  assert.equal(fs.readFileSync(file, 'utf8'), 'v2 from phone', 'last edit wins in order')
  const facts = path.join(root, org, '.arxa', 'facts', 'rail-applied.jsonl')
  assert.ok(fs.existsSync(facts), 'applied ids live in tree-side facts')
  assert.deepEqual([...appliedEditIds(root, org)].sort(), ['phone1:1', 'phone1:2'])
})

check('exactly-once: second run applies nothing', () => {
  assert.deepEqual(materialize(root, org, 'deskA'), [])
})

check('single-desktop: a second attached desktop refuses loudly', () => {
  assert.throws(() => materialize(root, org, 'deskB'), MaterializerClaimError)
})

check('materializer failure is loud, never a silent skip', () => {
  const org2 = 'beta'
  fs.mkdirSync(path.join(root, org2, 'clients'), { recursive: true })
  appendEdit(root, org2, {
    table: 'edit_log',
    op: 'no-such-op',
    payload: {},
    deviceId: 'phone1',
  })
  assert.throws(() => materialize(root, org2, 'deskA'), MaterializeError)
  assert.equal(appliedEditIds(root, org2).size, 0, 'no fact recorded for the failed edit')
  appendEdit(root, org2, {
    table: 'edit_log',
    op: 'set-file',
    payload: { project: 'clients', path: '../escape.md', content: 'x' },
    deviceId: 'phone1',
  })
  assert.throws(() => materialize(root, org2, 'deskA'), MaterializeError, 'path traversal is a loud failure')
  assert.ok(!fs.existsSync(path.join(root, org2, 'escape.md')))
})

check('outbox v1 is online-only: no transport = typed error, edits stay pending', () => {
  assert.equal(pendingEdits(root, org).length, 2)
  assert.throws(() => pushOutbox(root, org, null), RailOfflineError)
  assert.throws(() => pushOutbox(root, org, { connected: false, send: () => [] }), RailOfflineError)
  assert.equal(pendingEdits(root, org).length, 2, 'still pending, nothing lost')
})

check('outbox pushes contract-valid events over a connected transport', () => {
  const seen = []
  const transport = {
    connected: true,
    send(events) {
      for (const ev of events) {
        // receiver-side validation via the same pinned contract
        const row = fromReplicationEvent(ev)
        assert.equal(row.table, 'edit_log')
        seen.push(row.editId)
      }
      return events.map((ev) => ev.op.pk)
    },
  }
  const acked = pushOutbox(root, org, transport)
  assert.deepEqual(acked, ['phone1:1', 'phone1:2'])
  assert.deepEqual(seen, acked)
  assert.equal(pendingEdits(root, org).length, 0)
  assert.deepEqual(pushOutbox(root, org, transport), [], 'nothing left to push')
})

check('adapter: pinned seam round-trips and rejects malformed events', () => {
  assert.equal(PINNED_CAIRN_COMMIT, '224ccefbb49d50d8318499cec2e6aeb5e67b4d65')
  const edit = readEdits(root, org)[0]
  const round = fromReplicationEvent(toReplicationEvent(edit, 7))
  assert.equal(round.lsn, 7)
  assert.equal(round.editId, edit.editId)
  assert.equal(round.deviceId, edit.deviceId)
  assert.throws(() => fromReplicationEvent({ op: {} }), WireContractError)
  assert.throws(() => fromReplicationEvent({ lsn: 1, op: { kind: 'upsert', table: 't', pk: 'p' } }), WireContractError)
})

check('rail data survives an index-cache clear (rail is not derived)', () => {
  const backend = openBackend(root)
  backend.put('probe', 'x', { ok: true })
  backend.clear()
  backend.close()
  assert.equal(readEdits(root, org).length, 2, 'edit log untouched by cache clear')
  assert.ok(fs.existsSync(railDir(root, org)))
})

// Everything above ran with no cairn checkout, no database server and no
// network — the local-only fallback IS the tested path (CLAUDE.md).

fs.rmSync(root, { recursive: true, force: true })

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`)
  process.exit(1)
}
console.log('\nall cairn-rail selftest checks passed')
