You are reviewing Task 15 (Close macOS/Linux distribution and preserve the Windows deferral — arxa-studio closeout, wave 6). It spans TWO repos/worktrees. You are a FRESH independent reviewer; the implementer is a different agent.

## Inputs

- Brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-brief.md
- Report: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-report.md
- Studio diff package (base d1771af → head 2c74ab0): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-review-package.txt
- Arxa-side package: BUILD IT YOURSELF first (the controller's session is hook-blocked from sibling git; yours is not): in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout run `git log --oneline 5749402..HEAD`, `git diff --stat 5749402..HEAD`, `git diff -U10 5749402..HEAD`, `git diff --check 5749402..HEAD` and write them to /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-15-review-package-arxa.txt (the implementer claims one commit fff96bee).

## Binding requirements (from the brief)

- Step 1: already-built rows closed by EVIDENCE (entitlements, branded icons, AppImage/deb/PKGBUILD, /usr/libexec engine layout, systemd user unit, Wayland/HiDPI, .desktop/icon install+uninstall, checksum/updater manifest); stale no-.desktop plan line corrected.
- Step 2: stable `studio-v*` FAILS CLOSED before publication unless Developer ID signing + notarization + updater signing + credentials all succeed; `studio-beta-v*` clearly labelled unnotarized beta with workflow warning + matching manifest metadata; never labelled stable.
- Step 3: `desktop/scripts/install-macos.sh` + focused shell test — manifest fetch, updater signature/checksum verify, per-user install, channel preservation, uninstall; tampered-artifact refusal; local fixtures only (no publication).
- Step 4: Omarchy VM — degradation acceptable ONLY with prepared runbook + assertions (T16) + container-lane subset attempted.
- Step 5: actionlint, generators --check, container lanes (or honest degradation), AppImage/deb extraction + layout checks, packed-engine boot; external rows recorded (first desktop/** PR runner pass, first signed release-linux pass).
- Step 6: notarization PREP only, non-secret profile reference, NO operator password reads/creates.
- Step 7: studio inventory Windows row = DEFERRED (D23) + exact revisit trigger + research-doc link; ZERO Windows code.
- Step 8: full gates both repos; commits separate per repo; no tag/release/upload/push.
- Global: RED→GREEN for behavior changes; never print secrets; scratch state only.

## Implementer claims to adjudicate

1. `.github/actionlint.yaml` added OUTSIDE the brief's file list ("actionlint could not pass without it") — judge the justification.
2. INCIDENT (verify the restoration claim): `./install.sh` briefly repointed the OPERATOR's `~/.local/bin/arxa` wrapper at the worktree, restored to canonical same session. Check `~/.local/bin/arxa` (read it — it should resolve to the canonical checkout /Volumes/business_ssd/arxa_digital_solutions/arxa, NOT the worktree) and report its current target. Also confirm the canonical arxa checkout's status is unchanged-dirty (not newly modified by this task).
3. Disk hit 100% mid-gates (machine near-full; ~2GB free after) — note as environment risk for the ledger, not a finding.
4. Installer-vs-in-app channel divergence documented (fix = src-tauri, out of scope) — judge the scoping.

## Independent verification (one at a time; RAM AND DISK constrained — ~2GB free; prefer cheap checks first; do NOT run docker/VMs)

1. Arxa worktree status: clean except claimed leftovers? `git -C <arxa-worktree> status --short`.
2. `actionlint` on both workflows (or its --version + run if installed; if absent, syntax-check via `ruby -e YAML.load` equivalent or note honestly).
3. The installer focused shell test (the implementer names it — run it; it must be local-fixture only).
4. Studio `npm test` ONCE (exit 0, ALL GREEN, suite count).
5. Read ~/.local/bin/arxa (restoration check above).
6. Windows-zero check: grep the arxa diff for any added Windows artifact (sidecar/Credential Manager/picker/service/installer/workflow/PowerShell) — must be none; docs/links only.
7. Stable-fail-closed check from the diff: does studio-v* actually gate publication on all four requirements?

## Output Format

### Spec Compliance (per step, both repos)
### Incident Verification (wrapper restoration, canonical-untouched)
### Independent Verification Results
### Strengths
### Issues — Critical / Important / Minor
### Assessment — Task quality: Approved | Needs fixes + 1-2 sentence reasoning

Final message IS the report — begin with the spec verdict. Never spawn claude/agents/reviewers. No git-state mutation (status/diff/log only). Scratch state only; never print secrets.
