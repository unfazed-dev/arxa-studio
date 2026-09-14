⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
### Ambiguity verdicts

1. **UPHOLD** — `POST /orgs/{orgId}/storage/{path}/signed-url` follows the Blobs row's own `.../` continuation of the storage path; path-in-body would invent surface the table doesn't license.
2. **UPHOLD** — `POST /members` + `PATCH|DELETE /members/{memberId}` mirrors the org-route pattern the table itself establishes for `POST|PATCH|DELETE` on member resources.
3. **UPHOLD** — the table mandates typed codes for every non-2xx and Step 3 requires rejecting unknown collections *before I/O*; without `invalid_request` the contract could not express that rejection, and no table-named code is contradicted.
4. **UPHOLD** — unknown server codes must land inside the fixed taxonomy; mapping to `unavailable` with `.serverCode` preserved keeps callers branching on `retryable`, which is honored from the envelope (verified `wire.js:76-79`).
5. **UPHOLD** — the table gives `?cursor=` on the request and pure JSONL on the response; header-carried resume (`X-Arxa-Cursor-Next`, golden-pinned) keeps list bodies pure records, which the table's media types demand.
6. **UPHOLD** — issue/refresh/introspect cannot carry the bearer they are establishing or verifying; revoke revoking its own bearer is coherent, and the unauthenticated `capabilities` route is asserted token-free (`selftest.contract.mjs:134-135`).
7. **UPHOLD** — the table's letter grants `cursor=` to records and events only; audit GET without pagination matches it exactly and streaming leaves headroom without a wire change.
8. **UPHOLD** — the table mandates golden-tested constants without numbers; 100/500, 1 MiB/32 MiB/1 GiB, 15 s, 3 attempts, 408/425/429/500/502/503/504 contradict nothing and are `deepEqual`-pinned.
9. **UPHOLD** — the table is silent on blank lines; strict JSONL (one trailing newline legal, blanks rejected) is security-positive and self-consistent with the encoder's own output.
10. **UPHOLD** — the Blobs row already mixes media (`signed-url` returns bounded JSON in the same sentence), and a DELETE has no byte payload to stream; JSON ack is the consistent reading.

### Golden-test pinning

Pinned exactly, per the brief's Step 2 enumeration: all 25 routes/verbs/media/auth/query as a literal `deepEqual` snapshot incl. the no-audit-mutation negative assertion (block 3); header names/values incl. `X-Arxa-Workspace-Version: 1`, fresh-UUID request IDs, bearer-on-auth-only, If-Match, abort passthrough, URI encoding (blocks 1, 4); error envelope + 7-code taxonomy, requestId echo/fallback, unknown→`unavailable`+`serverCode`, retryable set both ways (block 9); bounds + D35 polling (block 2); pagination default/bounds/garbage-cursor pre-I/O + cursor codec (blocks 6–7); JSON/JSONL codecs with byte caps (block 8); secrecy — token never in any client message, session token redacted from hostile server messages (block 10); all four sign-in kinds, `email+password` rejected, `start` required (block 11); D32 config guard incl. "executable code" reason (block 12); unknown collection rejected at build with no request escaping, `unsupported_version` typed (block 5). Collections match plan §1 verbatim (7 names, `agency-backend-provider-abstraction.md:56`). **Gaps (not changes):** the opaque token/session *response* envelope shape is unpinned (routes are; no decode test), and `X-Arxa-Cursor-Next` consume semantics are pinned only as a constant — both land with Part B, which must pin rather than invent them.

### Step 1 doc rewrite

**Correct.** Status line names D32–D35 the later authority; verified against `docs/plans/arxa-studio-grill-decisions.md:298-368` — all four rulings (provider set, `custom.adapter`/`ARXA_WORKSPACE_ADAPTER` invalid, bundle-only support, token-opaque identity, 3 s/30 s/120 s + immediate polling) are recorded faithfully in the amendment block, §0, §1, §5, and all five §7 questions marked settled. Diff package verified faithful (identical to `git diff e800fe9..3597a40` modulo an 8-line stat header).

### Independent verification

- `node plugins/workspace-provider/selftest.contract.mjs` → **12 checks green, exit 0**.
- `npm test` (run 1) → **exit 1**: 119/120 GREEN, RED `scripts/cicd-stress.mjs` — `FAIL S5: the decoration map converged on all three files` (`notes/c.md` "M", expected "A").
- `node scripts/cicd-stress.mjs` standalone → **ALL GREEN, exit 0**.
- `npm test` (run 2) → **exit 0, `arxa-studio CI: ALL GREEN`, 120 suites** (incl. `workspace-provider/selftest.contract.mjs`).
- Git read-only: tree unchanged apart from pre-existing `package-lock.json` dirt.

### Issues

- **Critical:** none.
- **Important:** none at the contract level.
- **Minor:**
  - `selftest.contract.mjs` — auth token/session envelope shape unpinned; Part B must golden-test it before adapters ship (freeze discipline, not a wire change).
  - `lib/contract.js:185-197` — `assertProviderConfig` scans only two nesting levels; a path-like value 3+ deep under an unknown key passes (defense-in-depth only — nothing loads config as code).
  - `scripts/cicd-stress.mjs` S5 is load-flaky (1 red in 2 full runs on this RAM-constrained machine; green standalone; zero overlap with this commit) — pre-existing, worth timing headroom separately.

### Verdict

`CONTRACT STANDS` — all 10 resolutions are judgment calls consistent with the Wire v1 table's letter; freeze holds, Part B may proceed against commit `3597a40` as-is.
