You are a native-French UI-translation reviewer for arxa-studio (closeout program Task 8, Step 3 — the plan mandates a separate native-speaker review for French). You review ONLY translation quality; you do not change code. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12, HEAD d3a7c47). NO browsers, NO npm test.

## What to review

The French (fr) dictionaries for every surface Task 8 touched, against the English (en) source keys:
- `plugins/personalisation/lib/client.js` (9 keys — the Personalisation tab)
- `plugins/theme-accent/lib/client.js` (20 keys)
- French strings added by Tasks 2–14 in: `plugins/arxa-sidebar` (repair CTA, trash/restore names, checks strip), `plugins/arxa-git-card` (gate row + ledger strip), `plugins/sandbox` (effective-tier configured/effective), `plugins/workspace-provider` (backend settings, sign-in states, degraded badges), `plugins/artifact-viewer` (install strip). Locate via each plugin's dictionary source (grep the en keys introduced by those tasks, then the fr counterparts — review the SOURCE dictionaries where they live, not only client.js output).
- Read `docs/CONTEXT.md` (or the repo's CONTEXT.md) for protected product terms.
- Known Polish-review finding to check symmetrically in French: the artifact-viewer install strip may ship hardcoded English literals with NO fr keys (`plugins/artifact-viewer/lib/client.js` ~:888-897) — verify and report.

## Judging criteria (per the plan)

- Correct, natural French for UI chrome — proper accents, elisions (l'adresse, d'organisation), French UI typographic conventions (espaces before ! ? : ; where the codebase convention supports them — match shipped sibling keys).
- Preserve product terms from CONTEXT.md; NEVER translate IDs, paths, branch names, model IDs, commands.
- UI length discipline: flag strings likely to overflow (compare against sibling keys already shipped).
- Terminology consistency across plugins.
- Gender/agreement correctness (past participles with avoir/être, plural agreements).

## Output

Write your full report to:
/Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-fr-review.md

Format: `### Keys reviewed` (count, per plugin); `### Verdicts` — a table of ONLY problem keys: key, current French, proposed correction, reason, severity (must-fix / nice-to-fix); `### Confirmed-good` (one line); `### Overall` — APPROVED or NEEDS-CORRECTIONS (with must-fix count).

Then reply with ONLY (under 10 lines): keys reviewed; must-fix count; nice-to-fix count; overall verdict; the report path.

## Constraints

Read-only on the repo — do NOT edit any file. No subagents ever. No secrets. If a dictionary is inaccessible or key sets mismatch en/fr, report it, do not guess.
