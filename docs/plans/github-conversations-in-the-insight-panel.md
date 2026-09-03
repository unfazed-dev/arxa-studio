# GitHub conversations in the insight panel

Goal (user, 2026-09-03): *"pull all the comments/conversations and important
things from github and add it to the git card insights panel … I want a user in
arxa studio to try to do as much as possible inside arxa studio and focus on the
things that need to be focused on instead of opening different apps like github."*

Built as a cordis plugin through the existing composition/patch system — no new
mechanism. (No skill named `cordis` exists on this machine; `profile/cordis.patch.yml`
and `profile/agent-presets/arxa/agent.cordis.yml` are the only cordis artifacts.
`arxa-git-card` is already a cordis plugin, so "use the cordis skill plugin" is
read as: extend it the cordis way.)

## Facts verified before designing (not assumed)

**A new insight view is three additive touch points**, no new infrastructure:

| Step | File | Anchor |
|---|---|---|
| server handler | `plugins/arxa-git-card/lib/index.js` | `insight.*` table at :761 |
| panel branch | `plugins/artifact-viewer/lib/client.js` | render at :822, `view === '…'` |
| launcher button | `plugins/arxa-git-card/lib/client.js` | `action('insight-…')` at :520 |

Plus locale keys ×3 (en/pl/fr) in both client files.

**Transport.** GitHub reads live in `plugins/github-link/lib/frame.js` as
`*Api({owner, name, …, accessToken, fetch, apiBase})`, re-exported and wrapped
with token refresh in `github-link/lib/index.js` (`withRefresh`). Writing a PR
comment already exists (`prCommentApi`, frame.js:211). **Reading** comments and
reviews does not — that is new.

**Resolution is GraphQL-only.** Verified against the official schema
(`https://docs.github.com/public/fpt/schema.docs.graphql`, HTTP 200, 1 555 314 bytes):

- `resolveReviewThread(input: ResolveReviewThreadInput!): ResolveReviewThreadPayload`
- `unresolveReviewThread(input: UnresolveReviewThreadInput!)`
- `type PullRequestReviewThread implements Node { … isResolved: Boolean! … }`
- `PullRequestReviewState = APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING`

REST has no resolution field, so this adds ONE `graphqlApi({query, variables, …})`
helper beside the REST ones — not a second client library.

**No re-link needed.** `SCOPES = ['repo','read:user','delete_repo','workflow']`
(`github-link/lib/auth.js:29`). `repo` covers PR comment/review read+write on
private repos and authorises GraphQL. Nobody has to re-authorise.

**arxa cannot open a draft PR today.** `prCreateApi` (frame.js:72) takes
`{owner, name, title, body, head, base, accessToken, fetch, apiBase}` — no
`draft` parameter.

**"No drafts" is a recorded rule.** `docs/plans/git-card-sessions-worktree-rewire.md:585-587`,
inherited from t3ci's `file-pr/` and `babysit-pr/` skills: *"conventional title as
the merge subject, problem-first body, no drafts."* An earlier draft of this plan
recommended auto-opening a **draft** PR; that was withdrawn when the docs were read.

**The sweep must not bot-comment.** `~/.claude/skills/arxa-cicd/SKILL.md`:
*"never comment on PRs via bot, merge, or push fixes from the sweep."* Different
actor from the card (which already auto-posts stage comments at
`arxa-git-card/lib/index.js:262`), but the new reply path lands in the same
territory — see D3.

## Decisions

### D1 — Read, reply, AND resolve

*Naming note from the build:* the write verbs are `insight.reply` / `insight.resolve`,
not `review.*`. The action PREFIX is the route — the card selftest dispatches
`/^(card|insight|version)\./` to this host and everything else to the sidebar's, while
the viewer's own router sends everything but `agent.*` here. A `review.*` verb worked
through one router and 404'd through the other; `insight.*` is the prefix both already
agree on.
The panel is not a viewer. It reads threads, posts replies, and marks review
threads resolved/unresolved. Rationale: "do as much as possible inside arxa
studio" fails the moment answering a reviewer means opening github.com.
Cost accepted: resolution forces the GraphQL transport above.

### D2 — Scope is everything attached to the session's PR
PR review threads (line-anchored), plain PR comments, review states, linked
issues and their comments, commit comments, and failing CI step output.
This is the widest of the three options offered and was chosen deliberately —
it is also the most API calls per open, which D5 answers.

### D3 — Needs-you band on top, grouped sections below
Not one flat feed. Layout:

1. **Needs you** — change-requesting reviews, unresolved threads, @-mentions of
   the linked login, failing CI steps. Pinned, always first.
2. **Grouped below** — Reviews · Threads · Issues · Commits · CI, each
   chronological inside its group.
3. Bot comments collapsed by default.

Replies are **human-initiated only** — the panel never posts on its own. The
card's existing automatic `stageComment` is unchanged and stays the only
machine-authored comment.

### D4 — The new view absorbs CI; the standalone CI view retires
`insight.ci` and its button are removed; CI runs and failing steps live inside
the new view. Reason: two surfaces reading the same workflow runs will drift,
and that is the same duplicate-surface clash that produced the
`2 subagents` / `No subagents` bug. One place to look.
Cost: `insight.ci`'s handler and its selftest assertions get rewritten, not deleted —
the fetch logic moves, the tests move with it.

**Half-wrong when written; corrected during the build.** The card header does carry
`ci-rerun` / `ci-cancel` / `ci-open` (`arxa-git-card/lib/client.js:511-513`), but the
retired VIEW carried its own per-run pair as well, and those were not duplicates: the
card header only ever reaches the NEWEST run, while the view made every run in the
list individually addressable. Retiring the view as originally written would have
orphaned per-run control. The buttons were therefore MOVED into the review view's
`ci` group rather than dropped — same `card.ci.rerun` / `card.ci.cancel` actions,
same enable/disable pairing. `card.runner.wake` (:748) is on the card
(`client.js:445`) and genuinely untouched.

### D5 — Fetch on open, cache 60 s, manual refresh
Matches the D101 convention `insight.streak` and `insight.ci` already use
(short-lived module-scope cache, live source, no persisted index). With D2's
wide scope this is what keeps the panel off the 5 000/hr rate limit. No polling,
no webhooks — webhooks would need a public endpoint arxa studio users do not
have, which cuts against the local-first rule in CLAUDE.md.

### D6 — Auto-open a real PR on the session's first push
Supersedes the withdrawn draft-PR recommendation. On first push, arxa opens a
normal (non-draft) PR. The ledger already rendered into the PR body
(`renderLedger(… { next: 'review' })`, `arxa-git-card/lib/index.js:534`) declares
the stage and next owner — that is arxa's substitute for draft state, and it is
already built. **Verified that it stays current, not frozen at creation:**
`arxa-git-card/lib/index.js:255` re-renders the ledger on every stage transition and
PATCHes it back with `g.prUpdate(... { body: gw.withLedger(pr.body, table) })`. So
the body tracks the session; D6 needs no extra body-refresh step. Honours "no drafts"; gives CI and this panel something real from
commit one.

**Hook point, named.** At the tail of `pushSessionBranch`
(`arxa-git-card/lib/index.js:145`) and only after it returns `ok: true` — never on
the auth-retry path, which has a documented six-minute freeze when a token is
rejected. That one site covers both callers: `card.push` (:509, loud) and the
post-integrate push inside `card.integrate` (:476, caught). **Fires once per
session**, guarded by the check the stage-comment path already uses
(`g.prListForHead(owner, name, s.branch, 'all')` at :471) returning empty. A
failure to open the PR is recorded and swallowed — a push must never fail because
GitHub refused a PR.

### D7 — Replies carry a hidden session marker
Appended to every comment posted from the panel:

```
<!-- arxa-session: <sessionId> -->
```

Invisible on github.com. Lets the panel recognise its own comments and link each
back to the session that wrote it, mirroring the visible `Arxa-Session:` git
trailer `plugins/git-workspace/lib/ledger.js` already puts on commits — without
a line of chrome on every comment a reviewer reads. Stripped when rendering in
the panel.

## Degradation (CLAUDE.md boundary rule)

GitHub is the source of truth for this data and has no local equivalent, so the
panel follows the established `unavailable` convention rather than inventing a
local mirror: an org with no GitHub link, a `localOnly` org, or a session with no
PR renders an explanatory empty state — never an error, never a broken card. The
empty state carries the **Create PR** button so the flow is still reachable.
This is the same rule `insight.streak` and `insight.ci` already follow: *"a missing
export must never break the whole card"* (`arxa-git-card/lib/index.js:757`).

## Build order

1. `github-link/lib/frame.js` — `graphqlApi()`, `prReviewThreadsApi()`,
   `prCommentsApi()`, `prReviewsApi()`, `issueCommentsApi()`,
   `commitCommentsApi()`, `runJobsApi()`; `resolveThreadApi()` /
   `unresolveThreadApi()` over GraphQL.
2. `github-link/lib/index.js` — `withRefresh` wrappers + re-exports.
3. `arxa-git-card/lib/index.js` — `insight.review` handler. The fan-out came out at
   THREE calls, not the ~7 estimated: one GraphQL query returns comments, reviews,
   review threads, linked issues and commit notes together, then one REST call for the
   branch's workflow runs and one for the newest run's jobs. Under `Promise.allSettled`
   so a repo with no linked issues, no commit comments or no Actions renders instead of
   blanking. Plus the 60 s cache
   + ranking), `insight.reply`, `insight.resolve`; retire `insight.ci`; auto-open
   on first push in the push path.
4. `arxa-git-card/lib/client.js` — swap the CI button for the Review button,
   locale keys ×3.
5. `artifact-viewer/lib/client.js` — the `view === 'review'` branch: needs-you
   band, five groups, reply box, resolve control; locale keys ×3.
6. Selftests: extend `arxa-git-card/selftest.actions.mjs` section E (rewrite the
   `insight.ci` assertions), add ranking and marker-strip assertions.

## Carried from the previous grill (not built yet)

- **Card ledger strip** — condensed strip on the git card (last stage, result,
  next owner) with a link out; the full ledger table stays on the GitHub PR.
- **`scripts/cicd-smoke.mjs`** — hand-run driver for the smoke tiers, shaped like
  `scripts/jobs-push-proof.mjs`: live engine + GitHub required, never in CI.

## Stale lines to fix in `docs/plans/session-path-identity-and-cicd-smoke.md`

- Line 148 — *"records half OPEN"*: the ledger landed (`git-workspace/lib/ledger.js`,
  10 selftests green; PR body at `arxa-git-card/lib/index.js:534`, auto stage
  comment at :262).
- The fvm claim — `.fvmrc` handling is present in `plugins/git-workspace/lib/frame.js`
  (:31 doc comment, :179-225 the generated check script, which resolves `.fvmrc` by
  walking up, verified against fvm 4.1.2) and `plugins/sandbox/lib/index.js:63-171`.
  **Note the two `frame.js` files** — `plugins/github-link/lib/frame.js` is the GitHub
  REST module (`:31` there is `protectionApi`) and has nothing to do with fvm. An
  earlier draft of this plan cited the wrong one.

## Live verification (2026-09-03, dev engine on 7897)

Offline greens were not treated as proof — the `endedAt` bug earlier the same day
passed 23 assertions and a fence gate while being wrong.

**Proven live:**
- `insight.ci` returns `unknown-action` on the running engine — genuinely retired.
- `insight.review` and `insight.resolve` reach their handlers and return the
  documented structured refusals (`serves session seats`, `thread-required`).
- `prConversationApi` ran against **real GitHub PRs** (`unfazed-dev/RESTO#5`,
  `unfazed-dev/kitchen-project#6`) and returned arxa's own stage comments — the
  content that until now only existed on github.com. The GraphQL query, its
  field names and the flattening are correct against the live API.
- In a real headless browser (`arxa lens eval`, the documented `arxa-av-open`
  event): the panel mounts, `data-arxa-insight="review"`, the title resolves to
  "Review", and an unlinked org renders *"Not available for this repository."* —
  the CLAUDE.md degradation rule, observed rather than asserted.
- 40+ new offline assertions in `arxa-git-card/selftest.actions.mjs` covering the
  ranking band, the marker, the cache and both write verbs. Full CI ALL GREEN
  (37 suites).

**NOT yet proven live, and why:**
- **Review threads, reply and resolve against a real thread.** No PR on this
  account has a review thread, and creating one means writing to the operator's
  real GitHub. Schema-verified and unit-tested; not exercised end to end.
- **A populated panel.** Needs a linked org + session + PR at once. The only
  linked org with PRs (RESTO) had its worktree removed earlier, and the seated
  org (LensCo) is local-only — which is why the degradation path is what
  rendered.
- **D6 auto-open on first push.** The code path is tested offline; firing it for
  real opens a PR on a real repository.

All three close with one authorised live smoke: create a session in a linked org,
commit, push (D6 fires), review it, reply and resolve.

## Repair made to boot the dev engine (not caused by this work)

The engine refused to start: *"workspace domain is inconsistent: session
`arxa-note-wt-260903-001` is accounted by both workspace `e32d25da…` and
`563887a8…`"*. Two org trees — `/Volumes/business_ssd/RESTO` and
`/Volumes/business_ssd/TESTO` — had each minted the SAME session id on the same
day. RESTO's worktree was deleted earlier in the day, leaving a dead registry row
that collided with TESTO's live one.

Repair (backup first, to `scratchpad/workspace.json.bak`): removed the row whose
`path` no longer exists on disk, and then the orphaned id left behind in
`global.workspaceIds` — the second failure the first fix exposed. Both edits
refused to touch any row whose directory still existed.

**This is a real product bug, not just bad data.** `dsh-workspace` requires
session ids to be globally unique, but arxa mints them per workspace per day
(`nextSessionId`). Two organisations working on the same day therefore produce a
colliding id, and the collision is not detected at mint — it is detected at BOOT,
where it takes the whole engine down and cannot be cleared from inside the
product. Belongs with the session-naming work in
`docs/plans/session-path-identity-and-cicd-smoke.md`.
