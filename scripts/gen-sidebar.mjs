// gen-sidebar — regenerate the SIDEBAR SHELL half of
// plugins/arxa-sidebar/lib/client.js from the stock
// @deepseek-ai/dsh-client-ui-sidebar lib/client.js (dsh 0.1.1-rc.2).
// The WORKSPACE SECTION half is produced by scripts/gen-workspace.mjs,
// which runs this script, transforms dsh-client-ui-workspace the same way,
// and writes client.js = shell + workspace parts. Hand-edits are caught by
// the drift gate in plugins/arxa-sidebar/selftest.mjs.
//
// Deltas applied to the stock shell (sidebar rethink — the old OrgSection
// region/CSS splices are GONE; the organisations rows live in the
// workspace-section half):
//   1. class prefix hHd-Xa_ → aXa_sb_, module id/tag arxa-sidebar
//   2. brand fallbacks "arxa"/"studio" (arxa-brand registrants override)
//   3. the shell's New-session CTA becomes org-aware: it creates a session
//      in the CURRENT open org (Q5) and is disabled with a tooltip while no
//      org is open (state arrives via window.__ARXA_SIDEBAR__ + the
//      arxa-sidebar-state event the workspace half dispatches).
// rc-bump policy: a dsh bump is an explicit re-transform — update DSH_VERSION,
// refresh the anchors if the stock shape moved, run scripts/gen-workspace.mjs,
// then the lens visual gate before committing.
//
// Usage: node scripts/gen-sidebar.mjs   (writes the shell part to stdout)
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const DSH_VERSION = '0.1.1-rc.2'
const stockPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'lib', 'client.js')

let out = readFileSync(stockPath, 'utf8')

// 1. drop sourcemap pointer
out = out.replace(/\/\/#[ ]sourceMappingURL=client\.js\.map\s*$/m, '')

// 2. identity renames
out = out.replace('id: "@deepseek-ai/dsh-client-ui-sidebar",', 'id: "arxa-sidebar",')
out = out.replaceAll('hHd-Xa_', 'aXa_sb_')
out = out.replace('"@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css"', '"arxa-sidebar/SidebarRoot.module.css"')
out = out.replace('tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar";', 'tag.dataset.plugin = "arxa-sidebar";')

// 3. brand fallbacks (slot registrants from arxa-brand override these)
out = out.replace('children: "DSH Local Build"', 'children: "arxa"')
out = out.replace('children: "29b22c5"', 'children: "studio"')

// 4. shell New-session CTA → org-aware (Q5). Marker surgery on the inject
//    factory: no orgId — the host uses the current open-org handle.
const SS_ANCHOR = 'startSession: (workspaceId) => {'
if (!out.includes(SS_ANCHOR)) throw new Error('shell startSession anchor missing — stock shape moved?')
const ssStart = out.indexOf(SS_ANCHOR)
const ssEnd = out.indexOf('},', ssStart) + 2
out = out.slice(0, ssStart) + [
  'startSession: () => {',
  '					// Organisations world (v2, grilled 2026-08-30): the shell CTA',
  '					// creates a session in the SELECTED workspace row — org-level',
  '					// creation is gone. No selection → no-op (the button is',
  '					// disabled — see the button splice below).',
  '					const sel = window.__ARXA_SIDEBAR__ && window.__ARXA_SIDEBAR__.selectedWorkspace ? window.__ARXA_SIDEBAR__.selectedWorkspace() : null;',
  '					if (sel) fetch("/__arxa/sidebar/action", {',
  '						method: "POST",',
  '						headers: { "content-type": "application/json" },',
  '						body: JSON.stringify({ action: "workspace.new-session", arg: { orgId: sel.orgId, workspace: sel.rowId } })',
  '					}).catch(() => {});',
  '				},',
].join('\n') + out.slice(ssEnd)

// 5. disabled + tooltip on the shell CTA while no org is open. A tiny tick
//    hook re-renders SidebarRoot whenever the workspace half re-poll state.
const WIDE_ANCHOR = 'const wide = !collapsed || !settled;'
if (!out.includes(WIDE_ANCHOR)) throw new Error('SidebarRoot wide anchor missing — stock shape moved?')
out = out.replace(WIDE_ANCHOR, [
  WIDE_ANCHOR,
  '		const [orgTick, setOrgTick] = (0, react.useState)(0);',
  '		(0, react.useEffect)(() => {',
  '			const onOrgState = () => setOrgTick((x) => x + 1);',
  '			window.addEventListener("arxa-sidebar-state", onOrgState);',
  '			return () => window.removeEventListener("arxa-sidebar-state", onOrgState);',
  '		}, []);',
].join('\n'))
const NS_BUTTON_ANCHOR = 'className: SidebarRoot_module_css_default.newSession,'
if (!out.includes(NS_BUTTON_ANCHOR)) throw new Error('shell new-session button anchor missing — stock shape moved?')
out = out.replace(NS_BUTTON_ANCHOR, [
  NS_BUTTON_ANCHOR,
  '								disabled: orgTick > -1 && window.__ARXA_SIDEBAR__?.orgOpen === false,',
  '								title: window.__ARXA_SIDEBAR__?.orgOpen === false ? "Open an organisation first" : void 0,',
].join('\n'))

// 6. provenance header
out = `// Browser half of arxa-sidebar (shell part; the workspace-section part is
// appended by scripts/gen-workspace.mjs). GENERATED from
// @deepseek-ai/dsh-client-ui-sidebar lib/client.js (dsh ${DSH_VERSION}) +
// scripts/gen-sidebar.mjs deltas. Do not hand-edit: regenerate and let the
// selftest drift gate compare bytes. The stock SidebarRoot shell is kept
// whole — logoRow (brand slots + fold toggle), New-session CTA, regionArea
// (the sidebar.workspaces slot renders the ORGANISATIONS rows), foot,
// collapse/rail/scrollbar-linger behaviour, locale dicts, slot children map.
// The original package stays untouched in node_modules as reference.
` + out

process.stdout.write(out)
