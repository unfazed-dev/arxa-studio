# The git card on local-only orgs

Date: 2026-09-08. Reported on macOS: "the git card on local only orgs is not
functioning".

## Why nothing caught this

Every card smoke we had needs a real GitHub token and a real repo:
`scripts/cicd-smoke.mjs` drives arxa's GitHub helpers, `scripts/card-cicd-smoke.mjs`
drives the card's own route — both hand-run, both online. So the ONE
configuration most arxa studio users actually run, an org that was never
published, had **no coverage through the card's route at all**. The gap was
structural, not an oversight in any one test.

That is now `scripts/card-local-smoke.mjs` — offline, sandboxed, in `ci.mjs`.

## Root cause — card.status described the wrong repo

An org and a project each own a GitHub repo (D98/D99). The card's actions
already know this: `repoFor()` (`arxa-git-card/lib/index.js:409`) reads
`project.json` for a project seat and `org.json` otherwise.

`card.status` did not. It read `cur.path + '/org.json'` unconditionally, for
every seat, and fed that manifest to:

```js
linked: Boolean(manifest.repoUrl),
localOnly: Boolean(manifest.localOnly),
```

The client gates its entire PR + CI section on exactly those two fields
(`git-card.snippet.txt:715` — `status.linked && !status.localOnly`).

So for a **published project inside a local-only org**: status reports
`linked:false, localOnly:true`, the client hides PR, checks, merge, CI and
runner — while `repoFor()` would have found that project's repo perfectly well
for any button the card never drew. Status and the actions disagreed about
which repo the seat belongs to, and status is the half that decides what is
drawn.

Measured, before the fix, on a published project in a local-only org:
`{"linked":false,"localOnly":true}`.

## Fix

`card.status` now resolves its manifest the way `repoFor` already does, and
inherits per D91:

```js
let seatManifest = manifest
if (sessionRow?.origin === 'project' && typeof sessionRow.repoPath === 'string') {
  seatManifest = JSON.parse(readFileSync(sessionRow.repoPath + '/project.json', 'utf8'))
}
const seatLinked = Boolean(seatManifest.repoUrl)
const seatLocalOnly = seatManifest.localOnly === true || (!seatLinked && manifest.localOnly === true)
```

The inheritance half is load-bearing and easy to get wrong. A project born in
a local-only org has **neither** `localOnly` nor `repoUrl` in its
`project.json` — verified on a real fixture:

```json
org.json      { "name": "Local Co", "localOnly": true }
project.json  { "name": "storefront", "targets": {} }
```

So reading `project.json` *alone* would have reported `localOnly:false` for the
ordinary local-only project and dropped the local-only badge — trading one
wrong answer for another. Inherit only when the project is genuinely unlinked;
a published project is not local-only whatever its org says (D91: "a project
marked local-only … stays local until project.connect").

No new module. One read, mirroring the existing precedent rather than
duplicating it.

## What was NOT wrong

Worth recording, because three plausible suspects were investigated and
cleared:

- **`pushSessionBranch` throwing on a local-only integrate.** It returns
  `{ok:false, reason}` and never throws unless `loud` — it degrades cleanly.
- **The local CI/CD loop.** `card.commit` is the local stage boundary: it
  squashes, runs the gate, and merges to main with no remote involved. Proven
  by reading `git log main` back, not by trusting a return value.
- **The PR/CI actions refusing.** They are hidden for a local-only seat, so
  their refusals are not user-reachable. Their shapes are inconsistent (some
  refuse in the envelope, some in the result), which is why the smoke asserts
  the contract that actually holds — a refusal is *named* and *inert* — rather
  than inventing a uniform convention the codebase does not have.

## Still open (noted, deliberately not fixed)

- `integrateMain` returns `reason: url ? 'current' : 'no-origin'` when
  `behind === 0` (`git-workspace/lib/integrate.js:171`). For a local-only repo
  the truth is `current` — "you are up to date" is computed entirely locally
  by `git rev-list --count HEAD..main` and needs no remote. `no-origin` is
  reported instead. **Not user-reachable**: the Integrate button only renders
  when `behind > 0`, so nobody can click into this branch. Left alone rather
  than fixed speculatively; it wants a pass over what `no-origin` is supposed
  to signal across all its callers.
- `card.status`'s `frame` and `main.checks` still read `cur.path` and the ORG
  manifest for a project seat, so a project's frame state and main-branch
  checks are the org's. Same class as the bug above; out of scope for a fix
  aimed at the reported symptom, and it needs the D98/D99 model applied to
  `mainChecksFor` and `frameStatus` together.
- `card.ci.rerun` / `card.ci.cancel` answer `runId-required` on a local-only
  org — technically true, useless as a message. Hidden from the UI, so
  cosmetic.

## Test

`scripts/card-local-smoke.mjs` — 30 assertions, offline, sandboxed:

1. a local-only org is born `localOnly`, with no remote;
2. `card.status` reports the local-only truth;
3. the local CI/CD loop: dirty worktree → draft → `card.commit` → main carries
   the work (asserted against `git log` / `git show`, not the return value);
4. the reachable integrate path — a second session falls behind main and
   `card.integrate` catches it up with no remote;
5. nothing was published: no push, no remote, and the card still answers after
   every refused remote action;
6. the regression for this bug: a published project in a local-only org reads
   `linked:true, localOnly:false`, while an unlinked one still inherits
   `localOnly:true`.

Verified to FAIL on the pre-fix code (section 6, both assertions) and pass
after — the D91 inheritance assertion passes either way by design, since that
behaviour was accidentally correct before and must stay correct.
