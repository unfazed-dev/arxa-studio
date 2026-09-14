⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Spec Compliance
- ✅ Step 1 — all 11 matrix areas covered: selftest.supabase.mjs §1–16 (row mapping §6, RLS §12–15, token lifecycle §5, email sign-in §4, invitation §7, storage §10, realtime/poll §11, audit §9, retry/idempotency §3+§8, unavailable §2); hostile idor+leak flips prove the kit bites
- ✅ Step 2 — harness: pinned CLI 2.67.1 refusing mismatch (smoke:38,100–102), docker required (:103), scratch mkdtemp copy (:109–114), reserved ports 54921/54922 (config.toml:12,15), two users/orgs (:153–163), exit+SIGINT/SIGTERM cleanup (:69–76). ⚠️ volume cleanup not literal (see Minor 4); ⚠️ auto-mode can run the real leg inside `npm test` (Important 2)
- ✅ Step 3 — apply-twice via db reset + migration up (:132–138), raw authenticated A-vs-B replay get/put/list/audit (:170–186), reversal `migration down --last N` + count proof (:229–234), inverse SQL in-file header
- ✅ Step 4 — adapter; row shapes confined to lib/supabase.js (mapOrg/mapMember:208–211); opaque session surface ({userId,email,expiresAt}:196)
- ✅ Step 5 — credentials only via injected store (`workspace-supabase`, supabase.js:39,164); no env-file writes (grep of diff clean); zero-config local default; selection fence verified live ("must be one of: local, supabase, generic-rest"); declared-kind dispatch (§4); truthful realtime:false badges (settings selftest :56,78)
- ✅ Step 6 — one conformance kit for all three providers; export local→supabase→local hash-equal, identities re-invited not copied (§16, asserts :704–706)
- ✅ Step 7 — npm test 129/129 GREEN; commit message exact
- ✅ Global: wire freeze diff empty; no staff-access capability; no Arxa-owned URL/key (grep); service key only server-side in the harness leg
- Claims: (1) daemon-gating honest ✅ but real leg likely defective (Important 1); (2) env fallbacks present ✅; (3) verified — exemption is `instanceof LocalWorkspaceProvider` only (arxa-studio-provider.mjs:183); (4) three New findings confirmed in progress.md:289–291 ✅; (5) two full runs here: no flake ✅

### Independent Verification Results
- `node plugins/workspace-provider/selftest.supabase.mjs` — **16 checks green, exit 0**
- `node bin/selftest.provider-cli.mjs` — 10 green; bogus provider name `firebase` rejected at config layer with the three-name fence — exit 0
- `node plugins/workspace-provider/selftest.contract.mjs` — 14 green, exit 0
- `node scripts/workspace-provider-supabase-smoke.mjs` — fake leg, honest `DAEMON-GATED:` banner, exit 0
- `npm test` ×2 — **exit 0, 129/129 GREEN, RED=0** both runs (no S5 flake observed)
- Wire freeze: `git diff 3597a40..HEAD -- contract.js wire.js errors.js` → **0 lines**
- CI job: separate `supabase-conformance` job, pinned-CLI hard-fail step, loud `::warning::` docker skip, runs `--real` explicitly
- Migrations: RLS on all tables; SECURITY DEFINER helpers with pinned search_path; SECURITY INVOKER RPCs; audit insert+select only + explicit revoke; storage policy keyed on `org/<id>/` path; SQLSTATE map matches adapter

### Strengths
- The protocol fake is genuinely adversarial (RLS emulation, SQLSTATE→HTTP, hostile idor/leak flips) — the kit's green is provably non-rubber-stamped
- Clean row-shape encapsulation; token redaction in `decodeError`; `return=representation` discipline in the adapter's own table calls
- Ledger discipline honest (3 findings recorded, flake reported as seen)

### Issues
#### Critical (Must Fix)
None.

#### Important (Should Fix)
1. **Prefer-header semantics unverified against real PostgREST; fake is blind to them (zero Prefer handling in selftest.supabase.mjs).** (a) `scripts/workspace-provider-supabase-smoke.mjs:158` — mkOrg POSTs a table insert with no `Prefer: return=representation` then reads `r.body[0].id`; PostgREST's table-insert default is minimal (no body) — the adapter itself always sends the header when it needs rows (supabase.js:214,228,233,293). Real leg likely dies at first org create. (b) `lib/supabase.js:108` — blanket `return=minimal` rides every body-carrying call without explicit prefer, including all six `/rpc/*` calls that consume their response (`out.id` at :273 would TypeError on a 204). postgrest-js never sends this on rpc precisely because bodies must come back. Both fail loudly (never a false green), but "correct by construction" doesn't hold — fix before trusting the CI job: `return=representation` on RPC/mkOrg.
2. **Auto-mode makes `npm test` machine-state-dependent.** `scripts/ci.mjs:100` wires the smoke into npm test; `smoke:265–269` runs the REAL stack whenever daemon+CLI-pin exist — the runner must have the CLI for `supabase-conformance`, so the main job will also spin the disposable stack, contradicting ci.mjs's own "never in npm test" comment and the brief's "ordinary offline npm test uses the injected protocol fake". Run the offline leg deterministically.

#### Minor (Nice to Have)
3. `migrations:149–153` — orgs_update/orgs_delete gate on plain membership: a lowest-role member can DELETE the org, cascading away all records and the append-only audit (org delete cascade, :71). Cross-tenant isolation intact; inconsistent with owner/admin-gated member management. Consider owner/admin-gating delete.
4. `smoke:71` — `stop --no-backup` does not remove Docker named volumes (fixed project_id, config.toml:8); rmSync wipes only the scratch dir. `db reset` prevents contamination, but the "volume cleanup" constraint is only partially met.
5. `lib/client.js` — `badgeDegraded` exists in all three dictionaries but `section()` never emits it; retrying `appendAudit` after a lost response can double-append (no idempotency key).

### Assessment
**Task quality:** Needs fixes
**Reasoning:** Offline surface is fully green and honestly adversarial (verified twice, wire frozen), but the unexecuted real leg carries two likely Prefer-header defects the fake cannot catch, plus npm-test nondeterminism — the real-stack leg that CI is supposed to certify is probably not correct as shipped. All fixes are one-liners; everything else is approved.
