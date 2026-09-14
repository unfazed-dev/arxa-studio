You are executing the CAPTURE-ONLY half of Task 8 (visual acceptance; arxa-studio closeout). The locale half landed in commit `5c2f83a` (BASE for you). Your job: capture the missing narrow-width evidence and run the in-repo console gate. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout (git worktree, branch closeout-2026-09-12).

## Scope — ONLY this, nothing else

1. **RAM discipline above all** (three prior workers OOM-died): ONE width at a time; ONE surface at a time; launch the browser, capture, KILL the browser process tree before the next capture; write files immediately; never run npm test until all captures exist; if memory_pressure free % drops below 20, pause captures, run `pkill -f chrome`-class cleanup (only YOUR headless test browser processes), continue.
2. Capture at **390** then **744** (each: fresh headless launch at that real window size — no emulated resize; T7 proved emulated resize fails to mount): the surfaces from the brief's Step 4 still missing at those widths — Finish, Sweep, Checks red disclosure, project preparation, trash confirmation/recovery, viewer install strip, configured/effective confinement, Workspace backend/sign-in states, Personalisation; light AND dark where the component differs. 1280 is complete (T7 set + the 6-7 new PNGs) — do not redo it.
3. The **viewer ladder** at 390/744 (Task 7 review condition): language strip + dart-absent strip shots (T7 only has these at 1280/744-dart) — whatever renders at narrow widths; record honestly if a surface genuinely cannot mount at 390 and why (that is evidence too — a named, reproduced limitation beats a faked shot).
4. Run the now-in-repo `scripts/evidence-gate.mjs` console-error gate over every NEW capture session; record its output; zero errors required except the gate's named+justified filter list (verify the list in the script; report it).
5. Commit as `docs: complete the narrow-width evidence ladder` (blank line, trailer `Co-Authored-By: Claude Code <noreply@anthropic.com>`). Evidence files land under `designs/evidence/studio-closeout/{390,744}/`.
6. APPEND a `## Part B — captures` section to /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-8-report.md: capture method per width, full file inventory (width × surface), gate output, honest notes on anything that could not be captured.

## Constraints (binding)

Scratch ARXA_HOME/orgs only; never print secrets; never push/merge/tag; no subagents ever; `package-lock.json` dirt stays out; NO code changes beyond what a capture blocker strictly requires (if a surface will not mount at 390, that is a finding — ledger it, do not fix product code in this dispatch).

## Report back ONLY (under 12 lines)

Status; commit (short SHA + subject); evidence inventory one-liner (files per width, gaps + reason); gate result one-liner; concerns; report path. Never silently produce work you are unsure about.
