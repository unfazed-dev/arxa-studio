You are implementing Task 15: Close macOS/Linux distribution and preserve the Windows deferral (arxa-studio closeout program, wave 6 — release surfaces). This task works in TWO worktrees; commits land SEPARATELY per repository.

## Task Description

Read your task brief FIRST — it is your requirements, with the exact values to use verbatim:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-brief.md

## Worktrees

- Studio (primary; deps installed): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — branch closeout-2026-09-12, studio BASE d1771af. Linux harness/tests/docs + the Step 7 inventory update land here.
- Sibling arxa (the bulk of the work): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout — branch closeout-2026-09-12, checkout of arxa 5749402b. Workflows, desktop/scripts, install-macos.sh, docs/linux-support.md land here. Check its status first (`git -C <path> status --short`) — if it carries leftover dirt from earlier audits (analysis_options.yaml, pub locks), leave that dirt out of your commits.
- Sibling repo law (arxa/AGENTS.md, binding): behavior-TDD for kit/app code; never hand-edit generated outputs; never mutate the operator's real ~/.arxa. The CANONICAL arxa checkout (/Volumes/business_ssd/arxa_digital_solutions/arxa) is READ-ONLY and DIRTY — never touch it.
- Commits: studio-side as `test: close studio linux harness rows` (or `docs:`/`test:` fitting the content — your judgment, say what and why); arxa-side as `feat: close macos linux distribution and windows deferral`. Both with blank line + trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`. No tag, no release upload, no store submission, no push.

## Step-by-step guidance

- Step 1: verify by evidence (artifacts/scripts/manifests on disk + their generators/tests); correct the stale no-`.desktop` plan line.
- Step 2: fail-closed stable releases in `desktop-release.yml` (signing+notarization+updater+credentials all required before publication); clearly-labelled unnotarized beta lane allowed with warning + manifest metadata, never labelled stable. actionlint after.
- Step 3: macOS installer twin (`desktop/scripts/install-macos.sh` + its focused shell test): channel manifest fetch, updater signature/checksum verify, per-user install, channel preservation, uninstall; test syntax/local-file override/tampered-artifact refusal/idempotent upgrade/clean uninstall — all WITHOUT network publication (local fixtures).
- Step 4: Omarchy VM user path — if a disposable VM cannot run on this RAM-constrained machine (likely), DEGRADE HONESTLY: prepare the exact VM runbook + assertions list for Task 16, and validate whatever subset the container lanes permit; record the degradation explicitly (precedent: Docker/sbx gated legs). If a reproduced product fault surfaces anywhere, fix it test-first in the owning repo.
- Step 5: actionlint, manifest generators --check, Arch/Ubuntu container lanes (if containers can run — docker daemon was DOWN; degrade honestly with the prepared command otherwise), AppImage/deb extraction + layout checks, packed-engine boot.
- Step 6: notarization PREP only — validate identities/entitlements/hardened-runtime/updater-signature shapes and `notarytool` command shape via a NON-SECRET profile reference. Never read/create the operator's app-specific password; never print secrets.
- Step 7: studio-side inventory update — `docs/plans/open-work-inventory-2026-09-12.md`: Windows row → `DEFERRED (D23)` + exact demand/Scale-customer revisit trigger + link `../arxa/docs/research/windows-packaging.md` (create the link target only if the research doc exists in the sibling worktree; otherwise link the path with a note). NO Windows code of any kind.
- Step 8: full local gates BOTH repos: studio `npm test` (exit 0, ALL GREEN, record suite count); arxa side — the repo's own test entry (`command -v` first: dart/flutter via fvm; `./tools/portable-core-test.sh` if that's the gate; flutter analyze/test under mobile_flutter is NOT in this task's scope). Read the sibling README/AGENTS for the right gate and say which you ran. Record the still-external first `desktop/**` PR runner pass and first signed `studio-v*` release-linux pass as EXTERNAL pending rows.

## Constraints (binding)

Every behavior change RED→GREEN→focused→full gate→commit. Scratch state only; never mutate operator state (no real releases, no real notarization, no network publication). Never print secrets/tokens/passwords. Generated clients never hand-edited. No push/merge/tag. RAM discipline: one suite at a time; containers/VMs only if they fit; no browsers. No subagents ever — report instead. Findings → ledger append (.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md). If a hook refuses a compound shell command, split it. Machine: macOS ARM64, Node 24 via nvm, dart/flutter via fvm, `command -v` before assuming.

## Report

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-report.md
covering: per-step evidence (commands + key output), what degraded and why (VM/containers), the two commit SHAs + which repo, gates run per repo, external pending rows recorded, files changed per repo, self-review, concerns.

Then report back with ONLY (under 15 lines):
- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Commits (repo + short SHA + subject)
- One-line gate summary per repo
- Degradations one-liner (VM/containers/daemon)
- Your concerns, if any
- The report file path

Never silently produce work you are unsure about.
