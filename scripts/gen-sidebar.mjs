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
const DSH_VERSION = '0.1.2-rc.1'
const stockPath = join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'lib', 'client.js')

let out = readFileSync(stockPath, 'utf8')

// 1. drop sourcemap pointer
out = out.replace(/\/\/#[ ]sourceMappingURL=client\.js\.map\s*$/m, '')

// 2. identity renames
out = out.replace('id: "@deepseek-ai/dsh-client-ui-sidebar",', 'id: "arxa-sidebar",')
out = out.replaceAll('hHd-Xa_', 'aXa_sb_')
out = out.replace('"@deepseek-ai/dsh-client-ui-sidebar/SidebarRoot.module.css"', '"arxa-sidebar/SidebarRoot.module.css"')
out = out.replace('tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-sidebar";', 'tag.dataset.plugin = "arxa-sidebar";')

// 3. brand fallbacks (slot registrants from arxa-brand override these).
//    dsh 0.1.2-rc.1 (2026-09-05): the plain "DSH Local Build"/"29b22c5"
//    strings became a two-part local-build badge — localBuildTitle labelled
//    by t("brand.localBuild") over a buildVersion stamp. Same intent, new
//    shape: the title slot reads "arxa", the version slot reads "studio".
//    replaceAll covers the badge title AND the plain-fallback branch (dead
//    while localBuildVersion() is defined) so no surface can render stock.
if (!out.includes('localBuildBrand')) throw new Error('shell local-build badge anchor missing — stock shape moved?')
out = out.replaceAll('t("brand.localBuild")', '"arxa"')
if (!out.includes('children: buildVersion')) throw new Error('shell buildVersion anchor missing — stock shape moved?')
out = out.replace('children: buildVersion', 'children: "studio"')

// 4. shell New-session CTA → org-aware (Q5). Marker surgery on the inject
//    factory: no orgId — the host uses the current open-org handle.
const SS_ANCHOR = 'startSession: (workspaceId) => {'
if (!out.includes(SS_ANCHOR)) throw new Error('shell startSession anchor missing — stock shape moved?')
const ssStart = out.indexOf(SS_ANCHOR)
const ssEnd = out.indexOf('},', ssStart) + 2
out = out.slice(0, ssStart) + [
  'startSession: () => {',
  '					// Organisations world (v2, grilled 2026-08-30; loop closed',
  '					// 2026-09-01): the shell CTA creates a session in the SELECTED',
  '					// workspace row and OPENS it — server create, then the org',
  '					// lever (openCreated) carries session.open + conversation',
  '					// focus, the same flow a tree-row open uses. The first cut',
  '					// fired-and-forgot the POST: the session landed but nothing',
  '					// surfaced for ~5s (next poll), reading as a dead button.',
  '					// No selection → no-op (the button is disabled — see the',
  '					// button splice below).',
  '					const w = window.__ARXA_SIDEBAR__;',
  '					const sel = w && w.selectedWorkspace ? w.selectedWorkspace() : null;',
  '					if (!sel) return;',
  '					// D111 (2026-09-02): a refusal must be VISIBLE. This handler used',
  '					// to drop it twice over — a { ok: false } body fell out of the',
  '					// `if` below without a branch, and a thrown error died in a bare',
  '					// catch — so a red main read to the user as a dead button. The',
  '					// code travels to SidebarRoot on an event (the same shape the',
  '					// ctaReady levers already use) because startSession lives in',
  '					// injectProps, outside the component that owns the notice state.',
  '					window.dispatchEvent(new CustomEvent("arxa-sidebar-notice", { detail: { code: null } }));',
  '					const notice = (code) => window.dispatchEvent(new CustomEvent("arxa-sidebar-notice", { detail: { code } }));',
  '					if (sel.kind === "freestyle") {',
  '						fetch("/__arxa/freestyle/action", {',
  '							method: "POST",',
  '							headers: { "content-type": "application/json" },',
  '							body: JSON.stringify({ action: "session.new", arg: { rootId: sel.rootId, relDir: sel.relDir } })',
  '						}).then((r) => r.json()).then((b) => {',
  '							if (!b || !b.ok) { notice(String((b && b.result && b.result.reason) || (b && b.reason) || (b && b.error) || "unknown")); return; }',
  '							if (typeof w.refreshFreestyle === "function") w.refreshFreestyle();',
  '						}).catch((e) => notice(String((e && e.message) || e)));',
  '						return;',
  '					}',
  '					fetch("/__arxa/sidebar/action", {',
  '						method: "POST",',
  '						headers: { "content-type": "application/json" },',
  '						body: JSON.stringify({ action: "workspace.new-session", arg: { orgId: sel.orgId, workspace: sel.rowId } })',
  '					}).then((r) => r.json()).then((b) => {',
  '						// The action route answers { ok: false, error } — `error` is the',
  '						// thrown message verbatim, so "main-red" arrives as that string.',
  '						if (!b || !b.ok) { notice(String((b && b.error) || "unknown")); return; }',
  '						if (b.result && b.result.id && typeof w.openCreated === "function") w.openCreated(sel.orgId, b.result.id);',
  '					}).catch((e) => notice(String((e && e.message) || e)));',
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
  '		// D111 refusal notice. The CODE is held, not the sentence, so a locale',
  '		// switch re-renders the message instead of freezing the wording chosen',
  '		// at click time. startSession dispatches null before every POST, which',
  '		// is what makes the line auto-clear on the next click.',
  '		const [ctaNotice, setCtaNotice] = (0, react.useState)(null);',
  '		(0, react.useEffect)(() => {',
  '			const onNotice = (ev) => setCtaNotice((ev && ev.detail && ev.detail.code) || null);',
  '			window.addEventListener("arxa-sidebar-notice", onNotice);',
  '			return () => window.removeEventListener("arxa-sidebar-notice", onNotice);',
  '		}, []);',
].join('\n'))

// 5b. D111: render the refusal next to the CTA. The shell had NO error surface
//     — the old handler dropped a { ok:false } body and swallowed throws — so a
//     red main looked like a dead button. One line, shell-owned, tokens only.
const NOTICE_ANCHOR = [
  '					(0, react_jsx_runtime.jsx)("div", {',
  '						className: SidebarRoot_module_css_default.regionArea,',
].join('\n')
if (!out.includes(NOTICE_ANCHOR)) throw new Error('SidebarRoot regionArea anchor missing — stock shape moved?')
out = out.replace(NOTICE_ANCHOR, [
  '					ctaNotice && wide ? (0, react_jsx_runtime.jsx)("div", {',
  '						className: "aXa_sb_ctaNotice",',
  '						"data-arxa-cta-notice": ctaNotice,',
  '						role: "status",',
  '						// Known codes get a sentence; anything else shows the server\'s own',
  '						// message rather than a shrug — an unmapped refusal is still more',
  '						// use to the reader than silence.',
  '						children: ctaNotice === "main-red" ? t("session.new.err.mainRed") : ctaNotice',
  '					}) : null,',
  NOTICE_ANCHOR,
].join('\n'))

// 5c. D111 wording lives in the shell's OWN dictionary namespace ("sidebar",
//     stock) — no arxa namespace is added here, and the workspace half's dicts
//     are untouched. pl/fr stay sparse: the stock lookup chain falls back per
//     key to en, the same contract plOver/frOver rely on in the other half.
const DICT_ANCHOR = '		const en = {'
if (!out.includes(DICT_ANCHOR)) throw new Error('shell en dictionary anchor missing — stock shape moved?')
out = out.replace(DICT_ANCHOR, [
  '		const pl = {',
  '			// TODO native review (conformance decision 4): machine-drafted.',
  '			"session.new.err.mainRed": "main jest czerwony — napraw main przed rozpoczęciem sesji"',
  '		};',
  '		const fr = {',
  '			// TODO native review (conformance decision 4): machine-drafted.',
  '			"session.new.err.mainRed": "main est au rouge — corrigez main avant de démarrer une session"',
  '		};',
  DICT_ANCHOR,
  '			"session.new.err.mainRed": "main is red — fix main before starting a session",',
].join('\n'))
const REG_ANCHOR = [
  '			ctx.effect(() => ctx.locale.register(NS, {',
  '				zh,',
  '				en',
  '			}), "ui-sidebar: dictionaries");',
].join('\n')
if (!out.includes(REG_ANCHOR)) throw new Error('shell locale.register anchor missing — stock shape moved?')
out = out.replace(REG_ANCHOR, [
  '			ctx.effect(() => ctx.locale.register(NS, {',
  '				zh,',
  '				en,',
  '				pl,',
  '				fr',
  '			}), "ui-sidebar: dictionaries");',
].join('\n'))

// 5d. one CSS rule for the notice, appended to the shell's own css string.
const CSS_END = ';animation:none}}";'
if (!out.includes(CSS_END)) throw new Error('shell css tail anchor missing — stock shape moved?')
out = out.replace(CSS_END, ';animation:none}}"'
  + ' + ".aXa_sb_ctaNotice{margin:-4px 2px 8px;padding:5px 8px;border-radius:8px;'
  + 'border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);'
  + 'background:var(--dsw-alias-bg-layer-1);font-size:11.5px;line-height:15px;word-break:break-word}";')
const NS_BUTTON_ANCHOR = 'className: SidebarRoot_module_css_default.newSession,'
if (!out.includes(NS_BUTTON_ANCHOR)) throw new Error('shell new-session button anchor missing — stock shape moved?')
out = out.replace(NS_BUTTON_ANCHOR, [
  NS_BUTTON_ANCHOR,
  '								// Declarative CTA gate (2026-09-01): the levers are the single',
  '								// source of truth. The render-time value previously only',
  '								// tracked orgOpen while an imperative gate fought it with',
  '								// b.disabled writes — the button rendered ENABLED with no',
  '								// selection and every click no-oped. `!== true` (not',
  '								// `=== false`) keeps the CTA dark until the levers exist.',
  '								disabled: window.__ARXA_SIDEBAR__?.ctaReady !== true,',
  '								title: window.__ARXA_SIDEBAR__?.ctaTitle ?? void 0,',
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
