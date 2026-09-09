# Freestyle Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A second sidebar tab, **Freestyle**, beside **Organisations**: any folder, any file, any session, no org rules, VS Code-style explorer verbs, with the same automatic local git, GitHub link, arxa CI/CD gate and branch-per-session worktrees the orgs get.

**Architecture:** One tab strip inside the existing generated sidebar bundle (the `sidebar.workspaces` slot is single-owner, so both tab bodies render from `arxa-sidebar`). Freestyle's host logic lives in a new plugin `plugins/arxa-freestyle/` (roots registry, file verbs, trash, sessions) that reuses the `git-workspace` engine through a third routing kind `freestyle`. The artifact viewer gains a generic *root* concept so it can show any open Freestyle root next to the open org.

**Tech Stack:** Node ESM, dsh 0.1.2-rc.1 cordis plugins (`lib/index.js` host, generated `lib/client.js`), `scripts/gen-sidebar.mjs` + `scripts/gen-workspace.mjs` copy-whole transforms, selftests auto-discovered by `scripts/ci.mjs`, arxa lens for visual gates.

**Spec:** this file, section 1 (grilled decisions, 2026-09-08). Related: `docs/plans/local-only-git-parity-and-sidebar-decorations.md` (decorations and Checks row, being built in another session), `docs/plans/sidebar-org-rethink.md` (sidebar build route), `docs/plans/dsh-plugin-ui-conformance.md` (UI rules), dsh's shipped `cordis-plugin-development` skill (`node_modules/@deepseek-ai/dsh-agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md`).

## Global Constraints

- Never hand-edit `plugins/arxa-sidebar/lib/client.js`; change `scripts/gen-workspace.mjs`, `scripts/gen-sidebar.mjs` or a `*.snippet.txt` and regenerate. `plugins/arxa-sidebar/selftest.mjs` byte-diffs the output.
- UI uses real dsh primitives and tokens only (`_deepseek_ai_dsh_client_ui_primitives.*`, `--dsw-alias-*`, `--dsw-static-*`); every string through `ctx.locale.register` + `t()`; every side effect inside `ctx.effect()` or a retained disposer.
- Every arxa git call goes through `git-workspace/lib/run.js` (`runGit`), which pins `init.defaultBranch=main`. Never call bare `git init`.
- `.git/` and `.arxa/` are never listed, never written by a file verb, never served.
- Local-only is first class: nothing GitHub-shaped is required for any Freestyle feature. No Supabase, no cloud.
- Nothing is deleted on red: parked sessions are never swept, trash purge is the only destructive door and it confirms.
- Plans live in `docs/plans/`. Commit subjects match `frame.js` `SUBJECT_RE` (`feat: …`, `fix: …`, `docs: …`, `test: …`).

---

## 1. Decisions (grilled 2026-09-08, all confirmed by the operator)

These are new decisions, not amendments. They deliberately sit beside D42 (no user top-level folders *inside an org*), D70/D71 (an org workspace is a category or a project) and D69 (org creation needs a linked GitHub account): Freestyle is a different section with its own rules, and those org decisions stand untouched for the Organisations tab. Append them to `docs/plans/arxa-studio-grill-decisions.md` as the next free D-numbers in the docs task (Task 16); they are labelled F1–F9 here to avoid colliding with the parallel session's edits to that file.

| # | Decision | Chosen |
|---|----------|--------|
| F1 | **Root source** | Any folder, VS Code-style. Freestyle **+** offers *Open Folder* (pick any existing folder) and *New Folder* (name + location). Roots are remembered in `~/.arxa/freestyle.json`, a recents list beside `organisation.json`. Nothing is forced under `~/.arxa`. |
| F2 | **Tabs** | One tab strip inside the existing sidebar body: **Organisations** / **Freestyle**. Both bodies render from the generated `arxa-sidebar` bundle (the slot is single-owner). On the collapsed rail the strip becomes two icon buttons. Freestyle's host logic is its own plugin. **Freestyle manages its own archives and trash**, separate from the org trash. |
| F3 | **Engine reuse** | Add a third routing kind `freestyle` to `git-workspace` instead of refuse-on-unknown; manifest `<root>/.arxa/freestyle.json`; generic manifest resolver in the git card and the new-session gate. Sessions, worktrees, collapse-and-merge, `check.sh` gate, Checks row, Finish, Sweep and GitHub publish are the same code the orgs use. |
| F4 | **Git default** | Adding a folder silently runs `git init -b main` when no repo exists; an existing repo is adopted as-is. No GitHub account needed. The git card offers *Publish to GitHub* (private) when an account is linked. Local-only roots are first class. |
| F5 | **Sessions** | New session is allowed on the root and on any folder inside it. The worktree is always the enclosing repo, under `<repo>/.arxa/worktrees/<session-id>`; the session's working directory is the chosen folder inside that worktree. A folder that is its own nested git repo binds to that nested repo (nearest enclosing repo wins, like VS Code). |
| F6 | **File verbs** | Create, rename, move, duplicate, trash act directly on the root working tree on `main`, like VS Code. Each verb ends with `wipCommit` so nothing is lost and the card shows it. Freestyle trash is `<root>/.arxa/trash/<entryId>/` with restore and purge. Sidebar verbs and viewer saves share root confinement and owning-repository WIP commits; Task 9 extends the existing editor write API. |
| F7 | **Coexistence** | Freestyle roots are independent of the single open org; several roots can be open at once (multi-root). The artifact viewer, watcher and LSP gain a generic root concept. The org lock stays org-only. |
| F8 | **CI/CD frame** | Adding a folder writes a generic `check.sh` that detects the stack at the root (`package.json`, `pubspec.yaml`, `Cargo.toml`, `go.mod`, `pyproject.toml`) so session merges are gated from day one. `ci.yml`, PR template and branch protection are written on *Publish to GitHub* through the same `frame.js` code. |
| F9 | **v1 scope** | VS Code core set: new file / new folder in any folder with inline name entry, inline rename, drag-drop move, trash with restore and purge, duplicate, reveal in Finder, open in viewer, new session on any row, lazy tree (`.git`, `.arxa` hidden), watcher refresh, git decorations from the decorations plan. **Deferred:** multi-select, cut/copy/paste, compact folders, file nesting, sort options. |

**Rejected during the grill** (do not re-propose): a single studio-owned `~/.arxa/freestyle/` root; a separate plugin with its own git/session code; requiring GitHub like orgs; root-only sessions; writes only inside a session worktree; an exclusive org-or-freestyle lock; stacked sections instead of tabs.

### 1.1 Verified facts the plan builds on

- The sidebar body is `renderSlot("sidebar.workspaces")` and nothing else (`node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js:234-240`); one registrant per slot name, two registrants deadlock boot (`scripts/gen-workspace.mjs` header comment).
- `scripts/gen-workspace.mjs:67-72` splices `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` before the stock `//#region lib/types/client/index.js`. `createOrgStore()` is at snippet line 63, `window.__ARXA_SIDEBAR__` (CTA bridge: `selectedWorkspace()`, `ctaReady`, `ctaTitle`) at 379-399, `ArxaDirRows({ dir, depth, mode, hideDirs })` at 1806, `OrgBrowser` at 2646.
- `ArxaDirRows` lists one directory per call via `POST /__arxa/artifacts/token {scope:"tree-read"}` then `GET /__arxa/artifacts/tree?dir=&avt=` (snippet 1861-1867); the route is org-rooted (`artifact-viewer/lib/wt-api.js:142-170`) and hides only `.git` and `.arxa`.
- File open is `window.dispatchEvent(new CustomEvent("arxa-av-open", { detail: { relPath } }))` (snippet 1851); the viewer already accepts `sessionId` on that event (`artifact-viewer/lib/client.js:1838`).
- The viewer's root is always `readOpenOrg()` (`artifact-viewer/lib/follow.js:27-40`), read from `~/.arxa/organisation.json` plus the org lock. Tokens carry `orgPath`/`worktreeId` claims (`tokens.js:25-47`). Writes go only to worktrees (`write-api.js`), then `wipCommit`.
- Session routing is a frozen dock table (`git-workspace/lib/routing.js:34-38`), `routeDock` throws `RoutingRefusedError('unknown-dock')` on anything else, `resolveSessionRepo(orgPath, workspace)` returns `{ repoPath, kind: 'org'|'project' }` (`routing.js:128-152`).
- `lifecycle.newSession(name, workspace)` (`file-org-shell/lib/lifecycle.js:1246-1392`) does: validate workspace shape → `resolveSessionRepo` → `mintSessionPath({ org, workspace, name, sessions, ghosts })` → `openSession(repoPath, { id, orgPath, name, project, workspace, env })` → `dshBridge.spawn({ cwd: session.worktree, name, id })`.
- `git-workspace/lib/sessions.js:428` `openSession(repoPath, { id, orgPath = repoPath, name, project, workspace, env })`; worktree lands at `<orgPath>/.arxa/worktrees/<id>`. `commits.js:64` `wipCommit(repoPath, { message, env })`. `finish.js:81` `finishSession`, `integrate.js:171` `integrateMain`, `sessions.js:520` `runGate(worktree)`.
- `frame.js:366` `frameStatus(repoPath, kind='org', { includeCiYml })`, `:382` `writeFrameFiles(repoPath, kind='org', { includeCiYml, upgrade, force })`, `:123` `orgCheckSh()`, `:166` `projectCheckSh()`. `repos.js:269` `initOrgRepo` writes the org `.gitignore`; `repos.js:63` `excludeArxaDir(gitDir)`; `repos.js:41` `isRepo`, `:82` `hasHead`.
- Git card seat resolution: `arxa-git-card/lib/index.js:417-420` `repoFor(s)` picks `project.json` vs `org.json`; `card.status` at `:495-630` reads `org.json` then the seat's `project.json`. Sidebar gate helper `mainChecksFor(repoPath, manifest, g, gw)` at `arxa-sidebar/lib/index.js:211`.
- Org trash is `<org>/.arxa/trash/<entryId>` with a ledger at `~/.arxa/org-trash.json` (`lifecycle.js:2049-2159`).
- Plugin registration: row in `profile/cordis.patch.yml` (arxa-sidebar at line 234, arxa-git-card at 246), dir constant + copy-list entry + `BY_NAME_PLUGINS` in `bin/arxa-studio.mjs:145,197,390`, `scripts/preset-check.mjs` validates the composition, `scripts/ci.mjs` auto-discovers `plugins/*/selftest*.mjs`.
- No dsh tabs primitive exists; `dsh-client-ui-cordis/lib/client.js:211` (`.sourceTabs/.sourceTab`) and `dsh-client-ui-trajectory/lib/client.js:3652` (`.detailTabs/.detailTab`) carry a copyable tab-bar CSS pattern using `--dsw-alias-border-l2`, `--dsw-alias-label-tertiary`, `--dsw-font-xs-13`.

## 2. File structure

**New plugin `plugins/arxa-freestyle/`** (host only; no `dsh.client` block, the UI is in the sidebar bundle)

| File | Responsibility |
|------|----------------|
| `package.json` | name `arxa-freestyle`, `main: lib/index.js`, `type: module`, private |
| `lib/paths.js` | `arxaHome(env)`, `registryPath(env)` → `~/.arxa/freestyle.json`, `manifestPath(root)` → `<root>/.arxa/freestyle.json`, `trashDir(root)`, `resolveInside(root, relPath)` (realpath-confined, rejects `..`, absolute, `.git/`, `.arxa/`) |
| `lib/roots.js` | registry read/write; `addRoot`, `newRoot`, `openRoot`, `closeRoot`, `forgetRoot`, `renameRoot`, `listRoots`, `rootById`; repo adoption/init + manifest + `check.sh` |
| `lib/files.js` | `createFile`, `createDir`, `renameEntry`, `moveEntry`, `duplicateEntry`, `trashEntry`, `listTrash`, `restoreEntry`, `purgeEntry`, `revealEntry`; every mutation ends in `wipCommit` |
| `lib/sessions.js` | `newSession`, `listSessions`, `archiveSession`, `reviveSession`, `trashArchivedSession`, `finishSession`, `sweepMerged` for a root, via `git-workspace` |
| `lib/index.js` | `inject = ['webServer']`; routes `GET /__arxa/freestyle/state`, `POST /__arxa/freestyle/action`; action table; `ctx.provide`-free (the sidebar calls the HTTP routes, same as the org lane) |
| `selftest.mjs` | paths + roots (real git in a temp dir) |
| `selftest.files.mjs` | verbs + trash |
| `selftest.sessions.mjs` | sessions with a stubbed dsh bridge |
| `selftest.actions.mjs` | HTTP routes through a fake `webServer.register` |

**Modified shared engine**

| File | Change |
|------|--------|
| `plugins/git-workspace/lib/repos.js` | `initPlainRepo(dir, env)`: `git init -b main` via `runGit`, `excludeArxaDir`, initial empty commit if no HEAD; never writes `ORG_GITIGNORE` |
| `plugins/git-workspace/lib/routing.js` | `resolveFreestyleRepo(rootPath, relDir, { env, requireHead })` → `{ repoPath, kind: 'freestyle', cwdRel }`; reason `'outside-root'` |
| `plugins/git-workspace/lib/frame.js` | `freestyleCheckSh()`; `kind === 'freestyle'` accepted by `frameStatus` and `writeFrameFiles` |
| `plugins/git-workspace/lib/sessions.js` | `mintSessionPath` accepts `workspace: ''` (root session) → identity `<root>/<word>-wt-<date>-<nnn>` |
| `plugins/git-workspace/lib/index.js` | re-export the three new names |
| `plugins/arxa-git-card/lib/index.js` | `seatManifest(repoPath, orgPath)` generic resolver (`.arxa/freestyle.json` → `project.json` → `org.json`), used by `repoFor` and `card.status` |
| `plugins/arxa-sidebar/lib/index.js` | new-session gate reads the manifest through the same resolver; state gains `ui: { activeTab }`; action `ui.tab` |
| `plugins/artifact-viewer/lib/follow.js` | `readOpenRoots(env)` (org + open Freestyle roots); `startRootFollow` serves one org-server per open root |
| `plugins/artifact-viewer/lib/tokens.js` | claim `orgPath` kept on the wire, semantics widened to "root path" |
| `plugins/artifact-viewer/lib/wt-api.js` | tree route accepts `root=<rootId>`; token bound to that root |
| `plugins/artifact-viewer/lib/write-api.js` | `{ rootId, relPath }` writes to a Freestyle root working tree + `wipCommit` |
| `plugins/artifact-viewer/lib/watcher.js` | `setRoots(paths)` |
| `plugins/artifact-viewer/lib/index.js` | wires the above; `arxa-av-open` accepts `rootId` |
| `plugins/artifact-viewer/lib/client.js` | column header shows the root name; `arxa-av-open` `rootId` threads into token/tree/read/write calls |

**Modified sidebar generator**

| File | Change |
|------|--------|
| `plugins/arxa-sidebar/lib/freestyle-region.snippet.txt` (new) | `createFreestyleStore`, `SidebarTabs`, `FreestyleBrowser`, `FreestyleRootRow`, `FreestyleEntryRows` (wraps `ArxaDirRows` with verbs), `FreestyleTrashRows`, `FreestyleArchivesRows`, inline name editor, drag-drop |
| `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` | `ArxaDirRows` gains `rootId`, `verbs`, `onSelect` props; `__ARXA_SIDEBAR__.selectedWorkspace()` returns a Freestyle selection when that tab is active |
| `scripts/gen-workspace.mjs` | step 9b splices the Freestyle snippet after the workspace region; the region body renders `SidebarTabs` + (`OrgBrowser` \| `FreestyleBrowser`) on `activeTab` |
| `scripts/gen-sidebar.mjs` | CTA click posts to `/__arxa/freestyle/action` `session.new` when the selection is a Freestyle one |
| `scripts/gen-locale.mjs` / locale dicts | `freestyle.*` strings |
| `plugins/arxa-sidebar/selftest.freestyle.mjs` (new) | store + tab + selection contract, byte drift for the new snippet |

**Registration and docs**

| File | Change |
|------|--------|
| `profile/cordis.patch.yml` | `- id: arxa-freestyle` inserted right after `arxa-sidebar` |
| `bin/arxa-studio.mjs` | `freestyleDir`, copy-list entry, `BY_NAME_PLUGINS` entry |
| `scripts/freestyle-smoke.mjs` (new) | hand-run: add root → verbs → session → merge, against a real dsh |
| `CONTEXT.md`, `docs/plans/arxa-studio-grill-decisions.md` | vocabulary (Root, Freestyle tab) and D-numbers for F1–F9 |

## 3. Interfaces (shared vocabulary for every task)

```js
// ~/.arxa/freestyle.json
{ "roots": [ { "id": "<uuid>", "name": "notes", "path": "/abs/path", "addedAt": "...", "lastOpenedAt": "...", "open": true } ],
  "ui": { "activeTab": "org" | "freestyle" } }

// <root>/.arxa/freestyle.json  (machine-local; .arxa/ is git-excluded)
{ "id": "<uuid>", "kind": "freestyle", "name": "notes", "createdAt": "...",
  "localOnly": true, "repoOwner": null, "repoName": null, "repoUrl": null }

// <root>/.arxa/trash/<entryId>/entry.json
{ "id": "<entryId>", "relPath": "docs/a.md", "name": "a.md", "kind": "file" | "dir", "trashedAt": "..." }

// GET /__arxa/freestyle/state
{ "roots": [ { id, name, path, open, isRepo, hasHead, sessions: [...], archives: [...], trashCount } ],
  "trash": [ { rootId, id, relPath, name, kind, trashedAt } ], "ui": { activeTab } }

// POST /__arxa/freestyle/action  { action, arg }  →  { ok: true, ...result } | { ok: false, error }
// root.add {path}  root.new {parent,name}  root.open {rootId}  root.close {rootId}  root.forget {rootId}  root.rename {rootId,name}
// file.create {rootId,relPath}  dir.create {rootId,relPath}  entry.rename {rootId,relPath,name}
// entry.move {rootId,relPath,toDir}  entry.duplicate {rootId,relPath}  entry.trash {rootId,relPath}
// trash.restore {rootId,entryId}  trash.purge {rootId,entryId}  entry.reveal {rootId,relPath}
// session.new {rootId,relDir,name}  session.archive {rootId,id}  archive.revive {rootId,id}  archive.trash {rootId,id}
// session.finish {rootId,id}  session.sweep {rootId,dryRun}  ui.tab {tab}

// window event (sidebar → viewer)
new CustomEvent("arxa-av-open", { detail: { relPath, rootId?, sessionId? } })

// window.__ARXA_SIDEBAR__.selectedWorkspace()
{ orgId, workspace }                              // Organisations tab (unchanged)
{ kind: 'freestyle', rootId, relDir }             // Freestyle tab
```

Selftest convention (copy from `plugins/git-workspace/selftest.path-identity.mjs:1-40`): plain `node`, `assert/strict`, real git in `fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))`, `const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok', n, '-', msg) }`, exit non-zero on throw. Run one file with `node plugins/<p>/<selftest>.mjs`; run everything with `npm test`.

---

## 4. Tasks

### Task 1: Plain repo init and the freestyle check script (engine)

**Files:**
- Modify: `plugins/git-workspace/lib/repos.js` (after `initOrgRepo`, ~line 291)
- Modify: `plugins/git-workspace/lib/frame.js` (`freestyleCheckSh` after `projectCheckSh` ~line 260; `frameStatus`/`writeFrameFiles` kind switch ~366-420)
- Modify: `plugins/git-workspace/lib/index.js` (re-exports)
- Test: `plugins/git-workspace/selftest.freestyle-repo.mjs`

**Interfaces:**
- Produces: `initPlainRepo(dir, env = process.env) → { created: boolean }`; `freestyleCheckSh() → string`; `writeFrameFiles(repoPath, 'freestyle', opts)` writes only `check.sh` unless `includeCiYml`.

- [x] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// Selftest: Freestyle repo init + generic check.sh (F4, F8).
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { initPlainRepo, isRepo, hasHead } from './lib/repos.js'
import { freestyleCheckSh, writeFrameFiles, frameStatus, readStamp } from './lib/frame.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))

// 1. plain folder → repo on main with one commit, .arxa excluded, NO org .gitignore
const a = path.join(tmp, 'a'); fs.mkdirSync(a); fs.writeFileSync(path.join(a, 'hello.txt'), 'hi')
const r1 = initPlainRepo(a)
ok(r1.created === true && isRepo(a) && hasHead(a), 'init creates a repo with a HEAD')
ok(git(a, 'branch', '--show-current') === 'main', 'default branch is main')
ok(!fs.existsSync(path.join(a, '.gitignore')), 'no org .gitignore is written into a user folder')
ok(fs.readFileSync(path.join(a, '.git', 'info', 'exclude'), 'utf8').includes('/.arxa/'), '.arxa/ is excluded')
ok(git(a, 'status', '--porcelain') === '', 'existing files are committed by the first commit')

// 2. existing repo is adopted untouched
const before = git(a, 'rev-parse', 'HEAD')
ok(initPlainRepo(a).created === false && git(a, 'rev-parse', 'HEAD') === before, 'second call is a no-op')

// 3. check.sh detects the stack at the root
const sh = freestyleCheckSh()
for (const m of ['package.json', 'pubspec.yaml', 'Cargo.toml', 'go.mod', 'pyproject.toml']) ok(sh.includes(m), 'check.sh probes ' + m)
ok(sh.includes('npm test') && sh.includes('flutter test') && sh.includes('cargo test') && sh.includes('go test') && sh.includes('pytest'), 'check.sh runs each stack test command')
ok(!sh.includes('00-') && !sh.includes('application') && !sh.includes('website'), 'no stage or track assumptions')

// 4. frame for kind freestyle: check.sh only
writeFrameFiles(a, 'freestyle')
ok(fs.existsSync(path.join(a, 'check.sh')) && !fs.existsSync(path.join(a, '.github')), 'freestyle frame writes check.sh and nothing GitHub-shaped')
ok(readStamp(fs.readFileSync(path.join(a, 'check.sh'), 'utf8')) !== null, 'check.sh carries the frame stamp')
ok(frameStatus(a, 'freestyle').files.every((f) => f.state === 'current'), 'frameStatus reports current')
writeFrameFiles(a, 'freestyle', { includeCiYml: true })
ok(fs.existsSync(path.join(a, '.github', 'workflows', 'ci.yml')), 'includeCiYml adds ci.yml for publish time')
console.log('GREEN freestyle-repo (' + n + ')')
```

- [x] **Step 2: Run it to verify it fails**

Run: `node plugins/git-workspace/selftest.freestyle-repo.mjs`
Expected: FAIL with `does not provide an export named 'initPlainRepo'`.

- [x] **Step 3: Implement `initPlainRepo` in `repos.js`**

Read `initOrgRepo` (`repos.js:269-291`) first and mirror its `runGit` usage. Add after it:

```js
/**
 * Freestyle (F4): make an arbitrary user folder a repo without touching its
 * contents or writing the org .gitignore. Existing repos are adopted as-is.
 * @returns {{ created: boolean }}
 */
export function initPlainRepo(dir, env = process.env) {
  if (isRepo(dir, env)) {
    excludeArxaDir(path.join(dir, '.git'))
    return { created: false }
  }
  runGit(dir, ['init', '-q', '-b', 'main'], env)
  excludeArxaDir(path.join(dir, '.git'))
  runGit(dir, ['add', '-A'], env)
  runGit(dir, ['-c', 'user.email=studio@arxa.local', '-c', 'user.name=arxa studio', 'commit', '-q', '--allow-empty', '-m', 'chore: freestyle root adopted by arxa studio'], env)
  return { created: true }
}
```

If `runGit` in this file already applies identity via env, drop the two `-c` pairs and use whatever `initOrgRepo` uses for its first commit. Check `excludeArxaDir`'s argument: it takes the git dir (`repos.js:63`).

- [x] **Step 4: Implement `freestyleCheckSh` and the kind switch in `frame.js`**

Read `projectCheckSh` (`frame.js:166-260`) to copy its header, stamp and commit-subject hygiene block, then add:

```js
/** F8: one root, stack detected at the root, no stage/track layout assumed. */
export function freestyleCheckSh() {
  return stampContent(`#!/usr/bin/env bash
# arxa studio freestyle gate — Local green = CI green (ci.yml runs this exact script).
set -euo pipefail
cd "$(dirname "$0")"
${subjectHygieneBlock()}
if [ -f package.json ]; then
  if grep -q '"test"' package.json; then npm test; else echo "no npm test script — skipped"; fi
elif [ -f pubspec.yaml ]; then flutter test
elif [ -f Cargo.toml ]; then cargo test
elif [ -f go.mod ]; then go test ./...
elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then pytest
else echo "no stack detected at root — commit hygiene only"
fi
echo "freestyle gate green"
`)
}
```

`subjectHygieneBlock()` is whatever helper `orgCheckSh`/`projectCheckSh` share for `SUBJECT_RE`; if it is inline in both, extract it into a small function in the same file and use it in all three. In `frameStatus` and `writeFrameFiles`, where `kind` selects `orgCheckSh()` vs `projectCheckSh()`, add `kind === 'freestyle' ? freestyleCheckSh()` and keep `ciYml`/`prTemplate` behind `includeCiYml` exactly as for `org`. Throw `TypeError('frame kind must be org|project|freestyle')` on anything else.

- [x] **Step 5: Re-export from `plugins/git-workspace/lib/index.js`** (`initPlainRepo`, `freestyleCheckSh`).

- [x] **Step 6: Run the test and the existing frame tests**

Run: `node plugins/git-workspace/selftest.freestyle-repo.mjs && node plugins/git-workspace/selftest.frame-ignore.mjs`
Expected: both print GREEN.

- [x] **Step 7: Commit**

```bash
git add plugins/git-workspace/lib/repos.js plugins/git-workspace/lib/frame.js plugins/git-workspace/lib/index.js plugins/git-workspace/selftest.freestyle-repo.mjs
git commit -m "feat: add plain repo init and a stack-detecting freestyle check.sh to the git frame"
```

### Task 2: The `freestyle` routing kind and root sessions (engine)

**Files:**
- Modify: `plugins/git-workspace/lib/routing.js` (after `resolveSessionRepo`, ~line 153)
- Modify: `plugins/git-workspace/lib/sessions.js` (`mintSessionPath`, `assertSessionIdShape`)
- Modify: `plugins/git-workspace/lib/index.js` (re-export)
- Test: `plugins/git-workspace/selftest.freestyle-routing.mjs`

**Interfaces:**
- Produces: `resolveFreestyleRepo(rootPath, relDir, { env, requireHead = true }) → { repoPath, kind: 'freestyle', cwdRel }` where `cwdRel` is `relDir` re-expressed relative to `repoPath`. Throws `RoutingRefusedError('outside-root')` when `relDir` escapes, `RoutingRefusedError('no-head')` when the enclosing repo has no HEAD and `requireHead`.
- Produces: `mintSessionPath({ org, workspace: '', name, sessions, ghosts })` returns `<org>/<word>-wt-<YYMMDD>-<NNN>`.

- [x] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// Selftest: freestyle routing (F5) — nearest enclosing repo wins; root sessions mint.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveFreestyleRepo, RoutingRefusedError, ROUTING_REASONS } from './lib/routing.js'
import { mintSessionPath, openSession } from './lib/sessions.js'
import { initPlainRepo } from './lib/repos.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))
const root = path.join(tmp, 'root'); fs.mkdirSync(path.join(root, 'docs', 'deep'), { recursive: true }); initPlainRepo(root)

ok(ROUTING_REASONS.includes('outside-root'), 'outside-root is a documented reason')
let r = resolveFreestyleRepo(root, '')
ok(r.kind === 'freestyle' && r.repoPath === root && r.cwdRel === '', 'root session binds to the root repo')
r = resolveFreestyleRepo(root, 'docs/deep')
ok(r.repoPath === root && r.cwdRel === 'docs/deep', 'nested folder binds to the root repo with its relative cwd')

const nested = path.join(root, 'lib', 'child'); fs.mkdirSync(nested, { recursive: true }); initPlainRepo(nested)
r = resolveFreestyleRepo(root, 'lib/child/src')
ok(r.repoPath === nested && r.cwdRel === 'src', 'a nested repo is the nearest enclosing repo')

assert.throws(() => resolveFreestyleRepo(root, '../elsewhere'), (e) => e instanceof RoutingRefusedError && e.reason === 'outside-root'); ok(true, 'escaping the root refuses loudly')
const bare = path.join(tmp, 'bare'); fs.mkdirSync(bare); git(bare, 'init', '-q', '-b', 'main')
assert.throws(() => resolveFreestyleRepo(bare, ''), (e) => e.reason === 'no-head'); ok(true, 'a repo without HEAD refuses with no-head')

const id = mintSessionPath({ org: 'root', workspace: '', name: 'scratch', sessions: [], ghosts: [] })
ok(/^root\/scratch-wt-\d{6}-\d{3}$/.test(id), 'root session identity is <root>/<word>-wt-<date>-<nnn>: ' + id)
const s = openSession(root, { id, orgPath: root, name: 'scratch', workspace: '' })
ok(fs.existsSync(path.join(root, '.arxa', 'worktrees', id)) && git(s.worktree, 'branch', '--show-current') === 'arxa/' + id, 'root session gets a worktree and branch')
console.log('GREEN freestyle-routing (' + n + ')')
```

- [x] **Step 2: Run it to verify it fails**

Run: `node plugins/git-workspace/selftest.freestyle-routing.mjs`
Expected: FAIL, `resolveFreestyleRepo` not exported.

- [x] **Step 3: Implement `resolveFreestyleRepo`**

Add `'outside-root'` to `ROUTING_REASONS` (`routing.js:42`), then after `resolveSessionRepo`:

```js
/**
 * F5: a Freestyle session binds to the nearest enclosing git repo between
 * <rootPath> and <rootPath>/<relDir>. The org dock table is not consulted —
 * a Freestyle root has no docks. Pure path walk plus isRepo/hasHead.
 */
export function resolveFreestyleRepo(rootPath, relDir = '', { env = process.env, requireHead = true } = {}) {
  const rootReal = fs.realpathSync(rootPath)
  const target = path.resolve(rootReal, relDir || '')
  const rel = path.relative(rootReal, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new RoutingRefusedError('outside-root', `outside-root: "${relDir}" is not inside ${rootPath}`)
  let dir = target
  while (true) {
    if (isRepo(dir, env)) {
      if (requireHead && !hasHead(dir, env)) throw new RoutingRefusedError('no-head', `no-head: ${dir} is a repo with no commits yet`)
      return { repoPath: dir, kind: 'freestyle', cwdRel: path.relative(dir, target).split(path.sep).join('/') }
    }
    if (dir === rootReal) break
    dir = path.dirname(dir)
  }
  throw new RoutingRefusedError('no-head', `no-head: ${rootPath} is not a git repo — add it through Freestyle first`)
}
```

Import `fs`, `path`, `isRepo`, `hasHead` at the top if not present. Confirm `RoutingRefusedError`'s constructor signature at the top of the file and match it.

- [x] **Step 4: Let `mintSessionPath` accept the empty workspace**

In `sessions.js`, find where `mintSessionPath` joins `org + '/' + workspace + '/' + leaf`; when `workspace === ''` produce `org + '/' + leaf`. Update `assertSessionIdShape` so a two-segment identity is valid. Keep every other case byte-identical; `selftest.path-identity.mjs` must stay green.

- [x] **Step 5: Re-export `resolveFreestyleRepo` from `lib/index.js`; run**

Run: `node plugins/git-workspace/selftest.freestyle-routing.mjs && node plugins/git-workspace/selftest.path-identity.mjs && node plugins/git-workspace/selftest.mjs`
Expected: all GREEN.

- [x] **Step 6: Commit**

```bash
git add plugins/git-workspace/lib/routing.js plugins/git-workspace/lib/sessions.js plugins/git-workspace/lib/index.js plugins/git-workspace/selftest.freestyle-routing.mjs
git commit -m "feat: add the freestyle routing kind that binds a session to the nearest enclosing repo and lets a root session mint"
```

### Task 3: `arxa-freestyle` plugin — paths and roots registry

**Files:**
- Create: `plugins/arxa-freestyle/package.json`, `lib/paths.js`, `lib/roots.js`
- Test: `plugins/arxa-freestyle/selftest.mjs`

**Interfaces:**
- Produces (`paths.js`): `arxaHome(env)`, `registryPath(env)`, `manifestPath(root)`, `trashDir(root)`, `resolveInside(root, relPath) → { abs, rel }` (throws `Error('outside-root')` / `Error('reserved')`).
- Produces (`roots.js`): `readRegistry(env) → { roots, ui }`, `writeRegistry(reg, env)` (atomic tmp+rename), `listRoots(env)`, `rootById(id, env)`, `addRoot(absPath, { env, name }) → root`, `newRoot(parentAbs, name, { env }) → root`, `openRoot(id, env)`, `closeRoot(id, env)`, `forgetRoot(id, env)` (registry only, never deletes), `renameRoot(id, name, env)`, `readManifest(root)`, `writeManifest(root, patch)`.

- [x] **Step 1: `package.json`**

```json
{
  "name": "arxa-freestyle",
  "version": "0.1.0",
  "private": true,
  "description": "arxa Freestyle: any folder as a root, VS Code-style file verbs, own trash and archives, sessions through the git-workspace engine (F1-F9, docs/plans/freestyle-section.md). Host half only; the sidebar bundle renders the tab.",
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": "./lib/index.js", "./package.json": "./package.json" }
}
```

- [x] **Step 2: Write the failing test**

```js
#!/usr/bin/env node
// Selftest: arxa-freestyle roots registry (F1, F4, F8) against real git in a temp HOME.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { resolveInside, registryPath, manifestPath } from './lib/paths.js'
import { addRoot, newRoot, listRoots, openRoot, closeRoot, forgetRoot, renameRoot, readManifest, rootById } from './lib/roots.js'
import { isRepo, hasHead } from '../git-workspace/lib/repos.js'
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-'))
const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }

const folder = path.join(tmp, 'Scratch'); fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'a.txt'), 'a')
const r = addRoot(folder, { env })
ok(r.id && r.name === 'Scratch' && r.path === folder && r.open === true, 'addRoot registers, names from the folder, opens')
ok(isRepo(folder) && hasHead(folder), 'addRoot inits a repo on main (F4)')
ok(fs.existsSync(path.join(folder, 'check.sh')) && !fs.existsSync(path.join(folder, '.github')), 'addRoot writes check.sh only (F8)')
ok(readManifest(r).kind === 'freestyle' && readManifest(r).localOnly === true, 'manifest at <root>/.arxa/freestyle.json')
ok(fs.existsSync(registryPath(env)), 'registry at ~/.arxa/freestyle.json')
ok(addRoot(folder, { env }).id === r.id && listRoots(env).length === 1, 'adding the same folder twice is idempotent')

const r2 = newRoot(tmp, 'Fresh', { env })
ok(fs.existsSync(path.join(tmp, 'Fresh')) && isRepo(r2.path) && listRoots(env).length === 2, 'newRoot mkdirs then adds')
assert.throws(() => newRoot(tmp, 'Fresh', { env }), /exists/); ok(true, 'newRoot refuses an existing folder')

closeRoot(r.id, env); ok(rootById(r.id, env).open === false, 'closeRoot flips open')
openRoot(r.id, env); ok(rootById(r.id, env).open === true && rootById(r.id, env).lastOpenedAt, 'openRoot flips open and stamps')
renameRoot(r.id, 'Notes', env); ok(rootById(r.id, env).name === 'Notes' && readManifest(rootById(r.id, env)).name === 'Notes' && path.basename(rootById(r.id, env).path) === 'Scratch', 'rename is display-only, folder untouched')
forgetRoot(r.id, env); ok(!rootById(r.id, env) && fs.existsSync(folder), 'forget drops the row and never deletes the folder')

ok(resolveInside(folder, 'docs/x.md').abs === path.join(folder, 'docs', 'x.md'), 'resolveInside keeps a normal path')
for (const bad of ['../x', '/etc/passwd', '.git/config', '.arxa/freestyle.json', 'a/../../b']) { assert.throws(() => resolveInside(folder, bad)); }
ok(true, 'resolveInside rejects escapes and reserved dirs')
console.log('GREEN arxa-freestyle roots (' + n + ')')
```

- [x] **Step 3: Run to verify it fails** — `node plugins/arxa-freestyle/selftest.mjs` → cannot find module.

- [x] **Step 4: Implement `lib/paths.js`**

```js
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'
export const RESERVED = ['.git', '.arxa']
export function arxaHome(env = process.env) { return env.ARXA_HOME || path.join(os.homedir(), '.arxa') }
export function registryPath(env = process.env) { return path.join(arxaHome(env), 'freestyle.json') }
export function manifestPath(rootPath) { return path.join(rootPath, '.arxa', 'freestyle.json') }
export function trashDir(rootPath) { return path.join(rootPath, '.arxa', 'trash') }
/** Confine relPath inside rootPath (realpath on the deepest existing ancestor), refuse reserved dirs. */
export function resolveInside(rootPath, relPath) {
  if (typeof relPath !== 'string' || path.isAbsolute(relPath)) throw new Error('outside-root: absolute or missing path')
  const rootReal = fs.realpathSync(rootPath)
  const abs = path.resolve(rootReal, relPath)
  const rel = path.relative(rootReal, abs)
  if (rel === '' ? false : (rel.startsWith('..') || path.isAbsolute(rel))) throw new Error('outside-root: ' + relPath)
  const first = rel.split(path.sep)[0]
  if (RESERVED.includes(first)) throw new Error('reserved: ' + first + '/ is studio state')
  // symlink escape: realpath the deepest existing ancestor and re-check
  let probe = abs; while (!fs.existsSync(probe)) probe = path.dirname(probe)
  const probeReal = fs.realpathSync(probe)
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) throw new Error('outside-root: symlink escape')
  return { abs, rel: rel.split(path.sep).join('/') }
}
```

Check how `arxaHome` is defined in `plugins/artifact-viewer/lib/follow.js` (it is imported there) and match its env variable name exactly; if that one lives in a shared module, import it instead of redefining.

- [x] **Step 5: Implement `lib/roots.js`**

```js
import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto'
import { registryPath, manifestPath } from './paths.js'
import { initPlainRepo } from '../../git-workspace/lib/repos.js'
import { writeFrameFiles } from '../../git-workspace/lib/frame.js'

const EMPTY = () => ({ roots: [], ui: { activeTab: 'org' } })
export function readRegistry(env = process.env) {
  try { const j = JSON.parse(fs.readFileSync(registryPath(env), 'utf8')); return { roots: j.roots || [], ui: { activeTab: 'org', ...(j.ui || {}) } } } catch { return EMPTY() }
}
export function writeRegistry(reg, env = process.env) {
  const p = registryPath(env); fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n'); fs.renameSync(tmp, p)
}
export function listRoots(env = process.env) { return readRegistry(env).roots }
export function rootById(id, env = process.env) { return listRoots(env).find((r) => r.id === id) || null }
export function readManifest(root) { try { return JSON.parse(fs.readFileSync(manifestPath(root.path), 'utf8')) } catch { return null } }
export function writeManifest(root, patch) {
  const p = manifestPath(root.path); fs.mkdirSync(path.dirname(p), { recursive: true })
  const cur = readManifest(root) || { id: root.id, kind: 'freestyle', name: root.name, createdAt: new Date().toISOString(), localOnly: true, repoOwner: null, repoName: null, repoUrl: null }
  const next = { ...cur, ...patch }; fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n'); return next
}
function mutate(env, fn) { const reg = readRegistry(env); const out = fn(reg); writeRegistry(reg, env); return out }

/** F1+F4+F8: register a folder, adopt or init its repo, write manifest and check.sh. Idempotent on path. */
export function addRoot(absPath, { env = process.env, name } = {}) {
  const real = fs.realpathSync(absPath)
  if (!fs.statSync(real).isDirectory()) throw new Error('not-a-directory: ' + absPath)
  return mutate(env, (reg) => {
    let row = reg.roots.find((r) => r.path === real)
    if (!row) {
      row = { id: randomUUID(), name: name || path.basename(real), path: real, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: true }
      reg.roots.push(row)
    }
    initPlainRepo(real, env)
    const existing = readManifest(row); if (existing?.id) row.id = existing.id
    writeManifest(row, { name: row.name })
    writeFrameFiles(real, 'freestyle')
    return row
  })
}
export function newRoot(parentAbs, name, { env = process.env } = {}) {
  const target = path.join(parentAbs, name)
  if (fs.existsSync(target)) throw new Error('exists: ' + target)
  fs.mkdirSync(target, { recursive: true })
  return addRoot(target, { env, name })
}
export function openRoot(id, env = process.env) { return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = true; r.lastOpenedAt = new Date().toISOString(); return r }) }
export function closeRoot(id, env = process.env) { return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = false; return r }) }
export function forgetRoot(id, env = process.env) { return mutate(env, (reg) => { const i = reg.roots.findIndex((x) => x.id === id); if (i < 0) throw new Error('unknown-root'); const [r] = reg.roots.splice(i, 1); return r }) }
export function renameRoot(id, name, env = process.env) {
  const clean = String(name || '').trim(); if (!clean) throw new Error('name-required')
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.name = clean; writeManifest(r, { name: clean }); return r })
}
export function setActiveTab(tab, env = process.env) { if (tab !== 'org' && tab !== 'freestyle') throw new Error('bad-tab'); return mutate(env, (reg) => { reg.ui.activeTab = tab; return reg.ui }) }
```

`writeFrameFiles` writes `check.sh` into the working tree; the `initPlainRepo` first commit ran before it, so `check.sh` shows as untracked until the first `wipCommit`. Make `addRoot` end with `wipCommit(real, { message: 'chore: arxa freestyle frame', env })` from `../../git-workspace/lib/commits.js` so a fresh root is clean.

- [x] **Step 6: Run** — `node plugins/arxa-freestyle/selftest.mjs` → GREEN.

- [x] **Step 7: Commit**

```bash
git add plugins/arxa-freestyle
git commit -m "feat: add the arxa-freestyle plugin roots registry with repo adoption, manifest and local gate"
```

### Task 4: File verbs and Freestyle trash

**Files:**
- Create: `plugins/arxa-freestyle/lib/files.js`
- Test: `plugins/arxa-freestyle/selftest.files.mjs`

**Interfaces:**
- Produces: `createFile(root, relPath, { env }) → { rel }`, `createDir(root, relPath)`, `renameEntry(root, relPath, newName) → { rel }`, `moveEntry(root, relPath, toDir) → { rel }`, `duplicateEntry(root, relPath) → { rel }` (`name copy.ext`, `name copy 2.ext` …), `trashEntry(root, relPath) → entry`, `listTrash(root) → entry[]`, `restoreEntry(root, entryId) → { rel }` (restores to original path, or `<name> (restored)` if occupied), `purgeEntry(root, entryId)`, `revealEntry(root, relPath)` (macOS `open -R`, Linux `xdg-open <dir>`, returns `{ ok }`), `listDir(root, relDir) → { dirs, files }` (hides `.git`, `.arxa`).
- Every mutation calls `wipCommit(repoPath, { message: '<verb> <rel>' })` where `repoPath` is `resolveFreestyleRepo(root.path, relDir, { requireHead: false }).repoPath` so nested repos commit in the right place.

- [x] **Step 1: Write the failing test**

```js
#!/usr/bin/env node
// Selftest: Freestyle file verbs + trash (F6, F9). Real repo, every verb leaves a commit.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createFile, createDir, renameEntry, moveEntry, duplicateEntry, trashEntry, listTrash, restoreEntry, purgeEntry, listDir } from './lib/files.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-')); const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const folder = path.join(tmp, 'R'); fs.mkdirSync(folder); const root = addRoot(folder, { env })
const clean = () => git(folder, 'status', '--porcelain') === ''
const head = () => git(folder, 'rev-parse', 'HEAD')

let h = head()
createDir(root, 'docs', { env }); ok(fs.statSync(path.join(folder, 'docs')).isDirectory(), 'createDir')
createFile(root, 'docs/a.md', { env }); ok(fs.readFileSync(path.join(folder, 'docs/a.md'), 'utf8') === '' && clean() && head() !== h, 'createFile is empty and auto-committed')
assert.throws(() => createFile(root, 'docs/a.md', { env }), /exists/); ok(true, 'createFile refuses to clobber')
h = head(); renameEntry(root, 'docs/a.md', 'b.md', { env }); ok(fs.existsSync(path.join(folder, 'docs/b.md')) && !fs.existsSync(path.join(folder, 'docs/a.md')) && clean() && head() !== h, 'rename in place, committed')
assert.throws(() => renameEntry(root, 'docs/b.md', '../x.md', { env })); ok(true, 'rename cannot escape its folder')
createDir(root, 'archive', { env }); h = head(); moveEntry(root, 'docs/b.md', 'archive', { env }); ok(fs.existsSync(path.join(folder, 'archive/b.md')) && clean() && head() !== h, 'move, committed')
assert.throws(() => moveEntry(root, 'archive', 'archive', { env }), /into itself/); ok(true, 'cannot move a folder into itself')
const d1 = duplicateEntry(root, 'archive/b.md', { env }); const d2 = duplicateEntry(root, 'archive/b.md', { env })
ok(d1.rel === 'archive/b copy.md' && d2.rel === 'archive/b copy 2.md' && clean(), 'duplicate names like Finder')
const e = trashEntry(root, 'archive/b copy.md', { env })
ok(!fs.existsSync(path.join(folder, 'archive/b copy.md')) && fs.existsSync(path.join(folder, '.arxa/trash', e.id, 'b copy.md')) && listTrash(root).length === 1 && clean(), 'trash moves into .arxa/trash and commits the removal')
restoreEntry(root, e.id, { env }); ok(fs.existsSync(path.join(folder, 'archive/b copy.md')) && listTrash(root).length === 0, 'restore puts it back')
const e2 = trashEntry(root, 'archive', { env }); ok(listTrash(root)[0].kind === 'dir', 'folders trash too')
purgeEntry(root, e2.id, { env }); ok(listTrash(root).length === 0 && !fs.existsSync(path.join(folder, '.arxa/trash', e2.id)), 'purge is final')
const ls = listDir(root, '', { env }); ok(ls.dirs.includes('docs') && !ls.dirs.includes('.arxa') && !ls.dirs.includes('.git'), 'listDir hides studio state')
for (const bad of ['.git/HEAD', '.arxa/freestyle.json', '../x']) assert.throws(() => createFile(root, bad, { env })); ok(true, 'verbs refuse reserved and escaping paths')
console.log('GREEN arxa-freestyle files (' + n + ')')
```

- [x] **Step 2: Run to verify it fails** — module not found.

- [x] **Step 3: Implement `lib/files.js`**

```js
import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveInside, trashDir, RESERVED } from './paths.js'
import { resolveFreestyleRepo } from '../../git-workspace/lib/routing.js'
import { wipCommit } from '../../git-workspace/lib/commits.js'

function repoOf(root, rel, env) { return resolveFreestyleRepo(root.path, path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), { env, requireHead: false }).repoPath }
function commit(root, rel, verb, env) { wipCommit(repoOf(root, rel, env), { message: `chore: ${verb} ${rel}`, env }) }
function mustNotExist(abs) { if (fs.existsSync(abs)) throw new Error('exists: ' + abs) }

export function createFile(root, relPath, { env = process.env } = {}) {
  const { abs, rel } = resolveInside(root.path, relPath); mustNotExist(abs)
  fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ''); commit(root, rel, 'create', env); return { rel }
}
export function createDir(root, relPath, { env = process.env } = {}) {
  const { abs, rel } = resolveInside(root.path, relPath); mustNotExist(abs)
  fs.mkdirSync(abs, { recursive: true }); fs.writeFileSync(path.join(abs, '.gitkeep'), ''); commit(root, rel, 'mkdir', env); return { rel }
}
export function renameEntry(root, relPath, newName, { env = process.env } = {}) {
  if (typeof newName !== 'string' || newName.includes('/') || newName.includes('\\') || newName === '' || newName === '.' || newName === '..') throw new Error('bad-name')
  const from = resolveInside(root.path, relPath); const to = resolveInside(root.path, path.posix.join(path.posix.dirname(from.rel), newName)); mustNotExist(to.abs)
  fs.renameSync(from.abs, to.abs); commit(root, to.rel, 'rename ' + from.rel + ' ->', env); return { rel: to.rel }
}
export function moveEntry(root, relPath, toDir, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); const dir = resolveInside(root.path, toDir || '')
  if (dir.rel === from.rel || dir.rel.startsWith(from.rel + '/')) throw new Error('cannot move a folder into itself')
  const to = resolveInside(root.path, path.posix.join(dir.rel, path.posix.basename(from.rel))); mustNotExist(to.abs)
  fs.renameSync(from.abs, to.abs); commit(root, to.rel, 'move ' + from.rel + ' ->', env); return { rel: to.rel }
}
export function duplicateEntry(root, relPath, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); const ext = path.posix.extname(from.rel); const stem = from.rel.slice(0, from.rel.length - ext.length)
  let i = 1, cand; do { cand = stem + (i === 1 ? ' copy' : ' copy ' + i) + ext; i++ } while (fs.existsSync(path.join(root.path, cand)))
  const to = resolveInside(root.path, cand); fs.cpSync(from.abs, to.abs, { recursive: true }); commit(root, to.rel, 'duplicate', env); return { rel: to.rel }
}
export function trashEntry(root, relPath, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); if (!fs.existsSync(from.abs)) throw new Error('missing: ' + relPath)
  const id = randomUUID(); const dir = path.join(trashDir(root.path), id); fs.mkdirSync(dir, { recursive: true })
  const entry = { id, relPath: from.rel, name: path.posix.basename(from.rel), kind: fs.statSync(from.abs).isDirectory() ? 'dir' : 'file', trashedAt: new Date().toISOString() }
  fs.renameSync(from.abs, path.join(dir, entry.name)); fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(entry, null, 2))
  commit(root, from.rel, 'trash', env); return entry
}
export function listTrash(root) {
  const d = trashDir(root.path); if (!fs.existsSync(d)) return []
  return fs.readdirSync(d).flatMap((id) => { try { return [JSON.parse(fs.readFileSync(path.join(d, id, 'entry.json'), 'utf8'))] } catch { return [] } }).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt))
}
export function restoreEntry(root, entryId, { env = process.env } = {}) {
  const e = listTrash(root).find((x) => x.id === entryId); if (!e) throw new Error('unknown-entry')
  let target = resolveInside(root.path, e.relPath)
  if (fs.existsSync(target.abs)) { const ext = path.posix.extname(e.relPath); target = resolveInside(root.path, e.relPath.slice(0, e.relPath.length - ext.length) + ' (restored)' + ext) }
  fs.mkdirSync(path.dirname(target.abs), { recursive: true }); fs.renameSync(path.join(trashDir(root.path), entryId, e.name), target.abs)
  fs.rmSync(path.join(trashDir(root.path), entryId), { recursive: true, force: true }); commit(root, target.rel, 'restore', env); return { rel: target.rel }
}
export function purgeEntry(root, entryId) { const d = path.join(trashDir(root.path), entryId); if (!fs.existsSync(path.join(d, 'entry.json'))) throw new Error('unknown-entry'); fs.rmSync(d, { recursive: true, force: true }); return { ok: true } }
export function revealEntry(root, relPath) {
  const { abs } = resolveInside(root.path, relPath)
  const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', abs]] : ['xdg-open', [fs.statSync(abs).isDirectory() ? abs : path.dirname(abs)]]
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); return { ok: true } } catch (e) { return { ok: false, reason: String(e.message) } }
}
export function listDir(root, relDir = '') {
  const { abs } = resolveInside(root.path, relDir || ''); const dirs = [], files = []
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) { if (RESERVED.includes(d.name)) continue; (d.isDirectory() ? dirs : files).push(d.name) }
  dirs.sort(); files.sort(); return { dirs, files }
}
```

Note `resolveInside` in Task 3 must accept `''` (the root itself) and return `{ abs: root, rel: '' }`; the Task 3 code handles `rel === ''` for that reason.

- [x] **Step 4: Run** — `node plugins/arxa-freestyle/selftest.files.mjs` → GREEN.

- [x] **Step 5: Commit**

```bash
git add plugins/arxa-freestyle/lib/files.js plugins/arxa-freestyle/selftest.files.mjs
git commit -m "feat: add Freestyle file verbs with root-confined paths, auto WIP commits and a per-root trash"
```

### Task 5: Freestyle sessions and archives through the engine

**Files:**
- Create: `plugins/arxa-freestyle/lib/sessions.js`
- Test: `plugins/arxa-freestyle/selftest.sessions.mjs`

**Interfaces:**
- Consumes: `resolveFreestyleRepo`, `mintSessionPath`, `openSession`, `archiveSession`, `finishSession`, `sweepMerged`, `listSessions`-style readers from `git-workspace/lib/sessions.js` (read the exports list at `sessions.js:428-780` and `finish.js:81` first; use the real names), and the dsh bridge factory that `plugins/file-org-shell/lib/index.js` builds for `createOrgLifecycle` (grep `dsh-bridge` there for the export name and constructor arguments and reuse it verbatim).
- Produces: `createFreestyleSessions({ env, dshBridge })` → `{ newSession(root, relDir, name), list(root) → { active, parked, archived }, archive(root, id), revive(root, id), trashArchived(root, id), finish(root, id), sweep(root, { dryRun }) }`. `newSession` returns the annotated session row `{ id, name, branch, worktree, cwd, repoPath, dshSessionId | null, dshStatus }`.

- [x] **Step 1: Write the failing test** (dsh bridge stubbed: `{ spawn: async ({ cwd, name, id }) => ({ ok: true, id: 'dsh-' + id, cwd }), list: async () => [] }`)

```js
#!/usr/bin/env node
// Selftest: Freestyle sessions (F5) — any folder, worktree of the enclosing repo, cwd inside it.
import assert from 'node:assert/strict'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { addRoot } from './lib/roots.js'
import { createDir } from './lib/files.js'
import { createFreestyleSessions } from './lib/sessions.js'
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok', n, '-', m) }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fs-')); const env = { ...process.env, ARXA_HOME: path.join(tmp, 'home') }
const root = addRoot((() => { const p = path.join(tmp, 'R'); fs.mkdirSync(p); return p })(), { env })
const spawned = []; const dshBridge = { spawn: async (a) => { spawned.push(a); return { ok: true, id: 'dsh-' + a.id } }, list: async () => [] }
const S = createFreestyleSessions({ env, dshBridge })

const s1 = await S.newSession(root, '', 'scratch')
ok(s1.worktree === path.join(root.path, '.arxa', 'worktrees', s1.id) && s1.cwd === s1.worktree, 'root session: worktree under the root, cwd = worktree')
ok(spawned[0].cwd === s1.cwd && spawned[0].id === s1.id, 'dsh spawned in the worktree')
createDir(root, 'docs/deep', { env })
const s2 = await S.newSession(root, 'docs/deep', 'write')
ok(s2.cwd === path.join(s2.worktree, 'docs', 'deep') && fs.existsSync(s2.cwd), 'folder session: cwd is the folder inside the worktree')
ok(/^R\/docs\/deep\/write-wt-/.test(s2.id), 'identity mirrors the disk path: ' + s2.id)
const l = S.list(root); ok(l.active.length === 2 && l.archived.length === 0, 'list sees two active')
fs.writeFileSync(path.join(s2.cwd, 'x.md'), 'x'); git(s2.worktree, 'add', '-A'); git(s2.worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'feat: x')
const a = await S.archive(root, s2.id)
ok(!fs.existsSync(s2.worktree) && S.list(root).archived.length === 1, 'archive removes the worktree and parks/merges per D39')
await S.revive(root, s2.id); ok(fs.existsSync(path.join(root.path, '.arxa', 'worktrees', s2.id)) && S.list(root).archived.length === 0, 'revive rebuilds the worktree')
assert.rejects(S.newSession(root, '../out', 'nope'), /outside-root/); ok(true, 'escaping relDir refuses')
console.log('GREEN arxa-freestyle sessions (' + n + ')')
```

- [x] **Step 2: Run to verify it fails** — module not found.

- [x] **Step 3: Implement `lib/sessions.js`**

Follow `lifecycle.newSession` (`file-org-shell/lib/lifecycle.js:1246-1392`) step for step, replacing the dock validation with `resolveFreestyleRepo` and the workspace key with `relDir`:

```js
import fs from 'node:fs'; import path from 'node:path'
import { resolveFreestyleRepo } from '../../git-workspace/lib/routing.js'
import * as GW from '../../git-workspace/lib/sessions.js'
import * as FIN from '../../git-workspace/lib/finish.js'

export function createFreestyleSessions({ env = process.env, dshBridge }) {
  const registry = (repoPath) => GW.readSessions ? GW.readSessions(repoPath, env) : GW.listSessions(repoPath, env) // use the real reader name from sessions.js
  return {
    async newSession(root, relDir = '', name) {
      const route = resolveFreestyleRepo(root.path, relDir, { env })
      const id = GW.mintSessionPath({ org: path.basename(root.path), workspace: (relDir || '').replace(/\/+$/, ''), name, sessions: registry(route.repoPath), ghosts: [] })
      const session = GW.openSession(route.repoPath, { id, orgPath: root.path, name: name?.trim() || undefined, workspace: relDir || '', env })
      const cwd = path.join(session.worktree, route.cwdRel); fs.mkdirSync(cwd, { recursive: true })
      const spawned = await dshBridge.spawn({ cwd, name: session.name, id: session.id })
      return { ...session, cwd, repoPath: route.repoPath, dshSessionId: spawned.ok ? spawned.id : null, dshStatus: spawned.ok ? 'live' : (spawned.reason || 'spawn-failed') }
    },
    list(root) { /* aggregate registry(root.path) plus registry() of every nested repo that has rows; split by state active|parked|archived exactly as lifecycle.parkedSessions/activeSessions do */ },
    archive(root, id) { return GW.archiveSession(repoOfSession(root, id), id, { env }) },
    revive(root, id) { return GW.reviveSession ? GW.reviveSession(repoOfSession(root, id), id, { env }) : GW.openSession(repoOfSession(root, id), { id, orgPath: root.path, workspace: '', env }) },
    trashArchived(root, id) { return GW.removeSessionRow(repoOfSession(root, id), id, env) },
    finish(root, id, { dryRun = false } = {}) { return FIN.finishSession(repoOfSession(root, id), id, { env, dryRun }) },
    sweep(root, { dryRun = true } = {}) { return FIN.sweepMerged(root.path, { env, dryRun }) },
  }
  function repoOfSession(root, id) { /* find which registry (root or nested repo) holds id; throw 'unknown-session' */ }
}
```

The two comment bodies are the only judgement calls: implement `list` and `repoOfSession` by reading `lifecycle.js:1098-1131` (`projects/parkedSessions/activeSessions`) and `git-workspace/lib/index.js` `listSessionsAcrossRepos` (D115) and copying their aggregation over `[root.path, ...nestedRepos(root.path)]`, where `nestedRepos` walks the root (skipping `.git`, `.arxa`, `node_modules`) for directories with a `.git`. Replace every `GW.x ? … : …` above with the single real export once you have read the file; do not leave the ternaries.

- [x] **Step 4: Run** — `node plugins/arxa-freestyle/selftest.sessions.mjs` → GREEN.

- [x] **Step 5: Commit**

```bash
git add plugins/arxa-freestyle/lib/sessions.js plugins/arxa-freestyle/selftest.sessions.mjs
git commit -m "feat: wire Freestyle sessions through the git-workspace engine with any-folder cwd inside the enclosing repo worktree"
```

### Task 6: HTTP routes, action table and plugin registration

**Files:**
- Create: `plugins/arxa-freestyle/lib/index.js`
- Modify: `profile/cordis.patch.yml` (insert after the `arxa-sidebar` row at ~234), `bin/arxa-studio.mjs` (`:145` dir constants, `:197` copy list, `:390` `BY_NAME_PLUGINS`)
- Test: `plugins/arxa-freestyle/selftest.actions.mjs`

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `GET /__arxa/freestyle/state`, `POST /__arxa/freestyle/action` exactly as section 3. Reuses the folder picker route the sidebar already has (`/__arxa/sidebar/pick-folder`, `arxa-sidebar/lib/index.js:944-968`) for *Open Folder*: the client calls it, then posts `root.add {path}`.

- [x] **Step 1: Write the failing test** — construct a fake `ctx` whose `webServer.register({ name, path, kind, handler })` stores handlers, then call them with minimal `req`/`res` doubles. Read `arxa-sidebar/selftest.actions.mjs` for the exact fake shapes (`json(res, …)`, `params(req)`, body reading) and copy its helpers. Assert:

```js
// state before any root: { roots: [], trash: [], ui: { activeTab: 'org' } }
// action root.add {path} → { ok:true, root:{...} } and state.roots.length === 1 with isRepo/hasHead true
// action file.create {rootId, relPath:'a.md'} → ok; entry.trash → ok; state.trash.length === 1; trash.restore → ok
// action ui.tab {tab:'freestyle'} → state.ui.activeTab === 'freestyle'; {tab:'nope'} → { ok:false, error:/bad-tab/ }
// action nope.verb → { ok:false, error:/unknown action/ }; action entry.trash {rootId:'x'} → { ok:false, error:/unknown-root/ }
// action session.new with the dsh bridge stubbed (inject via apply(ctx, { dshBridge })) → ok and state.roots[0].sessions.length === 1
```

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Implement `lib/index.js`**

Mirror `arxa-sidebar/lib/index.js:1036-1060` for route registration and body parsing (copy its `readBody`, `json`, `params` helpers or import them if they are exported). Shape:

```js
export const inject = ['webServer']
export const name = 'arxa-freestyle'
export function apply(ctx, opts = {}) {
  const env = opts.env || process.env
  const dshBridge = opts.dshBridge || makeDshBridge(ctx)   // same factory file-org-shell uses (Task 5)
  const S = createFreestyleSessions({ env, dshBridge })
  const rootOr = (id) => { const r = rootById(id, env); if (!r) throw new Error('unknown-root: ' + id); return r }
  const state = () => {
    const reg = readRegistry(env)
    const roots = reg.roots.map((r) => ({ ...r, isRepo: isRepo(r.path), hasHead: isRepo(r.path) && hasHead(r.path), sessions: r.open ? S.list(r) : { active: [], parked: [], archived: [] }, trashCount: listTrash(r).length }))
    const trash = roots.flatMap((r) => listTrash(r).map((e) => ({ ...e, rootId: r.id })))
    return { roots, trash, ui: reg.ui }
  }
  const ACTIONS = {
    'root.add': ({ path: p }) => ({ root: addRoot(p, { env }) }),
    'root.new': ({ parent, name }) => ({ root: newRoot(parent, name, { env }) }),
    'root.open': ({ rootId }) => ({ root: openRoot(rootId, env) }),
    'root.close': ({ rootId }) => ({ root: closeRoot(rootId, env) }),
    'root.forget': ({ rootId }) => ({ root: forgetRoot(rootId, env) }),
    'root.rename': ({ rootId, name }) => ({ root: renameRoot(rootId, name, env) }),
    'file.create': ({ rootId, relPath }) => createFile(rootOr(rootId), relPath, { env }),
    'dir.create': ({ rootId, relPath }) => createDir(rootOr(rootId), relPath, { env }),
    'entry.rename': ({ rootId, relPath, name }) => renameEntry(rootOr(rootId), relPath, name, { env }),
    'entry.move': ({ rootId, relPath, toDir }) => moveEntry(rootOr(rootId), relPath, toDir, { env }),
    'entry.duplicate': ({ rootId, relPath }) => duplicateEntry(rootOr(rootId), relPath, { env }),
    'entry.trash': ({ rootId, relPath }) => ({ entry: trashEntry(rootOr(rootId), relPath, { env }) }),
    'entry.reveal': ({ rootId, relPath }) => revealEntry(rootOr(rootId), relPath),
    'trash.restore': ({ rootId, entryId }) => restoreEntry(rootOr(rootId), entryId, { env }),
    'trash.purge': ({ rootId, entryId }) => purgeEntry(rootOr(rootId), entryId),
    'session.new': ({ rootId, relDir, name }) => S.newSession(rootOr(rootId), relDir || '', name),
    'session.archive': ({ rootId, id }) => S.archive(rootOr(rootId), id),
    'archive.revive': ({ rootId, id }) => S.revive(rootOr(rootId), id),
    'archive.trash': ({ rootId, id }) => S.trashArchived(rootOr(rootId), id),
    'session.finish': ({ rootId, id, dryRun }) => S.finish(rootOr(rootId), id, { dryRun: !!dryRun }),
    'session.sweep': ({ rootId, dryRun }) => S.sweep(rootOr(rootId), { dryRun: dryRun !== false }),
    'ui.tab': ({ tab }) => ({ ui: setActiveTab(tab, env) }),
  }
  ctx.webServer.register({ name: 'arxa-freestyle-state', path: '/__arxa/freestyle/state', kind: 'exact', handler: async (req, res) => { try { json(res, state()) } catch (e) { json(res, { roots: [], trash: [], ui: { activeTab: 'org' }, error: String(e?.message ?? e) }) } } })
  ctx.webServer.register({ name: 'arxa-freestyle-action', path: '/__arxa/freestyle/action', kind: 'exact', handler: async (req, res) => {
    try { const { action, arg } = await readBody(req); const fn = ACTIONS[action]; if (!fn) throw new Error('unknown action: ' + action); const out = await fn(arg || {}); json(res, { ok: true, ...out }) }
    catch (e) { json(res, { ok: false, error: String(e?.message ?? e) }) }
  } })
}
```

Every action that changes the tree must end with the tree refresh the viewer watcher already provides (Task 8 makes the watcher root-aware), so no extra event plumbing here.

- [x] **Step 4: Register the plugin**

In `profile/cordis.patch.yml`, directly after the `arxa-sidebar` row (line ~234), add a row shaped exactly like `arxa-git-card`'s (line ~246) with `id: arxa-freestyle` and the same `name:` path convention. In `bin/arxa-studio.mjs` add `const freestyleDir = resolve(here, '..', 'plugins', 'arxa-freestyle')` beside `gitCardDir` (`:145`), `['arxa-freestyle', freestyleDir]` in the copy list (`:197`), and `'arxa-freestyle'` in `BY_NAME_PLUGINS` (`:390`).

- [x] **Step 5: Run** — `node plugins/arxa-freestyle/selftest.actions.mjs && node scripts/preset-check.mjs && node scripts/pack-list-check.mjs`
Expected: GREEN, preset check passes with the new row, pack list includes the plugin.

- [x] **Step 6: Commit**

```bash
git add plugins/arxa-freestyle/lib/index.js plugins/arxa-freestyle/selftest.actions.mjs profile/cordis.patch.yml bin/arxa-studio.mjs
git commit -m "feat: expose Freestyle state and action routes and register the arxa-freestyle plugin in the studio composition"
```

### Task 7: Generic seat manifest in the git card and the sidebar gate

**Files:**
- Modify: `plugins/arxa-git-card/lib/index.js` (`repoFor` `:417-420`, `card.status` `:495-630`)
- Modify: `plugins/arxa-sidebar/lib/index.js` (`mainChecksFor` `:211`, the new-session gate that reads `project.json`/`org.json`)
- Test: `plugins/arxa-git-card/selftest.seat-manifest.mjs`

**Interfaces:**
- Produces: `seatManifest(repoPath, fallbackOrgPath = null) → { manifest, kind: 'freestyle'|'project'|'org'|null, file }` exported from a new small module `plugins/git-workspace/lib/manifest-seat.js` (so both plugins import one resolver). Order: `<repoPath>/.arxa/freestyle.json` → `<repoPath>/project.json` → `<repoPath>/org.json` → `<fallbackOrgPath>/org.json`.

- [x] **Step 1: Write the failing test** — three temp dirs with one manifest each plus a dir with none; assert kind and that the freestyle manifest wins when both `.arxa/freestyle.json` and a stray `project.json` exist (a project inside a Freestyle root is still a Freestyle seat), and that `card.status` for a Freestyle session reports `linked:false, localOnly:true, kind:'freestyle'` with the same `seat.branch` shape as today. Drive `card.status` the way `plugins/arxa-git-card/selftest.mjs` does (read its fake handle setup and reuse it).

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Implement `manifest-seat.js`, then replace the two hard-coded reads**

```js
import fs from 'node:fs'; import path from 'node:path'
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
export function seatManifest(repoPath, fallbackOrgPath = null) {
  const tries = [[path.join(repoPath, '.arxa', 'freestyle.json'), 'freestyle'], [path.join(repoPath, 'project.json'), 'project'], [path.join(repoPath, 'org.json'), 'org']]
  if (fallbackOrgPath) tries.push([path.join(fallbackOrgPath, 'org.json'), 'org'])
  for (const [file, kind] of tries) { const m = read(file); if (m) return { manifest: m, kind, file } }
  return { manifest: null, kind: null, file: null }
}
```

In `repoFor(s)` return `seatManifest(s.repoPath, handle().path).manifest`. In `card.status`, compute `const seat = seatManifest(sessionRow.repoPath, cur.path)` and derive `seatLinked`/`seatLocalOnly` from `seat.manifest` instead of the two `readFileSync` calls; add `kind: seat.kind` to the status payload. In the sidebar, wherever the gate reads `org.json`/`project.json` to decide `mainChecksFor`, call `seatManifest` and pass `.manifest`. Behaviour for org and project seats must be byte-identical: run `plugins/arxa-git-card/selftest*.mjs` and `plugins/arxa-sidebar/selftest*.mjs` unchanged.

- [x] **Step 4: Run** — `node plugins/arxa-git-card/selftest.seat-manifest.mjs && node scripts/ci.mjs` → GREEN.

- [x] **Step 5: Commit**

```bash
git add plugins/git-workspace/lib/manifest-seat.js plugins/arxa-git-card plugins/arxa-sidebar/lib/index.js
git commit -m "feat: resolve a seat's manifest generically so the git card and the session gate recognise Freestyle roots"
```

### Task 8: Artifact viewer multi-root (follow, tokens, tree, watcher)

**Files:**
- Modify: `plugins/artifact-viewer/lib/follow.js`, `tokens.js`, `wt-api.js` (`createTreeRoute` `:142-175`), `watcher.js` (`setRoot` `:52`), `index.js` (`ensureFollow` `:246-320`)
- Test: `plugins/artifact-viewer/selftest.roots.mjs`

**Interfaces:**
- Produces: `readOpenRoots(env) → [{ id, path, slug, kind: 'org'|'freestyle', name }]` (the open org first if any, then every Freestyle root with `open: true` from `~/.arxa/freestyle.json`); `startRootFollow({ env, createServer, onServing })` keeps one org-server per open root and calls `onServing(roots)`; `GET /__arxa/artifacts/tree?dir=&avt=&root=<id>` lists inside that root (no `root` → open org, unchanged); `POST /__arxa/artifacts/token { scope:'tree-read', rootId }` mints a token whose `orgPath` claim is that root's path; `watcher.setRoots(paths[])`; SSE events carry `rootId`.

- [x] **Step 1: Write the failing test** — temp `ARXA_HOME` with an `organisation.json` holding one org plus a `freestyle.json` with two roots (one closed); assert `readOpenRoots` returns org + the open root only; a fake `createServer` counts calls through `startRootFollow` across two ticks (add a root → one more server; close it → closed); `createTreeRoute` with `root=<id>` returns that root's entries and 403s with a token minted for another root; `watcher.setRoots([a,b])` emits for a file written under `b` with `rootId` of `b`.

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Implement** — keep `readOpenOrg` as-is and add `readOpenRoots` beside it reading `path.join(arxaHome(env), 'freestyle.json')`; generalise `startOrgFollow` into `startRootFollow` (a `Map<path, handle>`; diff wanted vs serving each tick; keep the old function as a one-line wrapper so nothing else breaks). In `tokens.js` no code change beyond a comment: the `orgPath` claim now means "root path". In `wt-api.js` `createTreeRoute`: resolve `rootId` → root via `readOpenRoots`, verify the token against that root's path, `realpathSync` that root. In the token route (`index.js:~104-142`), accept `rootId` in the body and bind `orgPath` to that root's path. `watcher.js`: `setRoots(paths)` creating/closing per path; include `rootId` in the SSE payload (`createEventsRoute`). `index.js` `ensureFollow`: `onServing(roots)` → `watcher.setRoots(roots.map(r => r.path))` and re-point the LSP bridge at the root of the file being opened (the bridge is per-request by `relPath`; add `rootId` to the WS URL query it already builds with `session`).

- [x] **Step 4: Run** — `node plugins/artifact-viewer/selftest.roots.mjs && node plugins/artifact-viewer/selftest.mjs` → GREEN.

- [x] **Step 5: Commit**

```bash
git add plugins/artifact-viewer
git commit -m "feat: let the artifact viewer follow, list and watch every open Freestyle root beside the open org"
```

### Task 9: Artifact viewer root writes and the `rootId` open contract

**Files:**
- Modify: `plugins/artifact-viewer/lib/write-api.js`, `plugins/artifact-viewer/lib/client.js` (`arxa-av-open` ingress `:1838`, `fetchToken` `:647`, tree/read/write fetches, column header)
- Test: `plugins/artifact-viewer/selftest.root-write.mjs`

**Interfaces:**
- Produces: `POST /__arxa/artifacts/write { rootId, relPath, content, expectedMtimeMs? }` with header `x-arxa-write-token` scoped `write` + `rootId` (same token class, `worktreeId` claim carries the rootId string prefixed `root:`); writes atomically into the Freestyle root working tree, refuses `RESERVED`, then `wipCommit(repoOf(relPath), 'editor save <rel>')` using `resolveFreestyleRepo(root, dirname(rel), { requireHead:false })`. Worktree writes are unchanged. `GET /__arxa/artifacts/wt?root=<id>&path=` reads a root file (reuse `resolveInside` from `arxa-freestyle/lib/paths.js`).
- Client: `arxa-av-open` `detail.rootId` is stored beside `sessionId` in the viewer store (`client.js:530-544`); every token/tree/read/write call passes it; the docked column header shows `root.name` from `/__arxa/artifacts/roots` (new tiny GET returning `readOpenRoots`).

- [x] **Step 1: Write the failing test** — real Freestyle root; write through the route with a valid token → file exists, repo clean, HEAD moved; stale `expectedMtimeMs` → 409; `relPath: '.arxa/x'` → 403; token minted for another root → 403.

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Implement** the server half by adding a `rootId` branch before the existing `resolveWorktree` branch in `createWriteApi`, sharing the atomic tmp+rename, 5 MB cap and `expectedMtimeMs` code paths. Client: thread `rootId` through `state`, `fetchToken(relPath, writeFor, rootId)`, the tree/read/write URLs (`&root=` query, `rootId` body field) and render the root name in the column header using the existing header primitive.

- [x] **Step 4: Run** — `node plugins/artifact-viewer/selftest.root-write.mjs` → GREEN; then start the studio (`npm run smoke` then `bin/arxa-studio.mjs` per README) and open a Freestyle root file through the console: `window.dispatchEvent(new CustomEvent('arxa-av-open',{detail:{relPath:'a.md',rootId:'<id>'}}))`; edit; confirm the commit appears in `git log` of the root.

- [x] **Step 5: Commit**

```bash
git add plugins/artifact-viewer
git commit -m "feat: let the artifact viewer open and save files in a Freestyle root with auto WIP commits"
```

### Task 10: Sidebar tabs, Freestyle store and rail icons (generated client)

**Files:**
- Create: `plugins/arxa-sidebar/lib/freestyle-region.snippet.txt`
- Modify: `scripts/gen-workspace.mjs` (new step 9b after the region splice at `:67-72`; region body wrap), `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` (`__ARXA_SIDEBAR__.selectedWorkspace()` `:386`, `ctaReady` `:399`)
- Modify: `scripts/gen-locale.mjs` / the sidebar locale dict (`freestyle.tab.org`, `freestyle.tab.freestyle`, `freestyle.empty`, `freestyle.add.open`, `freestyle.add.new`, `freestyle.menu.*`, `freestyle.trash.*`, `freestyle.archives.*`)
- Test: `plugins/arxa-sidebar/selftest.freestyle.mjs`; regenerate and run `plugins/arxa-sidebar/selftest.mjs` (byte drift)

**Interfaces:**
- Produces (client globals inside the bundle): `createFreestyleStore()` → `{ get(), refresh(), mutate(action, arg), select(rootId, relDir), selected(), setTab(tab) }` polling `GET /__arxa/freestyle/state` on boot and after every mutate, POSTing to `/__arxa/freestyle/action`; `SidebarTabs({ wide, active, onChange })`; `FreestyleBrowser({ wide, expandSidebar })` rendering roots, trash and archives rows (rows filled in Task 11). `window.__ARXA_SIDEBAR__.selectedWorkspace()` returns `{ kind:'freestyle', rootId, relDir }` when `activeTab === 'freestyle'`; `ctaReady` is true when a root row or folder is selected and `hasHead`.

- [x] **Step 1: Write the failing test** — `selftest.freestyle.mjs` loads the generated `client.js` text and asserts: the snippet is spliced once (`__ARXA_FREESTYLE_REGION__` marker appears exactly once), `SidebarTabs` and `FreestyleBrowser` are defined, the stock `sidebar.workspaces` registration is still single (`slots.register` count for that name is 1), and `gen-workspace.mjs` throws if the tab anchor is missing. Also a pure-function test: extract `selectedWorkspace` behaviour by evaluating the store module in a `vm` context with a fake `fetch` (copy the harness `selftest.actions.mjs` or `selftest.header-index.mjs` uses to evaluate snippet functions).

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Write the Freestyle snippet (tabs + store + shell)**

Top of `freestyle-region.snippet.txt` (2-tab indentation to match the region it joins):

```js
		//#region arxa freestyle (F2) — __ARXA_FREESTYLE_REGION__
		function createFreestyleStore() {
			let state = { roots: [], trash: [], ui: { activeTab: "org" }, sel: null, tick: 0 };
			const subs = new Set(); const emit = () => { state = { ...state, tick: state.tick + 1 }; subs.forEach((f) => f()); };
			async function refresh() { try { const r = await fetch("/__arxa/freestyle/state"); const j = await r.json(); state = { ...state, roots: j.roots || [], trash: j.trash || [], ui: j.ui || state.ui }; emit(); } catch { /* keep last */ } }
			async function mutate(action, arg) { const r = await fetch("/__arxa/freestyle/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, arg }) }); const j = await r.json().catch(() => ({ ok: false, error: "bad json" })); await refresh(); if (!j.ok) throw new Error(j.error || action + " failed"); return j; }
			return { get: () => state, subscribe: (f) => { subs.add(f); return () => subs.delete(f); }, refresh, mutate,
				select(rootId, relDir) { state = { ...state, sel: rootId ? { rootId, relDir: relDir || "" } : null }; emit(); },
				selected: () => state.sel, setTab: (tab) => mutate("ui.tab", { tab }) };
		}
		const freestyleStore = createFreestyleStore();
		function useFreestyle() { const [, force] = (0, react.useReducer)((x) => x + 1, 0); (0, react.useEffect)(() => freestyleStore.subscribe(force), []); return freestyleStore.get(); }
		function SidebarTabs({ wide, active, onChange }) {
			const tab = (id, label, Icon) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, { content: label, children:
				(0, react_jsx_runtime.jsxs)("button", { type: "button", role: "tab", "aria-selected": active === id, className: "aXa_fs_tab" + (active === id ? " aXa_fs_tabOn" : ""), onClick: () => onChange(id),
					children: [(0, react_jsx_runtime.jsx)(Icon, { size: 16 }), wide ? (0, react_jsx_runtime.jsx)("span", { children: label }) : null] }) });
			return (0, react_jsx_runtime.jsxs)("div", { role: "tablist", className: "aXa_fs_tabs" + (wide ? "" : " aXa_fs_tabsRail"), children: [
				tab("org", t("freestyle.tab.org"), _deepseek_ai_dsh_client_ui_primitives.IconBuilding16 || _deepseek_ai_dsh_client_ui_primitives.IconFolderClose16),
				tab("freestyle", t("freestyle.tab.freestyle"), _deepseek_ai_dsh_client_ui_primitives.IconFolderClose16) ] });
		}
		//#endregion
```

Use only icon exports that exist: grep `Icon[A-Z][A-Za-z0-9]*16` in `node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/client.js` and pick two; never invent one. CSS for `.aXa_fs_tabs/.aXa_fs_tab/.aXa_fs_tabOn/.aXa_fs_tabsRail` goes into the existing appended `orgCss` string with the pattern from `dsh-client-ui-cordis/lib/client.js:211` (`--dsw-alias-border-l2` bottom border, `--dsw-alias-label-tertiary` inactive, `--dsw-font-xs-13`); the rail variant stacks the two icons vertically, 40px square hit targets.

- [x] **Step 4: Splice in `gen-workspace.mjs`**

After step 9 (`:72`) add step 9b: read `freestyle-region.snippet.txt`, assert `__ARXA_FREESTYLE_REGION__` is absent from `out` and present exactly once after the replace, and insert it directly after the workspace region. Then find the single call site where the region renders `OrgBrowser` (grep `OrgBrowser(` in the generated output and confirm one JSX use) and replace it with:

```js
(0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
	(0, react_jsx_runtime.jsx)(SidebarTabs, { wide, active: useFreestyle().ui.activeTab, onChange: (tab) => { freestyleStore.setTab(tab).catch(() => {}); } }),
	useFreestyle().ui.activeTab === "freestyle" ? (0, react_jsx_runtime.jsx)(FreestyleBrowser, { wide, expandSidebar }) : (0, react_jsx_runtime.jsx)(OrgBrowser, { ...props })
] })
```

Hooks must be called unconditionally: hoist `const fsState = useFreestyle()` to the top of that component and use `fsState.ui.activeTab`. Add the anchor guard (`throw new Error('OrgBrowser render anchor missing — stock shape moved?')`) like every other splice. `FreestyleBrowser` for this task renders the empty state + add menu only (rows arrive in Task 11):

```js
		function FreestyleBrowser({ wide, expandSidebar }) {
			const st = useFreestyle();
			(0, react.useEffect)(() => { void freestyleStore.refresh(); }, []);
			const addOpen = async () => { const r = await fetch("/__arxa/sidebar/pick-folder", { method: "POST" }); const j = await r.json().catch(() => ({})); if (j.path) await freestyleStore.mutate("root.add", { path: j.path }); };
			const addNew = async () => { const parent = await fetch("/__arxa/sidebar/pick-folder", { method: "POST" }).then((r) => r.json()).catch(() => ({})); if (!parent.path) return; const name = window.prompt(t("freestyle.add.newPrompt")); if (name) await freestyleStore.mutate("root.new", { parent: parent.path, name }); };
			if (!wide) return null;
			return (0, react_jsx_runtime.jsxs)("div", { className: "aXa_fs_body", children: [
				(0, react_jsx_runtime.jsxs)("div", { className: "aXa_fs_head", children: [ (0, react_jsx_runtime.jsx)("span", { children: t("freestyle.section") }),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, { items: [ { label: t("freestyle.add.open"), onSelect: addOpen }, { label: t("freestyle.add.new"), onSelect: addNew } ], children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", "aria-label": t("freestyle.add"), children: "+" }) }) ] }),
				st.roots.length === 0 ? (0, react_jsx_runtime.jsx)("div", { className: "aXa_fs_empty", children: t("freestyle.empty") }) : (0, react_jsx_runtime.jsx)(FreestyleRoots, { roots: st.roots, trash: st.trash })
			] });
		}
		function FreestyleRoots() { return null; } // filled in Task 11
```

Read the real `Menu` prop names from `dsh-client-ui-primitives` before writing `items`/`onSelect` (the org row menu in `workspace-region.snippet.txt` already uses it; copy that call shape). `window.prompt` mirrors the org add flow's v1 shortcut (sidebar-org-rethink decision 4) and is replaced by the inline editor in Task 11.

- [x] **Step 5: CTA bridge** — in `workspace-region.snippet.txt` `selectedWorkspace()` (`:386`): `if (freestyleStore.get().ui.activeTab === "freestyle") { const s = freestyleStore.selected(); return s ? { kind: "freestyle", ...s } : null }`. In `ctaReady`/`ctaTitle`: Freestyle branch → ready when a selection exists and its root `hasHead`, title `t("freestyle.cta.pick")` otherwise. In `scripts/gen-sidebar.mjs` at the CTA click patch (`NS_BUTTON_ANCHOR`): if `sel.kind === "freestyle"` POST `/__arxa/freestyle/action` `{ action: "session.new", arg: { rootId: sel.rootId, relDir: sel.relDir } }` and surface `ok:false` through the same `arxa-sidebar-notice` event the org path uses (D111: refusals are visible).

- [x] **Step 6: Regenerate and test** — `node scripts/gen-workspace.mjs && node plugins/arxa-sidebar/selftest.mjs && node plugins/arxa-sidebar/selftest.freestyle.mjs` → GREEN. Then a lens pass: start the studio and capture the sidebar at expanded and rail widths with the Freestyle tab active and inactive (`/arxa-lens`, 3 shots) into `docs/plans/phase0b-snapshots/freestyle/`.

- [x] **Step 7: Commit**

```bash
git add plugins/arxa-sidebar scripts/gen-workspace.mjs scripts/gen-sidebar.mjs scripts/gen-locale.mjs docs/plans/phase0b-snapshots/freestyle
git commit -m "feat: add the Organisations and Freestyle tab strip to the sidebar with rail icons, a Freestyle store and the add-root menu"
```

### Task 11: Freestyle rows: roots, tree, context menu, inline create and rename

**Files:**
- Modify: `plugins/arxa-sidebar/lib/freestyle-region.snippet.txt` (`FreestyleRoots`, `FreestyleRootRow`, `FreestyleEntryRows`, `InlineName`), `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` (`ArxaDirRows` `:1806`: new props `rootId`, `verbs`, `onSelect`, `selected`)
- Test: `plugins/arxa-sidebar/selftest.freestyle.mjs` (extend), lens shots

**Interfaces:**
- `ArxaDirRows({ dir, depth, mode, hideDirs, rootId, verbs, onSelect, selected })`: when `rootId` is set, the token POST sends `{ scope:"tree-read", rootId }` and the tree GET appends `&root=` (Task 8); `openFile` dispatches `{ relPath, rootId }`; a right-click or the row's trailing `…` opens `verbs.menu(relPath, kind)`; clicking a folder row calls `onSelect(relPath)`; `selected === relPath` highlights.
- `verbs` for Freestyle: `{ newFile(dirRel), newFolder(dirRel), rename(rel), duplicate(rel), trash(rel), reveal(rel), newSession(dirRel) }` implemented over `freestyleStore.mutate`.
- `InlineName({ placeholder, initial, onCommit, onCancel })`: text input row using the primitives' input, Enter commits, Escape cancels, blur commits if non-empty; rejects `/`, `\\`, empty.

- [x] **Step 1: Extend the test** — in the vm harness, render `ArxaDirRows` with `rootId` and a fake `fetch` recording URLs: assert the token body has `rootId` and the tree URL has `&root=`; render `InlineName` and simulate Enter/Escape (the snippet functions are plain React; the harness in `selftest.header-index.mjs` shows how the repo evaluates them without a DOM, reuse it; if it cannot render, test the pure helpers `validName()` and `menuFor()` instead and rely on the lens gate for the render).

- [x] **Step 2: Run to verify it fails.**

- [x] **Step 3: Implement**

`FreestyleRoots` maps `roots` to `FreestyleRootRow` (bold row like the org row: name, open/closed pill, `…` menu with Rename / Close or Open / Reveal in Finder / New session / Forget; Forget copy says the folder stays on disk). An open root renders `ArxaDirRows({ dir: "", depth: 1, mode: "full", rootId, verbs, onSelect, selected })` beneath it, then its sessions (reuse the existing `SessionTree` component the org rows use, feeding `root.sessions.active` — read how `OrgCategoryRows` mounts `SessionTree` and mirror the props) and, when `pendingCreate` state is set for a folder, an `InlineName` row at that depth whose commit calls `file.create`/`dir.create` with `dirRel + "/" + name`. Rename swaps the row label for `InlineName` with `initial` = current name and commits `entry.rename`. Trash shows the existing confirm dialog primitive the org trash uses (copy its call) then `entry.trash`. The row menu is the same `Menu` primitive the org rows use; the right-click handler is `onContextMenu: (e) => { e.preventDefault(); openMenu(e.clientX, e.clientY) }` using whatever anchored-menu API the primitive exposes (read the org row's code first; if it only supports a trigger button, use the trailing `…` button only and skip right-click).

- [x] **Step 4: Regenerate, test, lens** — `node scripts/gen-workspace.mjs && node plugins/arxa-sidebar/selftest.mjs && node plugins/arxa-sidebar/selftest.freestyle.mjs`; then in the running studio: add a root, new folder, new file, rename, trash, restore, open a file in the viewer; capture 4 lens shots (tree, menu open, inline rename, trash open) into `docs/plans/phase0b-snapshots/freestyle/`.

- [x] **Step 5: Commit**

```bash
git add plugins/arxa-sidebar docs/plans/phase0b-snapshots/freestyle
git commit -m "feat: render Freestyle roots as a lazy file tree with a row menu, inline new-file, new-folder and rename"
```

### Task 12: Drag-drop move, duplicate, reveal, trash and archives rows

**Files:**
- Modify: `plugins/arxa-sidebar/lib/freestyle-region.snippet.txt` (`FreestyleTrashRows`, `FreestyleArchivesRows`, drag handlers), `plugins/arxa-sidebar/lib/workspace-region.snippet.txt` (`ArxaDirRows` rows get `draggable` + drop targets when `rootId` is set)
- Test: `plugins/arxa-sidebar/selftest.freestyle.mjs` (extend: `dropTargetFor(rel, kind)` pure helper returns the folder rel for a file row's parent or the folder itself), lens shots

**Interfaces:**
- Drag: `dataTransfer.setData("application/x-arxa-fs", JSON.stringify({ rootId, rel }))`; drop on a folder row or the root row calls `entry.move { rootId, relPath, toDir }`; cross-root drops are refused with a visible notice (`freestyle.move.crossRoot`).
- `FreestyleTrashRows({ trash })`: one Trash disclosure row per the org trash pattern (`workspace-region.snippet.txt` trash section) listing entries across open roots with Restore and Purge (purge confirms, same dialog); `FreestyleArchivesRows({ roots })`: archived sessions across roots with Revive and Trash (mirrors the org archives row and `archive.revive` / `archive.trash`).

- [x] **Step 1: Extend the test** with `dropTargetFor` and the `x-arxa-fs` payload parse/refuse helper.
- [x] **Step 2: Run to verify it fails.**
- [x] **Step 3: Implement** — native HTML5 drag events on the row elements (no library); `onDragOver` `preventDefault` + `aXa_fs_dropOn` class; `onDrop` parses the payload, refuses cross-root and self-moves, calls `entry.move`. Duplicate and Reveal are two more menu items calling `entry.duplicate` / `entry.reveal`. Trash and Archives rows sit under the roots, exactly where the org body places its Trash and Archives.
- [x] **Step 4: Regenerate, test, lens** — as Task 11, plus 3 shots (drag hover, trash with entries, archives with one row).
- [x] **Step 5: Commit**

```bash
git add plugins/arxa-sidebar docs/plans/phase0b-snapshots/freestyle
git commit -m "feat: add drag-drop move, duplicate, reveal, and the Freestyle trash and archives rows"
```

### Task 13: New session from a Freestyle row and decorations hook

**Files:**
- Modify: `plugins/arxa-sidebar/lib/freestyle-region.snippet.txt` (row menu *New session*; session rows open the conversation the same way org session rows do), `plugins/arxa-git-card/lib/client.js` via `scripts/gen-git-card.mjs` only if the card hides itself for `kind:'freestyle'` (it must not: `linked:false, localOnly:true` already renders the local-only card)
- Test: `scripts/freestyle-smoke.mjs` (hand-run), `plugins/arxa-freestyle/selftest.sessions.mjs` (already covers the engine)

**Interfaces:**
- Consumes: Task 5 `session.new`, Task 7 seat manifest, and the decorations plan's status map (`git diff --name-status main...HEAD`) which keys by repo-relative path: Freestyle rows pass `rootId` and the same `relPath` so the decoration layer needs no Freestyle-specific code. Record in the decorations plan that Freestyle rows are decorated by the same `ArxaDirRows` path. **[Corrected 2026-09-09: "needs no Freestyle-specific code" was false and shipped as such — `ArxaDirRows` delegates every Freestyle row to `FreestyleEntryRow`, which had no badge, and the map was keyed to the selected org session. The tab showed no decorations at all until [`freestyle-git-decorations.md`](freestyle-git-decorations.md).]**

- [x] **Step 1: Write `scripts/freestyle-smoke.mjs`** — hand-run against the real engine: boot the studio headless the way `scripts/card-local-smoke.mjs` does, `root.add` a temp folder, `file.create`, `session.new` on a subfolder, write a file in the session cwd, `card.commit` through the card route, `session.finish` dry-run then real, assert `main` contains the file and the worktree is gone. Print each step and exit non-zero on the first failure.
- [x] **Step 2: Run it** — `node scripts/freestyle-smoke.mjs` → all steps print OK.
- [x] **Step 3: Wire the menu item and the session row click** (copy the org session row's open handler; the conversation key comes from `dshSessionKey(id)` as for org sessions).
- [x] **Step 4: Regenerate, run `npm test`, lens** one shot of a Freestyle session row with the git card showing the local-only state.
- [x] **Step 5: Commit**

```bash
git add plugins/arxa-sidebar scripts/freestyle-smoke.mjs docs/plans/phase0b-snapshots/freestyle
git commit -m "feat: start sessions from any Freestyle folder and prove the full local git lifecycle in a smoke script"
```

### Task 14: Publish to GitHub for a Freestyle root

**Files:**
- Modify: `plugins/arxa-freestyle/lib/index.js` (action `root.publish { rootId, visibility:'private' }`), `plugins/arxa-freestyle/lib/roots.js` (`publishRoot`)
- Modify: `plugins/arxa-git-card/lib/index.js` only if `card.push`/`card.pr.*` branch on `kind` (they read the manifest through Task 7, so `repoOwner`/`repoName` in `.arxa/freestyle.json` is enough)
- Test: `plugins/arxa-freestyle/selftest.publish.mjs` with the github bridge stubbed (`file-org-shell/lib/github-bridge.js` shape: `{ ok, reason }`, never throws)

**Interfaces:**
- `publishRoot(root, { github, env }) → { ok, repoUrl | reason }`: refuses when `github.status()` is unlinked (`reason:'github-unlinked'`, surfaced in the row menu as a disabled item with that title); creates the private repo via the bridge's existing create call (read `lifecycle.js:1085 publishGithub` and reuse its exact bridge calls), sets `origin`, `writeFrameFiles(root.path, 'freestyle', { includeCiYml: true })`, `wipCommit`, `pushRepo`, then `writeManifest(root, { localOnly:false, repoOwner, repoName, repoUrl })`, then `github.wireFrame(owner, name)` best-effort.

- [x] **Step 1: Write the failing test** — stub bridge records calls; assert order (create → push → wireFrame), manifest fields, `.github/workflows/ci.yml` present after publish and absent before, and the unlinked refusal.
- [x] **Step 2–3: Run, implement.**
- [x] **Step 4: Run** — `node plugins/arxa-freestyle/selftest.publish.mjs` → GREEN; hand-run once against a real linked account with a throwaway folder and record the repo URL in this plan's section 6.
- [x] **Step 5: Commit**

```bash
git add plugins/arxa-freestyle
git commit -m "feat: publish a Freestyle root to GitHub as a private repo and write the CI frame at publish time"
```

### Task 15: Full suite, regenerate gate and lens gate

- [x] **Step 1:** `npm test` GREEN (all selftests including Freestyle/root-viewer regressions, preset-check, pack-list and dsh-contract).
- [x] **Step 2:** `node scripts/gen-sidebar.mjs > /dev/null && node scripts/gen-workspace.mjs --write && git diff --exit-code plugins/arxa-sidebar/lib/client.js` — regenerated bundle is byte-identical to the committed one.
- [x] **Step 3:** Lens gate at 3 widths (rail, default, wide) for: Organisations tab unchanged versus the pre-change golden in `docs/plans/phase0b-snapshots/`, Freestyle empty, Freestyle with a root and a session. Any Organisations-tab pixel drift is a bug.
- [x] **Step 4:** Commit any fix as its own `fix:` commit.

### Task 16: Docs

**Files:**
- Modify: `CONTEXT.md` (Terms: *Root*, *Freestyle tab*; Recents now two lists), `docs/plans/arxa-studio-grill-decisions.md` (append F1–F9 as the next D-numbers, one paragraph each, pointing here), `docs/plans/local-only-git-parity-and-sidebar-decorations.md` (one line: Freestyle rows decorate through `ArxaDirRows` with `rootId`), `README.md` (one paragraph under the sidebar section)
- Modify: this file, section 6 (what was verified live, the smoke output, the lens shot list)

- [x] **Step 1:** Write the entries. Keep D42/D69/D70/D71 as they are and state explicitly that they govern the Organisations tab only.
- [x] **Step 2:** `node scripts/ci.mjs` still GREEN (the docs lint, if wired, must pass).
- [x] **Step 3:** Commit

```bash
git add CONTEXT.md README.md docs/plans
git commit -m "docs: record the Freestyle tab decisions, vocabulary and live verification"
```

---

## 5. Self-review

- **Spec coverage:** F1 → Task 3/6/10; F2 → Task 10 (tabs, rail), Task 12 (own trash/archives); F3 → Tasks 1, 2, 5, 7; F4 → Task 1/3; F5 → Task 2/5/13; F6 → Task 4/9; F7 → Task 8/9; F8 → Task 1/3/14; F9 → Tasks 11/12/13; deferred items are listed, not built.
- **Placeholders:** Task 5 has two named judgement calls with the exact source lines to copy from; Task 11 names the fallback if the vm harness cannot render. No "TBD".
- **Type consistency:** `root` objects are always registry rows `{ id, name, path, open, ... }`; `relPath`/`relDir` are POSIX, root-relative, `''` for the root; `rootId` is the registry id on every wire; `kind: 'freestyle'` is the routing and manifest kind everywhere.
- **Risks called out:** the generated bundle (regenerate, never edit); hooks order in the tab wrap (Task 10 step 4); primitive prop names (read before use); `mintSessionPath` empty-workspace change must keep `selftest.path-identity.mjs` green.

## 6. Verification log

Resumed on 2026-09-09 in `.claude/worktrees/freestyle-section` from `113f114`.
Tasks 1–7 and the embedded-repository WIP fix were recovered from the saved
ledger and commit history. All sixteen tasks are complete, including independent
implementation reviews, the final integrated suite and documentation checkpoint.

Use Node **24.19.0**. The checkout's default Node 22.14.0 cannot load the existing
`node:module` `registerHooks` import. The recovery baseline passed 90/92 suites
under Node 22; both failures passed when rerun under Node 24. The first final
Node 24 run passed 100/101 suites: its one failure was a source assertion that
assumed the tree filter had no Freestyle branch. The assertion now reflects the
root-specific placeholder rule, and a route test proves `.gitkeep` remains
visible in the org tree while hidden in Freestyle. Final integrated result on
`f63710b` with the documentation updates: **101/101 suites GREEN**, exit 0.
`npm test` invokes `node scripts/ci.mjs`, satisfying both final CI checkpoints.

### Automated and live checks

- Root/session identity, nested repository routing, file verbs, Trash retention,
  private publication, root tokens, read/write boundaries, watcher lifecycle,
  language features and sidebar ownership have focused regression coverage.
  Review fixes include exact mtime conflicts, externally deleted targets,
  delayed saves across navigation, event isolation and closed-root revocation.
- The actual Monaco editor opened a Freestyle file with no open org, saved it
  with a precise first-read mtime, and created a WIP commit with a clean root
  repository. No org session was created. External deletion during editing
  returned 409 and left the file absent; choosing **Overwrite with mine**
  explicitly recreated and committed it.
- One 31-step browser flow passed create, nested create, inline rename, file
  Trash/restore, duplicate, drag/drop, immediate live conversation creation,
  archive, session Trash and restore. Repeated confirmations work in the same
  mount. Archives/Trash identify the owning root when names coincide.
- External file and empty-directory creation/deletion refreshed the lazy tree.
  Deeper disclosure state survived refresh. Cross-root drag/drop was refused
  visibly, preserving the source. Browser checks reported no console/page errors.
- Monaco's rebuilt browser probe observed only `notes.md` on root A's language
  server and only `[slug].md` on root B's, including literal glob characters.
- `npm run smoke`: **1/1**, exit 0; actual engine boot and HTTP 200 within the
  eight-second budget. `scripts/freestyle-smoke.mjs`: **13/13**, exit 0;
  local-only live dsh session in `My Notes`, exact selected-folder cwd, Git-card commit, Finish
  dry-run, real Finish and worktree removal. No model prompt was sent.
- Generator gate: **PASS**. Regeneration parse-checked 410423 bytes and
  `git diff --exit-code` found no change; `gen-workspace --check` also passed.

### Publication

Private publication passed against the linked account:
[scratch repository](https://github.com/unfazed-dev/arxa-freestyle-smoke-20260909-mttam28v).
GitHub reported `private: true`, default branch `main`, the CI workflow and PR
template present, no `.arxa` paths committed, and a clean local working tree.
Retry coverage proves an interrupted push resumes the existing remote.
Remote CI execution is not claimed by this publication check.

### Visual gate

The arxa `CdpSession` checks captured 1280×900 and 1920×900 viewports with the
280px sidebar, plus its settled 56px rail. The complete screenshot list and
pixel comparison regions are in
[the visual verification record](phase0b-snapshots/freestyle/verification.md).
Organisations header/footer pixels match exactly; its body matches exactly
with the required 41px tab-strip translation. Rail header/footer match exactly,
and existing action icons match after the two new tabs' 80px translation.

The historical `phase0b-snapshots/` directory contained text reports, not PNG
goldens. Before-change references were therefore captured from the recovered
pre-change sidebar and are retained in `freestyle/reference-org/`. These checks
use the sidebar clip because the existing animated home surface does not
converge to a full-page pixel golden.

### Implementation clarifications

F5's confirmed repository-local worktree location takes precedence over Task 5's
root-local pseudocode: new nested-repo sessions use the owning repository's
`.arxa/worktrees`. Existing root-local worktree records remain restorable.
Freestyle maps Git-unsafe workspace paths to bounded branch identities;
the selected folder's raw path remains the conversation cwd. New Freestyle
conversation IDs hash the complete root UUID/session ID pair into a fixed-size
key, preventing slash-flattening aliases and oversized filenames. Stored
conversation IDs remain valid. Org identity rules are unchanged.

Checkout launch now copies an already-built Monaco `dist` into the installed
profile, because pnpm omits the gitignored build from a file dependency. The
packed sidecar already carries this build. This was verified by reproducing the
missing-module 404, relaunching, and editing through the real Monaco surface.
