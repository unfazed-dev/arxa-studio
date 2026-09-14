### Task 14: Implement the first-party Supabase/Postgres provider

**Governing source:** `docs/plans/agency-backend-provider-abstraction.md` plus Task 13's frozen contract.

**Files:**
- Create: `plugins/workspace-provider/lib/supabase.js`
- Create: `plugins/workspace-provider/migrations/*.sql`
- Create: `plugins/workspace-provider/selftest.supabase.mjs`
- Create: `plugins/workspace-provider/supabase/config.toml`, `scripts/workspace-provider-supabase-smoke.mjs`
- Modify: `plugins/workspace-provider/lib/index.js`, `plugins/workspace-provider/package.json`, `bin/arxa-studio-provider.mjs`, and `scripts/ci.mjs`
- Modify: `.github/workflows/ci.yml` with a separate disposable local-Supabase conformance job
- Modify: `plugins/workspace-provider/lib/client.js`, `plugins/workspace-provider/package.json`, and provider selftests for a dedicated Workspace backend settings section; integrate its EN/PL/FR keys through the existing `arxa-locale` service

**Interfaces:**
- Implements Task 13 `WorkspaceProvider`.
- The contract exposes no staff/support-access capability; diagnostics remain operator-exported.
- Supabase Auth supplies the reference email/password UX, but callers consume only the Task 13 opaque-token session surface.
- Realtime absence or failure degrades to Task 13 adaptive polling.

- [ ] **Step 1: Write failing adapter contract tests.** Cover SQL row mapping, RLS/tenant isolation, token lifecycle, reference email sign-in, member invitation, storage, realtime and adaptive-poll fallback, audit append-only behavior, retry/idempotency, and unavailable service.
- [ ] **Step 2: Build the disposable local-Supabase harness.** Pin the Supabase CLI version in the script/workflow, require Docker, start under `plugins/workspace-provider/supabase` with a scratch state directory and reserved ports, create two users/two orgs, and guarantee stop/volume cleanup on success, failure, and signal. The ordinary offline `npm test` uses an injected protocol fake; the dedicated CI job runs this real local stack.
- [ ] **Step 3: Write migrations with a reversible local test.** Apply to an empty local stack, apply twice, exercise rows, reset only the disposable database, and replay raw authenticated requests proving each user cannot list/read/write the other org.
- [ ] **Step 4: Implement the adapter.** Keep provider-specific row shapes inside this module; callers see only contract objects.
- [ ] **Step 5: Implement configuration/status.** Store credentials through the existing credential service, never environment files. Local stays the zero-config default; settings may select only `local`, `generic-rest`, or `supabase`, dispatch the declared sign-in kind, and show truthful live/degraded capability badges.
- [ ] **Step 6: Run all three providers through one conformance suite and export local -> Supabase -> local.** Hash-equivalent portable data is required; provider identities are re-invited, not copied. Run `node scripts/workspace-provider-supabase-smoke.mjs` and require the RLS/IDOR section green.
- [ ] **Step 7: Run `npm test`; commit.** `feat: add the first-party Supabase workspace provider`.

