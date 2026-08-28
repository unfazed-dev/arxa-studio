/**
 * THE cairn seam — the only file in arxa studio that knows cairn's wire
 * shape. Pre-v0.1 API churn lands here and nowhere else.
 *
 * PINNED CAIRN COMMIT: 224ccefbb49d50d8318499cec2e6aeb5e67b4d65
 * (verified by docs/plans/cairn-rail-spike.md: cairn-core builds at this
 * pin and ApplyEngine LWW / OR-set merge are deterministic).
 *
 * Wire contract adopted for D32 BYO (from
 * crates/cairn-domain/src/events.rs at the pin):
 *
 *   ReplicationEvent { lsn: number, op: RowOp, txn_id: number|null }
 *   RowOp = { kind: 'insert'|'update'|'delete', table, pk, payload }
 *
 * `lsn` is checkpointed by the receiver after apply (incremental
 * resume); events sharing `txn_id` form one atomic batch; `payload` is
 * opaque to cairn (JSON text for us). A BYO backend (D32) implements
 * exactly this shape server-side — arxa ships no foreign code.
 *
 * A transport is any object `{ connected: boolean, send(events) ->
 * ackedEventIds }`. The shipped cairn transport and BYO shims both fit;
 * tests use an in-memory fake. No network code lives in this plugin.
 */

import { WireContractError } from './errors.js'

export const PINNED_CAIRN_COMMIT = '224ccefbb49d50d8318499cec2e6aeb5e67b4d65'

const OPS = ['insert', 'update', 'delete']

/** Edit-log row → ReplicationEvent. Every mobile edit is an insert into
 * the `edit_log` rail table; the stable editId is the pk. */
export function toReplicationEvent(edit, lsn) {
  return {
    lsn,
    op: {
      kind: 'insert',
      table: edit.table,
      pk: edit.editId,
      payload: JSON.stringify({
        seq: edit.seq,
        deviceId: edit.deviceId,
        op: edit.op,
        payload: edit.payload,
        at: edit.at,
      }),
    },
    txn_id: null,
  }
}

/** Validate + decode an inbound event against the pinned contract. */
export function fromReplicationEvent(ev) {
  if (!ev || typeof ev.lsn !== 'number') {
    throw new WireContractError('missing numeric lsn')
  }
  const op = ev.op
  if (!op || !OPS.includes(op.kind)) {
    throw new WireContractError(`op.kind must be one of ${OPS.join('/')}`)
  }
  if (typeof op.table !== 'string' || typeof op.pk !== 'string') {
    throw new WireContractError('op.table and op.pk must be strings')
  }
  const body = op.payload == null ? null : JSON.parse(op.payload)
  return {
    lsn: ev.lsn,
    txnId: ev.txn_id ?? null,
    kind: op.kind,
    table: op.table,
    editId: op.pk,
    ...(body ?? {}),
  }
}

/** Push edit rows through a transport; returns acked edit ids. LSNs are
 * assigned by the receiver in a real deployment; locally we number the
 * batch so the shapes are always contract-valid. */
export function pushEdits(transport, edits) {
  const events = edits.map((e, i) => toReplicationEvent(e, i + 1))
  const acked = transport.send(events)
  if (!Array.isArray(acked)) {
    throw new WireContractError('transport.send must return an array of acked pks')
  }
  return acked
}
