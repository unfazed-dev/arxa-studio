⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
## 🔍 Task 14 re-review (75d090f → ce5e82e)

**Finding 1 (Prefer semantics): ADDRESSED** — `plugins/workspace-provider/lib/supabase.js:107-112,217,244,256,263,273,291,300,308,312`: blanket `return=minimal` removed from `call()`; `return=representation` on all five consumed RPCs (add_member, set_member_role, put_record, list_records, read_audit) plus mkOrg POST/PATCH/DELETE orgs and records DELETE; minimal only on remove_member + audit_log insert (nothing read); auth/storage carry none — and the fake now enforces this server-side (`selftest.supabase.mjs:184-188,264-267`: 201/204-no-body without representation, RPC minimal→204, errors pass through) with §17 (`:759-794`) asserting a per-call-site header map (`RPC_PREFER` differentiates remove_member=minimal from the rest=representation; `TABLE_PREFER` differentiates audit_log=minimal; unknown spellings and auth/storage must be `null`; every RPC asserted exercised so it can't pass vacuously), smoke mkOrg sends representation (`scripts/workspace-provider-supabase-smoke.mjs:164`).

**Finding 2 (deterministic npm test): ADDRESSED** — `scripts/workspace-provider-supabase-smoke.mjs:52-53`: `auto` mode and its docker+CLI probe are deleted (diff confirms removal of the `spawnSync('docker')`/version probe from dispatch); default/`--fake` → fake unconditionally, real only via `--real`/`ARXA_SUPABASE_REAL_SMOKE=1` (docker/CLI checks now live only inside `realLeg()`); CI job passes `--real` (`.github/workflows/ci.yml:93`); `scripts/ci.mjs:99-102` "never in npm test" comment is now true (spawned bare, no args, no env set anywhere in repo).

## ✅ Runs (one at a time, daemon down, CLI present)

- `node plugins/workspace-provider/selftest.supabase.mjs` → exit 0, **17 checks green**, incl. §17 prefer row
- `node scripts/workspace-provider-supabase-smoke.mjs` → exit 0, `FAKE LEG (injected protocol fake, offline, no ports)` + `OFFLINE BY DEFAULT` banner (no DAEMON-GATED)
- `npm test` → exit 0, `arxa-studio CI — 129 suites`, **129 GREEN / 0 RED, ALL GREEN**

## 🧊 Wire freeze
Held — `git diff 3597a40..HEAD -- contract.js wire.js errors.js` = 0 lines.

## ⚠️ New breakage
None — fix diff touches only headers/comments (supabase.js), fake emulation + §17 (selftest), and mode dispatch (smoke); rpc→rpcDo split has one caller; `--fake` merely takes precedence over `--real`.

## 📋 Deferred minors observed
Original Minors 3–5 (member-gated org DELETE, docker volume cleanup, badgeDegraded/appendAudit idempotency) remain untouched — deferred, as instructed.

Verdict: all findings addressed
