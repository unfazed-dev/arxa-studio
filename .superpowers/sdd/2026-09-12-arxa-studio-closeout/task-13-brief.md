### Task 13: Implement the fixed WorkspaceProvider wire contract, local provider, and generic REST adapter

**Governing source:** `docs/plans/agency-backend-provider-abstraction.md`.

**Files:**
- Create: `plugins/workspace-provider/package.json`
- Create: `plugins/workspace-provider/lib/{index,client,contract,wire,capabilities,errors,local,generic-rest,polling,export-bundle,conformance}.js`
- Create: `plugins/workspace-provider/selftest.{contract,local,rest,polling,export}.mjs`
- Create: `bin/arxa-studio-provider.mjs`
- Modify: `bin/arxa-studio.mjs` to add the plugin directory constant, `PROFILE_PLUGINS`, `BY_NAME_PLUGINS`, packed/materialization checks, and dispatch `provider verify`, `workspace export`, `workspace import`, and `diagnose` before normal studio boot
- Modify: `profile/cordis.patch.yml` to register the host/client service row
- Modify: `scripts/ci.mjs` to include the new focused suites
- Modify: `docs/plans/agency-backend-provider-abstraction.md` with the program rulings

**Interfaces:**
- Produces an in-process `WorkspaceProvider` used only by first-party modules, with versioned capabilities and collection/blob/member/audit operations from the source plan.
- Produces a versioned HTTP/JSONL protocol for the generic REST backend. Authentication is token-opaque: issue, refresh, revoke, and introspect; email/password is not part of the wire contract.
- Produces `LocalWorkspaceProvider` with zero network/auth dependency.
- Produces `GenericRestWorkspaceProvider({ baseUrl, credentialStore, fetch })`; no provider path or JavaScript module is accepted from user configuration.
- Produces portable export/import bundle: versioned `manifest.json`, one JSONL per collection, `storage/`, `members.json`, hashes, and no credentials/entitlements/subscriptions.

**Wire v1 (freeze before implementation):**

| Surface | Contract |
|---|---|
| Version/request | Base path `/arxa-workspace/v1`; every request carries `X-Arxa-Workspace-Version: 1` and `X-Request-Id`; authenticated requests carry `Authorization: Bearer <opaque-token>`. Unknown versions return typed `unsupported_version`. |
| Capability/sign-in | `GET /capabilities` returns capability booleans plus `signIn.kind: email-form | browser | device-code | token` and the matching start metadata. `POST /auth/issue`, `/auth/refresh`, `/auth/revoke`, and `/auth/introspect` exchange JSON and return opaque token/session envelopes; providers own credential verification and may redirect/hand off according to the declared kind. |
| Orgs/members | `GET /orgs` and `GET /orgs/{orgId}/members` return `application/x-ndjson`; `POST /orgs`, `GET|PATCH|DELETE /orgs/{orgId}`, and `POST|PATCH|DELETE` member resources use bounded JSON. Roles are `owner | admin | billing | member`. |
| Records/audit | `GET /orgs/{orgId}/records/{collection}?cursor=&limit=` returns JSONL; `PUT|GET|DELETE /orgs/{orgId}/records/{collection}/{id}` uses JSON plus ETag/`If-Match` for conflicts. `POST /orgs/{orgId}/audit` appends JSON; `GET` streams JSONL; no audit mutation route exists. Collection names are the fixed §1 list. |
| Blobs/realtime | `PUT|GET|DELETE /orgs/{orgId}/storage/{path}` streams bytes; `POST .../signed-url` returns bounded JSON. Optional `GET /orgs/{orgId}/events?cursor=` streams JSONL events and resumes from a cursor. |
| Errors/bounds | Non-2xx JSON is `{error:{code,message,retryable,requestId}}` with the fixed typed codes. Default/max page sizes, body/blob limits, timeouts, retryable status set, and cursor encoding are constants in `contract.js` and golden-tested; messages never contain tokens or cross-org data. |

- [ ] **Step 1: Rewrite the stale source-plan status and config examples.** Record D32–D35 as the later authority: local remains zero-config, remote choices are `generic-rest` and `supabase`, `custom.adapter` and `ARXA_WORKSPACE_ADAPTER` are invalid, support is bundle-only, identity is token-opaque, and fallback polling is 3s active/30s idle/120s background plus immediate after write.
- [ ] **Step 2: Freeze the contract and wire protocol in failing golden tests.** Encode the Wire v1 table above as exact routes, verbs, headers, media types, envelopes, bounds, pagination, token lifecycle, capability-driven sign-in dispatch, error taxonomy, abort signals, and request IDs. Assert config cannot name executable code. Stop for task review before writing either adapter; any wire change after this checkpoint requires a new protocol version.
- [ ] **Step 3: Verify RED, then implement contract/types/errors and protocol codecs.** JSON responses cover bounded singleton operations; record/audit streams and export use JSONL. Reject unknown versions and collections before I/O.
- [ ] **Step 4: Build the reusable conformance kit.** Cover CRUD, watch/poll degradation, adaptive polling transitions, optimistic conflict, pagination, audit immutability, blob hashes, member roles, idempotent replay, and migration round-trip. Network providers must also pass cross-org raw-request/IDOR tests; local reports that section `n/a (single-user local store)`.
- [ ] **Step 5: Implement the local provider.** Store atomic JSON documents and append-only JSONL under `<ARXA_HOME>/workspace/<orgId>/`, with mode `0700` on the workspace root; it must pass the same applicable conformance sections without network, account, database, or environment variables.
- [ ] **Step 6: Implement the generic REST adapter and sign-in dispatch.** Inject `fetch`, read its opaque credential handle through the credential service, render only the declared email/browser/device-code/token flow, enforce timeouts and bounded retries, and map only Wire v1. Add a hostile fixture server that proves tenant and IDOR failures become red conformance results.
- [ ] **Step 7: Implement export/import and the canonical CLI.** `arxa-studio workspace export|import`, `arxa-studio provider verify`, and `arxa-studio diagnose` are the only command spellings in this repository. Stream JSONL, verify hashes before mutation, preserve IDs where accepted, write an ID map otherwise, re-invite members through provider operations, and import audit rows as read-only history. `provider verify` prints every conformance section and exits nonzero on any required red row.
- [ ] **Step 8: Add `arxa-studio diagnose`.** Produce a user-inspectable bundle containing versions, redacted config shape, provider-verify results, and bounded error logs; include no tokens, secrets, or client records.
- [ ] **Step 9: Prove runtime and package inclusion.** Materialize a scratch profile and boot host/client settings; pack the sidecar, inspect its manifest for `arxa-workspace-provider`, and boot the packed engine before running focused conformance, migration pressure tests, CLI smokes, and `npm test`.
- [ ] **Step 10: Commit.** `feat: add fixed workspace providers and local storage`.

