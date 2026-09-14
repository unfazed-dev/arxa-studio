# Task 14 Report — the first-party Supabase/Postgres workspace provider

Status: DONE_WITH_CONCERNS (concerns: harness real-stack leg daemon-gated like the plan anticipated; two low-severity notes below)
Branch: `closeout-2026-09-12`, BASE `4cc0380`. Commit: see ledger (single commit, fixed message).

## What was implemented, per step

### Step 1 — failing adapter contract tests (`plugins/workspace-provider/selftest.supabase.mjs`)
16 test sections plus an **in-memory protocol fake**: an injected `fetch`
(zero ports, zero sockets — the RAM/port constraint) speaking exactly the
Supabase surface the adapter may touch (GoTrue `/auth/v1`, PostgREST
`/rest/v1` tables + the six workspace RPCs, `/storage/v1`), with **RLS
emulation** (bearer → user → membership fences) and the PostgREST
SQLSTATE→HTTP mapping (42501→403, 40001→409, P0002→404). The fake also flips
hostile (`idor`: membership fence dropped on records; `leak`: list ignores
the org filter) so the kit's cross-org section provably goes RED — same law
as selftest.rest.mjs for the generic adapter.

Coverage per the brief: SQL row mapping (§6 byte-exact docs — key order
survives because `records.doc` is TEXT, not jsonb), RLS/tenant isolation
(§12 + kit cross-org), token lifecycle (§5: opaque store handle, refresh
rotates twice — single-use refresh tokens are stored back), reference email
sign-in (§4: declared kind only, wrong kind invalid_request, bad password
unauthenticated), member invitation (§7: idempotent same-id replay,
fixed role vocabulary, different-role conflict, last-owner forbidden),
storage (§10: hash round-trip, signed url, 2 MiB blob ≠ 1 MiB record bound),
realtime/adaptive-poll fallback (§11: caps truthfully OFF; D35
immediate-after-write poll delivers put AND delete events), audit
append-only (§9: append+read ordered; no mutation method exists), retry +
idempotency (§3: one 503 retried with a re-issued request; hung request →
unavailable; §8 identical doc → identical etag), unavailable service (§2).

### Step 4 — the adapter (`plugins/workspace-provider/lib/supabase.js`)
`SupabaseWorkspaceProvider` implements the Task 13 interface. One transport
(`call()`): apikey always, bearer whenever a session exists, per-attempt
`AbortSignal.timeout`, bounded retries on the contract's retryable statuses,
contract byte bounds (1 MiB JSON / 1 GiB blobs), token-redacting error
decode, Supabase status→contract-code map. All Supabase row shapes stay
inside the module (`mapOrg`/`mapMember`, rpc envelopes); callers see only
contract objects. `SUPABASE_CAPABILITIES` (realtime **false** — Ruling 9
degradation, badge truthful), `SIGN_IN = { kind: 'email-form' }` (Ruling 8:
email/password UX, opaque-token session surface). Credentials: one opaque
handle `workspace-supabase` in the injected credential store — never env
files, never printed (tests assert shape, not values). The Wire v1 contract
was NOT touched — no wire change needed.

### Step 3 — migrations (`plugins/workspace-provider/migrations/20260913000000_workspace_v1.sql`) + `supabase/config.toml`
One migration (list: `20260913000000_workspace_v1.sql`): tables `orgs`,
`org_members` (nullable `user_id` — invited members have no identity yet),
`records` (PK org+collection+id, `doc` TEXT byte-exact, `etag = md5(doc)`,
collection CHECK on the seven fixed names), `audit_log` (identity PK;
INSERT+SELECT policies only; UPDATE/DELETE revoked). SECURITY DEFINER helpers
(`is_org_member`, `is_owner_or_admin`, `is_sole_owner`) with pinned
search_path; creator→owner trigger; RLS policies on every table (orgs INSERT
open to authenticated — the trigger binds ownership; everything else gated);
SECURITY INVOKER RPCs (`put_record`, `list_records`, `read_audit`,
`add_member`, `set_member_role`, `remove_member`) so RLS stays enforced
inside them; storage bucket `arxa-workspace` + `storage.objects` policy keyed
on the `org/<orgId>/…` path prefix; explicit grants (audit: insert+select
only). The inverse SQL is documented in the file header; the config pins
reserved ports (api 54921, db 54922), auto-confirm email signup, realtime
disabled (matches the truthful degraded badge), 1 GiB storage bound.

**Execution is daemon-gated on this machine** (docker daemon DOWN,
confirmed; CLI 2.67.1 present, DETECT only). Correctness is by construction
against the adapter/fake spec, and by inspection for the harness; the real
execution is the dedicated CI job (below) / Task 16 with a started daemon.

### Step 5 — configuration/status
- `lib/index.js`: pure `capabilitiesFor(backend)` — local full, supabase
  static-truthful (+signIn kind), generic-rest `null` (needs a live fetch);
  the RPC `info` endpoint uses it.
- `lib/client.js`: the "Workspace backend" settings-section model + EN/PL/FR
  dictionary registered through the arxa-locale service
  (`ctx.locale.register(NS, {en,pl,fr})`, `inject: ['connection','locale']`);
  `section(info, locale)` renders title/provider label/live-degraded
  badges/sign-in label/verify hint/license line.
- `package.json`: `./supabase` first-party export.
- `bin/arxa-studio-provider.mjs`: `supabase` branch in `buildProvider`
  (env `ARXA_SUPABASE_URL`/`ARXA_SUPABASE_ANON_KEY` > config, per plan §5);
  refusal branch KEPT for any other name (message now "implemented: local,
  supabase, generic-rest"); `provider verify`/`diagnose` now grant the
  single-user exemption ONLY to `LocalWorkspaceProvider` (supabase must
  answer cross-org isolation).
- Settings selection remains D32-frozen: `local | supabase | generic-rest`.

### Steps 2+6 — the disposable harness + conformance + export
`scripts/workspace-provider-supabase-smoke.mjs`:
- **REAL leg (`--real`, the CI job)**: pins CLI 2.67.1 (refuses mismatch,
  never installs), requires docker; scratch COPY of `supabase/config.toml` +
  `migrations/*.sql` into a mkdtemp workdir (operator state never touched);
  `supabase start -x studio,inbucket,imgproxy,edge-runtime,vector`; env from
  `supabase status -o env`; migrations: `db reset` (empty stack) → `migration
  up` again (no-op, apply-twice) → `migration list` count; two users via the
  ADMIN API (service key, server-side only) + password grants; two orgs; raw
  authenticated RLS replay (A vs org B: get/put/list/audit all refused);
  FULL conformance kit through the real adapter with cross-org GREEN
  required; local→supabase→local migration with hash-equal portable data;
  `migration down --last N` reversal + re-apply; stop+wipe on
  success/failure/signal (`exit` + SIGINT/SIGTERM handlers).
- **FAKE leg (default/npm test)**: runs `selftest.supabase.mjs` and prints
  the DAEMON-GATED banner naming the CI job — never silently fake.
- `scripts/ci.mjs`: smoke wired in (offline leg); the two new selftests are
  auto-discovered. `.github/workflows/ci.yml`: new job
  `supabase-conformance` (self-hosted mac runner, docker gate with a loud
  warning skip — the repo's standing convention, same as the linux lane;
  pinned-CLI check that fails on mismatch; `node scripts/workspace-provider-supabase-smoke.mjs --real`).

## TDD evidence (RED → GREEN per behavior change)

Raw outputs: `task-14-red-evidence.md` (same directory).

| Change | RED | GREEN |
|---|---|---|
| adapter + fake suite | `ERR_MODULE_NOT_FOUND: lib/supabase.js` | 16 checks green |
| settings section | `no export named 'capabilitiesFor'` | 4 checks green |
| CLI flip (§9) | `AssertionError: supabase is implemented — no refusal message` | 10 checks green (whole CLI suite) |
| smoke script | absent (exit 1) | fake leg green, honest banner |

Intermediate REDs caught by the suite while stabilizing the spec (all
test-harness fidelity bugs, not product bugs): bearer-attachment gate in the
transport, abort-signal handling, storage list prefix semantics, audit
payload merge order. Each was reproduced, fixed, re-run.

## Conformance results — all three providers through the ONE kit

| Provider | Where | Result |
|---|---|---|
| local | `selftest.local.mjs` + CLI `provider verify` (npm test) | all sections green; cross-org prints the STATED exemption `n/a (single-user local store)` |
| generic-rest | `selftest.rest.mjs` (npm test) | all sections green incl. cross-org against the Wire v1 fixture; hostile idor/leak legs RED as required |
| supabase | `selftest.supabase.mjs` + smoke fake leg (npm test) | **all 12 sections green, cross-org isolation GREEN** against the RLS-emulating fake; hostile idor + leak flips turn the kit RED (the section still bites) |

Real-stack leg (docker): **daemon-gated** — exercised by the CI job
`supabase-conformance`; local execution awaits Task 16 / an operator-started
daemon (`node scripts/workspace-provider-supabase-smoke.mjs --real`).

## Export local → Supabase → local (hash equivalence)

`selftest.supabase.mjs §16`: source local org (2 records across 2
collections with adversarial key order, invited member, audit event, blob) →
`exportBundle` → `importBundle` into the Supabase provider (fake) →
`exportBundle` → `importBundle` into a second local provider. Portable data =
per-collection `{id, doc}` + non-owner members `{email, role}` + audit action
sequence + blob content hashes; sha256 over the canonical JSON is **equal**
both ends. Members are RE-INVITED (email+role preserved, one row, no copied
identity — owners excluded as provider identities, per §6). The smoke's real
leg repeats this against the live stack (daemon-gated → CI).

## Files changed

Created: `plugins/workspace-provider/lib/supabase.js`,
`plugins/workspace-provider/migrations/20260913000000_workspace_v1.sql`,
`plugins/workspace-provider/supabase/config.toml`,
`plugins/workspace-provider/selftest.supabase.mjs`,
`plugins/workspace-provider/selftest.settings.mjs`,
`scripts/workspace-provider-supabase-smoke.mjs`.
Modified: `plugins/workspace-provider/lib/index.js`, `lib/client.js`,
`package.json`, `bin/arxa-studio-provider.mjs`,
`bin/selftest.provider-cli.mjs`, `scripts/ci.mjs`, `.github/workflows/ci.yml`.
Untouched: `package-lock.json` (pre-existing dirt, excluded from the commit).

## Verification

Full `npm test` — **129 suites ALL GREEN** (first run had ONE unrelated
flake: `scripts/cicd-stress.mjs` S5 decoration convergence, red only under
the full-suite memory pressure; green in isolation AND in the immediate full
re-run — recorded as a New finding). Focused suites run one at a time per the
RAM constraint: supabase 16, settings 4, CLI 10, local 6, contract 14, rest
9, export 7, polling 5, smoke fake leg — all green.

## Self-review notes

- No Arxa-owned URL/key anywhere; the adapter is BYO-project only (project
  law). No staff-access capability; diagnostics stay operator-exported.
- `provider verify` against a live supabase backend without a second user
  prints cross-org RED ("supply a second user context") and exits nonzero —
  same honest behavior generic-rest already had; the full-green proof is the
  smoke (two provisioned users) / CI job.
- `Prefer: return=representation` is sent only where the adapter needs the
  row back; default bodies ride `return=minimal`.
- `currentSession()` treats introspection `unavailable` as "cannot prove,
  answer from the handle" (offline-tolerant) and `unauthenticated` as
  session-dead (handle cleared).

## Concerns

1. **Real-stack leg unexecuted locally** (docker daemon down) — the SQL,
   harness, and workflow are correct-by-construction/inspection; first real
   execution is the CI job or Task 16. If `supabase status -o env` key names
   differ on the pinned CLI, the fallback map (`SUPABASE_ANON_KEY` /
   `ANON_KEY`) is a one-line fix in the smoke.
2. **CI job docker gate warns+skips** when the runner's Docker is down
   (repo's standing convention, same as the linux lane). If the fleet keeps
   Docker up, the job exercises the real stack on every push; flipping to a
   hard fail is one line if wanted.
3. **cicd-stress S5 flake under load** (unrelated suite) — recorded below.

## Fix round 1

Both Important findings addressed; Minors 3–5 deferred per instruction. Wire
freeze untouched (no changes to contract.js/wire.js/errors.js).

### IMPORTANT 1 — Prefer semantics (addressed)

- `plugins/workspace-provider/lib/supabase.js`: removed the blanket
  `return=minimal` default from `call()`; Prefer is now explicit at every
  PostgREST call site — `return=representation` on all five RPCs whose
  response is consumed (put_record, list_records, read_audit, add_member,
  set_member_role) and on every table write whose row is read (orgs
  POST/PATCH/DELETE, records DELETE — already explicit); `return=minimal`
  only where nothing is read (remove_member, audit_log insert). Auth/Storage
  are not PostgREST and now carry no Prefer at all.
- `scripts/workspace-provider-supabase-smoke.mjs`: `api()` takes a `prefer`;
  mkOrg's orgs insert now sends `Prefer: return=representation` (PostgREST's
  insert default hands back no row, so `r.body[0].id` was reading a body the
  real stack would not send).
- Covering tests — the fake is no longer blind: FakeSupabase now EMULATES
  PostgREST Prefer semantics server-side (RPC `return=minimal` → 204 no
  body, errors pass through; inserts/PATCH/DELETE return the row only under
  `return=representation`) and logs `[method, path, Prefer]` per request.
  New regression row §17 pins the per-call header map (every RPC and table
  spelling asserted; auth+storage asserted header-free; also asserts each
  RPC was actually exercised so the map cannot pass vacuously). Under the
  old blanket-minimal adapter this suite now fails (put_record in §8/§13
  TypeErrors on the 204), so the regression is covered both semantically
  and by the header map.

### IMPORTANT 2 — deterministic offline npm test (addressed)

- `scripts/workspace-provider-supabase-smoke.mjs`: the machine-state probe
  (docker up + CLI at pin ⇒ real) is GONE. Default and `--fake` always run
  the injected protocol fake; the real leg is opt-in only — `--real` (what
  CI's supabase-conformance job already passes, `.github/workflows/ci.yml`)
  or `ARXA_SUPABASE_REAL_SMOKE=1`, mirroring the repo's ARXA_A4/A5_REAL_SMOKE
  convention. Banner and docstring updated ("OFFLINE BY DEFAULT").
- `scripts/ci.mjs` needed no change — its existing comment ("This OFFLINE
  leg … never in npm test") is now actually true.
- Daemon-up case (reasoned, not executed — daemon stays down per brief):
  the dispatch never consults docker/CLI state anymore; ordinary `npm test`
  resolves to mode `fake` unconditionally on every machine.

### Verification (one suite at a time; machine HAS the CLI, daemon down)

- `node plugins/workspace-provider/selftest.supabase.mjs` → exit 0:
  `workspace-provider supabase conformance: 17 checks green` (was 16; +§17),
  including `ok prefer semantics: every /rest/v1 call states
  representation/minimal exactly; auth+storage carry none`.
- `node scripts/workspace-provider-supabase-smoke.mjs` → exit 0, honest
  banner: `FAKE LEG (injected protocol fake, offline, no ports)` /
  `OFFLINE BY DEFAULT: the real local-Supabase stack leg is opt-in (--real /
  ARXA_SUPABASE_REAL_SMOKE=1); CI job "supabase-conformance" runs it with
  --real.`
- `npm test` → exit 0: `arxa-studio CI — 129 suites` … `arxa-studio CI: ALL
  GREEN` (129/129 GREEN, zero RED) — on exactly the machine state the
  review flagged (CLI installed, daemon down).
