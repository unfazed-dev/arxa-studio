# Cairn rail viability spike — Phase 6 track (c), D46/D32

**Verdict: SPIKE PASSED.** Safe to build the adapter.

## Pin

- Repo: `/Volumes/developer_ssd/Developer/cairn` (primary per
  `docs/plans/cairn-maturity-audit.md`), checked out into the worktree at
  `.spike-scratch/cairn-pin` (untracked scratch, never committed).
- **Pinned commit: `224ccefbb49d50d8318499cec2e6aeb5e67b4d65`**
  (`docs(adr): ADR-0041 decision memo — accept/reject packet for
  spike/iroh-transport`, 2026-08-29). Same SHA is recorded in the adapter
  header at `plugins/cairn-rail/lib/adapter.js`.

## Build at pin

- `cargo build -p cairn-domain -p cairn-core -p cairn-client` — clean
  (`cairn-core v0.1.0`, dev profile). No patches needed.

## Merge API exercised

Throwaway harness at `.spike-scratch/harness/src/main.rs` (124 lines,
depends on the pinned crates by path). Output on the final run:

```
PASS 1: ApplyEngine LWW — conflicting edits resolve to later write, deterministic across runs (checkpoint=3)
PASS 2: ApplyEngine OR-set — divergent adds merge add-wins, byte-identical either order: {"elements":[...base,x,y...]}
PASS 3: merge_or_set_payloads — commutative and idempotent
SPIKE OK: all 3 checks green at pin 224ccefbb49d50d8318499cec2e6aeb5e67b4d65
```

- Two conflicting row edits (same table/pk) through `ApplyEngine`: later
  LSN wins, replay is deterministic, checkpoint advances to last applied
  LSN.
- OR-set columns (`CAIRN_OR_SET_COLUMNS`): divergent adds from two
  writers merge add-wins; apply order produces byte-identical payloads;
  `merge_or_set_payloads` is commutative and idempotent.

## Wire contract adopted (D32 BYO)

From `crates/cairn-domain/src/events.rs` at the pin:

- `ReplicationEvent { lsn, op, txn_id }` — `lsn` checkpointed after
  apply for incremental resume; shared `txn_id` = one atomic batch.
- `RowOp::Insert | Update | Delete { table, pk, payload }` — payload is
  opaque bytes (JSON in our use).

The rail adapter wraps exactly this shape and nothing else, so pre-v0.1
API churn hits one file.

## Consult note

Advisor call before build returned `over_budget` (session fuse 21/20);
proceeded on primary sources per advisor conventions.
