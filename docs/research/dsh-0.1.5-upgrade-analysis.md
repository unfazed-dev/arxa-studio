# dsh upgrade analysis: 0.1.2-rc.1 -> 0.1.5-rc.2 (arxa-studio)

2026-09-14. Sources: GitHub releases dsh-v0.1.5-alpha.1/alpha.2/rc.1/rc.2 (2026-09-08..10),
packages/session/session-format-v2-to-v3 README @ rc.2, npm registry versions, arxa repo scan.

## What 0.1.5 ships

- Right Sidebar: tabs / split / fullscreen, previews for md, code (highlighted), html, pdf, images.
  VIEW-ONLY - no editor UI upstream. Models can deliver files (cards + preview + open-in-app + reveal).
  Old Detail panel REMOVED.
- Arbitrary file-type uploads; background upload progress/cancel; readable by model via existing tools.
- deepseek-flash (V4.1 Flash) default for NEW sessions; explicit settings.yaml model wins.
- Session data format V3: migrates old logs to new files, originals preserved, NO downgrade reads;
  custom log readers must adapt. Preset id 'code' renamed 'ptc' in headers + selections.
- Plugin API: ctx.agent REMOVED (pass Agent explicitly). Inbox type-only: agent.inbox, no
  hasPending/claim. Panel API: global panels via 'sidebar.panellist' + 'main'; old 'conversation'
  slot moves to main.conversation.
- Session lifecycle: persistence via lifecycle-held SessionHandle; agentLoop.create() now ASYNC;
  session lock - one process per session max.
- Default tools: SDK/headless/ACP default to read/write/edit; web 'minimal' + python sdk-minimal
  default to persistent shell only, str_replace_editor explicit.
- Misc: HTTP(S)_PROXY/ALL_PROXY/NO_PROXY honored; perf on long conversations; Agent Teams pkg
  (opt-in); subagent plugins Codex 0.153.4, Claude Code 2.1.263; dynamic system prompt updates
  without KV-cache invalidation (model must declare support).

## arxa coupling surface (verified)

- package.json: exact pins dsh, dsh-agent-presets, dsh-authorization, dsh-base, dsh-headless,
  dsh-web-app @ 0.1.2-rc.1; allowScripts pins @deepseek-ai/dsh-subprocess-local@0.1.2-rc.1.
- bin/arxa-studio.mjs: bundles dsh-base + dsh-web-app (web) or dsh-headless (--headless); DSH_HOME
  ~/.arxa/dsh; settings.yaml seeded once WITH agent-default-model glm-5.3 (explicit -> immune to
  deepseek-flash default); forces agent-presets.default to 'arxa'; shipped set
  ['code','cordis','standard','minimal'] at :319; preset rewrite block :312-327.
- plugins/arxa-frame: GENERATED from dsh-client-ui-layout (scripts/gen-frame.mjs, drift gate).
- plugins/arxa-sidebar: replaces dsh-client-ui-sidebar + sidebar.workspaces registrant.
- plugins/artifact-viewer: own Monaco build, EDITS text-family artifacts, docked column (D88-D93).
- plugins/conversation: transcript fold of durable session log -> V3 reader.
- ctx.agents (plural) used: arxa-sidebar/lib/index.js:336,403,491,545; claude-code/lib/adapter.js:157
  (currentInitiator); arxa-freestyle/lib/index.js:76,163; conversation/lib/index.js:332.
- scripts/s1-sandbox-verify.mjs imports dsh-sandbox + dsh-sandbox-policy (hoisted-only, not in deps).
- pi-ai: override dropped at 0.1.2-rc.1, upstream range owns it; glm-5.3 catalog rides dsh-llm-pi-ai.

## WILL BREAK - must fix in upgrade

1. Pin bump 6 packages -> 0.1.5-rc.2 AND allowScripts entry
   "@deepseek-ai/dsh-subprocess-local@0.1.5-rc.2": true, else install scripts blocked.
2. plugins/conversation V2->V3 log reader adaptation (custom readers must adapt; no downgrade).
3. Panel API rename: regen arxa-frame (gen-frame.mjs + drift gate) from new dsh-client-ui-layout;
   check arxa-sidebar against new 'sidebar.panellist' registration namespace.
4. Preset rename 'code'->'ptc': verify what presets 0.1.5 ships; update shipped set
   bin/arxa-studio.mjs:319 and rewrite block :312-327 if 'code' no longer exists.
5. Session migration is ONE-WAY: back up ~/.arxa/dsh before first boot of upgraded engine.
   (Migrator preserves originals, but old engine cannot read V3.)

## Behavior changes - decide, not break

- Detail panel removed; stock right-sidebar previews now exist alongside arxa's docked
  artifact-viewer column -> two preview surfaces. arxa's stays the only EDITOR upstream lacks one.
- web 'minimal' profile loses default file tools (persistent shell only). arxa preset = standard
  coding agent, unaffected - only matters if arxa users can pick 'minimal'.
- New-session default model deepseek-flash: NOT hit (arxa seeds glm-5.3 explicitly; config wins).
- Session lock: arxa is single-engine-process; phone pairing tunnel rides same engine. OK.
- agentLoop.create() async: only relevant if anything calls it directly - nothing in arxa does
  (ctx.agents.create wrapper - verify signature unchanged after install).

## Verified clean

- ctx.agent (singular) removal: zero usage - arxa uses ctx.agents registry only.
- Inbox API (agent.inbox/hasPending/claim): zero usage.
- deepseek-flash default: blocked by explicit seed.
- pi-ai: 0.1.5-rc.2 published for dsh-llm-pi-ai; verify glm-5.3 catalog entries after install.

## Runbook (order matters)

1. cp -a ~/.arxa/dsh ~/.arxa/dsh.pre-0.1.5-backup
2. Bump 6 pins + allowScripts in package.json -> pnpm install
3. node scripts/gen-frame.mjs; REVIEW the diff: does the regen keep or drop the stock right
   sidebar? That diff IS the Q3 decision input.
4. Adapt plugins/conversation to V3 (reference: packages/session/session-format-v2-to-v3 README).
5. Reconcile preset shipped set ('ptc'?) in bin/arxa-studio.mjs:319/:312-327.
6. npm test (scripts/ci.mjs) + npm run smoke (engine-boot-smoke.mjs).
7. Boot on real ~/.arxa/dsh copy first; confirm V3 migration + glm-5.3 catalog + provider-status.

Open decisions live in the grill round (chat, 2026-09-14). Nothing merged until they're answered.

## Parity-by-plugin instead of bump (2026-09-14, post-grill Q1)

arxa is NOT forked - package.json: "depends on dsh components (depend-don't-fork);
never a fork, never a rebase". Pin + replacement plugins + own host/preset composition.
Staying on 0.1.2-rc.1 is architecturally supported. pi-ai catalog rides ^0.84.x
inside the pin, so glm-5.3 entries keep updating without bumps.

PORTABLE at plugin level (build now, ~all patterns already exist):
- Delivered-file cards: new deliver_file tool row in profile/agent-presets/arxa/
  (plain composition row, same shape as arxa-pi-delegate/arxa-gen-ui rows) +
  conversation card renderer (arxa-git-card injects dsh-client-ui-conversation;
  arxa-gen-ui already renders live React via tool.call.toolview keyed slot at
  0.1.2). Card actions: open in artifact-viewer column (exists), reveal in
  Finder / open-in-default-app via host plugin (trivial child_process).
  Preview coverage already EXCEEDS upstream: artifact-viewer lanes image/html/
  pdf + text-family EDITING (upstream is view-only).
NOT portable (engine-owned, wait for bump): arbitrary-file upload w/ progress
(composer + attachment store are stock dsh-web-app; replacing composer row is
the heavy path), subagent queue/steer/edit, continuable-subagent fixes,
long-conversation perf, proxy env, KV-safe dynamic system prompt, session V3,
Agent Teams. None currently hurt arxa.

Bump trigger rule (proposed): bump only when (a) an engine-owned feature above
becomes needed, (b) upstream security fix, or (c) 0.2.x stabilizes plugin API.
Review upstream releases monthly; gap compounds but arxa's surface (cards,
viewer) is additive, so bump cost stays flat.

## Decision — round 3, 2026-09-14 (user: "ok as recommended")

Fork-vs-pin settled: STAY pin + replacements. Fork triggers recorded in
docs/plans/arxa-harness-and-distribution.md §Fork triggers (upstream dies /
license flips / 1.0 + engine-core need / >half stock surfaces regenerated).
Landed with the decision:
- scripts/preset-names-check.mjs (ci) — found LIVE drift on first run: the
  wave already ships 'ptc', not 'code'; bin/arxa-studio.mjs rewrite set fixed
  ('ptc' added, 'code' kept as legacy for pre-rename homes).
- scripts/session-format-check.mjs (ci) — V3 alarm: pins dsh-session
  SESSION_FORMAT_VERSION (0 at this wave) so a format bump is red BEFORE the
  one-way ~/.arxa/dsh migration, never after.
- scripts/dsh-wave-latest-check.mjs (radar, NOT in ci — network) — registry's
  newest per pinned @deepseek-ai package vs pin, exit 1 when ahead; cron-able.
Delivered-file cards (round 2): SHIPPED 2026-09-14 as plugins/arxa-deliver
(`deliver_file` tool + keyed-toolview card; Open → arxa-av-open viewer
column, Reveal → callId-validated `open -R`). Selftest 15 checks, in ci.
Exceeds upstream 0.1.5 (its cards are view-only; arxa opens the editing
viewer). Ceiling: reveal is process-lifetime — stale after engine restart.

## Desktop smoke (2026-09-14, live engine, TERRA/notes session)

End-to-end verified: agent created deliver-smoke.md, called deliver_file,
durable meta {path,name,bytes,lane,note} persisted, card renders in the
desktop app scrollback, Open opens the docked viewer column on the file.
Evidence: designs/evidence/deliver-card/ (02-card, 03-open-viewer,
04-reveal PNGs + deliver-card-journey.mp4). The smoke surfaced and the
session fixed four real defects:

1. PLANE BUG (repo, fixed): the web boot bundle composes client halves from
   HOST rows only — an agent-preset plugin's browser half NEVER loads.
   arxa-deliver moved to a host patch row (preset row removed, note left in
   agent.cordis.yml). arxa-gen-ui has the same latent bug: its live cards
   silently degrade to presentCall/presentResult fallback on desktop.
2. LOSSLESS JSON (repo, fixed): a tool value carrying `sessionId: undefined`
   fails dsh's lossless-JSON gate ("value is not lossless JSON") — omit,
   never undefined (selftest pins the round-trip).
3. PHONE-RAIL PROMPT (repo, fixed): plugins/conversation POST /messages
   502'd with throwIfAborted on every desktop engine restart — prompting a
   parked agent without resume. Now hydrates first (selftest updated).
4. PACKED PAYLOAD (live-payload repairs; bake into the next pack-sidecar):
   a) the payload's arxa/ copy lacks hooks/ (arxa-guard.js) — the gate
   failed EVERY mutating tool call with MODULE_NOT_FOUND; copied hooks/ in.
   b) a launchctl-kickstarted engine inherits the plist's minimal PATH —
   verdict.sh `exec node` fails. The app-sidecar environment carries the
   payload node; launchd revivals do not (bounce the dsh child only, or
   relaunch the sidecar binary).
Also: preset-names-check's live 'ptc' find (§Decision above) was found by
this same session.

## Repack + the "#root wedge" verdict (2026-09-15)

scripts/pack-sidecar.mjs now packs arxa/hooks/ (defect 4a is baked, not
hand-copied). Repacked payload 8372a6c64067 → swapped into
/Applications/Arxa Studio.app/Contents/MacOS/arxa-studio (launchd service
solutions.arxadigital.arxa.engine boots it; bootout-then-open installs).

The "engine page-serving regression" was NOT an engine defect. On a fresh
payload every fresh browser page still showed a white body + "web app:
missing #root" — and the evidence chain acquitted the server completely:
the /plugins combo serves 200 in 60ms (4.5MB, browser-shaped headers too),
import(batchUrl) resolves in-page in 60ms, the bootstrap loads, yet
__ModuleLoader__.create() is never called and document.body has 0 children.
The cause is arxa-waiting-page's desktop-first presence referee: every
NON-SHELL page (lens CDP Chrome, plain Chrome) gets PARKED — body wiped —
while the engine runs in desktop mode. The shell webview (ArxaShell UA +
__TAURI__) skips the park path entirely. Diagnosis: high confidence; all
"#root" evidence came from lens probes, never from the shell itself.
Follow-up: lens needs shell emulation before it can smoke-test this app's
pages — and it HAS one: ARXA_LENS_UA="… ArxaShell/1.0" (arxa/lib/cdp.dart,
built exactly for the waiting-page referee). Resolution (same day): full
tauri rebuild installed over /Applications + WKWebView caches
(~/Library/{Caches,WebKit}/solutions.arxadigital.arxa, 84MB of stale UI —
the user's "old stuff") cleared; lens smoke with the shell UA passed
(card renders, Open opens the editing viewer on deliver-smoke.md);
evidence designs/evidence/deliver-card/repack-*.{mp4,png}. Also freed the
superseded 8ac7a8298f01 payload — the system disk was 95% full (dmg
bundling dies on it; install from bundle/macos/*.app instead).

## Viewer convergence rides this bump (decided 2026-09-15)

When this bump happens (trigger: 0.1.5 leaves rc, per the monthly upstream
review — see docs/research/dsh-0.1.5-right-sidebar-vs-arxa-artifact-viewer.md
§Decision), the same wave grafts arxa's editor into the stock right sidebar as
a `documentPreviews` renderer and retires the artifact-viewer column +
arxa-deliver. Add to §Runbook as step 8.

## Viewer theme-follow: three defects, fixed 2026-09-15

User report: "mix ui that should not occur" + "the viewer theme is not
following the studio whole theme". All three in the Monaco workbench's
palette handling (lens evidence: body flapping `monaco-workbench vs-dark`
under a LIGHT studio — `data-ds-dark-theme` never set):

1. PREWARM BOOTED DARK: client.js's warm-editor effect called
   `M.start(div)` with no opts; start()'s default is dark, and the workbench
   boots ONCE on document.body (menus/toasts/scrollbars hang off it) — so
   the studio got dark VS Code body chrome from page load. Fixed: the warm
   start passes `{ dark: isDarkMode(), fontFamily: studioEditorFont() }`.
2. PALETTE WATCHER DIED WITH EVERY REMOUNT: watchPalette was armed per
   CodeView mount and unwatched on unmount — a flip between mounts never
   reached Monaco (measured: attr toggled, theme did not move). Fixed: one
   `arxa-av: palette mirror` sub armed at apply(), flips a loaded workbench.
3. BARE start() STOMPED THE PALETTE: entry.mjs's internal callers
   (registerFile/updateFile/connectLanguageServer + harness probes) call
   `start()` bare → dark default re-applied AFTER a light boot (measured:
   session auto-open ran updateFile, theme flipped dark at +3.7s). Fixed:
   `dark: null` = boot-only, leave the palette; explicit dark re-applies
   (`flip`) so a post-boot palette change still wins.

entry.mjs `start()` now: dark=null default, guards themeDark + flip-apply.
Files: plugins/artifact-viewer/lib/client.js, lib/monaco-build/src/entry.mjs
(+ rebuilt dist; check.mjs GREEN, all 7 selftests GREEN). Live-verify via
lens (boot light, auto-open light, Open light, flip dark vs-dark+rgb(31,31,31),
flip back light). Evidence: designs/evidence/viewer-theme/.

Ops notes from the same session: the engine serves the plugin from
~/.arxa/dsh/profiles/arxa/node_modules/arxa-artifact-viewer (the payload
copy is only the install source — patch BOTH for live testing); `open -a`
on a running app does NOT respawn a booted-out engine service (quit the app
first); lens record's settle can run minutes against the animated prism
background — the --pre script runs after it, so time flips from pre-start,
not capture-start (641s video, flip at ~t=350s).

## Viewer contrast: the workbench now paints the studio canvas (2026-09-15)

Second user report (screenshot): the viewer reads as a foreign surface —
stock Light Modern paints #ffffff editor/tabs/active-tab against the
studio's soft-grey canvas (oklab(0.958 …) = #eef2f1). The "2026 port"
commented at client.js:600 was never wired: no themes.js exists; the
2026-dark/light JSONs in dist/ are orphans; entry.mjs set STOCK
Default Light/Dark Modern.

Fix: the client reads the studio canvas (computed body bg — frame, main and
body all carry it) and hands it to the workbench as
`workbench.colorCustomizations` overrides (editor, gutter, tabs, ACTIVE
TAB, breadcrumbs, widgets — foregrounds/syntax stay from the flipped base
theme, so contrast holds in both palettes). Re-read on every palette write:
boot, open, and the palette mirror all pass `studioColors()`.

The converter is hand-rolled oklab/oklch→sRGB (Ottosson matrices): WebKit
reports computed colors as oklab() strings, VS Code's color parser refuses
them, and the canvas-readback trick ALSO fails — Chrome serializes an
oklab source right back as oklab() (measured). Unitless-float forms only;
a % form yields null (no override rather than a wrong color).

Proof: spike gate `out.canvasApplied` (setTheme with {canvas:'#004488'} →
editor bg repaints); live lens assert — canvas #eef2f1, editor var + gutter
+ tabs + active tab all rgb(238,242,241), computed editor bg matches;
horizontal luma profile of the journey video: conversation 155-163, viewer
236-241 (was 255). Evidence: designs/evidence/viewer-theme/
(04-contrast-matched.png from the journey video — its active tab predates
the tab.activeBackground fix; the tab assert is the live probe).

## The bump + graft WAVE: executed 2026-09-15

User showed the 0.1.5 right-sidebar screenshots and overrode the
wait-for-stable timing ("wire this up properly"); grill round settled rc.2
now, retire in the same wave. Executed (this is the runbook above, done):

1. BACKUP: ~/.arxa/dsh → ~/.arxa/dsh.pre-0.1.5-backup (48M) BEFORE install.
2. PINS: 6 deps + allowScripts dsh-subprocess-local → 0.1.5-rc.2; pnpm
   v11 rewrote pnpm-workspace.yaml with placeholder allowBuilds — the same
   five approvals as before set to true there (@google/genai, edgedriver,
   geckodriver stay false).
3. STALE-ROOT PURGE: repo-root node_modules/@deepseek-ai carried 217 REAL
   pre-pnpm leftover dirs from the 0.1.2 era, silently satisfying every
   bare stock import (gen-frame regenerated DEAD stock with a green drift
   gate — measured). Moved to job tmp; root now holds only the 6 pinned
   links. scripts/stock-path.mjs added: graph-pinned stock resolution
   (via dsh-web-app's .pnpm tree, version-guarded, store fallback for
   entry-less packages) — every gen-* script and stock-reading selftest
   re-pointed at it.
4. WAVE devDeps: host-plane code imports engine-graph packages bare
   (sandbox family, schemastery 3.18.2 — independently versioned!,
   cordis 4.0.2, dsh-fs/-fs-sandbox, dsh-credentials, dsh-llm,
   dsh-llm-pi-ai, dsh-web-frontend, @earendil-works/pi-ai 0.85.1) —
   declared in devDependencies at the pin so tests resolve the LIVE wave;
   pack-manifest exempts wave-store members from the dev-only drop check
   (the payload ships them inside the wave closure, and cordis resolves
   them from the materialized node_modules at boot).
5. REGEN at 0.1.5: gen-sidebar + gen-workspace --write (all anchors held),
   gen-locale --write (stock byte-identical; hash re-pinned), gen-git-card
   --write (QueueDock class map 0.1.2's 14 keys → 20: +attachments,
   +file* ×3, +pendingRow, +status; thumbs merged into thumb),
   gen-insight-css --write (ToolDetails.module.css GONE at 0.1.5 — merged
   into ToolRow; single-source lift now).
6. RETIREMENT: plugins/arxa-frame + scripts/gen-frame.mjs + the patch's
   ui-layout disable/arxa-frame insert + arxa-deliver (plugin + host row +
   bin rows) all removed — stock ui-layout row restored, stock
   delivered-file cards + open-in-app ship upstream now.
7. THE GRAFT (plugins/artifact-viewer): one panel, two seats inside the
   stock right sidebar — (a) ctx.documentPreviews.register (extension
   band; 27 code/text extensions, NOT md/html/pdf/images — stock previews
   own those) + body in 'sidebar.right.tab.document' keyed
   arxa-artifact-viewer, fed by decoding the dsh-resource:// file address
   into the same av-store the av-open lane uses; (b) the 'arxa' page tab
   (ctx.sidebarRightTabs) + body in 'sidebar.right.pane.tab' — the lane
   for arxa-av-open (sidebar file rows, insights, org-lane files, md
   source editing). apply() changes: session-switch close now rides the
   rightbar's native per-session scoping; D91 chip interception RETIRED
   (stock cards open the preview natively, the editor renderer answers);
   first-produced-file auto-open kept, retargeted through av-open.
   package.json dsh.client inject drops ui-layout; plugin v0.4.0.
8. session-format-check EXPECTED 3 (V3 confirmed on disk); conversation
   fold rides sessionController RPC — no file reader parses v3 in arxa.
   Preset roster at 0.1.5: standard/ptc/minimal/cordis (code GONE);
   launcher rewrite set already carries ptc.
9. npm test: ALL GREEN, 131 suites, incl. engine-boot-smoke (real boot,
   8s budget, UI 200 via desktop-session contract).

Slot-key audit (0.1.5): every 0.1.2 key arxa uses —
conversation.session.header.actions, conversation.input.dock,
shell.overlay, tool.call.toolview, sidebar, sidebar.workspaces — still
exists verbatim; 'main.conversation'/'sidebar.panellist' are ADDITIONS,
not renames. ctx.layout face is now five methods
(selectPanel/beginNavigation/toggleSidebar/openRightbar/closeRightbar);
the viewer uses openRightbar(true,false) to reveal before its first
openTab (see below).

## Wave status at ship: 2026-09-15 (evening)

SHIPPED (payload 9eacfeacf19b installed, engine healthy, CI ALL GREEN
131 suites): the 0.1.5-rc.2 bump, retirement, graft code, V3 live
(lens: conversation of TERRA/notes opens on V3 reads), stock layout +
all stock rightbar packages load, no console errors.

PACK-ERA LESSONS (each cost a boot crash, now gated):
- Host plugins resolve bare @deepseek-ai/* imports through
  arxa-studio/node_modules; the 0.1.2 payload satisfied that by accident
  (npm layout, tar-all). The prod-staged pnpm tree must be HOISTED
  (nodeLinker: hoisted on the stage copy) and the host-provided peers
  (js-yaml, cordis, schemastery, pi-ai, the sandbox/fs/llm family,
  dsh-web-frontend) live in "dependencies" now. pack-sidecar gained a
  GRAPH GATE: importing dsh's entry under the payload's own node before
  tarring.
- The launchd "hang" rabbit hole: engines booted fine from any shell
  with the identical env/cwd/stdio/sidecar, stalled mid-apply under
  launchd ONLY, repeatedly — an infinite microtask cascade (native
  sample: 100% of samples in PromiseFulfillReactionJob) that starves
  all I/O including the inspector. It stopped reproducing after the
  diagnostic cycles (last ~4 boots incl. final ship are clean); the
  only confirmed trigger on the stall side was ARXA_ENGINE_INSPECT=1
  (NODE_OPTIONS=--inspect in the dsh child) — that hook stays in the
  launcher but env-gated. If it returns: sample the dsh pid (native
  stack distinguishes the cascade), do NOT chase env/cwd theories.

KNOWN GAP (CLOSED 2026-09-15 late) — the rightbar session surface did not
mount in arxa's composition. Root causes + resolution below the notes:
- stock layout renders the rightbar column + the 'rightbar' seat host,
  but the seat renders EMPTY: RightbarRoot never mounts, so
  'rightbar.session' → 'sidebar.right.pane.tab'/'…tab.document' never
  exist; ctx.sidebarRight.openTab throws "sidebarRight: no session
  surface is mounted" (its require() guard) even with a session open
  and the conversation view mounted.
- sidebar-right/documentpreview/files clients all APPLY (styles +
  registrations present, no loader errors) — it is the mount, not the
  load.
- RightbarRoot's null-guard: usePanelInfo(activePanelId === null) or
  canShow(normal.rightbar > 0) — layout store inits activePanelId null
  and arxa-sidebar only ever selects null, so the suspect is the
  canShow/rightbar-width projection or the seat's SessionProvider
  binding path under the replaced sidebar.
- Evidence files: job tmp probes (attr-probe, rb-html, ctx-probe,
  final-probe) — /Users/unfazed-mac/.claude/jobs/5c8a2239/tmp/.
- Next move: diff the slot-hook context (usePanelInfo/canShow values)
  against the operator's stock dsh web (:3080) where the rightbar
  demonstrably works, or bisect profile rows with the engine's
  --materialise-only + a scratch home (the live-profile edit is
  rewritten from the payload template each boot — edit THAT).

RESOLVED same night (systematic-debugging pass). The "session surface
does not mount" was the LAST visible symptom of a chain that broke the
client session catalog — TWO 0.1.2-era assumptions inside arxa's own
session-header-index wrapper (plugins/arxa-sidebar/lib/session-header-index.js):

1. STALE LIST-CACHE SHAPE: 0.1.5's session-query maps `snapshot.header`
   over every `persistence.list()` answer, but the v1 list cache
   (written by the 0.1.2 engine, trusted verbatim) held BARE headers —
   the fingerprint still matched (V3 migration is lazy, files unchanged),
   so every boot served [undefined x 50] and listSessions threw
   "reading 'id'". Fix: list answers are v2-only; a non-snapshot cache
   misses (shape guard) instead of poisoning stock code.
2. OPTIONS-ENVELOPE vs BARE SIGNAL: 0.1.5 hands `persistence.list()`
   an options envelope `{ signal }` while `listProjectDirs`/
   `listSessionDirs` still take a BARE signal. The wrapper's fingerprint
   scan forwarded the envelope into the walkers:
   `({ signal }).throwIfAborted()` threw on every GATEWAY-driven list
   (the gateway always passes a real AbortSignal) → session/list RPC
   answered ok:false → client catalog stayed EMPTY → no session ever
   became current → ui-session's session scope rendered its empty
   branch → RightbarRoot's seat never mounted → openTab threw. The
   engine's own no-signal diagnostic (q.listSessions() with NO arg →
   `signal === void 0 ? void 0 : {signal}` → undefined) SKIPPED the
   crash and logged "50 items", masking #2 behind #1 for the whole
   evening. Fix: the wrapper forwards `options?.signal` to the scan and
   the original arg to origList.

Evidence chain: engine.log "session list failed: reading 'id'" (every
boot) → lens probe {svcReady:true, ids:[], current:null} → net trace
/api/session/list 200 → payload gateway diag patch captured
`args=[{}, AbortSignal]` + the exact throw + stack at
listPersisted → persistence signatures confirmed the mixed conventions.
Verified live after both fixes: catalog 50 ids, current set,
[data-slot="rightbar.session"] MOUNTS, real V3 transcript renders
(previously the "conversation" was the stock hero — its text was the
giveaway), av-open lands the arxa tab INSIDE the rightbar (720px
column) and Monaco renders the file's actual bytes. Regression pins in
selftest.header-index.mjs (both blocks). Lens ops note: ARXA_LENS_UA
must be set whenever the DESKTOP APP is running — the waiting-page
referee parks non-shell UAs the moment desktop mode is live.


## Re-ship: 2026-09-15 (late night) — payload a889ccd17f83

Both header-index fixes + regression pins, CI ALL GREEN (131), repacked,
installed over /Applications + ad-hoc codesign, engine bounced. Live on
the SHIPPED build: catalog 50 ids, current binds on openCreated,
rightbar.session MOUNTS, V3 transcript renders, av-open lands the arxa
tab + Monaco inside the stock right sidebar. The KNOWN GAP is closed.
