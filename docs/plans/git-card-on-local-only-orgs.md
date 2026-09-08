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

## Live verification through the lens (2026-09-08)

The offline smoke proves the code; it cannot prove the running app serves it.
`arxa/tool/lens_studio_smoke.dart` walks the REAL desktop app with the app's
own launch token — sidebar → org → project tree → track → session → git card —
capturing evidence at each step. Run against the real **WAW** org (localOnly,
project `Tree`, also local-only):

```
PASS  the shell surface renders (not the parked browser card)
PASS  the WAW organisation row is present and clickable
PASS  every stage container renders a website + application track row
PASS  all nine stages carry a track row
PASS  a session row is rendered under the application track
PASS  the session opens from the sidebar
PASS  the git card renders in the composer dock
PASS  the expanded card names the local-only state
      card: "main · clean  local-only  nothing to commit"
PASS  no GitHub-only affordance is offered on a local-only seat
PASS  no console errors / no uncaught page errors
```

So **the git card does work on a local-only org**: it renders, reports
`local-only`, measures the branch as clean, and offers no GitHub control it
cannot honour. The reported symptom is not reproducible on this build against
this org — which is why the fix above is filed as a real but *adjacent* defect
(it needs a PUBLISHED project inside a local-only org to bite, and `Tree` is
not published).

Two things worth recording about getting the lens onto this surface:

- The waiting-page referee parks any plain-browser tab while the desktop is
  alive, so a naive capture returns "Arxa Studio is running as the desktop
  app." `ARXA_LENS_UA` with an `ArxaShell` UA is the documented way through,
  and it is *passive* — a shell-UA client only sends `shell-beat`; it never
  claims a slot, so it cannot displace the live window. The door NOT to use is
  `/?arxa-browser=<token>`, which claims PRIMARY.
- A live app never settles (spinners, a pulsing logo — 131 SMIL animations),
  so `captureGolden` refused to write. `tool/lens_shot.dart` gained
  `--allow-unstable`, the same opt-out `gate_lens.dart` already takes for its
  evidence shot. Off by default: a golden must still converge.

### Open finding: the + on a bare stage row is a silent no-op

The lens caught one genuine defect the offline suites cannot see. Every stage
row (`02-design`, …) carries a hover `+` button, `aria-label="New session in
02-design"`. It is **enabled**, and pressing it does nothing at all — measured:
session count 1 → 1, no toast, no console error, no explanation.

The cause is a half-applied gate. The server refuses a bare stage
(`workspace-needs-track`, 98f2e93) and the DOCK's New Session CTA correctly
disables itself with the `newSession.needsTrack` tooltip (`projectRowRefused`,
`workspace-region.snippet.txt:403/416`). The per-row `+` never got the same
gate — and it lives in the BUNDLED Rows region of `client.js`, outside the
generated snippet, which is why the earlier fix did not reach it.

Not fixed here: editing a bundled artifact is a different kind of change from
the one this pass was scoped to, and it wants the reason surfaced to the user
(disabled + the needsTrack tooltip), not merely the button removed.
