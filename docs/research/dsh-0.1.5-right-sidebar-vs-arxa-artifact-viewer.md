# dsh 0.1.5 Right Sidebar vs arxa artifact-viewer (adopt + graft editor?)

2026-09-15. Sources: npm tarballs of @deepseek-ai/dsh-client-ui-{sidebar-right,
sidebar-documentpreview,sidebar-files,open-in-app}@0.1.5-rc.2 (READMEs + lib/client.js,
unpacked in job tmp), npm registry metadata, local plugins/artifact-viewer,
docs/research/dsh-0.1.5-upgrade-analysis.md.

## What upstream 0.1.5 actually ships (measured)

Four NEW packages — **none exist at 0.1.2-rc.1** (npm 404 × 4; first publish in the
0.1.5 wave):

| package | LoC | what |
|---|---|---|
| `dsh-client-ui-sidebar-right` | 3,785 | docking surface: per-session tabs, split panes, push/fullscreen presentations, `ctx.sidebarRight` nav + `ctx.sidebarRightTabs` registry; frame drives it via NEW `ctx.layout.openRightbar(track, fullscreen)` |
| `dsh-client-ui-sidebar-documentpreview` | 26,984 | the previews: markdown, highlighted code, images, PDF (pdfjs-dist 6.3.289), HTML (Blob iframe, `sandbox="allow-scripts"` WITHOUT allow-same-origin), plain-text fallback. Paged text reads (`workspaceFiles.read` offset + Load-more), whole-bytes for pdf/html/img (`readAll`, `maxFileBytes` cap). READ-ONLY |
| `dsh-client-ui-sidebar-files` | 725 | file-tree tab: listing only (no search/watch/dnd/context menu, upstream's own "Known Limitations") |
| `dsh-client-ui-open-in-app` | 442 | NOT a viewer: session-header button opening the session cwd in a local app (Finder/VS Code/…), host routes `/open-in-app/*` |

sidebar-right's dsh.client injects 0.1.5-only platform modules
(dsh-client-store, ui-dockkit, ui-primitives, ui-slots, api-session-controller)
and the 0.1.5 layout API. `dsh-api-workspace-files` (the read API) DOES exist at
0.1.2 — reads are portable; the docking surface is not.

**The graft seam upstream built:** `ctx.documentPreviews.register({ id,
extensions, priority, title, loading, wrap? })` + a body in the keyed,
Session-scoped `sidebar.right.tab.document` child slot. Third-party renderers
sit beside the builtins (band system: extension > builtin > fallback patterns).
"Viewer becomes editor" is upstream-supported AT 0.1.5 — register an
arxa-editor renderer for text-family extensions at higher priority, done. No
fork of the sidebar.

## What arxa has (measured)

plugins/artifact-viewer v0.3.5: docked column in arxa-frame (session-bound,
drag, maximize, narrow full-frame sheet), lanes image/iframe(html,mdx)/pdf/text,
text family EDITABLE — own @codingame/monaco-vscode build (full VSCode Monaco:
extension host, 20+ grammars, audio/video previews, lib/lsp.js), write route
`/__arxa/artifacts/write` with 1.5s autosave, conflict UI, WIP commits into
session worktrees, en/pl/fr. Client ~1.4k LoC + monaco-build.

## Verdict

Upstream wins as VIEWER surface: real tab/split/fullscreen machinery, paged
reads for big files, stricter HTML sandbox, file tree, transient bytes (never
persisted). arxa wins as WORKBENCH: the only editor (Monaco+LSP+WIP commits),
per-org origin separation, write API, pl/fr, open-from-deliver-card.

Adopting the CODE at our 0.1.2 pin is not available: the packages don't exist
at that version and lean on 0.1.5 platform modules + layout API (arxa-frame is
generated from the 0.1.2 layout). Porting = vendoring ~31k LoC against foreign
slots — the exact drift the depend-don't-fork doctrine exists to avoid, and
then doing the 0.1.5 bump later anyway throws most of it away.

## Paths

- **(a) Graft at bump (recommended):** when the wave bumps, let dsh-web-app
  mount sidebar-right/docpreview/files natively; contribute the editor as a
  `documentPreviews` renderer (keep the monaco build, write route, worktree
  host half). Retire our column then. Zero fork, upstream maintains the surface.
- **(b) Tabs into our column NOW:** rebuild a slice of upstream UX on the 0.1.2
  surface we own. Cost ours to carry; deleted at bump.
- **(c) Bump to 0.1.5 now for this:** runbook exists (upgrade-analysis §Runbook:
  5 must-fixes, one-way V3 session migration, ~/.arxa/dsh backup first).
- **(d) Vendor/port upstream sidebar to 0.1.2:** ~31k LoC fork-by-generation
  against 0.1.5 APIs that don't exist here. Recommend against.

Open grill decisions: path; bump timing; what of arxa's column survives
convergence; editor scope at graft (full Monaco vs lighter).

## Decision — 2026-09-15 ("as recommended", both rounds)

- **Path (a): graft at bump.** When the wave bumps (0.1.5 stable or later),
  dsh-web-app mounts sidebar-right/documentpreview/files natively; arxa
  contributes its editor as a `ctx.documentPreviews.register` renderer
  (Session-scoped `sidebar.right.tab.document` child slot), extension band,
  text-family extensions, priority over the builtin code preview.
- **Timing: wait for stable**, not rc. Detected by the manual monthly upstream
  review (existing cadence); `dsh-wave-latest-check.mjs` stays manual, no cron.
- **Retirement at convergence:** delete the viewer column + iframe/image/pdf
  lanes + plugins/arxa-deliver wholesale (stock cards already do preview +
  open-in-app + reveal). Keep: monaco-build, `__arxa/artifacts/write` route,
  session-worktree/WIP-commit host half — reborn as the renderer. The one edge
  we keep is the point of the graft: cards open an EDITING viewer.
- **Editor scope: full Monaco** (LSP, grammars) — already built and tested;
  no lighter first pass.

Preconditions at bump day, beyond the §Runbook of
dsh-0.1.5-upgrade-analysis.md: back up ~/.arxa/dsh (V3 one-way), regen
arxa-frame (gains `openRightbar`), then graft + retire in the same wave.
