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

**S2's verdict (measured, not assumed)**

25 in-process mints and 6 separate processes, all shown the same unwritten
registry, produce the SAME id. The day counter is therefore **not** a
uniqueness mechanism — it is a readability feature, and uniqueness comes
entirely from the org segment. No lock was added: a lock would only make
concurrent creates *numbered* differently, which is not what protects the
dsh store. Guarding the org segment (H1/H2) plus the boot heal is what does.

**NOT proven — needs the user**

`scripts/cicd-smoke.mjs --yes` is written and syntax-clean but has NOT been
run: the sandbox permission classifier refused it, correctly, because it
creates and deletes a real GitHub repository. It is bounded by construction
(its own throwaway private repo, deleted in a `finally`, never an existing
one) and covers the four things no offline suite can reach: D6 auto-open on
first push, the live conversation READ, `insight.reply`, and
`insight.resolve` — each confirmed against GitHub afterwards rather than
trusting arxa's own response.

**Not a bug (steelmanned, left alone)**

A refused `createOrg` leaves its scaffolded folder on disk. That is
deliberate — `lifecycle.js`: "renaming it and adding it is the recovery."
It did mask H1 in an early draft of S1, which is why the scenario now renames
into a name held only in another root.
