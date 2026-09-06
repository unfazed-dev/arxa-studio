# Git card — confirmations, icons, and a live re-link (2026-09-06)

Second branch of `docs/plans/sidebar-git-card-viewer-harmony-grill.md`: G4
(dialog confirmations), G5 (icons), G6 (the re-link error becomes an action).
The artifact viewer is the next and last branch.

`plugins/arxa-git-card/lib/client.js` is composed by
`node scripts/gen-git-card.mjs --write` from `lib/git-card.snippet.txt` and the
stock QueueDock CSS. Never hand-edited; the selftest drift gate compares bytes.

## What is actually broken (verified)

1. **Nothing confirms.** Merge, Integrate main, Finish integrating and Mint
   fire on the first click. Merge is squash-merge into main; Integrate rewrites
   the session worktree; Mint stamps a version. Commit and Create PR already
   pause for text entry, and Cancel CI is reversible by re-running.
2. **Icons repeat and two do not exist.** `Icon(name, fallback)` falls back
   SILENTLY (`const C = P[name] || P[fallback]`). Checked against the 75 `Icon*`
   exports in `node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`:
   `IconGitBranchOutline14` (card head) and `IconUploadOutline16` (Mint) are not
   among them, so both have been rendering their fallback since they were
   written. Beyond that, one refresh glyph serves Refresh, Integrate, Wake,
   PR-refresh and CI re-run, and one check glyph serves Commit, Merge, Finish
   and the editor's Save — five and four actions that mean different things.
3. **The re-link is inert text.** `status.github.relinkRequired` pushes
   `t('git.relink')` into the detail line. Every GitHub-backed action then
   throws `github-unavailable`, and the one sentence that names the recovery is
   not clickable. The sign-in itself lives only in the sidebar's disconnect
   modal — there is no reusable standalone surface.

## Changes — all in `lib/git-card.snippet.txt` unless noted

### G4 confirmations

One `confirm` state (`{ key, title, body, label, run }`) and one stock
`P.Modal` at the end of the card, the same grammar the Claude row and the
sidebar's Delete use. Merge, Integrate, Finish and Mint set it instead of
acting. Commit and Create PR keep their text entry as the pause; Cancel CI
stays one click.

### G5 icons

| action | glyph |
|---|---|
| card head | `IconBranchOutline16` (was the non-existent `IconGitBranchOutline14`) |
| Refresh, PR refresh | `IconRefreshOutline16` |
| Integrate main | `IconDownloadOutline16` |
| Finish integrating | `IconCheckOutline16` |
| Wake the runner | `IconPlayOutline16` (was a refresh glyph) |
| Ask for a draft | `IconSparkle16` |
| Commit | `IconListPenOutline16` |
| Create PR | `IconSendOutline16` |
| Merge PR | `IconCheckOutline16` |
| Mint a version | `IconGoalOutline16` (was the non-existent `IconUploadOutline16`) |
| Re-run checks | `IconRefreshOutline14` |
| Cancel checks | `IconStopFill16` |
| Open the run | `IconRightUpOutline16` |
| Re-link GitHub | `IconLinkOutline16` |

Insight trio and the editor's Save/Cancel are unchanged. A selftest pins every
name the card names against the frontend bundle, so a silent fallback can never
ship again.

### G6 re-link

- Two actions on the card's own route: `card.github.link` and
  `card.github.device`, delegating to the same `getGithub()` service the card
  already holds (`plugins/arxa-git-card/lib/index.js`). The sidebar serves the
  identical pair at account level; the card keeps its one-route property rather
  than reaching across.
- The detail line stops carrying the sentence. The status row grows a **Re-link
  GitHub** action that runs the device flow and shows the one-time code in a
  `P.Modal` — the sidebar's relink flow verbatim (`github.link` long-polls,
  `github.device` polled every 700 ms for the user code).
- While `relinkRequired`, every GitHub-backed control is HIDDEN rather than
  left to throw: the whole Approve row (its text is a GitHub read too) and the
  Wake action. Refresh, Commit and Integrate are local git and stay.

## Order

Snippet + host → `node scripts/gen-git-card.mjs --write` →
`plugins/arxa-git-card/selftest.mjs` (drift gate) + `selftest.actions.mjs` →
`node bin/arxa-engine-sync.mjs` → screen check.
