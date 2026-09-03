# Session-id collision: root cause, recovery, and CI/CD stress scenarios

Grilled and traced 2026-09-03 under `/systematic-debugging`. Supersedes the
loose claim in the previous session's summary that "arxa mints session ids per
workspace per day" — that description was **wrong** and is corrected in §1.

## 1. The invariant, stated exactly

dsh (`@deepseek-ai/dsh-workspace/lib/types/index.js:463-495`,
`validateStoredState`) enforces, at BOOT, that:

- `workspaceIds` never repeats an id, and every id resolves in the table
- when `initialized`, no table workspace is absent from `workspaceIds`
- no two workspaces claim the same `path`
- **no session id is accounted by two workspace records**

Every one of those is a hard `throw`. There is no in-product repair: the engine
dies before any UI exists to fix it with.

arxa's side of the contract (`plugins/git-workspace/lib/sessions.js:327`,
`mintSessionPath`):

    <org folder>/<workspace key>/<word>-wt-<YYMMDD>-<NNN>
    RESTO/notes/note-wt-260903-001

and the dsh conversation key (`sessions.js:274`, `dshSessionKey`) is
`'arxa-' + id.split('/').join('-')` → `arxa-RESTO-notes-note-wt-260903-001`.

**The counter is NOT the uniqueness mechanism.** `NNN` is scoped by
`allSessions(orgPath)` = `parkedSessions` (`sessions.js:174-188`), which
aggregates the org repo registry + every project repo registry **within that
one org**. Cross-org uniqueness rests entirely on the LEADING SEGMENT: org
folder names must be globally unique, case-insensitively. That is stated at
`lifecycle.js:751-758` and enforced by `assertOrgFolderNameFree`.

So the real invariant is: **org folder names are globally unique** — and every
hole below is a way to break that one sentence.

## 2. Holes found (all verified against source, not memory)

**H1 — `renameOrg` never checks the folder name.**
`assertOrgFolderNameFree` is called at exactly two sites, `lifecycle.js:816`
(create) and `:830` (add). `renameOrg` (`lifecycle.js:1509`) checks only
`fs.existsSync(newPath)` — a SAME-DIRECTORY collision. Renaming `/a/FOO` →
`/a/RESTO` while `/b/RESTO` exists passes, and both orgs then mint `RESTO/...`.

**H2 — the guard's scan window is capped at 10. (LIVE TODAY.)**
`assertOrgFolderNameFree` scans `listOrgs()` (`lifecycle.js:732`), which reads
`readRecents()`; `touchRecent` (`workspace/lib/root.js:144-149`) slices to
`RECENTS_CAP = 10`. Orgs beyond the ten most recent are INVISIBLE to the guard
while their sessions persist in the dsh store forever.
Direct evidence, this machine: `~/.arxa/dsh/storages/workspace.json` holds
**20 workspace records**; `~/.arxa/organisation.json` holds **5 recents**. The
guard can see a quarter of the surface it is supposed to protect.

**H3 — no lock between the mint read and the registry write.**
`mintSessionPath` reads `allSessions`, computes `max + 1`; `writeRegistry`
(`sessions.js:119-123`) is a bare `writeFileSync`. No lockfile, flock or mutex
exists anywhere in `git-workspace/lib` or `file-org-shell/lib`. Within one
Node process the read→write path has no `await`, so it is atomic by accident;
**across two processes** (two engines, or engine + CLI) both mint the same NNN.

**H4 — the incident itself was legacy data, not H1-H3.**
The id that took the engine down, `arxa-note-wt-260903-001`, is a BARE LEAF —
the retired `nextSessionId` format that predates the org-led scheme. It sat in
two workspace records. Fixing H1-H3 would NOT have prevented it, which is the
whole argument for §3.

## 3. The fix that actually matters: recoverability

Guarding write paths cannot help a store that is already bad — from legacy
ids, a restored backup, a second install, or a hole not yet found. And dsh is
a DEPENDENCY: CLAUDE.md's depend-don't-fork rule forbids patching
`validateStoredState`.

So the repair belongs in arxa's launcher, before dsh boots:
`bin/arxa-studio.mjs` already resolves `dshHome` and runs hard-stop checks
before `spawn` at line 514. A preflight there heals the store to satisfy every
clause of `validateStoredState`, backs the file up first, and prints exactly
what it changed. Boot loudly repaired, never dead.

Repair rules, in validator order, each conservative:
1. dedupe `workspaceIds`
2. drop `workspaceIds` entries with no table row
3. append table rows missing from `workspaceIds`
4. duplicate `path`: keep the record with more sessions, then the earlier id
5. duplicate session claim: keep the record whose `path` still exists on
   disk; tie-break to the earlier `workspaceIds` position

Never deletes a workspace whose path exists. Always writes a timestamped
backup next to the store first.

## 4. Build order

1. `plugins/workspace/lib/store-heal.js` — pure functions over the parsed
   store, no fs, so the selftest can drive every clause.
2. `plugins/workspace/selftest.heal.mjs` — one case per validator clause plus
   the exact H4 shape.
3. Wire the preflight into `bin/arxa-studio.mjs` before the spawn.
4. H1: guard `renameOrg`, excluding the org's OWN old resolved path (a
   case-only rename `/a/resto` → `/a/RESTO` must not collide with itself).
5. H2: persistent org-name ledger so the guard stops depending on a capped
   recents list.
6. H3: prove or disprove by stress scenario before writing a lock.

## 5. Smoke + stress scenarios

`scripts/cicd-smoke.mjs`, hand-run, never in CI (needs a live engine and real
GitHub). Blast radius bounded to a scratch repo — never RESTO or
kitchen-project.

Three scenarios, chosen as different FAILURE MODES rather than different repos:

- **S1 identity pressure** — orgs that collide by rename, by falling off the
  recents cap, and by legacy bare-leaf id; assert the guard refuses and the
  preflight heals.
- **S2 concurrency** — N concurrent session creates in one org on one day,
  across processes; assert ids are distinct (this is the H3 verdict).
- **S3 partial failure** — push succeeds, PR open fails. Assert `prReason`
  surfaces, nothing is half-written, and a retry opens the PR.

## 6. What landed, and what is proven

**Fixes**

- `plugins/workspace/lib/store-heal.js` + boot preflight in
  `bin/arxa-studio.mjs` — heals every clause of `validateStoredState`,
  backs the store up first, prints each repair. **This is the answer to H4
  and to every future duplicate, whatever its cause.**
- `renameOrg` now calls `assertOrgFolderNameFree(newPath, oldPath)` (H1).
  The `oldPath` argument is load-bearing: without it the D80 case-only
  rename collides the org with itself.
- `readOrgNames`/`rememberOrgName` in `plugins/workspace/lib/root.js` —
  an uncapped, append-only org-name ledger, so the guard no longer depends on
  a 10-entry recents list (H2). Omitted from the file when empty, so a fresh
  install keeps the original `{ orgs }` shape.

**Proven**

- `plugins/workspace/selftest.heal.mjs` — 17 checks. The oracle is dsh's
  OWN `validateStoredState`, imported by absolute file URL, so "healed"
  is judged by the exact code that refuses to boot. Includes the real store
  on this machine (read-only).
- End-to-end through the real launcher: a store carrying the exact incident
  shape was healed, backed up and reported before dsh was spawned.
- `scripts/cicd-stress.mjs` — S1/S2/S3, all green, wired into
  `scripts/ci.mjs`. **Both new guards were verified by removal**: deleting
  the H1 call reddens the H1 check, stubbing the ledger reddens the H2 check.
- Full `node scripts/ci.mjs`: ALL GREEN, 39 suites.

**S2's verdict — H3 is NOT exploitable, and this is now measured**

An earlier draft of this plan argued from first principles that no lock was
needed. That was reasoning presented as evidence, and it was replaced with a
test of the real write path.

Four processes were spawned to run the FULL create path (`openOrg` →
`newSession`: mint, branch, worktree, registry write) against one org
simultaneously. Result: **1 created, 3 refused**, every refusal
`OrgOpenError` with `cause=ShellLockError`, failing at step
`"shell-lock"`.

So the ORG LOCK serialises concurrent creates. `writeRegistry` having no
lockfile of its own (H3 as originally described) is real but unreachable:
nothing gets far enough to race. No lock was added, because the one that
matters already exists one layer up.

The test asserts the refusal REASON, not just that some were refused — if it
ever reports 4 made and 0 refused, the lock has stopped serialising and the
counter genuinely can collide. The separate in-process check (25 mints against
one fixed registry all return the same id) documents that the mint is
deterministic given fixed input; on its own it says nothing about concurrency,
which is why the write-path test exists alongside it.

**PROVEN LIVE (2026-09-03, authorised)** — `scripts/cicd-smoke.mjs --yes`,
**26 checks ALL GREEN** against real github.com, in a throwaway private repo
created and deleted by the run.

Closed, each confirmed on GitHub afterwards rather than trusting arxa's own
response:

1. **D6 auto-open** — the first push opened a real PR with no second click.
2. **Live conversation READ** — `insight.review` against a real PR.
3. **`insight.reply`** — the reply is really on the PR.
4. **`insight.resolve`** — the thread is really resolved (checked by GraphQL).

Plus the three scenarios in their LIVE form:

- **L2 (two sessions, one org)** — distinct identities, distinct branches,
  one PR each, and the per-session **dedupe holds**: a later push returns the
  SAME PR and GitHub still shows two, not three.
- **L3 (PR-only outage)** — only `repoName` is flipped, so origin and
  credentials still work and only `prCreate` 404s. The push succeeds, the
  branch is confirmed on the remote, `prReason` surfaces, and the retry
  opens the PR the outage denied.
- **L1 (identity)** stays offline on purpose: org-name refusals need no
  network and are already proven with removal-verification.

**Not a bug (steelmanned, left alone)**

A refused `createOrg` leaves its scaffolded folder on disk. That is
deliberate — `lifecycle.js`: "renaming it and adding it is the recovery."
It did mask H1 in an early draft of S1, which is why the scenario now renames
into a name held only in another root.

## 7. Contract drift — the gap the live run exposed

The first live run failed on THREE call-shape errors, all in the smoke's own
calls, none caught by CI: `message` for `subject` (`card.commit`), and
`body`/`replyTo` for `text`/`commentId` (`insight.reply`). CI stayed
green through all of them because **every fake in the suite accepted whatever
it was handed**.

Fixed by making `scripts/cicd-stress.mjs`'s fake GitHub **validate its
inputs** the way the real API does — `prCreate` refuses a missing
head/base/title, `prThreadReply` refuses a missing commentId/body,
`prComment` refuses anything but its POSITIONAL owner/name shape (the two
differ, and github-link ships both). Six new checks then pin the write-verb
contracts offline, including that the hidden session marker rides the reply
body and that an empty message is refused before the service is touched.

Verified by drift: renaming the handler's `arg.text` to `arg.body` turns
the reply checks red.

The CLIENT half was checked by reading and is correct today:
`artifact-viewer/lib/client.js:997` sends
`{ sessionId, number, text, ...arg }` and `:1055` supplies
`{ commentId: th.replyTo }` — exactly what `index.js:995-1017` reads.

## 8. A correction worth keeping

Mid-investigation this plan briefly claimed `base: 'main'` in `openPr` was
a bug, because a bare `git init` in /tmp produced `master`. That probe was
invalid: `git-workspace/lib/run.js` PINS `init.defaultBranch=main` on
every arxa git call, so arxa's org repos are on `main` and the base is
correct. The live smoke asserts this directly.

**arxa's git behaviour is only observable through `runGit`, never through
bare `git`.** Any future probe that forgets this will re-derive the same
wrong conclusion.
