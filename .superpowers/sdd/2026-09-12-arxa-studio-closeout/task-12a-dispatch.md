You are implementing Task 12 PART A (of two): the files-only half of "Reconcile and finish the Flutter mobile deliverable". Two implementers OOM-died during Flutter toolchain cold-starts, so you run ZERO flutter/dart/gradle/pod/xcodebuild commands. A later dispatch runs the gates. Controller ruling you operate under: Task 1's 2026-09-12 audit (flutter analyze clean, flutter test +104 green, twelve §a parity boxes mapped to code) IS the "prove the existing app before editing" evidence for this checkout — cite it, don't re-run it.

## Inputs

- Brief: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-brief.md (Steps 2–7 file creation is your scope; Step 1's run is already evidenced)
- Ledger (Task 1's mobile audit section + Task 15's rows): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/progress.md

## Worktrees

- Sibling arxa worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-closeout (branch closeout-2026-09-12, base fff96bee). Files land here.
- Studio worktree: /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout — ONLY `docs/plans/mobile-flutter-migration-spec.md`.
- Canonical arxa checkout: READ-ONLY, never touch. Sibling repo law (AGENTS.md): behavior-TDD, never hand-edit generated outputs.

## Your scope (no toolchain executions)

1. Read the `arxa-cicd` and `arxa-deployer` skill files in the sibling repo (find under /Volumes/business_ssd/arxa_digital_solutions/arxa/.claude/skills/ or the repo's skills dir) as authoritative templates.
2. Create through arxa-cicd: `scripts/check.sh` (one-root check: `arxa gate --all` + flutter format/analyze/test hooks — commands written for Part B to execute), `.github/workflows/ci.yml`, `.github/pull_request_template.md` with [arxa-<skill-name>] stage tags, `docs/ci/{decisions,setup}.md` recording the brief's pre-made decisions (private monorepo, main trunk, hosted Ubuntu Android lane, self-hosted macOS/ARM64 labels for iOS, per-job timeouts, concurrency cancellation, deploy jobs prepare-then-halt at human approval), `docs/ci/explainer.html` from the skill template.
3. Create through arxa-deployer: `.github/workflows/mobile-release.yml`, `mobile_flutter/fastlane/{Appfile,Fastfile,Matchfile}`, and the `mobile_flutter/shorebird.yaml` extension point IF OTA remains in scope (check the brief + migration-spec; if unsure, create the extension point as the brief says "accepted ... if OTA remains in scope" — judge from the spec's OTA rows and say which and why).
4. Step 4 signing (code only): keep `solutions.arxadigital.arxa.mobile`; release signing loaded from gitignored `key.properties` or CI secrets with CLEAR failure when absent (debug key only for debug builds); confirm iOS team/bundle/entitlements against release configuration (read pbxproj/ExportOptions; edit only what the brief lists: `mobile_flutter/android/app/build.gradle.kts`, `mobile_flutter/ios/**` where signing validation requires it, `mobile_flutter/deploy/**`).
5. Studio-side: update `docs/plans/mobile-flutter-migration-spec.md` — close the twelve boxes with evidence pointers (from Task 1's audit + your file work), dated.
6. Validate WITHOUT toolchains: shell syntax (`sh -n scripts/check.sh`), YAML well-formedness (node/js-yaml or python -c yaml.safe_load — python via pyenv is fine), fastlane Ruby syntax if rubocop/-c available cheaply (`ruby -c`), and actionlint if installed (`command -v actionlint`).
7. Commit arxa-side as `feat: reconcile mobile ci and release readiness` and studio-side as `docs: close the mobile migration checklist` — blank line + `Co-Authored-By: Claude Code <noreply@anthropic.com>`. NO push/tag/release.

## Constraints

Behavior-TDD applies to any DART behavior changes — but Part A should make FEW or none (signing-config edits are config, not behavior; if you must change Dart behavior, write the failing test file and leave it RED for Part B to verify — do not run it). Never print secrets. No Windows work. No subagents. RAM: you may run `sh -n`, `ruby -c`, yaml loads, grep — nothing heavier. Disk: keep writes in the worktrees (62 GiB free there; system disk has ~2 GiB — do NOT write to system paths).

## Report

Append `## Part A` to .superpowers/sdd/2026-09-12-arxa-studio-closeout/task-12-report.md (create if absent): files created per skill template, decisions recorded, signing edits, OTA judgment, syntax validations, commits, what Part B must run. Reply ONLY (under 12 lines): Status; commits (repo+SHA+subject); files-created one-liner; OTA judgment; syntax checks one-liner; concerns.

If anything is unclear, return NEEDS_CONTEXT — do not guess.
