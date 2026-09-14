# Task 13 — Part A report (contract freeze, brief Steps 1–3)

Commit: `3597a40` `feat: freeze the workspace provider wire contract` (branch closeout-2026-09-12). `package-lock.json` pre-existing dirt left unstaged/untouched. Stopped before Step 4 as mandated.

## Step 1 — source-plan rewrite (`docs/plans/agency-backend-provider-abstraction.md`)

- **Status line**: PLAN ONLY → SUPERSEDED IN PART by D32–D35 (named as the later authority), pointer to the frozen contract in `plugins/workspace-provider`.
- **New 2026-09-13 amendment block** after the 2026-09-07 one, recording verbatim: providers fixed to `local` (DEFAULT, zero-config) / `supabase` / `generic-rest`; `custom.adapter` + `ARXA_WORKSPACE_ADAPTER` **invalid**; support bundle-only (D33, `arxa-studio diagnose`); identity token-opaque (D34, issue/refresh/revoke/introspect, `signIn.kind` dispatch); polling 3s/30s/120s + immediate-after-write (D35).
- **§0 table**: provider list changed to local/supabase/generic-rest, "no custom adapter module".
- **§1 realtime degradation cell**: visible-tab interval → D35 adaptive polling constants.
- **§5 config example**: `custom.adapter` row removed; `generic-rest.baseUrl` added; paragraph "Config cannot name executable code (D32)"; env list drops `ARXA_WORKSPACE_ADAPTER` and restricts `ARXA_WORKSPACE_PROVIDER` to the three fixed names.
- **§7**: all five open questions marked settled by D32/D32/D33/D34/D35 respectively.

Unchanged (intentionally): §2–§4, §6 — Part B owns CLI spellings (`arxa-studio provider verify` etc.) and will align §4's `arxa studio provider verify` wording when those land.

## Step 2 — golden-test inventory (`plugins/workspace-provider/selftest.contract.mjs`, 12 blocks)

1. **Scalars**: `WIRE_VERSION=1`, `BASE_PATH=/arxa-workspace/v1`, header names (version/request-id/authorization/etag/if-match/next-cursor), media types (json / `application/x-ndjson` / octet-stream), `PROVIDERS=[local,supabase,generic-rest]`, `ROLES`, the 7 fixed `COLLECTIONS`, `SIGN_IN_KINDS` (asserts `email+password` is NOT a kind — D34), `CAPABILITY_KEYS`.
2. **Bounds + polling**: `deepEqual` on the full `BOUNDS` (100/500 page limits, 1 MiB record, 32 MiB JSONL page, 1 GiB blob, 15s timeout, 3 attempts, retryable statuses 408/425/429/500/502/503/504) and `POLLING` (3000/30000/120000, `IMMEDIATE_AFTER_WRITE:true` — D35).
3. **THE route table**: full 25-operation `OPERATIONS` snapshot, literal in the test — every route/verb/media/auth/query, `events` flagged optional, and a negative assertion that **no audit mutation route exists**.
4. **buildRequest**: `X-Arxa-Workspace-Version: 1` always; `X-Request-Id` fresh UUID per request (caller's honored when given); `Authorization: Bearer` on auth routes only (capabilities carries none even with a token in context); abort `signal` forwarded untouched; per-segment URI encoding (blob path keeps `/`); `If-Match` emitted when an etag is supplied (optimistic concurrency).
5. **Pre-I/O guards**: unknown collection throws `invalid_request` at build time (no request spec escapes); unknown operation name is a plain programming error; `unsupported_version` decodes as a typed code.
6. **Pagination**: default limit 100 applied; 501/0/-1/2.5/'many' rejected pre-I/O; garbage cursor rejected pre-I/O; valid cursor → `?cursor=…&limit=100`.
7. **Cursor codec**: base64url JSON round-trip, URL-safe; malformed and `v!==1` cursors → `invalid_request`.
8. **JSON/JSONL codecs**: bounded singleton JSON encode/decode with byte cap; strict JSONL (one JSON object per line, exactly one trailing newline legal, blank line/junk/oversize rejected with 32 MiB cap).
9. **Error taxonomy**: the 7 typed codes frozen; envelope `{error:{code,message,retryable,requestId}}` shape; requestId echo with fallback to the caller's; malformed envelope → `invalid_request`; unknown server code → `unavailable` with `.serverCode` preserved; retryable-status set pinned both ways.
10. **Secrecy**: no codec/builder error message echoes parameter values (collection name = token → message stays a fixed literal); surfaced server messages are redacted of the caller's session token.
11. **Capabilities/sign-in dispatch (D34)**: booleans + required `signIn{kind,start}`; all four kinds legal; `email+password` kind rejected; missing `start` or missing `signIn` rejected.
12. **Config guard (D32)**: three fixed providers pass, `{}` = local zero-config; `custom` provider, `adapter` key (top-level and nested), module/file-path values, `require(...)` strings all rejected; thrown reason names "executable code".

## Step 3 — RED → GREEN evidence

- **RED**: `node plugins/workspace-provider/selftest.contract.mjs` → `ERR_MODULE_NOT_FOUND …/lib/contract.js` (expected failure with libs absent).
- **GREEN**: same command → `workspace-provider contract freeze: 12 checks green`.
- Two test-authoring bugs surfaced during GREEN (snapshot shorthand `'json'` vs real media types; my expected URL dropped the literal `orgs/` segment) and one impl bug (array blob paths stringified instead of joined) — all fixed; one test case corrected against my own freeze (a second trailing newline IS a blank line → rejected).
- **Full run**: `node scripts/ci.mjs` → `arxa-studio CI — 120 suites` … `ALL GREEN`, with `workspace-provider/selftest.contract.mjs` auto-discovered (no `scripts/ci.mjs` edit needed — its `plugins/*/selftest.*.mjs` sweep picked it up, verified in output).

## Files

- Created: `plugins/workspace-provider/{package.json, selftest.contract.mjs, lib/contract.js, lib/errors.js, lib/wire.js}`
- Modified: `docs/plans/agency-backend-provider-abstraction.md`
- Not touched: `bin/arxa-studio.mjs`, `profile/cordis.patch.yml`, `scripts/ci.mjs`, `package-lock.json` (pre-existing dirt).

## Wire-table ambiguities resolved (each needs checkpoint judgment)

1. **signed-url route shape** — brief says `POST .../signed-url` without full path. Frozen as `POST /orgs/{orgId}/storage/{path}/signed-url` (resource-scoped; the target blob is unambiguous in the route). Alternative rejected: path in body.
2. **Member mutation routes** — brief says "`POST|PATCH|DELETE` member resources". Frozen as `POST /orgs/{orgId}/members`, `PATCH|DELETE /orgs/{orgId}/members/{memberId}`.
3. **Error code set** — brief names `unsupported_version` + §1's five; a contract with no code for malformed input is incomplete, so `invalid_request` added (7 codes total). It is also what pre-I/O rejections use.
4. **Unknown server error codes** — mapped to `unavailable` with the raw code preserved on `.serverCode` (client branching keys off `retryable`, which is honored from the envelope).
5. **Pagination cursor on JSONL lists** — body stays pure records; the resume cursor rides the `X-Arxa-Cursor-Next` response header (absent/empty = end).
6. **Bearer on auth routes** — `authRevoke` is the only auth route requiring the bearer header (it revokes it); issue/refresh/introspect carry their material in the body.
7. **Audit read shape** — `GET /audit` frozen without query params (brief gives `cursor=` to records and events only). Long audit histories stream; client-side paging can come later without a wire change.
8. **Concrete bound values** — brief mandates "constants in contract.js, golden-tested" without numbers. Chosen: 100/500 limits, 1 MiB record, 32 MiB JSONL page, 1 GiB blob, 15s timeout, 3 attempts, retryable = 408/425/429/500/502/503/504.
9. **JSONL strictness** — blank lines are errors, exactly one trailing newline legal (what our own encoder emits).
10. **DELETE response media** — DELETE org/member/record/blob frozen as bounded JSON (e.g. `{deleted:true}`); blob PUT streams bytes both ways.

## Self-review

- Scope check: no conformance kit, provider, adapter, CLI, export/import, diagnose, launcher wiring, or profile registration — all Part B. Suite is pure/offline (assert-only, no network, no fs writes).
- Local-first parity preserved: contract layer requires nothing; `assertProviderConfig({})` accepts bare local; Part B's `LocalWorkspaceProvider` implements against the same frozen table.
- No tokens/credentials printed anywhere; the only literal token-like string is a self-test sentinel that is asserted NOT to appear in output.
- Cyclic import `contract.js ↔ wire.js` is call-time only (commented in source); safe under ESM live bindings; both suites prove load order doesn't matter.

## Concerns

- `MAX_JSONL_BYTES` (32 MiB) bounds a *decoded page*; Part B's streaming reader for audit/events should chunk rather than buffer — noted for the checkpoint, not a wire change.
- Ambiguities 1–8 above are my resolutions of brief underspecification; per the freeze rule, any the reviewer overturns becomes a new protocol version decision *now*, before Part B builds on them.

## Part B

Adapters/CLI half of task 13 (brief Steps 4–9, then commit). BASE 3597a40; contract/wire/errors untouched (freeze discipline held — verified byte-identical in the commit diff).

### Step 4 — reusable conformance kit (`lib/conformance.js`)

`runConformance(provider, opts)` → `{sections, ok}`. Twelve sections: auth, orgs-crud, members-roles, records-crud, pagination, optimistic-conflict, audit-immutability, storage-blobs, realtime-or-polling, idempotent-replay, migration-roundtrip, cross-org-isolation. Key rulings encoded:
- The local cross-org exemption is **claimed by the caller** (`opts.localExempt: true`), never inferred by the kit — a network provider cannot silently pass §3; without the flag AND without a second-user context the section is red ("supply a second user context"). Local prints the exact §4 string `n/a (single-user local store)`.
- A provider that cannot even create a scratch org gets an honest printable red report instead of a crash (`provider verify` must always print).
- Audit immutability is enforced by interface shape (kit asserts no mutation method exists) and at the wire (REST leg raw-PUTs an audit URL and expects refusal).
- Migration round-trip rides export/import (§4.8) with blobs only when the source exposes blob enumeration (the wire has no list-storage route).
- Kit `waitFor` swallows orphan timeout rejections (an abandoned wait was killing the process as unhandled).

### Step 5 — LocalWorkspaceProvider (`lib/local.js`, `lib/capabilities.js`)

Zero network/account/database/env (ARXA_HOME honored only as the launcher's own relocation convention). Layout exactly §1: atomic temp+rename JSON docs (`org.json`, `members.json`, `<collection>/<id>.json`), append-only `audit.jsonl`, `storage/` blobs, `workspace/<orgId>/` with mode 0700 on the root AND per-org dirs. §1 auth contract (single operator, no-op signIn/signOut that still fire onAuthStateChange, currentSession always returns), role vocabulary + owner/admin management + last-owner protection, fixed-collection guard, offset cursors via the frozen codec, sha256 etags (same doc ⇒ same etag = idempotent replay), in-process realtime emitter, `file:` signedUrl, `listBlobs` (local-only enumeration for export). Passes every applicable conformance section; cross-org prints n/a.

### Step 6 — GenericRestWorkspaceProvider + hostile fixture (`lib/generic-rest.js`, `selftest.rest.mjs`)

Injected `fetch`; opaque token handle kept ONLY in the injected credential store (`workspace-generic-rest`); every request built by frozen `buildRequest`, every response through a frozen codec; timeouts (AbortSignal.timeout) + bounded retries (contract MAX_ATTEMPTS, retryable status set, network errors retried, 100ms·attempt backoff); sign-in renders ONLY the declared kind (`signInInfo()` → capabilities.signIn; wrong kind is invalid_request); refresh rotates; signOut revokes server-side and clears the store; realtime degradation = AdaptivePoller diff over listRecords with empty-baseline initial-state delivery (no silent baseline pass to race a write). The fixture is an in-process conforming Wire v1 server on 127.0.0.1:ephemeral (torn down in finally) with modes: `idor` (skips the token→org fence on record get/put), `leak` (list ignores the org prefix), `flaky` (503 once), `delay` (outlives the client timeout). Conforming mode: full kit green including cross-org (two users, two orgs, raw replay + list-leak probes). Hostile modes: cross-org section RED, `ok:false` — the kit demonstrably fails closed. Also pinned: unauthenticated-before-sign-in, bearer sent, timeout→`unavailable`.

### Polling (`lib/polling.js`, `selftest.polling.mjs`)

AdaptivePoller with injectable clock: active/idle/background reschedule to contract.POLLING constants; a fired tick reschedules at the current interval; notifyWrite polls immediately then reschedules; a rejected poll never kills the loop; provider-supplied intervals are ignored (D35: contract, not hints). Poll passes coalesce (overlapping list reads racing a write would invent events from a stale snapshot).

### Step 7 — export/import + canonical CLI (`lib/export-bundle.js`, `bin/arxa-studio-provider.mjs`)

Bundle: versioned `manifest.json` (org by NAME — ids are not portable; collection counts; per-file sha256 hashes; blob hashes), one JSONL per collection in contract shape (`{id, doc}` lines), `members.json`, `audit.jsonl`, `storage/` tree. Import: **every hash verified before the first mutation** (tamper/missing ⇒ typed invalid_request, zero writes — negative-control proven), IDs preserved where accepted else remapped with `id-map.json` written into the bundle (negative-control proven), members re-invited through provider ops, audit replayed read-only with `imported`+`importedFrom` markers, blobs re-uploaded and hash-checked. Pressure: 300 records export+import across pagination without loss. CLI spellings (the only four): `arxa-studio workspace export|import`, `arxa-studio provider verify`, `arxa-studio diagnose`, dispatched from bin/arxa-studio.mjs AFTER the isolation hard-stop and BEFORE any dsh-home/profile write (no dsh spawn, no pnpm — pinned by the CLI suite). `provider verify` prints every section and exits nonzero on any red row (dead-backend and D32-rejected configs both proven). en/pl/fr string tables, all three render and differ. Config: §5 precedence (env provider-name > --config file > `~/.arxa/studio.json`), `assertProviderConfig` at the door; an absolute `local.root` is rejected by the frozen D32 guard (path-like values) — the sanctioned spelling is tilde-relative or the default ARXA_HOME layout.

### Step 8 — diagnose

Text bundle: versions (node/plugin/wire), redacted config shape (provider + section KEYS only — values never print), full provider-verify results, bounded error-log tail (last 50 lines of engine.log) with bearer + ≥20-char opaque-run redaction. Proven: a seeded secret token and a bearer JWT never appear in stdout; `--out` writes the bundle to a file. No tokens, secrets, or client records anywhere.

### Step 9 — runtime + package proof

- Scratch profile materialization (`--materialise-only` through the real launcher): profile package.json depends on `arxa-workspace-provider`, materialized cordis patch carries the service row — pinned in `bin/selftest.provider-cli.mjs` (RED first: dep absent).
- bin wiring: dir const + PROFILE_PLUGINS + BY_NAME_PLUGINS entries; cordis row (by package name, browser half via dsh.client); `dsh.client` + full exports map in the plugin package.json; host half `lib/index.js` (read-only Connection RPC status channel, one-segment `/arxa-workspace-provider`, config-shape redaction, local-first default) + browser half `lib/client.js` (`__ModuleLoader__` factory shape per personalisation; exposes `window.__arxaWorkspaceProvider.info()` for the later §5 panel).
- Pack: `BIN_FILES += arxa-studio-provider.mjs` (pack-list-check RED first: file loaded but not packed → fatal), pack-list-check 10 ok, `pack-sidecar --check` OK. **Full pack run** (239.9 MB, payload sha12 716a70d6b4eb): the packed self-extracting binary executed `provider verify` end-to-end against a scratch home — extraction, pinned node, payload, bin list, CLI dispatch, full conformance: **all sections green, exit 0**. Payload manifest inspected post-extraction: all 11 modules of `plugins/workspace-provider/lib/` present. Packed-mode `--materialise-only` proves profile package.json + cordis row.
- ci.mjs: the five plugin selftests auto-discovered (`selftest.<topic>.mjs` sweep); only `bin/selftest.provider-cli.mjs` hand-wired (bin/ is outside the sweep).
- **Full `npm test`: 125 suites, ALL GREEN.**
- `preset-check` ALL GREEN with the new row; `launcher-settings` 10 ok.

### Checkpoint obligations (pinned, golden, in `selftest.contract.mjs`)

1. **Token/session RESPONSE envelope** — new section 13: `decodeSessionEnvelope` pins `{token, session:{id, expiresAt?}}` exact decode (unknown keys dropped), every malformed shape typed `invalid_request`, no body echo; `decodeIntrospection` pins `{active[, session]}`.
2. **X-Arxa-Cursor-Next consume semantics** — new section 14: `consumeListPage` pins header-verbatim cursor (validated as a decodable v1 cursor, never inspected), absent/empty header = end of stream, body-borne cursors ignored, case-insensitive lookup, and the paginate-loop termination. The contract file grew pins only; nothing existing was edited (freeze honored).

### TDD evidence (RED → GREEN per step)

- contract pins: ERR_MODULE_NOT_FOUND (generic-rest.js absent) → 14 checks green.
- local/kit: ERR_MODULE_NOT_FOUND → after two test-side fixes (missing `localExempt` claim) and two kit bugs found by the tests (orgs-crud archived the shared org; orphan waitFor rejection unhandled) → 6 checks.
- polling: ERR_MODULE_NOT_FOUND → 5 checks (one clock-await subtlety: the schedule callback now `return`s the tick promise so an injected clock can await it).
- rest: missing-export SyntaxError → after one adapter bug (double-nested issue body), three fixture bugs found by the suite (tok2- token parse, member-id off-by-one, patchMember mutating a mapped copy, putBlob answering JSON where the frozen wire says BYTES) and the poller baseline race → 8 checks incl. hostile legs.
- export: written under the local suite's migration RED; deep suite then caught two of its own expectation bugs; **negative controls**: hash-compare mutated out ⇒ tamper check red; ID-map fallback disabled ⇒ ID check red; both restored to 7 green.
- CLI: dispatch absent ⇒ exit≠0 red → 9 checks (two CLI bugs found: diagnose swallowed `--out` via the subcommand destructure; config-shape needed readable rendering; plus the kit hardening for dead providers).
- wiring: materialisation asserts red (dep absent) → green; pack-list-check red (missing BIN_FILES entry) → 10 ok.

### Files

Created: `plugins/workspace-provider/lib/{capabilities,local,generic-rest,polling,export-bundle,conformance,index,client}.js`; `plugins/workspace-provider/selftest.{local,rest,polling,export}.mjs`; `bin/arxa-studio-provider.mjs`; `bin/selftest.provider-cli.mjs`.
Modified: `plugins/workspace-provider/{package.json,selftest.contract.mjs}` (pins only), `bin/arxa-studio.mjs` (dispatch + PROFILE_PLUGINS/BY_NAME_PLUGINS + dir const), `profile/cordis.patch.yml` (service row), `scripts/pack-manifest.mjs` (BIN_FILES), `scripts/ci.mjs` (one hand-wired suite).
Untouched: `lib/contract.js`, `lib/wire.js`, `lib/errors.js` (wire freeze), `package-lock.json` (pre-existing dirt, left out of the commit).

### Self-review

- Wire freeze: held. No frozen file edited; the contract selftest only gained sections 13–14 (additive pins). Any later change to the pinned response semantics is a wire change requiring v2.
- Local-first parity: LocalWorkspaceProvider needs nothing beyond a filesystem; the CLI, diagnose, service row, and conformance all run against it with zero config; the dsh service answers local by default.
- No secrets: token never printed by any layer (redaction pinned at three levels — codec, REST client, diagnose); diagnose redaction proven against a seeded secret+bearer.
- Hostile-fixture discipline: 127.0.0.1 only, ephemeral port, closed in finally; the fixture never runs in CI against anything but loopback.
- The dsh host/client row is deliberately thin (read-only status RPC + `window.__arxaWorkspaceProvider.info()`): the §5 settings panel and sign-in flows are later tasks' surface; nothing speculative was built.

### Concerns

1. **Pre-existing (verified at BASE by stash round-trip): the engine does not boot** — `plugins/git-workspace/lib/sessions.js:64` imports `../../sandbox/lib/devcontainer.js`+`sbx.js` (Task 11), which breaks in the profile's flat node_modules copies because `sandbox` is not in `fiveLibs` (`bin/arxa-studio.mjs`); ERR_MODULE_NOT_FOUND before the port binds, in checkout AND packed mode. `engine-boot-smoke` is a hand-run smoke (not in npm test), so nothing was red. This blocked the literal "boot the packed engine (web)" proof — my packed proof covers extraction + pinned node + payload inspection + full CLI/conformance execution through the real packed binary. Recorded as a New finding (severity high).
2. REST CLI sign-in is intentionally not interactive yet (credentials never ride config; the handle store exists, `signInInfo()` exposes the declared flow) — `provider verify` for generic-rest honestly reports red rows until a session exists. The interactive flow belongs with the §5 panel task.
3. The `loopback-localhost-patch.mjs` unused-pack-list warning is pre-existing (verified at BASE); harmless (warning, not failure) but the scanner misses a reachable file.

## Fix round 1

Commit `4cc0380` — fix: bound blob payloads, refuse unimplemented providers, pack sandbox lib (6 files, +97/−13). Wire freeze untouched: `git diff 3597a40 -- contract.js wire.js errors.js` is empty; no wire surface changed.

### Important 1 — blob payloads were bounded by MAX_RECORD_BYTES (1 MiB)

- **Change:** `plugins/workspace-provider/lib/generic-rest.js` — the one transport guard now picks the bound by media type: `op.req === MEDIA.BYTES ? BOUNDS.MAX_BLOB_BYTES : BOUNDS.MAX_RECORD_BYTES` (blobs ≤1 GiB legal; the JSON-body path and its exact message are unchanged).
- **Covering test (RED-first):** `plugins/workspace-provider/selftest.rest.mjs` leg 9 — a 2 MiB blob through the adapter against the in-process fixture (injected fetch + fake server): put + client hash + get round-trip, plus a >1 MiB JSON record still rejected as `invalid_request`.
- **Command:** `node plugins/workspace-provider/selftest.rest.mjs`
- **RED excerpt:** `WorkspaceError: body exceeds the Wire v1 byte bound … code: 'invalid_request'` (exit 1)
- **GREEN excerpt:** `ok blob byte bound is MAX_BLOB_BYTES (2 MiB accepted); the 1 MiB bound still guards JSON bodies` → `workspace-provider rest conformance: 9 checks green` (exit 0)

### Important 2 — provider: "supabase" silently built local; verify certified green

- **Change:** `bin/arxa-studio-provider.mjs` — `buildProvider` throws `invalid_request: the "<name>" adapter is not implemented in this build (implemented: local, generic-rest)` for any configured-but-unimplemented name; `provider verify` prints a RED `provider` row + `verifyFailed` and exits 1; `workspace export|import` refuse via the run() catch (nonzero, reason printed); `diagnose` still runs as a diagnostic (versions, config shape, redacted log tail) with a RED provider row and nonzero exit — nothing is ever certified green for the wrong backend.
- **Covering test (RED-first):** `bin/selftest.provider-cli.mjs` leg 9 — supabase config through the launcher: verify nonzero + RED row naming supabase + never "all sections green"; export refuses with "not implemented"; diagnose carries `provider: supabase` + RED + nonzero.
- **Command:** `node bin/selftest.provider-cli.mjs`
- **RED excerpt:** `AssertionError: verify exits nonzero for an unimplemented provider` (exit 1 — the old behavior exited 0 all-green)
- **GREEN excerpt:** `ok supabase config: verify RED + nonzero, export refuses, diagnose reports without certifying` → `workspace-provider CLI: 10 checks green` (exit 0)

### Important 3 (T11-rooted) — engine web boot died ERR_MODULE_NOT_FOUND

- **Change:** `bin/arxa-studio.mjs` `fiveLibs` += `['sandbox', plugins/sandbox]` AND `['github-link', githubLinkDir]`. The second row is the hidden hop the one-line prescription uncovered: `sandbox/lib/devcontainer.js` imports `../../github-link/lib/keyring.js` by DIRECTORY name (package name is `arxa-github-link`) — the same flat-resolution rule the approvals/push-doorbell rows already document. A static scan of every `../../<dir>/` import across `plugins/*/lib` confirms the flat closure is exactly fiveLibs ∪ {sandbox, github-link}; the only remaining target (`provider-status`) is imported solely by claude-code, a path row that never loads from `node_modules`.
- **Blind-spot closure (which + why):** wired `scripts/engine-boot-smoke.mjs` into `npm test` discovery (`scripts/ci.mjs`, one suite row) rather than extending the pack-list scanner. Cheapest that genuinely catches it: the smoke is the end-to-end proof that every import the launcher actually loads resolves (it caught this exact regression, and hop 2, which a fiveLibs/PROFILE_PLUGINS static check would need a dir-name↔package-name resolver to even model); fully local (scratch home, loopback port, no credentials, no model calls, ~5–15s).
- **Covering proof (RED-first, the gate is its own test):** `node scripts/engine-boot-smoke.mjs`
- **RED excerpt:** `engine-boot-smoke: FAILED — the launcher exited 1 … ERR_MODULE_NOT_FOUND …/node_modules/sandbox/lib/devcontainer.js imported from …/git-workspace/lib/sessions.js` (then hop 2: `…/node_modules/github-link/lib/keyring.js imported from …/sandbox/lib/devcontainer.js`)
- **GREEN excerpt:** `engine-boot-smoke: OK — studio UI answered 200 HTML on :7919 via the desktop-session.json contract` (exit 0, 5s)

### Verification

- Individually, one suite at a time: contract 14 / local 6 / rest 9 / polling 5 / export 7 checks green; CLI suite 10 checks green; boot smoke green at HEAD.
- `npm test` → exit 0, **arxa-studio CI: 126 suites** (grew from 125 by the boot-smoke row), **ALL GREEN**, 2m36s.
- No secrets printed in any new output; `package-lock.json` dirt excluded from the commit; no push/merge/tag.

### Minor findings — deferred, not fixed (per review ruling)

redactLine's `startsWith('line')` exemption (`arxa-studio-provider.mjs`); local `orgId` unguarded vs `../` (`lib/local.js:74`); REST `subscribe` polls only page 1 (`generic-rest.js`); `writeAtomic` has no fsync; corrupt `manifest.json` surfaces untyped SyntaxError; `importBundle` swallows all addMember errors.
