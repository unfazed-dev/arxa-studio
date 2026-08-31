# Artifact viewer-editor — D87 acceptance runbook

Everything mechanical is green (CI 15/15). What remains is the D68/D87
precedent: the OWNER demonstrates the live loop. One precondition is
owner-owned:

> **Precondition — restart the studio.** The running engine (PID on :7891)
> predates the plugin; plugins materialize at boot. Restart when the
> parallel D90 session reaches a safe point, then walk this page top to
> bottom. Nothing else is needed — no DB, no keys, no flags.

## 0. Standing evidence (already green, re-run to confirm)

- [ ] `node scripts/ci.mjs` → 15 suites, ALL GREEN (artifact-viewer
      selftests cover: per-org server containment + GET-only, token
      bindings/expiry, write API over a REAL git session worktree,
      main-version diffs, version chip, watcher coalescing + SSE).

## 1. Boot + panel presence

- [ ] Restart arxa studio. Boot log shows the profile materialized with
      `arxa-artifact-viewer` among the by-name plugins (no boot errors).
- [ ] Open http://arxa.studio.localhost:7891 — the right dock shows the
      "artifact viewer" toggle; expanding shows the path input.

## 2. View lanes (lens visual gate — capture at 390 / 744 / 1280)

- [ ] With an org open: open a `.md` artifact → rendered markdown, zero
      console errors. Capture.
- [ ] Open a `.js`/`.ts` file → CodeMirror 6 read-only view. Capture.
- [ ] Open a `.png` → image; an `.mp3`/`.mp4` → native player. Capture.
- [ ] Open an `.html` file → sandboxed iframe (allow-scripts only) on
      `org-<slug>.localhost`; open a `.pdf` → pdf.js canvas with pager.
      Capture.

## 3. The live loop (D87 core)

- [ ] Press **edit** → session badge appears (D80 transparent ensure; a
      session was created silently if none was open — visible in the
      sidebar under the org's notes workspace).
- [ ] Change text → **save** → note reads "saved · wip committed to …".
      In a terminal: `git -C <org>/.arxa/worktrees/<id> log --oneline`
      shows the `wip:` commit. MAIN IS UNCHANGED.
- [ ] Stage/gate merge: run the session's stage boundary (or the composer
      git card) → green merge → the version chip/timeline reflects it.

## 4. Conflict prompt (agent edits the open file)

- [ ] While the file sits dirty in the editor, have the agent (or any
      process) rewrite the same file in the worktree → within ~2 s the
      editor shows the red conflict note with **keep mine** / **take
      theirs**. Press **take theirs** → editor shows the external text.
- [ ] Re-dirty and let another external change land → **keep mine** →
      save succeeds (deliberate last-writer-wins), WIP commit again.

## 5. Security proofs

- [ ] Expired/absent token: `curl -s -o /dev/null -w '%{http_code}' \
      "http://org-<slug>.localhost:<port>/notes/a.md"` → 403.
- [ ] Org origin is read-only: `curl -X POST -o /dev/null -w '%{http_code}' \
      "http://org-<slug>.localhost:<port>/notes/a.md"` → 405.
- [ ] Traversal: `curl ".../<port>/%2e%2e/<something>"` → 403/404, never
      file contents.
- [ ] Expired write token → engine write API answers 401.

## 6. Sign-off

- [ ] Lens captures archived under `designs/artifact-viewer/evidence/`.
- [ ] Tick the Task 12 boxes in
      `docs/plans/artifact-viewer-implementation.md`, note the demo date
      next to D87 in `arxa-studio-grill-decisions.md`.
