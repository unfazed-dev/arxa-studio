# Cairn maturity audit (phase 6 input)

Date: 2026-08-29 · Read-only investigation · Answers the open input in
`docs/plans/file-organisation-implementation.md` line 143 ("cairn maturity
(spec vs working code)").

## Verdict: **WORKING (alpha)** — not spec-only, not merely partial

Cairn is a real, actively developed Rust codebase, not markdown. Public launch
is gated ("alpha — Phase 3, v0.1 prepared, launch gated" badge), but the core
engine, server, client, CRDT ops, and bench harness exist and build.

## What exists where

| Location | Contents |
|---|---|
| `/Volumes/developer_ssd/Developer/cairn` | Primary repo. Cargo workspace, 12 crates: `cairn-domain`, `cairn-application`, `cairn-infra`, `cairn-server`, `cairn-bench`, `cairn-cloud`, `cairn-license`, `cairn-core`, `cairn-client`, `cairn-ffi-wasm`, `cairn-cli`, `cairn-push`. Hexagonal/DDD layering, rust-version 1.95, Apache-2.0, v0.1.0. |
| `…/cairn/sdk/` | 9 SDK dirs: `cairn_tauri`, `cairn_flutter` (49 Dart files, `test/adapter_conformance_test.dart`), `cairn_react_native`, `cairn_capacitor`, `cairn_node`, `cairn_web`, `cairn_swift`, `cairn_kotlin`, `cairn_dotnet`. Flutter/Tauri are the lead tracks; others thinner. |
| `/Volumes/developer_ssd/Developer/totem_labs/arxa/kit/cairn` | Dart/Flutter kit package (pubspec.yaml, lib/, test/, tool/) — arxa-side integration. |
| `/Volumes/developer_ssd/Developer/totem_labs/arxa/docs/cairn` | Docs/ADRs (ADR-0032, 0037, 0038, 0040, 0041; push daemon + "complete-cairn-fully-wired-operational" plans). |

## Hard metrics (cairn repo)

- 310 `.rs` files, ~331,789 LOC (crates + sdk; includes generated bindings — treat as upper bound)
- 9,713 `#[test]`/`#[tokio::test]` annotations (grep count; inflation possible but testing is clearly extensive)
- 447 commits; last commit `224ccef` **2026-08-29 00:31** — active today
- Builds: `target/debug` contains `cairn` and `cairn-pushd` binaries; CI badge passing
- Bench results shipped (`benches/results/RESULTS.md`): 833,307 ops/sec aggregate fan-out vs PowerSync's 2–4k ceiling claim

## Feature coverage vs the phase-6 rail

Present and working: Postgres/Supabase logical replication ingest (`cairn-infra`),
apply state machine + storage seam (`cairn-core`), SQLite client with durable
checkpoints + `resume_lsn` reconnect (`cairn-client`), LWW + CRDT-field merge
(`CAIRN_COUNTER_COLUMNS` / `CAIRN_OR_SET_COLUMNS`, `orSetAdd`/`orSetRemove`/
`counterIncrement`/`counterDecrement`), watch/`watchSql`, push daemon with tests
(`crates/cairn-push/tests/daemon.rs`), WASM FFI. Replicator/predicate engine:
implemented server-side (fan-out router); dynamic predicates flagged in docs as
still-maturing — verify before leaning on them.

## Reuse vs greenfield for phase 6 (D46 DB rail, D32 BYO)

- **Reuse**: wire contract + replication semantics (D32 BYO contract should adopt cairn's, not invent one), `cairn-core` apply engine, `cairn_flutter`/kit adapter, LWW/CRDT merge — all exist.
- **Greenfield**: the append-only **edit log** and **single-desktop materializer** are arxa-studio concepts — cairn syncs rows, it does not define studio's file-organisation log schema or materialization. Also the local-only fallback path (CLAUDE.md boundary) must work with no DB at all — cairn is optional rail, not dependency.

## Effort estimate

Rail integration is adapter work, not engine work: **~S/M (days, not weeks)**
for DB rail + D32 contract adoption; the edit-log/materializer greenfield is the
same size regardless of cairn. Risk: pre-v0.1 API churn (launch-gated), so pin
a commit and keep the seam thin.
