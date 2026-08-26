# Agency Backend Provider Abstraction (BYO Database)

Status: PLAN ONLY — no code or schema changes. Consult-mode advisor skipped (no API key configured); design grounded in primary sources below.

Sources read: `docs/plans/arxa-studio-grill-decisions.md` (D-series locked decisions), `docs/plans/entitlement-backend-runbook.md`, `arxa/deploy/supabase/schema.sql` + `seed.sql`.

## 0. The one non-negotiable split

Two planes. They never merge:

| Plane | What it holds | Backend |
|---|---|---|
| **Product-license plane** | arxa entitlements, machines, subscriptions, Stripe billing, activate flow | **ALWAYS the official Totem backend.** Not pluggable, not configurable off. |
| **Workspace-data plane** | orgs, org_members, tickets, chat, feedback, audit_log, analytics, storage blobs | **Pluggable.** Supabase is the first-class default and the conformance reference. |

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

**Server-side authorization (cross-cutting, REQUIRED)** — every capability above must be enforced *by the provider's server*, not by the adapter. The adapter is untrusted client code. Concretely: user A of org X must be unable to read/write org Y's rows even with a hand-crafted request. Supabase does this with RLS; a BYO Postgres+PostgREST or custom API must do the equivalent. This is a conformance-kit gate, not a suggestion.

### OPTIONAL capabilities (with mandated degradation)

| Capability | Surface | Degradation when absent |
|---|---|---|
| `realtime` | `subscribe(orgId, collection, cb)` | App polls `records.list` on a visible-tab interval; UI drops the "live" badge. No feature is removed. |
| `storage` | `upload/download/delete/signedUrl(orgId, path)` | Attachments disabled in tickets/chat; text-only flows keep working. |
| `analytics` | `track(event)` (fire-and-forget) | No-op sink. Nothing user-visible. |
| `billingWebhooks` | inbound webhook spec for *agency-to-their-client* billing only | Feature hidden. **Product billing is never here** — see §0. |
| `entitlementIssuer` | see §2 trust model | Workspace-scoped gated features fall back to "everyone in org may use"; product gates unaffected. |

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
| `entitlementIssuer` | `activate` Edge Function + `ENTITLEMENT_ISSUER_JWK` secret + `machines`/`entitlements`/`subscriptions` tables — **note: in production this whole row belongs to the license plane and lives on the official project, not the customer's workspace project** |
| `billingWebhooks` | `stripe-webhook` Edge Function (`STRIPE_WEBHOOK_SECRET`) — license plane, official project only |

**Supabase-specific things the contract deliberately hides:**
- `user_id uuid references auth.users` — the contract's opaque `userId` string breaks this coupling; BYO providers use their own identity PKs.
- RLS + `auth.uid()` + SECURITY DEFINER helpers — contract only states the *behavioral* requirement (server-side org isolation); mechanism is provider's choice.
- Service-role key bypassing RLS — an operational detail; the contract has no "superuser" concept. Totem-staff support access (`is_totem_staff`) is a Supabase-adapter extra, not part of the portable contract.
- Edge Functions — contract specifies HTTP behavior of the issuer endpoint, not the runtime.

## 4. Conformance test kit (what a BYO provider must pass)

Ship as `arxa studio provider verify --config <file>` — a runnable suite against a live provider instance, plus a printed checklist. Sections:

1. **Auth**: sign-in/out round-trip; expired-session behavior; `onAuthStateChange` fires.
2. **Org CRUD + role matrix**: each of the four roles attempts each org/membership operation; results must match the contract's permission table exactly (e.g. only `owner|admin` add members; `billing` reads billing collections only; last-owner removal rejected).
3. **Cross-org isolation (the gate that matters)**: two real users, two orgs; user A replays raw API calls against org B's data — every one must fail server-side. Includes list-endpoint leakage (no org-B rows in org-A lists) and IDOR by guessed IDs.
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
    "provider": "supabase",            // default; or "custom"
    "supabase": { "url": "…", "anonKey": "…" },
    "custom":   { "adapter": "./adapters/my-backend.mjs" }  // module implementing WorkspaceProvider
  },
  "entitlements": {
    "extraPublicKeys": [ { "kid": "acme-2026", "publicKeyPem": "…" } ]
    // production key is compiled in and cannot be removed here
  }
}
```

Env overrides: `ARXA_WORKSPACE_PROVIDER`, `ARXA_SUPABASE_URL`, `ARXA_SUPABASE_ANON_KEY`, `ARXA_WORKSPACE_ADAPTER`, `ARXA_ENTITLEMENT_EXTRA_PUBKEYS` (path to JSON). These extend, and never replace, the production verification key — distinct from the existing debug-only `debugPublicKeyOverride`, which stays debug-gated.

**UX**: Settings → "Workspace backend" panel shows provider, capability badges (live/degraded per §1), and a `provider verify` run button. A permanent, non-editable line reads: **"arxa license: Totem official backend"** — so BYO users never form the belief that self-hosting exempts them from the product paywall. Paywall flow on BYO is byte-identical to Supabase-default: gate → checkout → official activate → token cached → offline verify.

## 6. Migration path (export / import)

- `arxa studio workspace export --org <id> --out bundle/` → portable bundle: `manifest.json` (contract version, capability set, collection counts, content hashes), one JSONL file per collection in **contract shape** (not provider row shape), `storage/` blob tree, `members.json` (emails + roles — identities themselves are not portable).
- `arxa studio workspace import --config <target> bundle/` → creates org on target, replays records preserving IDs where the target allows (else writes an ID-map file), re-uploads blobs, **re-invites members** (they re-auth on the new provider), imports `audit_log` as read-only historical records with an `imported_from` marker.
- Explicitly **not** migrated: entitlements, machines, subscriptions (license plane — nothing to migrate, it never moved), provider auth credentials, realtime subscriptions.
- Round-trip of the bundle is conformance-kit section 8, so every certified provider is also a certified migration source/target.

## 7. Open questions (for the user)

1. **Adapter distribution**: are custom adapters local JS modules only (simple, but unsigned code loaded into the app), or do we require a reviewed registry / signature before loading?
2. **Contract packaging**: publish `WorkspaceProvider` types + conformance kit as a public npm package (invites third-party adapters) or keep in-repo for a first-party-only v1?
3. **Totem staff support access on BYO**: Supabase adapter has `is_totem_staff` read access for support; on BYO we have none. Accept "no in-band support access, bundle-export on request," or add an optional support-access capability?
4. **Minimum identity methods**: must every provider support email invite flows, or is "any auth + manual member add by user id" acceptable for v1?
5. **Realtime degradation interval**: fixed polling default (e.g. 30 s visible-tab) baked into the contract, or provider-hintable via `capabilities()` metadata?
