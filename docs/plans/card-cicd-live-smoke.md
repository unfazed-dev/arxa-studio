# Git card — live CI/CD end to end, and what it caught (2026-09-06)

The user asked for the whole CI/CD flow driven **through the card**, on real
GitHub, start to finish: new session/worktree → commit → push → PR → checks →
merge to main → cleanup, with the history readable afterwards. Plus: "check all
of them and smoke test them all", after the re-link dialog turned out to be
impossible to close.

Harness: `scripts/card-cicd-smoke.mjs --yes [--keep]`.

## Why a new script rather than `cicd-smoke.mjs`

`scripts/cicd-smoke.mjs` drives arxa's GitHub *helpers*. This one drives the
**card** — every step goes through `/__arxa/git-card/action`, the same wire the
buttons in the composer dock use. Two of the four bugs below live above the
helper layer and are invisible to a helper-level test.

It also commits a real `ubuntu-latest` workflow to the base branch, so the PR
triggers an actual Actions run. Cancel, re-run and the merge-only-when-green
gate are then exercised against live state instead of a fake that always says
green. A `hold` job (`sleep 45`) exists purely so cancellation has something
live to act on — a workflow that finishes in five seconds cannot test cancel.

Blast radius: its own throwaway private repo, a temp `ARXA_HOME`, a temp
workspace root. It never touches an existing repo or the user's real orgs.

## Bugs found

### 1. The re-link dialog could not be closed (the reported one)

`startRelink` cleared its 700 ms device-code poll **only** when
`card.github.link` settled — and that call long-polls until GitHub confirms,
which a cancelling user never does. Cancel set `relink = null`; the next tick
set it straight back. `if (relink !== null) return` then swallowed every
further click, so nothing short of an app restart got out.

Fixed with a run token: `stopRelink` clears the interval and drops the token,
and every late writer checks the token first. Unmount clears the timer too.

Host side: **one device flow at a time**. The action table is rebuilt per
request, so the guard lives at plugin scope. A second concurrent flow is not
merely untidy — per GitHub's device-flow docs, competing polls on one client id
get `slow_down`, verification submissions are capped at 50/hour/app, and
`github-link` keeps a single `lastDeviceCode` slot, so flow B would overwrite
the code flow A has on screen.

Regression test: `plugins/arxa-git-card/selftest.relink.mjs`. No static pin can
see a reopen loop, so it slices the real functions out of the shipped
`client.js` and drives them against a real clock. Verified by reintroducing the
defect — it goes red with the symptom as data.

### 2. The Mint button was unreachable

The approve row has three states: open PR → **Merge**, merged PR → **Mint**,
neither → **Create PR**. But `card.pr.status` listed only *open* PRs, so the
instant a merge landed it returned `pr: null`, `prAny` went false, and the row
fell through to "Create PR". `prMerged` — and the entire Mint action behind it —
could never render.

`card.pr.comment` already reasoned correctly here ("stage comments outlive the
PR's open state"); `card.pr.status` did not. It now lists `'all'`, prefers the
open PR then the newest, and carries `merged` explicitly — GitHub's PR state is
only `open|closed`, never `merged`, so the flag has to be passed or the client's
branch stays dead.

This also explains why Mint's non-existent glyph (`IconUploadOutline16`, fixed
in `db39098`) went unnoticed for so long: nobody had ever seen the button.

### 3. A too-early re-run read like a dead GitHub grant

`card.ci.rerun` relayed GitHub's 403 as `workflow rerun failed (403)`. Measured:
the same run 403s while `in_progress` and 201s once it settles — so 403 here is
a **state** answer, not an auth one. `frame.js` already carried a comment saying
to say so; the code still relayed a bare status, which reads like an expired
token and sends the user off to re-link a perfectly good grant. It now names
the state.

The card already disables Re-run while the run is live (`disabled: runLive`), so
the UI does not normally reach this — a stale status can.

### 4. Two of my own assertions were wrong, not the product

`card.status` reports the branch under `result.seat.branch`, not `result.branch`.
`card.pr.comment` takes a `stage` and *builds* the body from it; it does not
take a raw `body`. Both corrected in the script.

## Audited, not changed

- **The four confirmation dialogs are structurally safe** from bug 1's class.
  The class is "something outside the modal writes the state that holds it
  open". The card's only other timers are the 30 s `card.status` and
  `card.pr.status` refreshes, and they write `status` and `pr` — never
  `confirm`. Nothing can reopen a dismissed confirmation.
- **The confirm closure captures its render's `pr`.** Confirming therefore acts
  on what you were shown rather than on a later refresh. Left as is; that is the
  better of the two behaviours.

## Coverage — what ran live vs what could not

15 card actions driven live through the card route: `card.status`,
`card.commit.draft`, `card.commit`, `card.push`, `card.pr.status`,
`card.pr.merge` (both the green-gate refusal and the merge), `card.ci.cancel`,
`card.ci.rerun`, `card.pr.comment`, `card.integrate`, `card.integrate.finish`,
`version.mint`, `insight.streak`, `insight.ci`, `insight.sessions`.

Not exercisable against a fresh throwaway repo, and said out loud rather than
quietly redefined:

- **`card.runner.wake`** needs a self-hosted runner registered to the repo.
  Asserted on its *refusal* instead — a clean answer, not a hang or a raw throw.
- **`card.github.link` / `card.github.device`** need a human to approve a code
  on github.com. Covered by `selftest.relink.mjs` and the host dedupe pin.
- **`card.pr.create`** as a separate click: D6 opens the PR on first push, so
  the explicit path is only reached when that failed. `cicd-smoke.mjs` L3
  already covers it.

## Result

`card cicd smoke: ALL GREEN` — 27 assertions.

Evidence repo (kept): `unfazed-dev/arxa-cicd-card-1788672186976`. PR #1 opened
by the first push, an `arxa · review` / `arxa · checks` / `arxa · merged`
comment trail, an Actions run with `attempt=2` from the re-run, an integrate
merge commit on the branch, merged to main, session branch cleaned off the
remote leaving only `main`.

The earlier repo `arxa-cicd-card-1788671869811` is the run that found bugs
2 and 3 — kept deliberately as the evidence for them.

## Separately noticed

`node scripts/github-relink.mjs --check` reports
`relink required: incorrect_client_credentials`. That is the **refresh** path,
not the device flow: GitHub requires a client secret to refresh unless the token
came from the device flow. Both client ids (the configured one in
`~/.arxa/github-link-config.json` and the shipped one) issue device codes fine,
so the Re-link button — now that it closes — will genuinely fix it.
