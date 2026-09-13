# Agency Backend Provider Abstraction (BYO Database)

Status: SUPERSEDED IN PART by grill decisions **D32–D35** (`docs/plans/arxa-studio-grill-decisions.md`, 2026-09-12) — those are the **later authority** wherever this plan and they disagree. The Wire v1 contract is frozen in `plugins/workspace-provider` (task 13); providers and the conformance kit land with it.

**Amended 2026-09-07 — two corrections, still no code.** (a) The plan offered
`supabase` and `custom` and nothing else, so a user with no database and no
adapter module got *nothing* — which the repo's own ownership boundary forbids
(`CLAUDE.md`: "every feature that can use a database must have a **local-only
fallback with equivalent capability and security** for users without one").
`local` is now the DEFAULT provider, specified in §0, §1 and §5. (b) The
Supabase table advertised `entitlementIssuer` and `billingWebhooks` as
workspace-provider capabilities while §0 says the license plane is not
pluggable; they are removed from the contract (§1) and kept only as a
description of the official project's own shape (§3). Everything marked `local`
here is a **design decision, not shipped code** — none of it exists yet.

**Amended 2026-09-13 — D32–D35 recorded (wire-contract freeze).** The four
rulings below are binding and later than every earlier paragraph:

- **Providers (D32):** the fixed set is `local` (DEFAULT, zero-config), `supabase`, and `generic-rest` (the Wire v1 contract itself, over any conforming backend). There is **no `custom` provider**: a `custom.adapter` key in config and the `ARXA_WORKSPACE_ADAPTER` env override are **invalid** and rejected. A BYO backend integrates by implementing the fixed HTTP/JSONL wire protocol server-side and passing `arxa-studio provider verify`; no third-party JavaScript ever executes inside the app, and nothing is published to npm in this closeout.
- **Support (D33):** bundle-only. Staff never hold credentials or tokens for customer-run infrastructure; no support-access capability exists in the wire contract. `arxa-studio diagnose` emits the redacted, user-inspectable bundle.
- **Identity (D34):** token-opaque. The wire contract specifies only the session-token lifecycle — issue, refresh, revoke, introspect. How a user authenticates is entirely the provider's business; `GET /capabilities` declares `signIn.kind: email-form | browser | device-code | token` plus start metadata, and studio renders only the declared flow. Email/password is **not** part of the wire contract.
- **Realtime fallback (D35):** adaptive polling, as contract constants — **3 s** focused-and-active, **30 s** focused-idle, **120 s** background, plus an **immediate poll after any local write**.

Sources read: `docs/plans/arxa-studio-grill-decisions.md` (D-series locked decisions), `docs/plans/entitlement-backend-runbook.md`, `arxa/deploy/supabase/schema.sql` + `seed.sql`.

## 0. The one non-negotiable split

Two planes. They never merge:

| Plane | What it holds | Backend |
|---|---|---|
| **Product-license plane** | arxa entitlements, machines, subscriptions, Stripe billing, activate flow | **ALWAYS the official Totem backend.** Not pluggable, not configurable off. |
| **Workspace-data plane** | orgs, org_members, tickets, chat, feedback, audit_log, analytics, storage blobs | **Pluggable, three providers (D32):** `local` (DEFAULT — no account, no network, no database), `supabase` (first-class, and the conformance reference), `generic-rest` (the Wire v1 contract over any conforming backend). There is no `custom` adapter module. |

A BYO provider replaces only the workspace-data plane. Paying for arxa (studio or agency tier) still means checkout → official `activate` Edge Function → Ed25519-signed token → offline verification in `arxa/lib/entitlement.dart`. A BYO backend cannot mint product tiers. This preserves every payment-gate decision in the grill doc unchanged.

## 1. Provider interface surface (`WorkspaceProvider`)

Minimal contract the agency app codes against. All IDs are opaque strings; all methods async; all errors from a small typed set (`unauthenticated`, `forbidden`, `not_found`, `conflict`, `unavailable`).

### REQUIRED capabilities

**`auth`** — session lifecycle
- `signIn(method, credentials)` / `signOut()` / `currentSession()` → `{ userId, email?, expiresAt }`
- `onAuthStateChange(cb)`
- Provider owns identity storage; the app never sees password hashes or provider tokens beyond the session handle.

**`orgs`** — org + membership CRUD (maps to the org/folder context-lock decision: every piece of workspace content lives inside exactly one org; agency = the multi-org tree, studio = single-org view)
- `createOrg(name, kind)` / `getOrg(id)` / `listOrgs()` / `updateOrg` / `archiveOrg`
- `addMember(orgId, email, role)` / `listMembers(orgId)` / `setRole` / `removeMember`
- Role vocabulary is fixed by the contract: `owner | admin | billing | member` (mirrors `org_members`). Providers may not invent roles; extra provider-side roles must map down to these four.

**`records`** — generic org-scoped document store for the agency collections
- `put(orgId, collection, id, doc)` / `get` / `list(orgId, collection, filter, cursor)` / `delete`
- Fixed collection names owned by the contract: `tickets`, `ticket_messages`, `chat_conversations`, `chat_messages`, `feedback`, `requirements`, `user_prefs`. Schema-on-write is the app's job; the provider stores JSON docs + a few indexed columns (`org_id`, `created_at`, `author_id`).

**`audit`** — append-only
- `append(orgId, event)` only. No update/delete in the interface at all — immutability enforced by interface shape, verified by the conformance kit.

**Server-side authorization (cross-cutting, REQUIRED)** — every capability above must be enforced *by the provider's server*, not by the adapter. The adapter is untrusted client code. Concretely: user A of org X must be unable to read/write org Y's rows even with a hand-crafted request. Supabase does this with RLS; a BYO Postgres+PostgREST or custom API must do the equivalent. This is a conformance-kit gate, not a suggestion. It binds every provider that talks to a network; the `local` provider is exempt by construction (see §1 local table and §4 section 3), and the kit reports that exemption rather than a pass.

### OPTIONAL capabilities (with mandated degradation)

| Capability | Surface | Degradation when absent |
|---|---|---|
| `realtime` | `subscribe(orgId, collection, cb)` | Adaptive polling (D35, contract constants): 3 s focused-and-active, 30 s focused-idle, 120 s background, immediate poll after any local write; UI drops the "live" badge. No feature is removed. |
| `storage` | `upload/download/delete/signedUrl(orgId, path)` | Attachments disabled in tickets/chat; text-only flows keep working. |
| `analytics` | `track(event)` (fire-and-forget) | No-op sink. Nothing user-visible. |

**Not capabilities, deliberately.** An earlier draft listed `billingWebhooks`
and `entitlementIssuer` here. Both contradict §0 — the license plane is "not
pluggable, not configurable off" — and listing them in the workspace contract
invites an adapter author to implement something no workspace provider may
serve. Product billing and product-tier issuance are the official backend's,
always. The *optional* BYO issuer for workspace-scoped claims is a separate
server endpoint spec (§2), not a `WorkspaceProvider` capability, and it can
never sign a product-tier claim.

### The `local` provider (the default, and the fallback the boundary requires)

Not a degraded mode: the same contract, same conformance kit, same UX. It is
what a free user with no account runs, and it is the shape
`plugins/account-mirror/lib/providers.js` already established (local default,
remote as a typed stub that performs no HTTP).

| Capability | Local implementation |
|---|---|
| `auth` | One local user, the machine's operator. `currentSession()` always returns it; `signIn`/`signOut` are no-ops that still fire `onAuthStateChange`. No password, no token. |
| `orgs` | Orgs and members are records like any other. Roles are stored and enforced by the same rules; with one user the enforcement is trivially satisfied but the vocabulary stays identical, so a later export/import into Supabase needs no translation. |
| `records` | JSON documents under `<ARXA_HOME>/workspace/<orgId>/<collection>/<id>.json`. Atomic per file (temp + rename), the account-mirror convention. |
| `audit` | Append-only JSONL per org. Immutability is a file mode plus the absence of any update/delete method — the same interface shape the contract relies on everywhere else. |
| `realtime` | In-process emitter. Strictly better than the polling degradation, because there is no network in between. |
| `storage` | Blobs under `<ARXA_HOME>/workspace/<orgId>/storage/`. `signedUrl` returns a `file:` URL. |
| `analytics` | No-op sink. |

**"Equivalent security" for a single-user local store means what it can mean:**
the OS's own file permissions (0700 on the workspace root) and the fact that
nothing leaves the machine. §1's server-side-authorization requirement is a
requirement about *remote* providers, where a hostile client is the threat;
locally the client and the server are the same process and the same user. The
conformance kit must state this exemption explicitly rather than let a local
provider silently "pass" the cross-org isolation section — see §4.

`provider.capabilities()` returns the supported set at startup; the app feature-flags from that one call.

## 2. Where the boundary lives — client-side adapter, and why

**Decision: the boundary is a client-side adapter inside the studio/agency app** (one interface, N adapter implementations), **not a hosted server shim.**

- arxa studio is local-first (`bin/arxa-studio.mjs`); a mandatory shim would add a server Totem must run or the user must deploy before anything works — worst of both.
- The trust-critical piece (entitlements) never depended on the data plane: tokens are minted server-side by an issuer and verified **offline, client-side** in `arxa/lib/entitlement.dart`. Moving data access client-side loses no security we actually rely on, *provided* server-side authz is a conformance requirement (§1).
- Supabase's own model is exactly this shape (client SDK + RLS), so the reference adapter is thin and honest — no capability exists in the reference that a BYO provider couldn't implement.

The only server component a BYO provider must add is the **activate-equivalent issuer endpoint** (below), because signing keys must never reach the client.

### Entitlement issuer trust model (unchanged, extended)

- Client holds a **verification keyring**: `[productionPublicKey]` always present and non-removable (today's embedded key; `debugPublicKeyOverride` remains a debug-only escape as in the runbook).
- Config may append extra public keys (env/config, §5). Tokens carry a key id; verification selects by kid.
- **Claim authority is partitioned by key**: product-tier claims (`pro`, seat counts for the arxa product, expiry of the paid license) are honored **only** when signed by the production key. Extra keys may only sign *workspace-scoped* claims (e.g. an agency gating a client portal feature). A BYO key signing a product claim → token rejected with a distinct error, logged.
- BYO issuer must replicate the shape of `deploy/supabase/functions/activate/index.ts` + `_shared/entitlement_jwt.ts`: keypair from a `keygen.mjs`-equivalent, private key server-side only, machine binding via `fingerprint_sha256`, expiry, seat/machine bookkeeping. We publish this as an "issuer spec" doc + the existing `local_mint_check.mjs` pattern as the smoke test.

## 3. Supabase reference adapter (conformance reference)

| Contract capability | Supabase implementation |
|---|---|
| `auth` | supabase-js Auth (GoTrue); session = Supabase session; `userId` = `auth.uid()` |
| `orgs` | `orgs`, `org_members` tables; RLS via `is_org_member(org_id)` / `is_totem_staff()` SECURITY DEFINER helpers; invite = insert into `org_members` |
| `records` | Existing tables (`tickets`, `ticket_messages`, `chat_conversations`, `chat_messages`, `feedback`, `user_prefs`) behind per-collection mapping in the adapter; RLS "read own org rows" policies |
| `audit` | `audit_log` insert-only (RLS: no update/delete policies) |
| `realtime` | Supabase Realtime channels per `org_id` |
| `storage` | Supabase Storage, bucket per env, path prefix `org/<org_id>/…` |
| `analytics` | `analytics_events` insert |

**Two rows that are NOT adapter capabilities** (they were, in an earlier draft;
§1 removed them). Kept here only to describe the official project's own shape,
because the Supabase adapter and the official license backend happen to be the
same technology:

- `activate` Edge Function + `ENTITLEMENT_ISSUER_JWK` secret +
  `machines`/`entitlements`/`subscriptions` tables — the license plane, on the
  official project, never on a customer's workspace project.
- `stripe-webhook` Edge Function (`STRIPE_WEBHOOK_SECRET`) — same.

A workspace provider neither implements nor advertises either one.

**Supabase-specific things the contract deliberately hides:**
- `user_id uuid references auth.users` — the contract's opaque `userId` string breaks this coupling; BYO providers use their own identity PKs.
- RLS + `auth.uid()` + SECURITY DEFINER helpers — contract only states the *behavioral* requirement (server-side org isolation); mechanism is provider's choice.
- Service-role key bypassing RLS — an operational detail; the contract has no "superuser" concept. Totem-staff support access (`is_totem_staff`) is a Supabase-adapter extra, not part of the portable contract.
- Edge Functions — contract specifies HTTP behavior of the issuer endpoint, not the runtime.

## 4. Conformance test kit (what a BYO provider must pass)

Ship as `arxa studio provider verify --config <file>` — a runnable suite against a live provider instance, plus a printed checklist. Sections:

1. **Auth**: sign-in/out round-trip; expired-session behavior; `onAuthStateChange` fires.
2. **Org CRUD + role matrix**: each of the four roles attempts each org/membership operation; results must match the contract's permission table exactly (e.g. only `owner|admin` add members; `billing` reads billing collections only; last-owner removal rejected).
3. **Cross-org isolation (the gate that matters)**: two real users, two orgs; user A replays raw API calls against org B's data — every one must fail server-side. Includes list-endpoint leakage (no org-B rows in org-A lists) and IDOR by guessed IDs. **The `local` provider is exempt from this section, and the kit must say so in its report rather than print a green** — the threat model is a hostile client talking to a shared server, and locally the client, the server and the user are one process. A local run prints `n/a (single-user local store)` for section 3; anything that talks to a network prints green or red.
4. **Records**: put/get/list/delete round-trip per collection; cursor pagination; concurrent-write conflict surfaces as `conflict`, not silent loss.
5. **Audit immutability**: append works; update/delete attempts (raw API) fail.
6. **Optional-capability honesty**: `capabilities()` matches reality — every advertised capability passes its round-trip; every absent one degrades per §1 table.
7. **Entitlement issuance (if `entitlementIssuer` advertised)**: mint on provider → verify with the real arxa verifier against the configured extra pubkey; machine-fingerprint binding; expiry rejection; revocation (deactivate machine → next verify fails); **negative test: BYO-signed product-tier claim is rejected**.
8. **Export/import fidelity** (§6): export → import into scratch Supabase project → deep-diff.

Passing = printed report with per-section green, suitable for pasting into a support ticket. The Supabase reference adapter must pass the kit in CI — the kit is the contract's executable form.

## 5. Config & UX

Precedence: env > project config > user config > default.

```jsonc
// .arxa/studio.json (project) or ~/.arxa/studio.json (user)
{
  "workspaceBackend": {
    "provider": "local",               // DEFAULT; or "supabase", or "generic-rest" — the only three (D32)
    "local":       { "root": "~/.arxa/workspace" },   // optional; this is the default
    "supabase":    { "url": "…", "anonKey": "…" },
    "generic-rest": { "baseUrl": "https://backend.example.test" }  // any backend implementing Wire v1
  },
  "entitlements": {
    "extraPublicKeys": [ { "kid": "acme-2026", "publicKeyPem": "…" } ]
    // production key is compiled in and cannot be removed here
  }
}
```

**Config cannot name executable code (D32).** A `custom` provider, an `adapter` key anywhere under `workspaceBackend`, or any module/file-path value is invalid and rejected at load — and the env override `ARXA_WORKSPACE_ADAPTER` is likewise invalid. `local` stays zero-config: no account, no network, no database, no environment variables.

Env overrides: `ARXA_WORKSPACE_PROVIDER` (one of the three fixed names only), `ARXA_SUPABASE_URL`, `ARXA_SUPABASE_ANON_KEY`, `ARXA_ENTITLEMENT_EXTRA_PUBKEYS` (path to JSON). These extend, and never replace, the production verification key — distinct from the existing debug-only `debugPublicKeyOverride`, which stays debug-gated.

**UX**: Settings → "Workspace backend" panel shows provider, capability badges (live/degraded per §1), and a `provider verify` run button. A permanent, non-editable line reads: **"arxa license: Totem official backend"** — so BYO users never form the belief that self-hosting exempts them from the product paywall. Paywall flow on BYO is byte-identical to Supabase-default: gate → checkout → official activate → token cached → offline verify.

## 6. Migration path (export / import)

- `arxa studio workspace export --org <id> --out bundle/` → portable bundle: `manifest.json` (contract version, capability set, collection counts, content hashes), one JSONL file per collection in **contract shape** (not provider row shape), `storage/` blob tree, `members.json` (emails + roles — identities themselves are not portable).
- `arxa studio workspace import --config <target> bundle/` → creates org on target, replays records preserving IDs where the target allows (else writes an ID-map file), re-uploads blobs, **re-invites members** (they re-auth on the new provider), imports `audit_log` as read-only historical records with an `imported_from` marker.
- Explicitly **not** migrated: entitlements, machines, subscriptions (license plane — nothing to migrate, it never moved), provider auth credentials, realtime subscriptions.
- Round-trip of the bundle is conformance-kit section 8, so every certified provider is also a certified migration source/target.
- `local` is a first-class source AND target: "try it offline, move to Supabase later" and "leave Supabase, keep working offline" are the same command with a different `--config`. Nothing about the bundle format is provider-specific.

## 7. Open questions — all settled (D32–D35, 2026-09-13)

The five questions below were open when this plan was written; the grill
decisions close all five, and the wire-contract freeze (task 13) encodes them.

1. **Adapter distribution** → settled by **D32**: no arbitrary local JS adapters at all. Two first-party adapters ship (`supabase`, `generic-rest`); exotic backends integrate server-side against the wire contract. Signing/review pipelines are moot.
2. **Contract packaging** → settled by **D32**: in-repo, first-party-only for v1; no public npm package in this closeout.
3. **Totem staff support access on BYO** → settled by **D33**: accept "no in-band support access"; support is bundle-only via `arxa-studio diagnose`.
4. **Minimum identity methods** → settled by **D34**: the contract is token-opaque (issue/refresh/revoke/introspect); any auth method is acceptable because providers declare `signIn.kind` and studio renders only the declared flow.
5. **Realtime degradation interval** → settled by **D35**: adaptive polling baked into the contract as constants — 3 s active / 30 s idle / 120 s background + immediate poll after any local write. Not provider-hintable.
