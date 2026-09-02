// Browser half of arxa-sidebar (shell part; the workspace-section part is
// appended by scripts/gen-workspace.mjs). GENERATED from
// @deepseek-ai/dsh-client-ui-sidebar lib/client.js (dsh 0.1.1-rc.2) +
// scripts/gen-sidebar.mjs deltas. Do not hand-edit: regenerate and let the
// selftest drift gate compare bytes. The stock SidebarRoot shell is kept
// whole — logoRow (brand slots + fold toggle), New-session CTA, regionArea
// (the sidebar.workspaces slot renders the ORGANISATIONS rows), foot,
// collapse/rail/scrollbar-linger behaviour, locale dicts, slot children map.
// The original package stays untouched in node_modules as reference.
window.__ModuleLoader__.load({
	id: "arxa-sidebar",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.module.css.mjs
		const css = ".aXa_sb_root{--dsh-sidebar-inline-padding:12px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;font-size:14px;display:flex}.aXa_sb_root.aXa_sb_collapsed{padding:18px 10px 6px}.aXa_sb_root.aXa_sb_quietBars{--dsh-scrollbar-thumb:transparent;--dsh-scrollbar-thumb-hover:transparent}.aXa_sb_fading>*{opacity:0;transition:opacity .15s var(--ds-ease-in-out)}.aXa_sb_wide{animation:aXa_sb_wide-in .2s var(--ds-ease-in-out)}@keyframes aXa_sb_wide-in{0%{opacity:0}}.aXa_sb_railIn .aXa_sb_iconButton,.aXa_sb_railIn .aXa_sb_newSession,.aXa_sb_railIn .aXa_sb_regionArea{animation:aXa_sb_rail-in .15s var(--ds-ease-in-out) backwards}.aXa_sb_railIn .aXa_sb_footArea{animation:aXa_sb_rail-fade-in .15s var(--ds-ease-in-out) backwards}@keyframes aXa_sb_rail-in{0%{opacity:0;transform:translate(49px)}}@keyframes aXa_sb_rail-fade-in{0%{opacity:0}}.aXa_sb_logoRow{box-sizing:border-box;flex:none;justify-content:flex-end;align-items:center;gap:8px;height:60px;margin-bottom:8px;padding:8px 0 8px 4px;display:flex;overflow:hidden}.aXa_sb_collapsed .aXa_sb_logoRow{justify-content:flex-start;height:36px;margin-bottom:12px;padding:0}.aXa_sb_brand{min-width:0;color:inherit;cursor:pointer;background:0 0;border:none;flex:1;align-items:center;padding:0;display:inline-flex;overflow:hidden}.aXa_sb_brandIdentity{align-items:center;gap:8px;min-width:0;height:24px;display:inline-flex}.aXa_sb_brandMark{flex:none;justify-content:center;align-items:center;display:inline-flex}.aXa_sb_brandName{letter-spacing:.04em;align-items:center;gap:6px;min-width:0;height:24px;font-size:18px;font-weight:600;line-height:24px;display:inline-flex}.aXa_sb_fallbackBrandName{letter-spacing:0;white-space:nowrap;font-size:17px}.aXa_sb_iconButton{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_sb_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_collapsed .aXa_sb_iconButton{width:36px;height:36px}.aXa_sb_collapsed .aXa_sb_toggle .aXa_sb_panelIcon{display:none}.aXa_sb_collapsed .aXa_sb_toggle:hover .aXa_sb_panelIcon{display:inline}.aXa_sb_collapsed .aXa_sb_toggle:hover .aXa_sb_railMark{display:none}.aXa_sb_railMark{justify-content:center;align-items:center;display:inline-flex}.aXa_sb_collapsed .aXa_sb_iconButton{color:var(--dsw-alias-label-primary)}.aXa_sb_buildRevision{height:16px;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);border-radius:3px;align-items:center;padding:0 4px;font-size:8px;font-weight:500;line-height:16px;display:inline-flex}.aXa_sb_newSession{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);height:38px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:12px;flex:none;justify-content:center;align-items:center;gap:6px;margin:0 2px 8px;padding:8px 16px;font-size:14px;font-weight:500;line-height:22px;display:flex;overflow:hidden}.aXa_sb_newSession:hover{background:var(--dsw-alias-button-floating-hover)}.aXa_sb_collapsed .aXa_sb_newSession{background:0 0;border-color:#0000;align-self:flex-start;gap:0;width:36px;height:36px;margin:0 0 12px;padding:0}.aXa_sb_collapsed .aXa_sb_newSession:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_newSessionLabel{white-space:nowrap;max-width:200px;overflow:hidden}.aXa_sb_collapsed .aXa_sb_newSessionLabel{max-width:0}.aXa_sb_regionArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-sidebar-inline-padding));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:hidden}.aXa_sb_collapsed .aXa_sb_regionArea{margin-left:0;margin-right:0;padding-left:0}.aXa_sb_footArea{flex-direction:column;flex:none;display:flex}.aXa_sb_settingsArea,.aXa_sb_footerActions{flex:none;width:100%;min-width:0}.aXa_sb_footerActions{display:flex}.aXa_sb_collapsed .aXa_sb_footArea{align-items:center}.aXa_sb_collapsed .aXa_sb_settingsArea,.aXa_sb_collapsed .aXa_sb_footerActions{justify-content:center;width:auto;display:flex}@media (prefers-reduced-motion:reduce){.aXa_sb_wide,.aXa_sb_fading>*,.aXa_sb_railIn .aXa_sb_iconButton,.aXa_sb_railIn .aXa_sb_newSession,.aXa_sb_railIn .aXa_sb_footArea,.aXa_sb_railIn .aXa_sb_regionArea{transition:none;animation:none}}" + ".aXa_sb_ctaNotice{margin:-4px 2px 8px;padding:5px 8px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);font-size:11.5px;line-height:15px;word-break:break-word}";
		const tagId = "arxa-sidebar/SidebarRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "arxa-sidebar";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var SidebarRoot_module_css_default = {
			"brand": "aXa_sb_brand",
			"brandIdentity": "aXa_sb_brandIdentity",
			"brandMark": "aXa_sb_brandMark",
			"brandName": "aXa_sb_brandName",
			"buildRevision": "aXa_sb_buildRevision",
			"collapsed": "aXa_sb_collapsed",
			"fading": "aXa_sb_fading",
			"fallbackBrandName": "aXa_sb_fallbackBrandName",
			"footArea": "aXa_sb_footArea",
			"footerActions": "aXa_sb_footerActions",
			"iconButton": "aXa_sb_iconButton",
			"logoRow": "aXa_sb_logoRow",
			"newSession": "aXa_sb_newSession",
			"newSessionLabel": "aXa_sb_newSessionLabel",
			"panelIcon": "aXa_sb_panelIcon",
			"quietBars": "aXa_sb_quietBars",
			"rail-fade-in": "aXa_sb_rail-fade-in",
			"rail-in": "aXa_sb_rail-in",
			"railIn": "aXa_sb_railIn",
			"railMark": "aXa_sb_railMark",
			"regionArea": "aXa_sb_regionArea",
			"root": "aXa_sb_root",
			"settingsArea": "aXa_sb_settingsArea",
			"toggle": "aXa_sb_toggle",
			"wide": "aXa_sb_wide",
			"wide-in": "aXa_sb_wide-in"
		};
		//#endregion
		//#region lib/types/client/SidebarRoot.js
		/**
		* Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
		* content freezes at its expanded width (inline style) and fades out in place
		* while the sliding column (AppFrame grid tracks) clips it — nothing reflows
		* mid-slide. At settle the wide-only content unmounts and the four upper
		* controls enter the 56px rail from the same horizontal offset (one icon each,
		* same top-down order) on one fade that ends with the slide. The bottom-pinned
		* settings control only fades. The workspace/session browsing region between
		* the New Session button and the foot is the `sidebar.workspaces` registrant's,
		* and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
		* hands them the wide flag (plus an expand request callback for the browser).
		*
		* The column also owns whether the scroll regions nested in it draw a
		* scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
		* scrollbar indirection away while it is elsewhere, so a list the user is not
		* pointing at carries no bar.
		*/
		/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
		const COLLAPSE_SETTLE_MS = 150;
		/**
		* How long the column's scrollbars stay drawn after the pointer leaves it.
		* The bar is a pointer affordance here, and hiding it on the leave event
		* itself makes it blink out while the pointer is only crossing the column's
		* edge — on the way to the conversation, or around a portalled menu.
		*/
		const SCROLLBAR_LINGER_MS = 2e3;
		/**
		* Render the sidebar column shell.
		* @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
		* @returns the sidebar element tree.
		*/
		function SidebarRoot({ collapsed, width, startSession, toggleSidebar, t, renderSlot }) {
			const [settled, setSettled] = (0, react.useState)(collapsed);
			(0, react.useEffect)(() => {
				if (!collapsed) {
					setSettled(false);
					return;
				}
				const timer = window.setTimeout(() => {
					setSettled(true);
				}, COLLAPSE_SETTLE_MS);
				return () => {
					window.clearTimeout(timer);
				};
			}, [collapsed]);
			const wide = !collapsed || !settled;
		const [orgTick, setOrgTick] = (0, react.useState)(0);
		(0, react.useEffect)(() => {
			const onOrgState = () => setOrgTick((x) => x + 1);
			window.addEventListener("arxa-sidebar-state", onOrgState);
			return () => window.removeEventListener("arxa-sidebar-state", onOrgState);
		}, []);
		// D111 refusal notice. The CODE is held, not the sentence, so a locale
		// switch re-renders the message instead of freezing the wording chosen
		// at click time. startSession dispatches null before every POST, which
		// is what makes the line auto-clear on the next click.
		const [ctaNotice, setCtaNotice] = (0, react.useState)(null);
		(0, react.useEffect)(() => {
			const onNotice = (ev) => setCtaNotice((ev && ev.detail && ev.detail.code) || null);
			window.addEventListener("arxa-sidebar-notice", onNotice);
			return () => window.removeEventListener("arxa-sidebar-notice", onNotice);
		}, []);
			const lastWideWidth = (0, react.useRef)(width);
			if (!collapsed) lastWideWidth.current = width;
			const everWide = (0, react.useRef)(!collapsed);
			if (!collapsed) everWide.current = true;
			const column = (0, react.useRef)(null);
			const [pointerInside, setPointerInside] = (0, react.useState)(false);
			const lingerTimer = (0, react.useRef)(void 0);
			const armLinger = () => {
				if (lingerTimer.current !== void 0) return;
				lingerTimer.current = window.setTimeout(() => {
					lingerTimer.current = void 0;
					setPointerInside(false);
				}, SCROLLBAR_LINGER_MS);
			};
			const cancelLinger = () => {
				window.clearTimeout(lingerTimer.current);
				lingerTimer.current = void 0;
			};
			(0, react.useEffect)(() => {
				if (!pointerInside) return;
				const onMove = (event) => {
					const rect = column.current?.getBoundingClientRect();
					/* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
					if (rect === void 0) return;
					if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) cancelLinger();
					else armLinger();
				};
				document.addEventListener("pointermove", onMove);
				return () => {
					document.removeEventListener("pointermove", onMove);
					cancelLinger();
				};
			}, [pointerInside]);
			return (0, react_jsx_runtime.jsxs)("div", {
				ref: column,
				className: clsx(SidebarRoot_module_css_default.root, !wide && SidebarRoot_module_css_default.collapsed, !wide && everWide.current && SidebarRoot_module_css_default.railIn, collapsed && wide && SidebarRoot_module_css_default.fading, !pointerInside && SidebarRoot_module_css_default.quietBars),
				style: wide ? { width: collapsed ? lastWideWidth.current : width } : void 0,
				onPointerEnter: () => {
					cancelLinger();
					setPointerInside(true);
				},
				onPointerLeave: () => {
					armLinger();
				},
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.logoRow,
						children: [wide && (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: clsx(SidebarRoot_module_css_default.brand, SidebarRoot_module_css_default.wide),
							"aria-label": t("session.new.label"),
							onClick: () => {
								startSession();
							},
							children: (0, react_jsx_runtime.jsxs)("span", {
								className: SidebarRoot_module_css_default.brandIdentity,
								"aria-hidden": "true",
								children: [(0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandMark,
									children: renderSlot("sidebar.brand.mark", { size: 24 }, { fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 }) })
								}), (0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.brandName,
									children: renderSlot("sidebar.brand.name", {}, { fallback: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
										className: SidebarRoot_module_css_default.fallbackBrandName,
										children: "arxa"
									}), (0, react_jsx_runtime.jsx)("span", {
										className: SidebarRoot_module_css_default.buildRevision,
										children: "studio"
									})] }) })
								})]
							})
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: collapsed ? t("toggle.open") : t("toggle.collapse"),
							delayMs: 500,
							children: (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: clsx(SidebarRoot_module_css_default.iconButton, SidebarRoot_module_css_default.toggle),
								"aria-label": collapsed ? t("toggle.open") : t("toggle.collapse"),
								onClick: () => {
									toggleSidebar();
								},
								children: [!wide && (0, react_jsx_runtime.jsx)("span", {
									className: SidebarRoot_module_css_default.railMark,
									"aria-hidden": "true",
									children: renderSlot("sidebar.brand.mark", { size: 24 }, { fallback: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.FishLogo, { size: 24 }) })
								}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutline16, {
									className: SidebarRoot_module_css_default.panelIcon,
									size: wide ? 16 : 18
								})]
							})
						})]
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("session.new.label"),
						delayMs: 500,
						disabled: wide,
						children: (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: SidebarRoot_module_css_default.newSession,
								// Declarative CTA gate (2026-09-01): the levers are the single
								// source of truth. The render-time value previously only
								// tracked orgOpen while an imperative gate fought it with
								// b.disabled writes — the button rendered ENABLED with no
								// selection and every click no-oped. `!== true` (not
								// `=== false`) keeps the CTA dark until the levers exist.
								disabled: window.__ARXA_SIDEBAR__?.ctaReady !== true,
								title: window.__ARXA_SIDEBAR__?.ctaTitle ?? void 0,
							"aria-label": t("session.new.label"),
							onClick: () => {
								startSession();
							},
							children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconNewChatOutline16, { size: wide ? 14 : 18 }), wide && (0, react_jsx_runtime.jsx)("span", {
								className: clsx(SidebarRoot_module_css_default.newSessionLabel, SidebarRoot_module_css_default.wide),
								children: t("session.new")
							})]
						})
					}),
					ctaNotice && wide ? (0, react_jsx_runtime.jsx)("div", {
						className: "aXa_sb_ctaNotice",
						"data-arxa-cta-notice": ctaNotice,
						role: "status",
						// Known codes get a sentence; anything else shows the server's own
						// message rather than a shrug — an unmapped refusal is still more
						// use to the reader than silence.
						children: ctaNotice === "main-red" ? t("session.new.err.mainRed") : ctaNotice
					}) : null,
					(0, react_jsx_runtime.jsx)("div", {
						className: SidebarRoot_module_css_default.regionArea,
						children: renderSlot("sidebar.workspaces", {
							wide,
							expandSidebar: () => {
								if (collapsed) toggleSidebar();
							}
						})
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.footArea,
						children: [(0, react_jsx_runtime.jsx)("div", {
							className: SidebarRoot_module_css_default.footerActions,
							children: renderSlot("sidebar.footer.action", { wide })
						}), (0, react_jsx_runtime.jsx)("div", {
							className: SidebarRoot_module_css_default.settingsArea,
							children: renderSlot("sidebar.settings", { wide })
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"session.new": "新会话",
			"session.new.label": "新建会话",
			"toggle.open": "打开侧边栏",
			"toggle.collapse": "收起侧边栏"
		};
		/** English dictionary, checked complete against the zh key set. */
		const pl = {
			// TODO native review (conformance decision 4): machine-drafted.
			"session.new.err.mainRed": "main jest czerwony — napraw main przed rozpoczęciem sesji"
		};
		const fr = {
			// TODO native review (conformance decision 4): machine-drafted.
			"session.new.err.mainRed": "main est au rouge — corrigez main avant de démarrer une session"
		};
		const en = {
			"session.new.err.mainRed": "main is red — fix main before starting a session",
			"session.new": "New Session",
			"session.new.label": "New session",
			"toggle.open": "Open sidebar",
			"toggle.collapse": "Collapse sidebar"
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Dictionary namespace owned by this plugin (shell controls copy). */
		const NS = "sidebar";
		/** Services required by the sidebar plugin. */
		const inject = [
			"slots",
			"layout",
			"sessions",
			"workspaces",
			"locale"
		];
		/** Registers the sidebar shell and its service callbacks.
		* @param ctx - Client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en,
				pl,
				fr
			}), "ui-sidebar: dictionaries");
			const injectProps = () => ({
				startSession: () => {
					// Organisations world (v2, grilled 2026-08-30; loop closed
					// 2026-09-01): the shell CTA creates a session in the SELECTED
					// workspace row and OPENS it — server create, then the org
					// lever (openCreated) carries session.open + conversation
					// focus, the same flow a tree-row open uses. The first cut
					// fired-and-forgot the POST: the session landed but nothing
					// surfaced for ~5s (next poll), reading as a dead button.
					// No selection → no-op (the button is disabled — see the
					// button splice below).
					const w = window.__ARXA_SIDEBAR__;
					const sel = w && w.selectedWorkspace ? w.selectedWorkspace() : null;
					if (!sel) return;
					// D111 (2026-09-02): a refusal must be VISIBLE. This handler used
					// to drop it twice over — a { ok: false } body fell out of the
					// `if` below without a branch, and a thrown error died in a bare
					// catch — so a red main read to the user as a dead button. The
					// code travels to SidebarRoot on an event (the same shape the
					// ctaReady levers already use) because startSession lives in
					// injectProps, outside the component that owns the notice state.
					window.dispatchEvent(new CustomEvent("arxa-sidebar-notice", { detail: { code: null } }));
					const notice = (code) => window.dispatchEvent(new CustomEvent("arxa-sidebar-notice", { detail: { code } }));
					fetch("/__arxa/sidebar/action", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ action: "workspace.new-session", arg: { orgId: sel.orgId, workspace: sel.rowId } })
					}).then((r) => r.json()).then((b) => {
						// The action route answers { ok: false, error } — `error` is the
						// thrown message verbatim, so "main-red" arrives as that string.
						if (!b || !b.ok) { notice(String((b && b.error) || "unknown")); return; }
						if (b.result && b.result.id && typeof w.openCreated === "function") w.openCreated(sel.orgId, b.result.id);
					}).catch((e) => notice(String((e && e.message) || e)));
				},
				toggleSidebar: () => {
					ctx.layout.toggleSidebar();
				}
			});
			ctx.effect(() => ctx.slots.register({
				name: "sidebar",
				locale: NS,
				children: {
					"sidebar.brand.mark": {
						kind: "single",
						scope: "root"
					},
					"sidebar.brand.name": {
						kind: "single",
						scope: "root"
					},
					"sidebar.workspaces": {
						kind: "single",
						scope: "root"
					},
					"sidebar.settings": {
						kind: "single",
						scope: "root"
					},
					"sidebar.footer.action": {
						kind: "list",
						scope: "root"
					}
				},
				inject: injectProps
			}, SidebarRoot), "ui-sidebar: slot registration");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		{ // workspace section half (org rows world) — nested module scope
// Browser half of arxa-sidebar (workspace-section part). GENERATED by
// scripts/gen-workspace.mjs from @deepseek-ai/dsh-client-ui-workspace
// lib/client.js (dsh 0.1.1-rc.2) + lib/workspace-region.snippet.txt +
// the deltas listed in that script; composed after the shell part from
// scripts/gen-sidebar.mjs into lib/client.js. Do not hand-edit: regenerate
// and let the selftest drift gate compare bytes. The stock component tree
// (groups, rows, search, view options, menus, pills, animations) is kept
// whole; only the data faces, the add flow and the menu routing moved.
// The original package stays untouched in node_modules as reference.
		  const wsExports = (function (require) {

		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/types/client/stores.js
		/**
		* The workspace browser's viewing store: the session-list grouping mode,
		* persisted across reloads. Module level exports the factory only (a
		* module-level handle would pin the store identity across plugin reloads);
		* register() receives the factory and the browser derives its PropsStore
		* share from the return type.
		*/
		/** Browser-local order account for the hierarchy-free flat Session list. */
		const FLAT_SESSION_ORDER_KEY = "__flat_session_order__";
		/**
		* Create the workspace browser viewing store handle.
		* @returns the store handle (spec + type + identity + factory in one).
		*/
		function createWorkspaceViewStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					groupBy: "workspace",
					orderBy: "updated",
					groupExpansion: {},
					sessionOrderByAccount: {},
					sessionUpdatedAtByAccount: {}
				}),
				persist: "dsh.workspace.view.v5",
				actions: {
					setGroupBy: (d, mode) => {
						d.groupBy = mode;
					},
					setOrderBy: (d, mode) => {
						d.orderBy = mode;
					},
					setGroupExpanded: (d, key, expanded) => {
						d.groupExpansion[key] = expanded;
					},
					retainAccountKeys: (d, workspaceKeys) => {
						const retained = new Set(workspaceKeys);
						d.groupExpansion = Object.fromEntries(Object.entries(d.groupExpansion).filter(([key]) => retained.has(key)));
						d.sessionOrderByAccount = Object.fromEntries(Object.entries(d.sessionOrderByAccount).filter(([key]) => retained.has(key)));
						d.sessionUpdatedAtByAccount = Object.fromEntries(Object.entries(d.sessionUpdatedAtByAccount).filter(([key]) => retained.has(key)));
					},
					syncSessionOrderAccount: (d, accountKey, order, updatedAt) => {
						d.sessionOrderByAccount[accountKey] = order;
						d.sessionUpdatedAtByAccount[accountKey] = updatedAt;
					},
					setSessionOrder: (d, accountKey, order) => {
						d.sessionOrderByAccount[accountKey] = order;
					}
				}
			});
		}
		//#endregion
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		/** Display label for the ungrouped bucket row. */
		const UNGROUPED_LABEL = "Ungrouped";
		/**
		* Directory display label: basename of the path (both separators accepted).
		* Ungrouped-bucket fallback for surfaces without a workspace title.
		* @param cwd - directory path, or undefined for the ungrouped bucket.
		* @returns basename, the raw cwd when it has no basename, or the ungrouped label.
		*/
		function workspaceLabel(cwd) {
			if (cwd === void 0 || cwd === "") return UNGROUPED_LABEL;
			const base = cwd.replace(/[/\\]+$/, "").split(/[/\\]/).pop();
			return base !== void 0 && base !== "" ? base : cwd;
		}
		/** Recency comparator: newest first, id as the deterministic tiebreak (ids are unique per group). */
		function byRecency(a, b) {
			if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
			return a.id < b.id ? -1 : 1;
		}
		/**
		* Ordinary sessions are visible; among blank sessions, only the current one
		* is visible. Subagent children use their parent header catalog; archived
		* sessions are visible nowhere, while their accounting slots remain so
		* unarchiving restores position.
		*/
		function sessionVisible(session, current, archived) {
			return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
		}
		/**
		* A blank session is the selected Workspace's provisional New Session row;
		* its canonical title never enters search (blank rows are query-excluded)
		* and the renderer localizes its display label.
		*/
		function sessionTitle(session) {
			return session.blank ? "New Session" : session.displayTitle;
		}
		/** Build one group without projecting session lineage into presentation. */
		function buildGroup(key, workspaceId, cwd, createdAt, label, members, order) {
			const sessions = [...members];
			if (order === "recency") sessions.sort(byRecency);
			return {
				key,
				workspaceId,
				cwd,
				createdAt,
				label,
				sessions
			};
		}
		/** Apply a stored Ungrouped order and append newly loose Sessions by recency. */
		function orderedUngrouped(members, stored) {
			const byId = new Map(members.map((session) => [session.id, session]));
			const included = /* @__PURE__ */ new Set();
			const ordered = [];
			for (const key of stored) {
				const session = byId.get(key);
				if (session === void 0 || included.has(key)) continue;
				ordered.push(session);
				included.add(key);
			}
			for (const session of [...members].sort(byRecency)) {
				if (included.has(session.id)) continue;
				ordered.push(session);
			}
			return ordered;
		}
		/**
		* Group Sessions by Host Workspace: one group per entity in stable Host
		* order, with members resolved from sessionIds in their stored order. Sessions
		* outside every Workspace trail in the browser-local Ungrouped order, which
		* falls back to recency before that order is initialized.
		*/
		function groupByWorkspace(list, workspaces, archived, ungroupedOrder) {
			const groups = [];
			const accounted = /* @__PURE__ */ new Set();
			for (const workspace of workspaces) {
				const members = [];
				for (const id of workspace.sessionIds) {
					const summary = list.byId[id];
					if (summary === void 0) continue;
					accounted.add(id);
					if (!sessionVisible(summary, list.current, archived)) continue;
					members.push(summary);
				}
				groups.push(buildGroup(workspace.workspaceId, workspace.workspaceId, workspace.path, Date.parse(workspace.createdAt), workspace.title, members, "account"));
			}
			const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && sessionVisible(s, list.current, archived));
			if (stray.length > 0) groups.push(buildGroup("", void 0, void 0, void 0, UNGROUPED_LABEL, ungroupedOrder === void 0 ? stray : orderedUngrouped(stray, ungroupedOrder), ungroupedOrder === void 0 ? "recency" : "account"));
			return groups;
		}
		function sessionNode(s, descendants) {
			return {
				id: s.id,
				title: sessionTitle(s),
				blank: s.blank,
				running: s.running,
				runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,
				completed: s.completed === true,
				updatedAt: s.updatedAt,
				...s.pendingInteraction === void 0 ? {} : { pendingInteraction: s.pendingInteraction }
			};
		}
		/**
		* Derive the workspace browser groups with every session as a top-level row.
		*
		* Every group shows; sessions populate under expanded groups in the selected
		* local order. Blank sessions are excluded except for the selected
		* provisional New Session row; archived sessions are excluded everywhere.
		* Content search lives outside this derivation
		* (see {@link deriveSearchResults}).
		* @param list - sessions list snapshot (`current` feeds containsCurrent).
		* @param workspaces - real workspaces in stable Host order.
		* @param archivedSessionIds - registry-global archive set.
		* @param view - local expansion arrays.
		* @returns group sections in render order.
		*/
		function deriveGroups(list, workspaces, archivedSessionIds, view) {
			const archived = new Set(archivedSessionIds);
			const expandedGroups = new Set(view.expandedGroups);
			const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
			const currentGroup = list.current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(list.current))?.workspaceId ?? "";
			const groups = [];
			for (const g of groupByWorkspace(list, workspaces, archived, view.ungroupedOrder)) {
				const expanded = expandedGroups.has(g.key);
				groups.push({
					key: g.key,
					workspaceId: g.workspaceId,
					cwd: g.cwd,
					createdAt: g.createdAt,
					label: g.label,
					sessionCount: g.sessions.length,
					expanded,
					containsCurrent: g.key === currentGroup,
					sessions: expanded ? g.sessions.map((session) => sessionNode(session, descendants)) : []
				});
			}
			return groups;
		}
		/**
		* Derive the flat session list ("In one list" mode): every session — fork
		* children included — as a top-level row, strictly newest-first. No grouping,
		* no parent/child adjacency. Content search lives outside this derivation
		* (see {@link deriveSearchResults}).
		* @param list - sessions list snapshot.
		* @param archivedSessionIds - registry-global archive set.
		* @returns flat rows in render order.
		*/
		function deriveFlat(list, archivedSessionIds) {
			const archived = new Set(archivedSessionIds);
			const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
			const rows = [];
			for (const id of list.ids) {
				const s = list.byId[id];
				if (s === void 0 || !sessionVisible(s, list.current, archived)) continue;
				rows.push(s);
			}
			rows.sort(byRecency);
			return rows.map((session) => sessionNode(session, descendants));
		}
		/**
		* Merge immediate title/Workspace substring matches with ranked Host content
		* matches. Local rows lead newest-first, content-only rows retain backend
		* order, and duplicate sessions receive the backend snippet in place.
		* @param list - session metadata authority.
		* @param workspaces - Workspace membership and display labels.
		* @param query - caller text; surrounding whitespace is ignored.
		* @param archivedSessionIds - registry-global archive set (members never match).
		* @param content - ranked Host content-search page.
		* @param limit - protocol-owned maximum merged row count.
		* @returns bounded deduplicated flat rows and a refine-query hint bit.
		*/
		function deriveSearchResults(list, workspaces, query, archivedSessionIds, content, limit) {
			const q = query.trim().toLowerCase();
			if (q === "") return {
				items: [],
				hasMore: false
			};
			const archived = new Set(archivedSessionIds);
			const descendants = (0, _deepseek_ai_dsh_client_runtime_client.indexSubagentDescendants)(list.byId);
			const workspaceBySession = /* @__PURE__ */ new Map();
			for (const workspace of workspaces) for (const sessionId of workspace.sessionIds) if (!workspaceBySession.has(sessionId)) workspaceBySession.set(sessionId, workspace.title);
			const labelOf = (summary) => workspaceBySession.get(summary.id) ?? workspaceLabel(summary.cwd);
			const contentBySession = /* @__PURE__ */ new Map();
			for (const item of content.items) if (!contentBySession.has(item.sessionId)) contentBySession.set(item.sessionId, item);
			const local = [];
			for (const id of list.ids) {
				const summary = list.byId[id];
				if (summary === void 0 || summary.blank || !sessionVisible(summary, list.current, archived)) continue;
				if (sessionTitle(summary).toLowerCase().includes(q) || labelOf(summary).toLowerCase().includes(q)) local.push(summary);
			}
			local.sort(byRecency);
			const ordered = [];
			const included = /* @__PURE__ */ new Set();
			const include = (summary) => {
				if (included.has(summary.id)) return;
				included.add(summary.id);
				ordered.push(summary);
			};
			for (const summary of local) include(summary);
			for (const item of content.items) {
				const summary = list.byId[item.sessionId];
				if (summary !== void 0 && !summary.blank && sessionVisible(summary, list.current, archived)) include(summary);
			}
			return {
				items: ordered.slice(0, limit).map((summary) => {
					const match = contentBySession.get(summary.id);
					return {
						id: summary.id,
						title: sessionTitle(summary),
						workspace: labelOf(summary),
						running: summary.running,
						runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,
						...summary.pendingInteraction === void 0 ? {} : { pendingInteraction: summary.pendingInteraction },
						completed: summary.completed === true,
						...match === void 0 ? {} : { snippet: match.snippet }
					};
				}),
				hasMore: content.hasMore || ordered.length > limit
			};
		}
		/**
		* Compact relative time for session rows, as a structured bucket the
		* renderer localizes ("now"/"5min"/"3h"/"2d"/"4mo"/"1y" in en).
		* @param updatedAt - epoch ms of the session's last activity.
		* @param now - current epoch ms (injected for pure rendering).
		* @returns the row's trailing time bucket and magnitude.
		*/
		function relativeTime(updatedAt, now) {
			const MIN = 6e4;
			const HOUR = 36e5;
			const DAY = 864e5;
			const diff = Math.max(0, now - updatedAt);
			if (diff < MIN) return {
				unit: "now",
				n: 0
			};
			if (diff < HOUR) return {
				unit: "minutes",
				n: Math.floor(diff / MIN)
			};
			if (diff < DAY) return {
				unit: "hours",
				n: Math.floor(diff / HOUR)
			};
			if (diff < 30 * DAY) return {
				unit: "days",
				n: Math.floor(diff / DAY)
			};
			if (diff < 365 * DAY) return {
				unit: "months",
				n: Math.floor(diff / (30 * DAY))
			};
			return {
				unit: "years",
				n: Math.floor(diff / (365 * DAY))
			};
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-workspace/src/client/rows/Rows.module.css.mjs
		const css$2 = ".aXa_wsr_projectRow,.aXa_wsr_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex}.aXa_wsr_projectRow:hover,.aXa_wsr_sessionRow:hover,.aXa_wsr_sessionRow.aXa_wsr_selected{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsr_searchResultRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:48px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}.aXa_wsr_searchResultRow:hover,.aXa_wsr_searchResultRow.aXa_wsr_selected{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsr_searchResultHeading{align-items:center;min-width:0;display:flex}.aXa_wsr_searchResultTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;margin-left:4px;font-size:14px;line-height:20px;overflow:hidden}.aXa_wsr_searchResultMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}.aXa_wsr_searchResultWorkspace,.aXa_wsr_searchResultSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}.aXa_wsr_searchResultWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}.aXa_wsr_searchResultSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}.aXa_wsr_projectRow{box-sizing:border-box;align-items:center;height:34px}.aXa_wsr_projectRow .aXa_wsr_rowActions{height:20px}.aXa_wsr_sessionRow{height:32px;animation:aXa_wsr_row-in .15s var(--ds-ease-in-out);gap:0}.aXa_wsr_sessionRow .aXa_wsr_title{margin:0 6px 0 4px}.aXa_wsr_flatSessionRowWithoutStatus .aXa_wsr_title{margin-left:0}@keyframes aXa_wsr_row-in{0%{opacity:0}}.aXa_wsr_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.aXa_wsr_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.aXa_wsr_folderActive{color:var(--dsw-alias-state-business-primary)}.aXa_wsr_projectRow .aXa_wsr_chevron{display:none}.aXa_wsr_projectRow:hover .aXa_wsr_chevron{display:inline-flex}.aXa_wsr_projectRow:hover .aXa_wsr_folder{display:none}.aXa_wsr_arrow{transition:transform .15s var(--ds-ease-in-out)}.aXa_wsr_arrowOpen{transform:rotate(90deg)}.aXa_wsr_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.aXa_wsr_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden}.aXa_wsr_renameInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);min-width:0;color:inherit;border-radius:4px;outline:none;padding:0 2px;font-size:14px;line-height:20px}.aXa_wsr_sessionRow .aXa_wsr_title{flex:1}.aXa_wsr_meta{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;overflow:hidden}.aXa_wsr_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}.aXa_wsr_dot{flex:none}.aXa_wsr_rowActions{flex:none;align-items:center;gap:12px;display:none}.aXa_wsr_projectRow:hover .aXa_wsr_rowActions,.aXa_wsr_sessionRow:hover .aXa_wsr_rowActions,.aXa_wsr_projectRow.aXa_wsr_menuOpen .aXa_wsr_rowActions,.aXa_wsr_sessionRow.aXa_wsr_menuOpen .aXa_wsr_rowActions{display:inline-flex}.aXa_wsr_sessionRow:hover .aXa_wsr_time,.aXa_wsr_sessionRow.aXa_wsr_menuOpen .aXa_wsr_time{display:none}.aXa_wsr_projectRow.aXa_wsr_menuOpen,.aXa_wsr_sessionRow.aXa_wsr_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsr_sessionRow.aXa_wsr_dropBefore,.aXa_wsr_sessionRow.aXa_wsr_dropAfter{position:relative}.aXa_wsr_sessionRow.aXa_wsr_dropBefore:before,.aXa_wsr_sessionRow.aXa_wsr_dropAfter:after{content:\"\";z-index:1;background:linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat, linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat, linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;pointer-events:none;height:12px;position:absolute;left:0;right:4px}.aXa_wsr_sessionRow.aXa_wsr_dropBefore:before{top:-7px}.aXa_wsr_sessionRow.aXa_wsr_dropAfter:after{bottom:-7px}.aXa_wsr_hoverContent{flex-direction:column;gap:8px;display:flex}.aXa_wsr_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.aXa_wsr_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}.aXa_wsr_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}.aXa_wsr_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}.aXa_wsr_iconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_wsr_iconButton:hover{color:var(--dsw-alias-label-primary)}.aXa_wsr_chevron{color:var(--dsw-alias-label-caption)}@media (prefers-reduced-motion:reduce){.aXa_wsr_sessionRow,.aXa_wsr_arrow{transition:none;animation:none}}";
		const tagId$2 = "arxa-sidebar-workspace/Rows.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "arxa-sidebar-workspace";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var Rows_module_css_default = {
			"arrow": "aXa_wsr_arrow",
			"arrowOpen": "aXa_wsr_arrowOpen",
			"chevron": "aXa_wsr_chevron",
			"dot": "aXa_wsr_dot",
			"dropAfter": "aXa_wsr_dropAfter",
			"dropBefore": "aXa_wsr_dropBefore",
			"flatSessionRowWithoutStatus": "aXa_wsr_flatSessionRowWithoutStatus",
			"folder": "aXa_wsr_folder",
			"folderActive": "aXa_wsr_folderActive",
			"hoverContent": "aXa_wsr_hoverContent",
			"hoverPath": "aXa_wsr_hoverPath",
			"hoverStatus": "aXa_wsr_hoverStatus",
			"hoverTime": "aXa_wsr_hoverTime",
			"hoverTitle": "aXa_wsr_hoverTitle",
			"iconButton": "aXa_wsr_iconButton",
			"menuOpen": "aXa_wsr_menuOpen",
			"meta": "aXa_wsr_meta",
			"projectRow": "aXa_wsr_projectRow",
			"projectText": "aXa_wsr_projectText",
			"renameInput": "aXa_wsr_renameInput",
			"row-in": "aXa_wsr_row-in",
			"rowActions": "aXa_wsr_rowActions",
			"searchResultHeading": "aXa_wsr_searchResultHeading",
			"searchResultMeta": "aXa_wsr_searchResultMeta",
			"searchResultRow": "aXa_wsr_searchResultRow",
			"searchResultSnippet": "aXa_wsr_searchResultSnippet",
			"searchResultTitle": "aXa_wsr_searchResultTitle",
			"searchResultWorkspace": "aXa_wsr_searchResultWorkspace",
			"selected": "aXa_wsr_selected",
			"sessionRow": "aXa_wsr_sessionRow",
			"slot": "aXa_wsr_slot",
			"time": "aXa_wsr_time",
			"title": "aXa_wsr_title",
			"visuallyHidden": "aXa_wsr_visuallyHidden"
		};
		//#endregion
		//#region lib/types/client/rows/Rows.js
		/**
		* Workspace browser tree row components (figma Cell set 14:3080): pure presentational —
		* all data and callbacks arrive via props. Hover swaps (folder->chevron,
		* time->ellipsis, action buttons) are CSS-only. Row ... menus are visual-only
		* except workspace Rename/Delete and session Rename/Fork/Archive; the session
		* and workspace hover cards are suppressed while a menu is open.
		*/
		/** Row display title: blank rows show the localized New Session label. */
		function displayTitle(node, t) {
			return node.blank ? t("session.new") : node.title;
		}
		/** Localized compact relative time ("刚刚"/"5分钟" in zh, "now"/"5min" in en). */
		function timeLabel(updatedAt, now, t) {
			const { unit, n } = relativeTime(updatedAt, now);
			return unit === "now" ? t("time.now") : t(`time.${unit}`, { n });
		}
		/** Hover-card variant: distances wrap in the ago template; the now bucket stays bare (no "now ago"). */
		function hoverTimeLabel(updatedAt, now, t) {
			const { unit, n } = relativeTime(updatedAt, now);
			return unit === "now" ? t("time.now") : t("time.ago", { t: t(`time.${unit}`, { n }) });
		}
		/**
		* Absolute creation time through the dictionary's date template (the message
		* clock pattern): `toLocaleString` would follow the browser language, not the
		* app locale, and produce mixed-language text after a switch.
		*/
		function createdLabel(createdAt, t) {
			const d = new Date(createdAt);
			const pad2 = (v) => String(v).padStart(2, "0");
			return t("hover.created", { time: `${t("date.ymd", {
				y: d.getFullYear(),
				m: d.getMonth() + 1,
				d: d.getDate()
			})} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
		}
		/** Hover-card body: workspace title, display directory path, absolute creation time. */
		function WorkspaceHoverContent({ label, cwd, createdAt, t }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: Rows_module_css_default.hoverContent,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						className: Rows_module_css_default.hoverTitle,
						children: label
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: Rows_module_css_default.hoverPath,
						children: cwd
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: Rows_module_css_default.hoverTime,
						children: createdLabel(createdAt, t)
					})
				]
			});
		}
		/** Pointer-position half of a row (insert line above or below). */
		function rowHalf(e) {
			const rect = e.currentTarget.getBoundingClientRect();
			return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
		}
		/**
		* Project (workspace) header row: folder + title;
		* hover reveals the chevron and create button, and dwelling on a real
		* Workspace shows its hover card (the ungrouped bucket has none).
		* `containsCurrent` arrives on the node (derivation fact, no renderer scan).
		* @param props.group - derived group node.
		* @param props.onToggle - expand/collapse the group.
		* @param props.onCreate - start a frontend Session inside this Workspace.
		* @param props.drag - optional workspace-row drag wiring.
		* @param props.home - host account home for POSIX hover-path abbreviation.
		* @param props.t - the browser root's locale seat.
		* @returns the row element.
		*/
		function ProjectRowItem({ group, onToggle, onCreate, actions, drag, home, t }) {
			const row = group;
			const label = row.workspaceId === void 0 ? t("group.ungrouped") : row.label;
			const active = group.expanded && group.containsCurrent;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const workspaceMenuItems = [{
				id: "rename",
				label: t("rename"),
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
			}, {
				id: "delete",
				label: t("delete.workspace"),
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}),
				danger: true
			}];
			const ownRow = (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),
				role: "treeitem",
				"aria-expanded": row.expanded,
				onClick: () => { onToggle(); ARXA_SELECT_WS(row.workspaceId); },
				draggable: drag !== void 0,
				onDragStart: drag === void 0 ? void 0 : (e) => {
					e.dataTransfer.effectAllowed = "move";
					e.dataTransfer.setData("text/plain", row.key);
					drag.start();
				},
				onDragEnd: drag?.end,
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder, active && Rows_module_css_default.folderActive),
						children: row.expanded ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, row.expanded && Rows_module_css_default.arrowOpen) })
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.projectText,
						children: (0, react_jsx_runtime.jsx)("span", {
							className: Rows_module_css_default.title,
							children: label
						})
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						className: Rows_module_css_default.rowActions,
						children: [false && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items: workspaceMenuItems,
							onSelect: (id) => {
								setMenuOpen(false);
								/* v8 ignore next -- workspaceMenuItems carries exactly these two rows today. */
								if (id !== "rename" && id !== "delete") return;
								if (id === "rename") actions.rename();
								else actions.delete();
							},
							portal: true,
							closeOnPointerLeave: true,
							anchor: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Rows_module_css_default.iconButton,
								"aria-label": t("actions.workspace.aria", { name: label }),
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
							})
						}), (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: Rows_module_css_default.iconButton,
							"aria-label": t("actions.newSession.aria", { name: label }),
							onClick: (e) => {
								e.stopPropagation();
								onCreate();
							},
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
						})]
					})
				]
			});
			if (row.createdAt === void 0) return ownRow;
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: ownRow,
				content: (0, react_jsx_runtime.jsx)(WorkspaceHoverContent, {
					label: row.label,
					cwd: row.cwd === void 0 ? void 0 : (0, _deepseek_ai_dsh_client_runtime_client.abbreviateHomePath)(row.cwd, home),
					createdAt: row.createdAt,
					t
				}),
				disabled: menuOpen,
				copyText: row.cwd,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		/* v8 ignore next 3 -- closed-union backstop; only reached if the status is forged */
		function assertNever(value) {
			throw new Error(`unknown pending interaction: ${String(value)}`);
		}
		/**
		* Session status presentation; pending interaction is primary and live activity
		* outranks completion reminders.
		*/
		function sessionStatuses(node, t) {
			const subagents = node.runningSubagentCount === 0 ? void 0 : {
				state: "ongoing",
				label: t(node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other", { n: node.runningSubagentCount })
			};
			let pending;
			switch (node.pendingInteraction) {
				case "approval":
					pending = {
						state: "warning",
						label: t("status.waitingApproval")
					};
					break;
				case "plan-review":
					pending = {
						state: "warning",
						label: t("status.planReview")
					};
					break;
				case "question":
					pending = {
						state: "warning",
						label: t("status.waitingAnswer")
					};
					break;
				case void 0: break;
				/* v8 ignore next -- closed PendingInteractionStatus union */
				default: return assertNever(node.pendingInteraction);
			}
			if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
			if (node.running) {
				const primary = {
					state: "ongoing",
					label: t("status.running")
				};
				return subagents === void 0 ? [primary] : [primary, subagents];
			}
			if (subagents !== void 0) return [subagents];
			if (node.completed) return [{
				state: "done",
				label: t("status.completed")
			}];
			return [{
				state: "done",
				label: t("status.idle")
			}];
		}
		/** Primary status dot plus every status's screen-reader label, shared by the search and session rows. */
		function SessionStatusDots({ statuses }) {
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: statuses[0].state }), statuses.map((status) => (0, react_jsx_runtime.jsx)("span", {
				className: Rows_module_css_default.visuallyHidden,
				children: status.label
			}, status.label))] });
		}
		/** Hover-card body: full title, relative time, and every relevant live status. */
		function SessionHoverContent({ node, now, t }) {
			const statuses = sessionStatuses(node, t);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: Rows_module_css_default.hoverContent,
				children: [
					(0, react_jsx_runtime.jsx)("div", {
						className: Rows_module_css_default.hoverTitle,
						children: displayTitle(node, t)
					}),
					!node.blank && (0, react_jsx_runtime.jsx)("div", {
						className: Rows_module_css_default.hoverTime,
						children: hoverTimeLabel(node.updatedAt, now, t)
					}),
					statuses.map((status) => (0, react_jsx_runtime.jsxs)("div", {
						className: Rows_module_css_default.hoverStatus,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: status.state }), (0, react_jsx_runtime.jsx)("span", { children: status.label })]
					}, status.label))
				]
			});
		}
		/**
		* One flat search result: title, Workspace context, and optional content
		* excerpt. Search navigation opens the session only; it does not address an
		* event inside the conversation.
		* @param props.result - merged local/content search row.
		* @param props.currentId - selected session id.
		* @param props.onOpen - open the selected session.
		* @param props.t - Workspace-browser translation seat.
		* @returns the result button.
		*/
		function SearchResultItem({ result, currentId, onOpen, t }) {
			const selected = result.id === currentId;
			const statuses = sessionStatuses(result, t);
			const primaryStatus = statuses[0];
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: clsx(Rows_module_css_default.searchResultRow, selected && Rows_module_css_default.selected),
				role: "treeitem",
				"aria-selected": selected,
				onClick: () => {
					onOpen(result.id);
				},
				children: [(0, react_jsx_runtime.jsxs)("span", {
					className: Rows_module_css_default.searchResultHeading,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.slot,
						children: (primaryStatus.state !== "done" || result.completed) && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
					}), (0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.searchResultTitle,
						children: result.title
					})]
				}), (0, react_jsx_runtime.jsxs)("span", {
					className: Rows_module_css_default.searchResultMeta,
					children: [(0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.searchResultWorkspace,
						children: result.workspace
					}), result.snippet !== void 0 && (0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.searchResultSnippet,
						children: result.snippet
					})]
				})]
			});
		}
		/**
		* One top-level 34px session row: status dot (pending user interaction outranks
		* own or descendant activity), title, relative time, and the row actions menu.
		* @param props.node - derived session node.
		* @param props.currentId - selected session id (row highlight).
		* @param props.now - epoch ms for relative-time formatting.
		* @param props.onOpen - open a session by id.
		* @param props.onRename - open the session rename dialog (id + current title).
		* @param props.onFork - fork a session at its last completed turn.
		* @param props.onArchive - archive a session by id.
		* @param props.drag - optional draggable-row wiring.
		* @param props.flat - omit the empty status slot in the hierarchy-free flat list.
		* @param props.t - the browser root's locale seat.
		* @returns the session row.
		*/
		function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {
			const row = node;
			const title = displayTitle(node, t);
			const selected = node.id === currentId;
			const statuses = sessionStatuses(node, t);
			const showStatus = statuses[0].state !== "done" || row.completed;
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			const sessionMenuItems = [
				{
					id: "rename",
					label: t("rename"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})
				},
				{
					id: "fork",
					label: t("menu.fork"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
				},
				{
					id: "archive",
					label: t("menu.archiveSession"),
					icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })
				}
			];
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.HoverCard, {
				anchor: (0, react_jsx_runtime.jsxs)("div", {
					className: clsx(Rows_module_css_default.sessionRow, selected && Rows_module_css_default.selected, menuOpen && Rows_module_css_default.menuOpen, flat && !showStatus && Rows_module_css_default.flatSessionRowWithoutStatus, drag?.marker === "before" && Rows_module_css_default.dropBefore, drag?.marker === "after" && Rows_module_css_default.dropAfter),
					role: "treeitem",
					"aria-selected": selected,
					onClick: () => {
						onOpen(node.id);
					},
					draggable: drag !== void 0,
					onDragStart: drag === void 0 ? void 0 : (e) => {
						e.dataTransfer.effectAllowed = "move";
						e.dataTransfer.setData("text/plain", node.id);
						drag.start();
					},
					onDragEnd: drag?.end,
					onDragOver: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						e.dataTransfer.dropEffect = "move";
						drag.hover(rowHalf(e));
					},
					onDrop: drag === void 0 ? void 0 : (e) => {
						if (!drag.active) return;
						e.preventDefault();
						drag.drop(rowHalf(e));
					},
					children: [
						(!flat || showStatus) && (0, react_jsx_runtime.jsx)("span", {
							className: Rows_module_css_default.slot,
							children: showStatus && (0, react_jsx_runtime.jsx)(SessionStatusDots, { statuses })
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: Rows_module_css_default.title,
							children: title
						}),
						!row.blank && (0, react_jsx_runtime.jsx)("span", {
							className: Rows_module_css_default.time,
							children: timeLabel(row.updatedAt, now, t)
						}),
						!row.blank && (0, react_jsx_runtime.jsx)("span", {
							className: Rows_module_css_default.rowActions,
							children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								open: menuOpen,
								onClose: () => {
									setMenuOpen(false);
								},
								items: sessionMenuItems,
								onSelect: (id) => {
									setMenuOpen(false);
									if (id === "rename") onRename(node.id, row.title);
									if (id === "fork") onFork(node.id);
									if (id === "archive") onArchive(node.id);
								},
								portal: true,
								closeOnPointerLeave: true,
								anchor: (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: Rows_module_css_default.iconButton,
									"aria-label": t("actions.session.aria", { name: title }),
									onClick: (e) => {
										e.stopPropagation();
										setMenuOpen((v) => !v);
									},
									children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
								})
							})
						})
					]
				}),
				content: (0, react_jsx_runtime.jsx)(SessionHoverContent, {
					node,
					now,
					t
				}),
				disabled: menuOpen || drag?.active === true,
				copyText: row.blank ? void 0 : row.title,
				copyLabel: t("copy"),
				copiedLabel: t("hover.copied")
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-workspace/src/client/WorkspacePicker.module.css.mjs
		const css$1 = ".aXa_wsp_modalAction{min-width:72px}.aXa_wsp_modalError,.aXa_wsp_menuStatus{margin-top:8px;font-size:12px;line-height:18px}.aXa_wsp_modalError{color:var(--dsw-alias-state-error-primary)}.aXa_wsp_menuStatus{color:var(--dsw-alias-label-secondary)}";
		const tagId$1 = "arxa-sidebar-workspace/WorkspacePicker.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "arxa-sidebar-workspace";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var WorkspacePicker_module_css_default = {
			"menuStatus": "aXa_wsp_menuStatus",
			"modalAction": "aXa_wsp_modalAction",
			"modalError": "aXa_wsp_modalError"
		};
		//#endregion
		//#region lib/types/client/WorkspacePicker.js
		const ADD_WORKSPACE = "::add-workspace";
		/**
		* Render the pick menu plus the adoption error dialog.
		* @param props - owner-controlled flow props.
		* @returns menu + dialog elements.
		*/
		function WorkspacePickFlow({ t, open, anchorRef, useWorkspaces, createWorkspace, useDirectoryFlow, renderDirectoryFlow, onPick, onClose, addOnly = false, side = "bottom", selectedId }) {
			const workspaceSnapshot = useWorkspaces((state) => state);
			const workspaces = workspaceSnapshot.items;
			const getAnchorRect = (0, react.useCallback)(() => anchorRef?.current?.getBoundingClientRect() ?? null, [anchorRef]);
			const [errorOpen, setErrorOpen] = (0, react.useState)(false);
			const [modalError, setModalError] = (0, react.useState)(null);
			const [flowOpen, setFlowOpen] = (0, react.useState)(false);
			const [pickingFolder, setPickingFolder] = (0, react.useState)(false);
			const flowBusy = flowOpen || pickingFolder;
			const flowAvailable = useDirectoryFlow((occupied) => occupied);
			(0, react.useEffect)(() => {
				if (flowOpen && !flowAvailable) setFlowOpen(false);
			}, [flowOpen, flowAvailable]);
			const addEntries = [{
				id: ADD_WORKSPACE,
				label: t("menu.addWorkspace"),
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 16 }),
				disabled: flowBusy
			}];
			const pinAdd = !addOnly && workspaces.length > 0;
			const items = pinAdd ? workspaces.map((workspace) => ({
				id: workspace.workspaceId,
				label: workspace.title,
				icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, { size: 16 }),
				disabled: flowBusy
			})) : addEntries;
			const menuIsEmpty = items.length === 0;
			const closeModal = () => {
				setErrorOpen(false);
				setModalError(null);
			};
			/** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
			const adoptDirectory = (path) => createWorkspace({ path }).then((workspace) => {
				setFlowOpen(false);
				onPick(workspace.workspaceId);
			}).catch((reason) => {
				setModalError(reason instanceof Error ? reason.message : String(reason));
				setFlowOpen(false);
				setErrorOpen(true);
			});
			const openDirectoryFlow = (0, react.useCallback)(() => {
				onClose();
				// Organisations world (Q3): scaffold-by-name runs in the in-bundle
				// create-organisation modal (org region). window.prompt is a silent
				// no-op in WKWebView (the Tauri shell) — never prompt. The event, not
				// a store emit: emits here tick the shell into re-firing this very
				// auto-open effect — an emit loop ending in React #185.
				window.dispatchEvent(new Event("arxa-create-org"));
			}, [onClose]);
			const listSettled = addOnly || workspaceSnapshot.phase === "ready";
			const addIsTheOnlyEntry = !pinAdd && listSettled && addEntries.length === 1;
			(0, react.useEffect)(() => {
				if (open && addIsTheOnlyEntry && !flowBusy) openDirectoryFlow();
			}, [
				open,
				addIsTheOnlyEntry,
				flowBusy,
				openDirectoryFlow
			]);
			/** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
			const flowOwner = {
				open: flowOpen,
				busy: pickingFolder,
				onPicked: (path) => {
					setPickingFolder(true);
					adoptDirectory(path).finally(() => {
						setPickingFolder(false);
					});
				},
				onCancel: () => {
					setFlowOpen(false);
				},
				onError: (message) => {
					setFlowOpen(false);
					setModalError(message);
					setErrorOpen(true);
				}
			};
			const handleSelect = (id) => {
				if (id === ADD_WORKSPACE) {
					openDirectoryFlow();
					return;
				}
				onPick(id);
			};
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
					open: open && !addIsTheOnlyEntry && !menuIsEmpty,
					anchor: null,
					items,
					...pinAdd ? { footer: addEntries } : {},
					selectedId,
					onSelect: handleSelect,
					onClose,
					side,
					portal: true,
					getAnchorRect
				}),
				open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === "pending" && (0, react_jsx_runtime.jsx)("div", {
					className: WorkspacePicker_module_css_default.menuStatus,
					role: "status",
					children: t("picker.loading")
				}),
				renderDirectoryFlow(flowOwner),
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: errorOpen,
					onClose: closeModal,
					closeLabel: t("close"),
					title: t("folderError.title"),
					footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						className: WorkspacePicker_module_css_default.modalAction,
						onClick: closeModal,
						children: t("cancel")
					}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						className: WorkspacePicker_module_css_default.modalAction,
						disabled: !flowAvailable,
						onClick: openDirectoryFlow,
						children: t("folderError.retry")
					})] }),
					children: (0, react_jsx_runtime.jsx)("div", {
						className: WorkspacePicker_module_css_default.modalError,
						role: "alert",
						children: modalError
					})
				})
			] });
		}
		/**
		* The conversation empty-state registration: adapts the owner share to the
		* core flow (all state and semantics live in the flow / the owner).
		* @param props - empty-state slot props (owner share + injected creation callback).
		* @returns the flow element.
		*/
		function WorkspacePicker({ open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, useDirectoryFlow, renderSlot, t }) {
			return (0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
				t,
				open,
				anchorRef,
				useWorkspaces,
				createWorkspace,
				useDirectoryFlow,
				renderDirectoryFlow: (owner) => renderSlot("conversation.hero.workspace.directoryFlow", owner),
				selectedId,
				onPick,
				onClose
			});
		}
		//#endregion
		//#region \0dsh-css:/home/runner/work/deepseek-harness/deepseek-harness/packages/client/ui-workspace/src/client/WorkspaceBrowser.module.css.mjs
		const css = ".aXa_wsb_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);flex-direction:column;flex:1;display:flex}.aXa_wsb_root.aXa_wsb_rail{padding-right:0}.aXa_wsb_iconButton{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_wsb_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsb_sectionHeader{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex;overflow:hidden}.aXa_wsb_root:not(.aXa_wsb_rail) .aXa_wsb_sectionHeader{margin-top:2px;margin-right:-4px}.aXa_wsb_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;transition:max-width .18s var(--ds-ease-in-out), margin-right .18s var(--ds-ease-in-out), opacity .12s var(--ds-ease-in-out), transform .18s var(--ds-ease-in-out), visibility 0s linear;flex:none;line-height:20px;overflow:hidden}.aXa_wsb_sectionLabelHidden{opacity:0;visibility:hidden;max-width:0;margin-right:-4px;transition-delay:0s,0s,0s,0s,.18s;transform:translate(-4px)}.aXa_wsb_searchSlot{box-sizing:border-box;min-width:0;max-width:28px;transition:max-width .18s var(--ds-ease-in-out), padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}.aXa_wsb_searchSlotExpanded{max-width:100%;padding-left:0}.aXa_wsb_headerActions{opacity:1;visibility:visible;max-width:60px;transition:max-width .18s var(--ds-ease-in-out), opacity .12s var(--ds-ease-in-out), transform .18s var(--ds-ease-in-out), visibility 0s linear;flex:none;align-items:center;gap:4px;display:flex;overflow:hidden}.aXa_wsb_headerActionsHidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0;transition-delay:0s,0s,0s,.18s;transform:translate(4px)}.aXa_wsb_search{box-sizing:border-box;cursor:text;width:100%;height:28px;color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out), padding .18s var(--ds-ease-in-out), border-color .18s var(--ds-ease-in-out), background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}.aXa_wsb_searchExpanded{border:1px solid var(--dsw-alias-border-l2);width:calc(100% + 4px);height:30px;color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}.aXa_wsb_searchButton{cursor:pointer;width:28px;height:28px;color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_wsb_searchExpanded .aXa_wsb_searchButton{width:28px;height:30px}.aXa_wsb_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsb_searchExpanded .aXa_wsb_searchButton:hover{background:0 0}.aXa_wsb_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}.aXa_wsb_searchExpanded .aXa_wsb_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}.aXa_wsb_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}.aXa_wsb_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_wsb_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsb_rail .aXa_wsb_sectionHeader{justify-content:flex-start;gap:0;margin-bottom:12px;padding-left:0}.aXa_wsb_rail .aXa_wsb_headerActions{max-width:none}.aXa_wsb_rail .aXa_wsb_iconButton{width:36px;height:36px;color:var(--dsw-alias-label-primary)}.aXa_wsb_rail .aXa_wsb_search{background:0 0;border-color:#0000;gap:0;width:36px;height:36px;margin:0 0 12px;padding:0}.aXa_wsb_rail .aXa_wsb_searchButton{width:36px;height:36px;color:var(--dsw-alias-label-primary)}.aXa_wsb_rail .aXa_wsb_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_wsb_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}.aXa_wsb_rail .aXa_wsb_listArea{margin-left:0;margin-right:0;padding-left:0}.aXa_wsb_treeBody{flex-direction:column;flex:1;min-height:0;display:flex;position:relative}.aXa_wsb_fade{left:0;right:var(--dsh-session-list-edge-inset);background:linear-gradient(to bottom, transparent, var(--dsw-specific-sidebar-fill));pointer-events:none;height:24px;position:absolute;bottom:0}.aXa_wsb_wide{animation:aXa_wsb_wide-in .2s var(--ds-ease-in-out)}@keyframes aXa_wsb_wide-in{0%{opacity:0}}.aXa_wsb_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:16px;overflow-y:auto}.aXa_wsb_flatList>*+*,.aXa_wsb_searchTree>[role=treeitem]+[role=treeitem],.aXa_wsb_groupSection>*+*{margin-top:2px}.aXa_wsb_searchStatus,.aXa_wsb_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}.aXa_wsb_searchWarning{color:var(--dsw-alias-label-secondary)}.aXa_wsb_groupSection{position:relative}.aXa_wsb_groupSection+.aXa_wsb_groupSection{margin-top:4px}.aXa_wsb_listTopDropIndicator,.aXa_wsb_workspaceDropBefore:before,.aXa_wsb_workspaceDropAfter:after{content:\"\";z-index:1;background:linear-gradient(55deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 0 / 5px 7px no-repeat, linear-gradient(125deg, transparent calc(50% - 1px), var(--dsw-alias-state-business-primary) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px)) 0 5px / 5px 7px no-repeat, linear-gradient(var(--dsw-alias-state-business-primary) 0 0) 4px 5px / calc(100% - 4px) 2px no-repeat;pointer-events:none;height:12px;position:absolute;left:0;right:0}.aXa_wsb_listTopDropIndicator{top:-8px;left:0;right:var(--dsh-session-list-edge-inset)}.aXa_wsb_listTopDropActive>.aXa_wsb_workspaceDropBefore:first-child:before{display:none}.aXa_wsb_workspaceDropBefore:before{top:-8px}.aXa_wsb_workspaceDropAfter:after{bottom:-8px}.aXa_wsb_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:28px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:12px}.aXa_wsb_groupSection>.aXa_wsb_sessionOverflowButton{margin-top:0}.aXa_wsb_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}.aXa_wsb_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}.aXa_wsb_renameInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}.aXa_wsb_renameInput:disabled{color:var(--dsw-alias-label-dimmed)}.aXa_wsb_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}.aXa_wsb_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}.aXa_wsb_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}@media (prefers-reduced-motion:reduce){.aXa_wsb_wide{animation:none}.aXa_wsb_search,.aXa_wsb_sectionLabel,.aXa_wsb_searchSlot,.aXa_wsb_searchInput,.aXa_wsb_headerActions{transition:none}}";
		const tagId = "arxa-sidebar-workspace/WorkspaceBrowser.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "arxa-sidebar-workspace";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var WorkspaceBrowser_module_css_default = {
			"clearButton": "aXa_wsb_clearButton",
			"deleteAction": "aXa_wsb_deleteAction",
			"deleteStatus": "aXa_wsb_deleteStatus",
			"empty": "aXa_wsb_empty",
			"fade": "aXa_wsb_fade",
			"flatList": "aXa_wsb_flatList",
			"groupSection": "aXa_wsb_groupSection",
			"headerActions": "aXa_wsb_headerActions",
			"headerActionsHidden": "aXa_wsb_headerActionsHidden",
			"iconButton": "aXa_wsb_iconButton",
			"list": "aXa_wsb_list",
			"listArea": "aXa_wsb_listArea",
			"listTopDropActive": "aXa_wsb_listTopDropActive",
			"listTopDropIndicator": "aXa_wsb_listTopDropIndicator",
			"rail": "aXa_wsb_rail",
			"renameError": "aXa_wsb_renameError",
			"renameInput": "aXa_wsb_renameInput",
			"root": "aXa_wsb_root",
			"search": "aXa_wsb_search",
			"searchButton": "aXa_wsb_searchButton",
			"searchExpanded": "aXa_wsb_searchExpanded",
			"searchInput": "aXa_wsb_searchInput",
			"searchSlot": "aXa_wsb_searchSlot",
			"searchSlotExpanded": "aXa_wsb_searchSlotExpanded",
			"searchStatus": "aXa_wsb_searchStatus",
			"searchTree": "aXa_wsb_searchTree",
			"searchWarning": "aXa_wsb_searchWarning",
			"sectionHeader": "aXa_wsb_sectionHeader",
			"sectionLabel": "aXa_wsb_sectionLabel",
			"sectionLabelHidden": "aXa_wsb_sectionLabelHidden",
			"sessionOverflowButton": "aXa_wsb_sessionOverflowButton",
			"treeBody": "aXa_wsb_treeBody",
			"wide": "aXa_wsb_wide",
			"wide-in": "aXa_wsb_wide-in",
			"workspaceDropAfter": "aXa_wsb_workspaceDropAfter",
			"workspaceDropBefore": "aXa_wsb_workspaceDropBefore"
		};
		//#endregion
		//#region lib/types/client/WorkspaceBrowser.js
		/**
		* The workspace/session browsing region filling the sidebar shell's
		* `sidebar.workspaces` hole: section header (title + view options + add
		* workspace), search, the grouped tree or flat list, and the workspace
		* dialogs. Wide state renders the full browser; rail state renders the two
		* region icons (search / add workspace) as 36px controls on the shell's shared
		* rail entry path, each requesting expansion through the owner share. Adding
		* is the header button's one action, so it raises the directory flow with no
		* menu in between; the flow and its error dialog live in WorkspacePicker
		* (same package — direct composition, no slot between them).
		*/
		/**
		* Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
		* focus() forces a synchronous layout and would jank the slide.
		*/
		const EXPAND_SLIDE_MS = 300;
		/** Pause between the latest keystroke and a Host content-search request. */
		const SEARCH_DEBOUNCE_MS = 250;
		/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
		const SEARCH_QUERY_MAX_CODE_UNITS = 500;
		/** Session rows visible per Workspace before the local overflow control. */
		const COLLAPSED_SESSION_LIMIT = 5;
		/** Keep controlled input and RPC payload inside the session.search wire contract. */
		function sanitizeSearchQuery(value) {
			const withoutNul = value.replaceAll("\0", "");
			if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul;
			let end = SEARCH_QUERY_MAX_CODE_UNITS;
			const last = withoutNul.charCodeAt(end - 1);
			const next = withoutNul.charCodeAt(end);
			if (last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343) end--;
			return withoutNul.slice(0, end);
		}
		/** Immutable membership toggle for the local expand-all array. */
		function toggled(list, key) {
			return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
		}
		/**
		* Accept the native drag at document level while a row drag is active: row
		* hover still owns the insertion marker, and releasing outside the list must
		* not be rendered as a rejected drop before dragend commits that last marker.
		*/
		function useNativeDragAcceptance(active) {
			(0, react.useEffect)(() => {
				if (!active) return;
				const acceptDrag = (event) => {
					event.preventDefault();
					if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
				};
				const acceptDrop = (event) => {
					event.preventDefault();
				};
				document.addEventListener("dragover", acceptDrag);
				document.addEventListener("drop", acceptDrop);
				return () => {
					document.removeEventListener("dragover", acceptDrag);
					document.removeEventListener("drop", acceptDrop);
				};
			}, [active]);
		}
		/** Reconcile a stored view order with the Workspace's current session account. */
		function reconciledSessionOrder(sessionIds, stored) {
			if (stored === void 0) return [...sessionIds];
			const byId = new Map(sessionIds.map((id) => [id, id]));
			const ordered = [];
			const included = /* @__PURE__ */ new Set();
			for (const key of stored) {
				const id = byId.get(key);
				if (id === void 0 || included.has(key)) continue;
				ordered.push(id);
				included.add(key);
			}
			for (const id of sessionIds) {
				if (included.has(id)) continue;
				ordered.push(id);
			}
			return ordered;
		}
		/** Newest update first with stable Session identity as the tie-break. */
		function compareSessionRecency(a, b, byId) {
			const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY;
			const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY;
			if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt;
			return a < b ? -1 : 1;
		}
		/** Reconcile one editable order account and apply its activity-promotion policy. */
		function nextSessionOrderAccount({ sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency }) {
			let order = reconciledSessionOrder(sessionIds, previousOrder);
			if (sortByRecency) order.sort((a, b) => compareSessionRecency(a, b, list.byId));
			else if (orderBy === "updated") {
				const promoted = sessionIds.filter((id) => {
					const session = list.byId[id];
					return session !== void 0 && (previousUpdatedAt[id] === void 0 || session.updatedAt > previousUpdatedAt[id]);
				}).sort((a, b) => compareSessionRecency(a, b, list.byId));
				if (promoted.length > 0) {
					const promotedIds = new Set(promoted);
					order = [...promoted, ...order.filter((id) => !promotedIds.has(id))];
				}
			}
			const updatedAt = {};
			for (const id of sessionIds) {
				const session = list.byId[id];
				if (session !== void 0) updatedAt[id] = session.updatedAt;
			}
			const orderChanged = previousOrder === void 0 || order.length !== previousOrder.length || order.some((id, index) => id !== previousOrder[index]);
			const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp);
			return {
				order,
				updatedAt,
				changed: orderChanged || timestampsChanged
			};
		}
		/** Grouping and ordering menu; own open state so it resets with the wide chrome. */
		function ViewOptionsMenu({ groupBy, orderBy, onGroupPick, onOrderPick, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: [
					{
						type: "label",
						id: "group-by",
						text: t("groupBy.label")
					},
					{
						id: "workspace",
						label: t("groupBy.workspace")
					},
					{
						id: "flat",
						label: t("groupBy.flat")
					},
					{
						type: "separator",
						id: "order-by-separator"
					},
					{
						type: "label",
						id: "order-by",
						text: t("orderBy.label")
					},
					{
						id: "manual",
						label: t("orderBy.manual")
					},
					{
						id: "updated",
						label: t("orderBy.updated")
					}
				],
				selectedIds: [groupBy, orderBy],
				onSelect: (id) => {
					if (id === "workspace" || id === "flat") onGroupPick(id);
					else if (id === "manual" || id === "updated") onOrderPick(id);
					setOpen(false);
				},
				align: "end",
				dense: true,
				portal: true,
				anchor: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("viewOptions.label"),
					side: "bottom",
					delayMs: 500,
					children: (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: clsx(WorkspaceBrowser_module_css_default.iconButton, WorkspaceBrowser_module_css_default.wide),
						"aria-label": t("viewOptions.label"),
						onClick: () => {
							setOpen((v) => !v);
						},
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPersonalizationOutline16, {})
					})
				})
			});
		}
		/** Resolve an insertion side from the full rendered workspace group. */
		function workspaceGroupHalf(e) {
			const rect = e.currentTarget.getBoundingClientRect();
			return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
		}
		/** The scrolling session tree; unmounting drops the sessions subscription and expand-all state. */
		function SessionTree({ useSessions, startSession, open, forkSession, workspaces, archivedSessionIds, onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore, insertSessionBefore, orderBy, groupExpansion, setGroupExpanded, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t }) {
			const list = useSessions((s) => s);
			const current = list.current;
			const [expandedSessionGroups, setExpandedSessionGroups] = (0, react.useState)([]);
			const [drag, setDrag] = (0, react.useState)(null);
			const sessionDropCommitted = (0, react.useRef)(false);
			const [workspaceDrag, setWorkspaceDrag] = (0, react.useState)(null);
			const workspaceDropCommitted = (0, react.useRef)(false);
			const previousOrderBy = (0, react.useRef)(orderBy);
			useNativeDragAcceptance(drag !== null || workspaceDrag !== null);
			const currentGroup = current === void 0 ? void 0 : workspaces.find((w) => w.sessionIds.includes(current))?.workspaceId ?? "";
			(0, react.useEffect)(() => {
				if (current === void 0 || currentGroup === void 0 || Object.hasOwn(groupExpansion, currentGroup)) return;
				setGroupExpanded(currentGroup, true);
			}, [
				current,
				currentGroup,
				setGroupExpanded,
				groupExpansion
			]);
			const expandedGroups = (0, react.useMemo)(() => Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key), [groupExpansion]);
			const ungroupedSessionIds = (0, react.useMemo)(() => {
				const accounted = new Set(workspaces.flatMap((workspace) => workspace.sessionIds));
				return list.ids.filter((id) => list.byId[id] !== void 0 && !accounted.has(id));
			}, [list, workspaces]);
			(0, react.useEffect)(() => {
				if (list.phase !== "ready") return;
				const switchedToUpdated = previousOrderBy.current !== "updated" && orderBy === "updated";
				previousOrderBy.current = orderBy;
				const accounts = [...workspaces.map((workspace) => ({
					key: workspace.workspaceId,
					sessionIds: workspace.sessionIds.filter((id) => list.byId[id] !== void 0)
				})), {
					key: "",
					sessionIds: ungroupedSessionIds
				}];
				for (const { key, sessionIds } of accounts) {
					const previousOrder = sessionOrderByAccount[key];
					const next = nextSessionOrderAccount({
						sessionIds,
						previousOrder,
						previousUpdatedAt: sessionUpdatedAtByAccount[key] ?? {},
						list,
						orderBy,
						sortByRecency: orderBy === "updated" && (previousOrder === void 0 || switchedToUpdated)
					});
					if (next.changed) syncSessionOrderAccount(key, next.order.map((id) => id), next.updatedAt);
				}
			}, [
				list,
				orderBy,
				sessionOrderByAccount,
				sessionUpdatedAtByAccount,
				syncSessionOrderAccount,
				ungroupedSessionIds,
				workspaces
			]);
			const orderedWorkspaces = (0, react.useMemo)(() => {
				return workspaces.map((workspace) => {
					const stored = sessionOrderByAccount[workspace.workspaceId];
					const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored);
					return {
						...workspace,
						sessionIds
					};
				});
			}, [sessionOrderByAccount, workspaces]);
			const orderedUngroupedSessionIds = (0, react.useMemo)(() => reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[""]), [sessionOrderByAccount, ungroupedSessionIds]);
			const groups = (0, react.useMemo)(() => deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
				expandedGroups,
				...sessionOrderByAccount[""] === void 0 ? {} : { ungroupedOrder: sessionOrderByAccount[""] }
			}), [
				list,
				orderedWorkspaces,
				archivedSessionIds,
				expandedGroups,
				sessionOrderByAccount
			]);
			const now = Date.now();
			const commitSessionDrag = (activeDrag, over) => {
				if (sessionDropCommitted.current) return;
				sessionDropCommitted.current = true;
				setDrag(null);
				const group = groups.find((candidate) => candidate.key === activeDrag.accountKey);
				if (group === void 0) return;
				const targetIndex = group.sessions.findIndex((session) => session.id === over.id);
				if (targetIndex === -1) return;
				const anchor = over.half === "before" ? over.id : group.sessions[targetIndex + 1]?.id;
				if (anchor === activeDrag.sessionId) return;
				const sourceIndex = group.sessions.findIndex((session) => session.id === activeDrag.sessionId);
				const anchorIndex = anchor === void 0 ? group.sessions.length : group.sessions.findIndex((session) => session.id === anchor);
				if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
				const accountSessionIds = activeDrag.accountKey === "" ? orderedUngroupedSessionIds : orderedWorkspaces.find((workspace) => workspace.workspaceId === activeDrag.accountKey)?.sessionIds;
				if (accountSessionIds === void 0) return;
				const nextOrder = accountSessionIds.filter((id) => id !== activeDrag.sessionId);
				const insertAt = anchor === void 0 ? nextOrder.length : nextOrder.indexOf(anchor);
				nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
				setSessionOrder(activeDrag.accountKey, nextOrder.map((id) => id));
				if (orderBy === "updated" || activeDrag.accountKey === "") return;
				insertSessionBefore(activeDrag.accountKey, activeDrag.sessionId, anchor).catch((reason) => {
					console.warn("session reorder rejected:", reason);
				});
			};
			const commitWorkspaceDrag = (activeDrag, over) => {
				if (workspaceDropCommitted.current) return;
				workspaceDropCommitted.current = true;
				setWorkspaceDrag(null);
				const rowIndex = workspaces.findIndex((workspace) => workspace.workspaceId === over.id);
				if (rowIndex === -1) return;
				const anchor = over.half === "before" ? over.id : workspaces[rowIndex + 1]?.workspaceId;
				if (anchor === activeDrag.workspaceId) return;
				const sourceIndex = workspaces.findIndex((workspace) => workspace.workspaceId === activeDrag.workspaceId);
				const anchorIndex = anchor === void 0 ? workspaces.length : workspaces.findIndex((workspace) => workspace.workspaceId === anchor);
				if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
				insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason) => {
					console.warn("workspace reorder rejected:", reason);
				});
			};
			const workspaceDropAtListStart = groups[0]?.workspaceId !== void 0 && workspaceDrag?.over?.id === groups[0].workspaceId && workspaceDrag.over.half === "before";
			return (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
				children: [
					workspaceDropAtListStart && (0, react_jsx_runtime.jsx)("span", {
						className: WorkspaceBrowser_module_css_default.listTopDropIndicator,
						"aria-hidden": "true"
					}),
					(0, react_jsx_runtime.jsxs)("div", {
						className: clsx(WorkspaceBrowser_module_css_default.list, workspaceDropAtListStart && WorkspaceBrowser_module_css_default.listTopDropActive),
						role: "tree",
						"aria-label": t("section.sessions"),
						children: [groups.length === 0 && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.empty,
							children: t("empty.none")
						}), groups.map((group) => {
							const workspaceId = group.workspaceId;
							const workspaceMarker = workspaceId !== void 0 && workspaceDrag?.over?.id === workspaceId ? workspaceDrag.over.half : null;
							const workspaceDragProps = workspaceId === void 0 ? void 0 : {
								start: () => {
									workspaceDropCommitted.current = false;
									setWorkspaceDrag({
										workspaceId,
										over: null
									});
								},
								end: () => {
									if (workspaceDrag?.over !== null && workspaceDrag?.over !== void 0) commitWorkspaceDrag(workspaceDrag, workspaceDrag.over);
									else setWorkspaceDrag(null);
									workspaceDropCommitted.current = false;
								}
							};
							const hoverWorkspace = workspaceId === void 0 ? void 0 : (half) => {
								setWorkspaceDrag((active) => active === null ? active : {
									...active,
									over: {
										id: workspaceId,
										half
									}
								});
							};
							const dropWorkspace = workspaceId === void 0 ? void 0 : (half) => {
								if (workspaceDrag === null) return;
								commitWorkspaceDrag(workspaceDrag, {
									id: workspaceId,
									half
								});
							};
							return (0, react_jsx_runtime.jsxs)("div", {
								style: { paddingLeft: ARXA_WS_INDENT(group.workspaceId), display: ARXA_WS_HIDDEN(group.workspaceId) ? "none" : void 0 },
								className: clsx(WorkspaceBrowser_module_css_default.groupSection, workspaceMarker === "before" && WorkspaceBrowser_module_css_default.workspaceDropBefore, workspaceMarker === "after" && WorkspaceBrowser_module_css_default.workspaceDropAfter),
								onDragOver: workspaceDrag === null || hoverWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "move";
									hoverWorkspace(workspaceGroupHalf(e));
								},
								onDrop: workspaceDrag === null || dropWorkspace === void 0 ? void 0 : (e) => {
									e.preventDefault();
									dropWorkspace(workspaceGroupHalf(e));
								},
								children: [
									...ARXA_CONTAINER_ROWS(group.workspaceId),
									...(ARXA_IS_CONTAINER_GROUP(group.workspaceId) ? [] : [(0, react_jsx_runtime.jsx)(ProjectRowItem, {
										group,
										home,
										t,
										onToggle: () => {
											if (group.expanded) setExpandedSessionGroups((keys) => keys.filter((key) => key !== group.key));
											setGroupExpanded(group.key, !group.expanded);
										},
										onCreate: () => {
											if (group.workspaceId !== void 0) {
												setGroupExpanded(group.key, true);
												startSession(group.workspaceId);
											}
										},
										drag: workspaceDragProps,
										actions: group.workspaceId === void 0 ? void 0 : {
											rename: () => {
												/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
												if (group.workspaceId !== void 0) onRenameRequest(group.workspaceId, group.label);
											},
											delete: () => {
												/* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
												if (group.workspaceId !== void 0) onDeleteRequest(group.workspaceId, group.label);
											},
										trash: () => orgStore.toggleTrash(),
										open: () => { orgStore.mutate("org.open", { orgId: group.workspaceId }).catch(() => {}); }
										}
									})]),
									ARXA_LEAF_FILES(group),
									(expandedSessionGroups.includes(group.key) ? group.sessions : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)).map((node) => {
										const sameGroupDrag = drag !== null && drag.accountKey === group.key;
										return (0, react_jsx_runtime.jsx)(SessionNodeItem, {
											node,
											currentId: current,
											now,
											onOpen: open,
											onRename: onSessionRename,
											onFork: forkSession,
											onArchive: onSessionArchive,
											drag: {
												start: () => {
													sessionDropCommitted.current = false;
													setDrag({
														accountKey: group.key,
														sessionId: node.id,
														over: null
													});
												},
												active: sameGroupDrag,
												marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
												hover: (half) => {
													/* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
													setDrag((d) => d === null ? d : {
														...d,
														over: {
															id: node.id,
															half
														}
													});
												},
												drop: (half) => {
													/* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
													if (drag === null) return;
													commitSessionDrag(drag, {
														id: node.id,
														half
													});
												},
												end: () => {
													if (drag?.over !== null && drag?.over !== void 0) commitSessionDrag(drag, drag.over);
													else setDrag(null);
													sessionDropCommitted.current = false;
												}
											},
											t
										}, node.id);
									}),
									group.sessions.length > COLLAPSED_SESSION_LIMIT && (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: WorkspaceBrowser_module_css_default.sessionOverflowButton,
										"aria-expanded": expandedSessionGroups.includes(group.key),
										onClick: () => {
											setExpandedSessionGroups((keys) => toggled(keys, group.key));
										},
										children: expandedSessionGroups.includes(group.key) ? t("sessions.collapse") : t("sessions.expand", { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })
									})
								]
							}, group.key);
						}), ARXA_TRASH_AFTER_ORGS()]
					}),
					(0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })
				]
			});
		}
		/** The flat "In one list" body: every session is one draggable top-level row. */
		function FlatList({ useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds, orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t }) {
			const list = useSessions((s) => s);
			const baseRows = (0, react.useMemo)(() => deriveFlat(list, archivedSessionIds), [list, archivedSessionIds]);
			const sessionIds = (0, react.useMemo)(() => baseRows.map((row) => row.id), [baseRows]);
			const previousOrderBy = (0, react.useRef)(orderBy);
			(0, react.useEffect)(() => {
				if (list.phase !== "ready") return;
				const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY];
				const previousUpdatedAt = sessionUpdatedAtByAccount["__flat_session_order__"] ?? {};
				const switchedToUpdated = previousOrderBy.current !== "updated" && orderBy === "updated";
				previousOrderBy.current = orderBy;
				const next = nextSessionOrderAccount({
					sessionIds,
					previousOrder,
					previousUpdatedAt,
					list,
					orderBy,
					sortByRecency: orderBy === "updated" && (previousOrder === void 0 || switchedToUpdated)
				});
				if (next.changed) syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map((id) => id), next.updatedAt);
			}, [
				list,
				orderBy,
				sessionOrderByAccount,
				sessionUpdatedAtByAccount,
				sessionIds,
				syncSessionOrderAccount
			]);
			const rows = (0, react.useMemo)(() => {
				const byId = new Map(baseRows.map((row) => [row.id, row]));
				return reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]).flatMap((id) => {
					const row = byId.get(id);
					return row === void 0 ? [] : [row];
				});
			}, [
				baseRows,
				sessionOrderByAccount,
				sessionIds
			]);
			const [drag, setDrag] = (0, react.useState)(null);
			const dropCommitted = (0, react.useRef)(false);
			useNativeDragAcceptance(drag !== null);
			const commitDrag = (activeDrag, over) => {
				if (dropCommitted.current) return;
				dropCommitted.current = true;
				setDrag(null);
				const targetIndex = rows.findIndex((row) => row.id === over.id);
				if (targetIndex === -1) return;
				const anchor = over.half === "before" ? over.id : rows[targetIndex + 1]?.id;
				if (anchor === activeDrag.sessionId) return;
				const sourceIndex = rows.findIndex((row) => row.id === activeDrag.sessionId);
				const anchorIndex = anchor === void 0 ? rows.length : rows.findIndex((row) => row.id === anchor);
				if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) return;
				const nextOrder = rows.map((row) => row.id).filter((id) => id !== activeDrag.sessionId);
				const insertAt = anchor === void 0 ? nextOrder.length : nextOrder.indexOf(anchor);
				nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId);
				setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map((id) => id));
			};
			const now = Date.now();
			return (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: clsx(WorkspaceBrowser_module_css_default.list, WorkspaceBrowser_module_css_default.flatList),
					role: "tree",
					"aria-label": t("section.sessions"),
					children: [rows.length === 0 && (0, react_jsx_runtime.jsx)("div", {
						className: WorkspaceBrowser_module_css_default.empty,
						children: t("empty.none")
					}), rows.map((node) => {
						const active = drag !== null;
						return (0, react_jsx_runtime.jsx)(SessionNodeItem, {
							node,
							currentId: list.current,
							now,
							onOpen: open,
							onRename: onSessionRename,
							onFork: forkSession,
							onArchive: onSessionArchive,
							flat: true,
							drag: {
								start: () => {
									dropCommitted.current = false;
									setDrag({
										accountKey: FLAT_SESSION_ORDER_KEY,
										sessionId: node.id,
										over: null
									});
								},
								active,
								marker: active && drag.over?.id === node.id ? drag.over.half : null,
								hover: (half) => {
									setDrag((current) => current === null ? current : {
										...current,
										over: {
											id: node.id,
											half
										}
									});
								},
								drop: (half) => {
									if (drag !== null) commitDrag(drag, {
										id: node.id,
										half
									});
								},
								end: () => {
									if (drag?.over !== null && drag?.over !== void 0) commitDrag(drag, drag.over);
									else setDrag(null);
									dropCommitted.current = false;
								}
							},
							t
						}, node.id);
					})]
				}), (0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })]
			});
		}
		/** Flat search body: local metadata matches plus the current Host result page. */
		function SearchResults({ useSessions, open, workspaces, archivedSessionIds, query, remote, resultLimit, t }) {
			const list = useSessions((s) => s);
			const currentRemote = remote.query === query ? remote : {
				query,
				status: "loading",
				items: [],
				hasMore: false
			};
			const results = (0, react.useMemo)(() => deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit), [
				list,
				workspaces,
				query,
				archivedSessionIds,
				currentRemote,
				resultLimit
			]);
			const pending = currentRemote.status === "loading";
			const failed = currentRemote.status === "error";
			return (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(WorkspaceBrowser_module_css_default.treeBody, WorkspaceBrowser_module_css_default.wide),
				children: [(0, react_jsx_runtime.jsxs)("div", {
					className: WorkspaceBrowser_module_css_default.list,
					children: [
						(0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.searchTree,
							role: "tree",
							"aria-label": t("search.results.aria"),
							children: results.items.map((result) => (0, react_jsx_runtime.jsx)(SearchResultItem, {
								result,
								currentId: list.current,
								onOpen: open,
								t
							}, result.id))
						}),
						pending && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.searchStatus,
							role: "status",
							children: t("search.pending")
						}),
						failed && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.searchWarning,
							role: "status",
							children: t("search.unavailable")
						}),
						!pending && results.items.length === 0 && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.empty,
							children: t("search.noMatches")
						}),
						results.hasMore && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.searchStatus,
							children: t("search.hasMore", { n: resultLimit })
						})
					]
				}), (0, react_jsx_runtime.jsx)("span", { className: WorkspaceBrowser_module_css_default.fade })]
			});
		}
		/**
		* Render the browsing region.
		* @param props - composed slot props (shell owner share + store + injected actions).
		* @returns the region element tree.
		*/
		function WorkspaceBrowser({ wide, expandSidebar, useSessions, useWorkspaces, useStore, actions, startSession, open, renameSession, forkSession, renameWorkspace, deleteWorkspace, insertWorkspaceBefore, archiveSession, insertSessionBefore, createWorkspace, searchSessions, searchResultLimit, useDirectoryFlow, useHostDescription, renderSlot, t }) {
			const home = useHostDescription((description) => description?.home);
			const workspaces = useWorkspaces((state) => state.items);
			const workspacePhase = useWorkspaces((state) => state.phase);
			const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
			const directoryFlowAvailable = useDirectoryFlow((occupied) => occupied);
			const groupBy = useStore((s) => s.groupBy);
			const orderBy = useStore((s) => s.orderBy);
			const groupExpansion = useStore((s) => s.groupExpansion);
			const sessionOrderByAccount = useStore((s) => s.sessionOrderByAccount);
			const sessionUpdatedAtByAccount = useStore((s) => s.sessionUpdatedAtByAccount);
			const currentBlankSessionId = useSessions((state) => {
				const current = state.current;
				return current !== void 0 && state.byId[current]?.blank === true ? current : void 0;
			});
			const currentBlankAccount = currentBlankSessionId === void 0 ? void 0 : workspaces.find((workspace) => workspace.sessionIds.includes(currentBlankSessionId))?.workspaceId ?? "";
			const promotedBlank = (0, react.useRef)(void 0);
			(0, react.useEffect)(() => {
				if (currentBlankSessionId === void 0 || currentBlankAccount === void 0) {
					promotedBlank.current = void 0;
					return;
				}
				if (promotedBlank.current?.sessionId === currentBlankSessionId && promotedBlank.current.accountKey === currentBlankAccount) return;
				promotedBlank.current = {
					sessionId: currentBlankSessionId,
					accountKey: currentBlankAccount
				};
				for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
					const previous = sessionOrderByAccount[accountKey] ?? [];
					actions.setSessionOrder(accountKey, [currentBlankSessionId, ...previous.filter((id) => id !== currentBlankSessionId)]);
				}
			}, [
				actions.setSessionOrder,
				currentBlankAccount,
				currentBlankSessionId,
				sessionOrderByAccount
			]);
			(0, react.useEffect)(() => {
				if (workspacePhase !== "ready") return;
				actions.retainAccountKeys([
					"",
					FLAT_SESSION_ORDER_KEY,
					...workspaces.map((workspace) => workspace.workspaceId)
				]);
			}, [
				actions.retainAccountKeys,
				workspacePhase,
				workspaces
			]);
			const [query, setQuery] = (0, react.useState)("");
			const [searchExpanded, setSearchExpanded] = (0, react.useState)(false);
			const normalizedQuery = sanitizeSearchQuery(query).trim();
			const [remoteSearch, setRemoteSearch] = (0, react.useState)({
				query: "",
				status: "idle",
				items: [],
				hasMore: false
			});
			const searchRoot = (0, react.useRef)(null);
			const searchInput = (0, react.useRef)(null);
			const [wsPickerOpen, setWsPickerOpen] = (0, react.useState)(false);
			const wsPlusRef = (0, react.useRef)(null);
			const composingRef = (0, react.useRef)(false);
			const [searchOnExpand, setSearchOnExpand] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (wide && searchOnExpand) {
					const timer = window.setTimeout(() => {
						searchInput.current?.focus({ preventScroll: true });
						setSearchOnExpand(false);
					}, EXPAND_SLIDE_MS);
					return () => {
						window.clearTimeout(timer);
					};
				}
			}, [wide, searchOnExpand]);
			(0, react.useEffect)(() => {
				if (!wide || !searchExpanded || searchOnExpand) return;
				searchInput.current?.focus({ preventScroll: true });
			}, [
				wide,
				searchExpanded,
				searchOnExpand
			]);
			(0, react.useEffect)(() => {
				if (!wide || !searchExpanded || searchOnExpand) return;
				const onClick = (event) => {
					if (!(event.target instanceof Node) || searchRoot.current?.contains(event.target) === true) return;
					searchInput.current?.blur();
					if (normalizedQuery !== "") return;
					setSearchExpanded(false);
				};
				document.addEventListener("click", onClick);
				return () => {
					document.removeEventListener("click", onClick);
				};
			}, [
				normalizedQuery,
				wide,
				searchExpanded,
				searchOnExpand
			]);
			(0, react.useEffect)(() => {
				if (normalizedQuery === "") {
					setRemoteSearch({
						query: "",
						status: "idle",
						items: [],
						hasMore: false
					});
					return;
				}
				const controller = new AbortController();
				setRemoteSearch({
					query: normalizedQuery,
					status: "loading",
					items: [],
					hasMore: false
				});
				const timer = window.setTimeout(() => {
					searchSessions(normalizedQuery, controller.signal).then((result) => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "ready",
							items: result.items,
							hasMore: result.hasMore
						});
					}).catch(() => {
						if (controller.signal.aborted) return;
						setRemoteSearch({
							query: normalizedQuery,
							status: "error",
							items: [],
							hasMore: false
						});
					});
				}, SEARCH_DEBOUNCE_MS);
				return () => {
					window.clearTimeout(timer);
					controller.abort();
				};
			}, [normalizedQuery, searchSessions]);
			const [renameTarget, setRenameTarget] = (0, react.useState)(null);
			const [renameDraft, setRenameDraft] = (0, react.useState)("");
			const [renaming, setRenaming] = (0, react.useState)(false);
			const [renameError, setRenameError] = (0, react.useState)(null);
			const renameTrimmed = renameDraft.trim();
			const renameDuplicate = renameTarget !== null && renameTrimmed !== "" && renameTrimmed !== renameTarget.currentTitle && workspaces.some((w) => w.title === renameTrimmed);
			const renameBlocked = renaming || renameTrimmed === "" || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate;
			const closeRename = () => {
				if (renaming) return;
				setRenameTarget(null);
				setRenameError(null);
			};
			const confirmRename = () => {
				if (renameBlocked) return;
				setRenaming(true);
				setRenameError(null);
				renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
					setRenaming(false);
					setRenameTarget(null);
				}).catch((reason) => {
					setRenaming(false);
					setRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const [sessionRenameTarget, setSessionRenameTarget] = (0, react.useState)(null);
			const [sessionRenameDraft, setSessionRenameDraft] = (0, react.useState)("");
			const [sessionRenaming, setSessionRenaming] = (0, react.useState)(false);
			const [sessionRenameError, setSessionRenameError] = (0, react.useState)(null);
			const sessionRenameTrimmed = sessionRenameDraft.trim();
			const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === "" || sessionRenameTarget === null;
			const closeSessionRename = () => {
				if (sessionRenaming) return;
				setSessionRenameTarget(null);
				setSessionRenameError(null);
			};
			const confirmSessionRename = () => {
				if (sessionRenameBlocked) return;
				setSessionRenaming(true);
				setSessionRenameError(null);
				renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
					setSessionRenaming(false);
					setSessionRenameTarget(null);
				}).catch((reason) => {
					setSessionRenaming(false);
					setSessionRenameError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			const onSessionRename = (sessionId, currentTitle) => {
				setSessionRenameTarget({
					sessionId,
					currentTitle
				});
				setSessionRenameDraft(currentTitle);
				setSessionRenameError(null);
			};
			const onSessionArchive = (sessionId) => {
				archiveSession(sessionId).catch((reason) => {
					console.warn("session archive rejected:", reason);
				});
			};
			const [deleteTarget, setDeleteTarget] = (0, react.useState)(null);
			const [deleting, setDeleting] = (0, react.useState)(false);
			const [deleteCommittedId, setDeleteCommittedId] = (0, react.useState)(null);
			const [deleteError, setDeleteError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (deleteCommittedId === null || workspaces.some((workspace) => workspace.workspaceId === deleteCommittedId)) return;
				setDeleting(false);
				setDeleteCommittedId(null);
				setDeleteTarget(null);
			}, [deleteCommittedId, workspaces]);
			const closeDelete = () => {
				if (deleting) return;
				setDeleteTarget(null);
				setDeleteError(null);
			};
			const confirmDelete = () => {
				/* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
				if (deleting || deleteTarget === null) return;
				setDeleting(true);
				setDeleteCommittedId(null);
				setDeleteError(null);
				deleteWorkspace(deleteTarget.workspaceId).then(() => {
					setDeleteCommittedId(deleteTarget.workspaceId);
				}).catch((reason) => {
					setDeleting(false);
					setDeleteError(reason instanceof Error ? reason.message : String(reason));
				});
			};
			return (0, react_jsx_runtime.jsxs)("div", {
				className: clsx(WorkspaceBrowser_module_css_default.root, !wide && WorkspaceBrowser_module_css_default.rail),
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						className: WorkspaceBrowser_module_css_default.sectionHeader,
						children: [
							wide && (0, react_jsx_runtime.jsx)("span", {
								className: clsx(WorkspaceBrowser_module_css_default.sectionLabel, WorkspaceBrowser_module_css_default.wide, searchExpanded && WorkspaceBrowser_module_css_default.sectionLabelHidden),
								children: groupBy === "flat" ? t("section.sessions") : t("section.workspaces")
							}),
							wide && (0, react_jsx_runtime.jsx)("div", {
								className: clsx(WorkspaceBrowser_module_css_default.searchSlot, searchExpanded && WorkspaceBrowser_module_css_default.searchSlotExpanded),
								children: (0, react_jsx_runtime.jsxs)("div", {
									ref: searchRoot,
									className: clsx(WorkspaceBrowser_module_css_default.search, searchExpanded && WorkspaceBrowser_module_css_default.searchExpanded),
									onClick: () => {
										setWsPickerOpen(false);
										setSearchExpanded(true);
										searchInput.current?.focus();
									},
									children: [
										(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
											label: t("search"),
											side: "bottom",
											delayMs: 500,
											disabled: searchExpanded,
											children: (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: WorkspaceBrowser_module_css_default.searchButton,
												"aria-label": t("search.sessions.aria"),
												"aria-expanded": searchExpanded,
												onClick: () => {
													setWsPickerOpen(false);
													setSearchExpanded(true);
												},
												children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: searchExpanded ? 11 : 14 })
											})
										}),
										(0, react_jsx_runtime.jsx)("input", {
											ref: searchInput,
											className: WorkspaceBrowser_module_css_default.searchInput,
											type: "text",
											placeholder: t("search.placeholder"),
											maxLength: SEARCH_QUERY_MAX_CODE_UNITS,
											value: query,
											tabIndex: searchExpanded ? 0 : -1,
											onChange: (e) => {
												setQuery(sanitizeSearchQuery(e.target.value));
											},
											onKeyDown: (e) => {
												if (e.key !== "Escape") return;
												setQuery("");
												setSearchExpanded(false);
											}
										}),
										searchExpanded && (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: WorkspaceBrowser_module_css_default.clearButton,
											"aria-label": t("search.clear"),
											onClick: (e) => {
												e.stopPropagation();
												setQuery("");
												setSearchExpanded(false);
											},
											children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseFill14, {})
										})
									]
								})
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								className: clsx(WorkspaceBrowser_module_css_default.headerActions, wide && searchExpanded && WorkspaceBrowser_module_css_default.headerActionsHidden),
								children: [wide && (0, react_jsx_runtime.jsx)(ViewOptionsMenu, {
									groupBy,
									orderBy,
									onGroupPick: (mode) => {
										actions.setGroupBy(mode);
									},
									onOrderPick: (mode) => {
										actions.setOrderBy(mode);
									},
									t
								}), true && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: t("workspace.add"),
									side: "bottom",
									delayMs: 500,
									children: (0, react_jsx_runtime.jsx)("button", {
										ref: wsPlusRef,
										type: "button",
										className: WorkspaceBrowser_module_css_default.iconButton,
										"aria-label": t("workspace.add"),
										onClick: () => {
											setWsPickerOpen((v) => !v);
										},
										children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconProjectAddOutline16, { size: wide ? 16 : 18 })
									})
								})]
							}),
							(0, react_jsx_runtime.jsx)(WorkspacePickFlow, {
								t,
								open: wsPickerOpen,
								anchorRef: wsPlusRef,
								useWorkspaces,
								createWorkspace,
								useDirectoryFlow,
								renderDirectoryFlow: (owner) => renderSlot("sidebar.workspaces.directoryFlow", owner),
								addOnly: true,
								side: "right",
								onPick: (workspaceId) => {
									setWsPickerOpen(false);
									startSession(workspaceId);
								},
								onClose: () => {
									setWsPickerOpen(false);
								}
							})
						]
					}),
					!wide && (0, react_jsx_runtime.jsx)("div", {
						className: WorkspaceBrowser_module_css_default.search,
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: t("search"),
							children: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: WorkspaceBrowser_module_css_default.searchButton,
								"aria-label": t("search.sessions.aria"),
								onClick: () => {
									setSearchExpanded(true);
									setSearchOnExpand(true);
									expandSidebar();
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSearchOutline16, { size: 18 })
							})
						})
					}),
					(0, react_jsx_runtime.jsx)("div", {
						className: WorkspaceBrowser_module_css_default.listArea,
						children: wide && (normalizedQuery !== "" ? (0, react_jsx_runtime.jsx)(SearchResults, {
							useSessions,
							open,
							workspaces,
							archivedSessionIds,
							query: normalizedQuery,
							remote: remoteSearch,
							resultLimit: searchResultLimit,
							t
						}) : groupBy === "flat" ? (0, react_jsx_runtime.jsx)(FlatList, {
							useSessions,
							open,
							forkSession,
							onSessionRename,
							onSessionArchive,
							archivedSessionIds,
							orderBy,
							sessionOrderByAccount,
							sessionUpdatedAtByAccount,
							syncSessionOrderAccount: actions.syncSessionOrderAccount,
							setSessionOrder: actions.setSessionOrder,
							t
						}) : (0, react_jsx_runtime.jsx)(SessionTree, {
							useSessions,
							onSessionRename,
							onSessionArchive,
							forkSession,
							workspaces,
							groupExpansion,
							setGroupExpanded: actions.setGroupExpanded,
							sessionOrderByAccount,
							sessionUpdatedAtByAccount,
							syncSessionOrderAccount: actions.syncSessionOrderAccount,
							setSessionOrder: actions.setSessionOrder,
							archivedSessionIds,
							startSession,
							open,
							insertWorkspaceBefore,
							insertSessionBefore,
							orderBy,
							home,
							t,
							onRenameRequest: (workspaceId, currentTitle) => {
								setRenameTarget({
									workspaceId,
									currentTitle
								});
								setRenameDraft(currentTitle);
								setRenameError(null);
							},
							onDeleteRequest: (workspaceId, title) => {
								setDeleteTarget({
									workspaceId,
									title
								});
								setDeleteError(null);
							}
						}))
					}),
					(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: renameTarget !== null,
						onClose: closeRename,
						closeLabel: t("close"),
						title: t("rename.workspace.title"),
						footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: renaming,
							onClick: closeRename,
							children: t("cancel")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: renameBlocked,
							onClick: confirmRename,
							children: t("rename")
						})] }),
						children: [
							(0, react_jsx_runtime.jsx)("input", {
								className: WorkspaceBrowser_module_css_default.renameInput,
								value: renameDraft,
								"aria-label": t("field.workspaceName"),
								autoFocus: true,
								disabled: renaming,
								onFocus: (e) => {
									e.target.select();
								},
								onChange: (e) => {
									setRenameDraft(e.target.value);
									setRenameError(null);
								},
								onCompositionStart: () => {
									composingRef.current = true;
								},
								onCompositionEnd: () => {
									composingRef.current = false;
								},
								onKeyDown: (e) => {
									if (e.key === "Enter" && !composingRef.current) {
										e.preventDefault();
										confirmRename();
									}
								}
							}),
							renameDuplicate && (0, react_jsx_runtime.jsx)("div", {
								className: WorkspaceBrowser_module_css_default.renameError,
								role: "alert",
								children: t("conflict.named", { name: renameTrimmed })
							}),
							renameError !== null && (0, react_jsx_runtime.jsx)("div", {
								className: WorkspaceBrowser_module_css_default.renameError,
								role: "alert",
								children: renameError
							})
						]
					}),
					(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: sessionRenameTarget !== null,
						onClose: closeSessionRename,
						closeLabel: t("close"),
						title: t("rename.session.title"),
						footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: sessionRenaming,
							onClick: closeSessionRename,
							children: t("cancel")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							disabled: sessionRenameBlocked,
							onClick: confirmSessionRename,
							children: t("rename")
						})] }),
						children: [(0, react_jsx_runtime.jsx)("input", {
							className: WorkspaceBrowser_module_css_default.renameInput,
							value: sessionRenameDraft,
							"aria-label": t("field.sessionName"),
							autoFocus: true,
							disabled: sessionRenaming,
							onFocus: (e) => {
								e.target.select();
							},
							onChange: (e) => {
								setSessionRenameDraft(e.target.value);
								setSessionRenameError(null);
							},
							onCompositionStart: () => {
								composingRef.current = true;
							},
							onCompositionEnd: () => {
								composingRef.current = false;
							},
							onKeyDown: (e) => {
								if (e.key === "Enter" && !composingRef.current) {
									e.preventDefault();
									confirmSessionRename();
								}
							}
						}), sessionRenameError !== null && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.renameError,
							role: "alert",
							children: sessionRenameError
						})]
					}),
					(0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
						open: deleteTarget !== null,
						onClose: closeDelete,
						closeLabel: t("close"),
						title: t("delete.workspace"),
						...deleteTarget === null ? {} : { description: t("delete.desc", { name: deleteTarget.title }) },
						footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							disabled: deleting,
							onClick: closeDelete,
							children: t("cancel")
						}), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "outline",
							className: WorkspaceBrowser_module_css_default.deleteAction,
							disabled: deleting,
							onClick: confirmDelete,
							children: t("delete.workspace")
						})] }),
						children: [deleting && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.deleteStatus,
							role: "status",
							children: t("delete.pending")
						}), deleteError !== null && (0, react_jsx_runtime.jsx)("div", {
							className: WorkspaceBrowser_module_css_default.renameError,
							role: "alert",
							children: deleteError
						})]
					})
				]
			});
		}
		//#endregion
		//#region lib/types/client/locales.js
		/**
		* `workspace` namespace dictionaries: the browsing region (section header,
		* search, tree rows, dialogs) and the pick/add flow. Runtime failure
		* messages (wire error strings) pass through untranslated by policy.
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"group.ungrouped": "未分组",
			"session.new": "新会话",
			"section.workspaces": "工作区",
			"section.sessions": "会话",
			"viewOptions.label": "视图选项",
			"groupBy.label": "分组方式",
			"groupBy.workspace": "按工作区",
			"groupBy.flat": "单列表",
			"orderBy.label": "排序方式",
			"orderBy.manual": "手动排序",
			"orderBy.updated": "最近更新",
			"sessions.expand": "展开其余 {n} 个会话",
			"sessions.collapse": "收起",
			"empty.none": "暂无会话",
			"empty.noMatches": "无匹配结果",
			"workspace.add": "添加工作区",
			"search.sessions.aria": "搜索会话",
			"search.placeholder": "搜索会话…",
			"search.clear": "清除搜索",
			"search.results.aria": "搜索结果",
			"search.pending": "正在搜索会话历史…",
			"search.unavailable": "内容搜索暂不可用，仅显示名称匹配。",
			"search.noMatches": "无匹配会话",
			"search.hasMore": "仅显示前 {n} 条结果，请缩小搜索范围。",
			"menu.addWorkspace": "添加工作区…",
			"picker.loading": "正在加载工作区…",
			"conflict.named": "已存在名为“{name}”的工作区。",
			"folderError.title": "无法打开文件夹",
			"folderError.retry": "重新选择",
			"rename": "重命名",
			"rename.workspace.title": "重命名工作区",
			"rename.session.title": "重命名会话",
			"field.workspaceName": "工作区名称",
			"field.sessionName": "会话名称",
			"delete.workspace": "删除工作区",
			"delete.desc": "将把“{name}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。",
			"delete.pending": "正在删除工作区…",
			"menu.fork": "分叉会话",
			"menu.archiveSession": "归档会话",
			"sessions.count.one": "{n} 个会话",
			"sessions.count.other": "{n} 个会话",
			"actions.workspace.aria": "工作区“{name}”的操作",
			"actions.session.aria": "会话“{name}”的操作",
			"actions.newSession.aria": "在“{name}”中新建会话",
			"status.running": "进行中",
			"status.subagentsRunning.one": "{n} 个子代理运行中",
			"status.subagentsRunning.other": "{n} 个子代理运行中",
			"status.idle": "空闲",
			"status.waitingApproval": "等待审批",
			"status.planReview": "计划待审",
			"status.waitingAnswer": "等待回答",
			"status.completed": "已完成",
			"hover.created": "创建于 {time}",
			"hover.copied": "已复制",
			"date.ymd": "{y}年{m}月{d}日",
			"time.now": "刚刚",
			"time.minutes": "{n}分钟",
			"time.hours": "{n}小时",
			"time.days": "{n}天",
			"time.months": "{n}个月",
			"time.years": "{n}年",
			"time.ago": "{t}前"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"group.ungrouped": "Ungrouped",
			"session.new": "New Session",
			"section.workspaces": "Workspaces",
			"section.sessions": "Sessions",
			"viewOptions.label": "View options",
			"groupBy.label": "Group by",
			"groupBy.workspace": "WorkSpace",
			"groupBy.flat": "In one list",
			"orderBy.label": "Order by",
			"orderBy.manual": "Manual",
			"orderBy.updated": "Last updated",
			"sessions.expand": "Show {n} more sessions",
			"sessions.collapse": "Show less",
			"empty.none": "No sessions yet",
			"empty.noMatches": "No matches",
			"workspace.add": "Add workspace",
			"search.sessions.aria": "Search sessions",
			"search.placeholder": "Search sessions...",
			"search.clear": "Clear search",
			"search.results.aria": "Search results",
			"search.pending": "Searching session history…",
			"search.unavailable": "Content search is temporarily unavailable. Showing name matches.",
			"search.noMatches": "No matching sessions",
			"search.hasMore": "Showing the first {n} results. Narrow your search.",
			"menu.addWorkspace": "Add workspace…",
			"picker.loading": "Loading workspaces…",
			"conflict.named": "A workspace named “{name}” already exists.",
			"folderError.title": "Couldn’t open folder",
			"folderError.retry": "Choose again",
			"rename": "Rename",
			"rename.workspace.title": "Rename workspace",
			"rename.session.title": "Rename session",
			"field.workspaceName": "Workspace name",
			"field.sessionName": "Session name",
			"delete.workspace": "Delete workspace",
			"delete.desc": "This removes “{name}” from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
			"delete.pending": "Deleting workspace…",
			"menu.fork": "Fork session",
			"menu.archiveSession": "Archive session",
			"sessions.count.one": "{n} session",
			"sessions.count.other": "{n} sessions",
			"actions.workspace.aria": "Workspace actions for {name}",
			"actions.session.aria": "Session actions for {name}",
			"actions.newSession.aria": "New session in {name}",
			"status.running": "Running",
			"status.subagentsRunning.one": "{n} subagent running",
			"status.subagentsRunning.other": "{n} subagents running",
			"status.idle": "Idle",
			"status.waitingApproval": "Waiting for approval",
			"status.planReview": "Plan awaiting review",
			"status.waitingAnswer": "Waiting for answer",
			"status.completed": "Completed",
			"hover.created": "Created {time}",
			"hover.copied": "Copied",
			"date.ymd": "{y}-{m}-{d}",
			"time.now": "now",
			"time.minutes": "{n}min",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"time.ago": "{t} ago"
		};
		//#endregion
		//#region arxa: rows world (docs/plans/sidebar-org-rethink.md)
		// The stock component tree (groups, rows, search box, view-options menu,
		// hover menus, pills) is kept whole above; this region re-points its data
		// hooks at /__arxa/sidebar/*, relabels the locale dicts, and adds the one
		// genuinely new surface: the trash list (Q6). Everything else is stock
		// behaviour over org data.
		const ORG_FETCH = async (selectedProject) => {
			const q = selectedProject ? "?project=" + encodeURIComponent(selectedProject) : "";
			const r = await fetch("/__arxa/sidebar/state" + q);
			return r.json();
		};
		// card.* / insight.* / version.* moved to the arxa-git-card host
		// (docs/plans/git-card-stock-dock-rebuild.md A2); routed by prefix
		// until the card itself leaves this bundle (plan step 3).
		const ORG_ROUTE_FOR = (action) => /^(card|insight|version)\./.test(action)
			? "/__arxa/git-card/action" : "/__arxa/sidebar/action";
		const ORG_POST = (action, arg) => fetch(ORG_ROUTE_FOR(action), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, arg })
		}).then(async (r) => {
			const b = await r.json();
			if (!b.ok) throw new Error(b.error || action);
			return b;
		});
		function createOrgStore() {
			let resumeTried = false;
		let bootDecided = false;
			// Client-side current session (stock auto-expand + highlight key off it):
			// set by resume + session.open; server truth is which org is open, not
			// which session is focused — dsh owns focus, we mirror the last open.
			let currentSessionId = null;
			let state = { orgs: [], trash: [], trashCount: 0, root: false, selectedProject: null, trashView: { rows: [], open: true }, selectedRowId: null, expanded: {}, emit: {}, currentSessionId: null, loading: true, __sig: "", workspacesView: { items: [], phase: "ready", archivedSessionIds: [] }, sessionsView: { byId: {}, ids: [], current: void 0 } };
			const subs = new Set();
			let timer = 0;
			/** Resume (D71 UX + 2026-08-30): on first sight of an org with
			 * sessions, open the newest open one (else newest overall) so the
			 * app lands where the user left off — and RESUME IT LIKE DSH: the
			 * host revive (which spawns the engine conversation when the row
			 * lacks one) is followed by the client sessions service open() —
			 * the same call stock dsh makes when a session row opens. When
			 * the org world has landed and there is NOTHING to resume, the
			 * content area lands on the empty state (clear() wipes the
			 * persisted selection — raw pre-arxa/hero sessions stop riding
			 * along every boot) and re-asserts empty while dsh's startup
			 * workspace-reconnect settles. Never fights the user. */
			const clearIfNothingToResume = () => {
				if (bootDecided || state.loading) return;
				bootDecided = true;
				if (!arxaClientSessions || typeof arxaClientSessions.clear !== "function") return;
				try { arxaClientSessions.clear() } catch { /* degrade */ }
				// dsh's startup policy (workspaces.startInitialSelection) connects the
				// recent workspace's resident blank session right after the first
				// baseline and re-opens it OVER a clear that landed mid-connect (the
				// .then re-checks current). A rider is definitionally a session
				// outside the org model, so re-assert empty while the boot policy
				// settles (bounded); user and resume opens always win (the org-row
				// and current-session guards bail out on either).
				let tries = 0;
				const reassertEmpty = () => {
					tries += 1;
					const snap = arxaClientSessions.list && typeof arxaClientSessions.list.getSnapshot === "function" ? arxaClientSessions.list.getSnapshot() : null;
					const cur = snap ? snap.current : void 0;
					if (cur === void 0 || cur === null) return;
					if (currentSessionId) return;
					const orgIds = new Set();
					for (const o of state.orgs || []) for (const x of o.sessions || []) if (x.dshSessionId) orgIds.add(x.dshSessionId);
					if (orgIds.has(cur)) return;
					if (tries > 20) return;
					try { arxaClientSessions.clear() } catch { /* degrade */ }
					window.setTimeout(reassertEmpty, 250);
				};
				window.setTimeout(reassertEmpty, 250);
			};
			const maybeResume = (orgs) => {
				if (resumeTried) return;
				if (!orgs || orgs.length === 0) {
					// Welcome world (no orgs): land on the empty state too.
					clearIfNothingToResume();
					return;
				}
				// No org open YET (fresh boot): keep the shot — a later poll may
				// see one (org.open switches server-side); once the data has
				// settled with nothing openable, clear once.
				const open = orgs.find((o) => o.open);
				if (!open || !open.sessions || open.sessions.length === 0) {
					clearIfNothingToResume();
					return;
				}
				resumeTried = true;
				bootDecided = true;
				const openSessions = open.sessions.filter((x) => x.state === "open");
				const cand = openSessions.length ? openSessions[openSessions.length - 1] : open.sessions[open.sessions.length - 1];
				currentSessionId = cand.id;
			// The sig gate blocks the next state replacement when server data is
			// unchanged — surface current NOW or the stock auto-expand (which
			// keys off sessionsView.current) never sees the resumed session.
			state = { ...state, currentSessionId: cand.id };
			state.sessionsView = sessionsList(state);
			emit();
			// Host revive first (may spawn the engine conversation), then the
			// refresh the mutate carries lands the fresh dshSessionId, then
			// open the conversation — dsh's own resume call.
			orgStore.mutate("session.open", { orgId: open.id, sessionId: cand.id }).then(() => arxaOpenConversation(cand.id)).catch(() => {});
			};
			const emit = () => {
				subs.forEach((l) => l());
				window.dispatchEvent(new Event("arxa-sidebar-state"));
			};
			const refresh = async () => {
				try {
					const next = await ORG_FETCH();
					// D88: orgTrash rides the change signature — a purge changes ONLY
			// orgTrash (the org left orgs when it was trashed), so without this
			// the post-purge snapshot was silently discarded and the ghost row
			// survived every refresh and poll.
			const sig = JSON.stringify([next.orgs, next.trash, next.orgTrash, next.trashCount, next.root, next.selectedProject]);
					if (sig !== state.__sig) {
						// Client-side faces survive every server replacement (the trash
						// toggle, the row selection and the container expansion are not
						// server data — a bare spread would leave selectedRowId
						// undefined where the contract says null).
						state = { ...next, loading: false, __sig: sig, trashOpen: state.trashOpen, selectedRowId: state.selectedRowId ?? null, expanded: state.expanded ?? {}, currentSessionId: currentSessionId ?? state.currentSessionId ?? null };
						state.trashView = { rows: state.trash ?? [], open: state.trashOpen ?? true };
						// Derived faces computed ONCE per state replacement: stock hosts
						// serve stable array identities, and per-render rebuilds would
						// re-fire the browser's store-sync effects every render (React #185).
						state.workspacesView = { items: orgItems(state), phase: "ready", archivedSessionIds: [] };
						state.sessionsView = sessionsList(state);
						state.emit = buildEmit(state);
						state.trashView = { rows: state.trash ?? [], open: state.trashOpen ?? true };
						emit();
						maybeResume(next.orgs);
					} else if (state.loading) {
						state = { ...state, loading: false };
						state.trashView = { rows: state.trash ?? [], open: state.trashOpen ?? true };
						emit();
					}
				} catch {
					/* transient — keep the last good snapshot */
				}
			};
			return {
				subscribe(l) {
					subs.add(l);
					if (subs.size === 1) {
						refresh();
						timer = window.setInterval(refresh, 5e3);
						window.addEventListener("focus", refresh);
					}
					return () => {
						subs.delete(l);
						if (subs.size === 0) {
							window.clearInterval(timer);
							window.removeEventListener("focus", refresh);
						}
					};
				},
				refresh,
				mutate(action, arg) {
					if (action === "session.open" && arg && typeof arg.sessionId === "string") {
						currentSessionId = arg.sessionId;
						state = { ...state, currentSessionId };
						state.sessionsView = sessionsList(state);
						emit();
					}
					return ORG_POST(action, arg).then((r) => refresh()).then(() => {}, (e) => {
						refresh();
						throw e;
					});
				},
				get: () => state,
				/** Client-side toggle only (Q6): the list itself is server data. */
				toggleTrash() {
					state = { ...state, trashOpen: !(state.trashOpen ?? true) };
					state.trashView = { rows: state.trash ?? [], open: state.trashOpen ?? true };
					emit();
				},
				/** Client-side selection only (D70/D71, org-scoped): which
				* workspace row the New Session CTA targets — { orgId, rowId }
				* where rowId is the workspace path ("notes",
				* "projects/topo/design") | null. Server truth is untouched. */
				selectRow(sel) {
					state = { ...state, selectedRowId: sel };
					emit();
				},
				/** Client-side container expansion (default-collapsed, 2026-08-30):
				* key = orgId (the org row) or orgId + "|" + container path (dock /
				* project). EVERY container starts collapsed — the tree lands as
				* org rows only and opens exactly where the user opens it. Toggling
				* re-derives the emit map instantly — no server round trip; hidden
				* leaves keep their group identity (display gating, never identity
				* churn). */
				toggleExpand(key) {
					const x = { ...(state.expanded ?? {}) };
					if (x[key]) delete x[key];
					else x[key] = true;
					state = { ...state, expanded: x };
					state.emit = buildEmit(state);
					emit();
				}
			};
		}
		const orgStore = createOrgStore();
		/** Locale capture for stock-scope render sites: SessionTree (where
		 * OrgCategoryRows renders, gen splice 6c) has NO t prop — a t passed
		 * there is an undefined identifier that kills the whole sidebar
		 * section (seen live 2026-08-30: blank sidebar). OrgBrowser refreshes
		 * the capture every render; identity-stable fallback until then. */
		let orgT = (k) => k;
		window.__ARXA_SIDEBAR__ = {
			get orgOpen() {
				return orgStore.get().orgs.some((o) => o.open);
			},
			/** Selected workspace row (v2): the shell New Session CTA target —
			* { orgId, rowId } | null. Org-level creation is gone; a null
			* selection no-ops (the CTA is disabled). */
			selectedWorkspace() {
				return orgStore.get().selectedRowId ?? null;
			},
			/** CTA bridge (2026-09-01): the shell New Session button reads these
			* at RENDER — single source of truth. The first cut (D70/D71) gated
			* the button imperatively from OrgBrowser (querySelectorAll +
			* b.disabled writes); every SidebarRoot re-render reset disabled to
			* its render value, so the CTA sat ENABLED while every click
			* no-oped (orgTick fires on every store emit — the race was
			* constant). ctaReady/ctaTitle recompute per render (orgTick
			* re-renders the shell on every store emit); openCreated closes the
			* loop: server create → session.open → conversation focus, the
			* same flow a tree-row open uses. */
			get ctaReady() {
				const s = orgStore.get();
				const sel = s.selectedRowId;
				if (!sel) return false;
				const o = (s.orgs || []).find((y) => y.id === sel.orgId);
				return !(o && o.open && o.snapshotPending === true);
			},
			get ctaTitle() {
				// orgT (the captured NS locale seat), NOT the enOver/zhOver
				// literals — those close over a LATER region scope and read as
				// undefined from the levers (found live 2026-09-01: the getter
				// threw 'reading selectFirst' and crashed the whole sidebar
				// slot). orgT resolves through the registered dicts instead.
				const s = orgStore.get();
				const sel = s.selectedRowId;
				if (!sel) return orgT("newSession.selectFirst");
				const o = (s.orgs || []).find((y) => y.id === sel.orgId);
				return o && o.open && o.snapshotPending === true ? orgT("newSession.snapshotPending") : void 0;
			},
			openCreated(orgId, sessionId) {
				orgStore.mutate("session.open", { orgId, sessionId }).then(() => arxaOpenConversation(sessionId)).catch(() => {});
			},
			/** Diagnostic (2026-08-30): is the client sessions service bound?
			 * Drives conversation focus (resume like dsh + row open). */
			get clientSessionsReady() {
				return !!(arxaClientSessions && typeof arxaClientSessions.open === "function");
			},
			/** Diagnostic: the client session catalog ids (empty array when the
			 * service or its list store is unavailable). */
			clientSessionIds() {
				const s = arxaClientSessions;
				const snap = s && s.list && typeof s.list.getSnapshot === "function" ? s.list.getSnapshot() : null;
				return { ids: snap && Array.isArray(snap.ids) ? snap.ids.slice() : [], current: snap ? snap.current ?? null : null };
			},
			refresh: () => orgStore.refresh()
		};
		/** Workspace feed (v2 collapse fix, 2026-08-30): every CONTAINER
		 * (org, dock, project) and every leaf workspace becomes ONE stock
		 * workspace item. Containers are pseudo workspaces: their group
		 * hosts the OrgContainerRow and never the stock folder row (the
		 * gen splice suppresses it). v2 anchored container rows inside
		 * their first LEAF's group — dead by construction: collapsing a
		 * container hides every leaf group under it (leafHidden), so the
		 * row vanished with its anchor; tapping an org removed it from the
		 * tree entirely, org by org. A pseudo group hides only when an
		 * ANCESTOR collapses (the org pseudo has ws "" and never hides),
		 * so a row always survives its own collapse. Feed order IS render
		 * order (groupByWorkspace preserves it). Sessions bind by workspace
		 * match on leaves ("<orgId>|notes", "<orgId>|meetings/scheduler",
		 * "<orgId>|projects/topo/design"); pseudo items carry none.
		 * Degraded read (tree null): the org still lists its own row. */
		const wsLabel = (p) => {
			const parts = p.split("/");
			if (parts[0] === "projects" && parts.length === 3) {
				const c = parts[2];
				// D79: GitHub parity — the tree shows the REAL directory name
				// ("00-moodboard" on GitHub, "00-moodboard" here). Only a
				// genuine dictionary hit (a pre-v3 folder like "moodboard")
				// prettifies; v3 names render raw — never stem-mapped, never
				// TitleCased, never a leaked tree.pc key.
				const hit = orgT("tree.pc." + c);
				if (hit && hit !== "tree.pc." + c) return hit;
				return c;
			}
			return orgT("tree.ws." + p);
		};
		const orgItems = (s) => {
			const items = [];
			for (const o of s.orgs || []) {
				const tree = o.tree;
				const push = (ws, title, sessionIds) => items.push({
					workspaceId: ws === null ? o.id : o.id + "|" + ws,
					title,
					path: ws === null ? o.path : o.path + "/" + ws,
					createdAt: o.createdAt,
					sessionIds: sessionIds ?? []
				});
				const leafIds = (ws) => (o.sessions || []).filter((x) => (x.workspace ?? "") === ws).map((x) => x.id);
				// The org pseudo group comes first: the org row's permanent host.
				push(null, o.name);
				if (!tree || !Array.isArray(tree.docks)) continue;
				for (const d of tree.docks) {
					if (d.slug === "projects") {
						push("projects", orgT("tree.dock.projects"));
						for (const p of tree.projects || []) {
							push("projects/" + p.slug, p.name);
							for (const c of p.containers || []) push("projects/" + p.slug + "/" + c, wsLabel("projects/" + p.slug + "/" + c), leafIds("projects/" + p.slug + "/" + c));
						}
					} else if (d.workspace) {
						// Bare dock (notes): the leaf IS the dock row — no pseudo.
						push(d.slug, wsLabel(d.slug), leafIds(d.slug));
					} else {
						push(d.slug, orgT("tree.dock." + d.slug));
						for (const c of d.containers || []) push(d.slug + "/" + c, wsLabel(d.slug + "/" + c), leafIds(d.slug + "/" + c));
					}
				}
			}
			return items;
		};
		/** Registry rows → stock session summaries. Pills stay honest (Q5):
		* running/pendingInteraction ride the Phase D dsh join only; parked
		* rides the completed slot and the locale relabels it. updatedAt is
		* the registry's real ms epoch — the 56y bug fed ordinals, which
		* the stock renderer read as ages from 1970. */
		const sessionsList = (s) => {
			const byId = {};
			const ids = [];
			for (const o of s.orgs || []) for (const x of o.sessions || []) {
				byId[x.id] = {
					id: x.id,
					displayTitle: x.name,
					blank: false,
					origin: "user",
					running: x.running ?? false,
					completed: x.state === "parked",
					updatedAt: x.updatedAt ?? x.createdAt ?? Date.now(),
					...(x.pendingInteraction == null ? {} : { pendingInteraction: x.pendingInteraction })
				};
				ids.push(x.id);
			}
			return { byId, ids, current: s.currentSessionId ?? void 0 };
		};
		const orgOfSession = (sessionId) => {
			for (const o of orgStore.get().orgs) if ((o.sessions || []).some((x) => x.id === sessionId)) return o.id;
			return void 0;
		};
		/** Focus an org session's conversation into the content area (the
		 * client sessions service open — dsh's own row-open call). Called
		 * AFTER the host action + refresh so a just-spawned dshSessionId has
		 * landed on the row. A freshly spawned engine session can take a
		 * beat to reach the client's session catalog — retry until it is
		 * listed (open before then is a silent no-op, and the content area
		 * would stay on the empty state). */
		const arxaOpenConversation = (sessionId, tries = 0) => {
			if (!arxaClientSessions || typeof arxaClientSessions.open !== "function") return;
			let dshId = null;
			for (const o of orgStore.get().orgs || []) {
				const row = (o.sessions || []).find((x) => x.id === sessionId);
				if (row) { dshId = row.dshSessionId ?? null; break; }
			}
			if (!dshId) return;
			const snap = arxaClientSessions.list && typeof arxaClientSessions.list.getSnapshot === "function" ? arxaClientSessions.list.getSnapshot() : null;
			if (snap && Array.isArray(snap.ids) && !snap.ids.includes(dshId) && tries < 12) {
				window.setTimeout(() => arxaOpenConversation(sessionId, tries + 1), 400);
				return;
			}
			try {
				arxaClientSessions.open(dshId);
			} catch (err) {
				window.__arxaOpenError = String(err && err.message || err);
			}
		};
		/** Empty-state guidance (2026-08-30): the stock hero workspace
		 * picker is deliberately GONE from this build — its menu fed dsh's
		 * own workspace registry, and picking one + submitting created a
		 * raw engine session OUTSIDE the org model (the stranding-session
		 * factory: the runtime's persisted selection then restored it on
		 * every boot). This slot face replaces it with the arxa way; and
		 * when NOTHING is bound (the client sessions service has no
		 * current) the component marks the composer stack data-arxa-empty,
		 * which hides the text composer entirely (arxa CSS below) — the
		 * user asked for a blank page with guidance, not an inert input.
		 * A BOUND blank session keeps its composer: typing there is a
		 * legitimate first message into an org worktree. */
		/** The composer git card moved to plugins/arxa-git-card (docs/plans/
		 * git-card-stock-dock-rebuild.md A4, 2026-09-02): its own input-dock
		 * entry, stock QueueDock grammar. Nothing card-related lives here. */
		function ArxaHeroGuide({ t }) {
			const ref = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const stack = ref.current ? ref.current.parentElement?.parentElement?.parentElement : null;
				if (!stack) return;
				const s = arxaClientSessions;
				const snap = s && s.list && typeof s.list.getSnapshot === "function" ? s.list.getSnapshot() : null;
				const unbound = !snap || snap.current === void 0 || snap.current === null;
				if (unbound) stack.setAttribute("data-arxa-empty", "");
				else stack.removeAttribute("data-arxa-empty");
				return () => stack.removeAttribute("data-arxa-empty");
			});
			return (0, react_jsx_runtime.jsxs)("div", {
				ref,
				"data-arxa-hero-guide": "",
				children: [t("hero.guide")]
			});
		}
		// Empty-state CSS (2026-08-30): inside a marked stack the text
		// composer is gone — the data-slot anchor is the framework outlet
		// wrapper (stable), unlike hashed module classes.
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=arxa-sidebar-empty-state]") === null) {
			const tag = document.createElement("style");
			tag.dataset.pluginCss = "arxa-sidebar-empty-state";
			tag.textContent = "[data-arxa-hero-guide]{font-size:12.5px;opacity:.72;line-height:1.55;max-width:470px}"
				+ "[data-arxa-empty] [data-slot='conversation.composer.bar']{display:none!important}"
				+ "[data-arxa-empty] .wSkVaW_heroWorkspaceRow>button{display:none!important}"
				+ "[data-arxa-empty] [data-slot='conversation.hero.agentPreset']{display:none!important}"
				+ "[data-arxa-empty] [data-arxa-hero-guide]{text-align:center;max-width:560px;margin:12px auto 0;font-size:13px;opacity:.78;line-height:1.7}";
			document.head.appendChild(tag);
		}
		/** Parse "<orgId>|<wsPath>" composite ids. */
		const wsParts = (workspaceId) => {
			const s = String(workspaceId ?? "");
			const i = s.indexOf("|");
			if (i < 0) return { orgId: s, ws: "" };
			return { orgId: s.slice(0, i), ws: s.slice(i + 1) };
		};
		/** A leaf hides unless EVERY ancestor container is expanded —
		 * default-collapsed (2026-08-30): a fresh load shows org rows only;
		 * the tree opens exactly where the user opens it. Container pseudo
		 * groups walk the same prefixes (the org pseudo has ws "" and never
		 * hides). */
		const leafHidden = (workspaceId) => {
			const { orgId, ws } = wsParts(workspaceId);
			if (ws === "") return false;
			const x = orgStore.get().expanded ?? {};
			if (!x[orgId]) return true;
			const parts = ws.split("/");
			for (let i = 1; i < parts.length; i++) if (!x[orgId + "|" + parts.slice(0, i).join("/")]) return true;
			return false;
		};
		/** Stock-tree render hooks (gen splices call these by name). */
		// Leaf indent by depth, in px (a unitless paddingLeft is silently
		// dropped by the CSSOM, which once left every leaf at the stock 8px).
		const wsIndent = (ws) => 18 + 12 * (ws.split("/").length - 1);
		const ARXA_WS_INDENT = (workspaceId) => wsIndent(wsParts(workspaceId).ws) + "px";
		const ARXA_WS_HIDDEN = (workspaceId) => leafHidden(workspaceId);
		// Container rows render INSIDE their own pseudo group (v2 collapse
		// fix: never inside a leaf group — a collapsed container hides its
		// leaves' groups, and a row living there vanished with its anchor).
		// The pseudo group carries the container's own indent, so the row
		// compensates to land at its absolute depth:
		// org 4 < dock 18 < project 32 < leaves 18/30/42.
		const ARXA_CONTAINER_ROWS = (workspaceId) => {
			const host = wsIndent(wsParts(workspaceId).ws);
			return ((orgStore.get().emit ?? {})[workspaceId] ?? []).map((d) => (0, react_jsx_runtime.jsx)(OrgContainerRow, {
				d,
				offset: 4 + d.depth * 14 - host
			}, d.key));
		};
		// True on container pseudo groups (org / dock / project): the stock
		// folder row is suppressed there — the OrgContainerRow IS the row.
		const ARXA_IS_CONTAINER_GROUP = (workspaceId) => ((orgStore.get().emit ?? {})[workspaceId] ?? []).length > 0;
		/** T4 v2: a leaf worktree's files render INSIDE its group, under the
		 * row, only while the group is expanded — "full" mode (the worktree
		 * is real content: subdirs expand in place). Container groups render
		 * their listing on the OrgContainerRow itself instead. */
		const ARXA_LEAF_FILES = (group) => {
			if (!group || group.expanded !== true || group.workspaceId === void 0) return null;
			if (ARXA_IS_CONTAINER_GROUP(group.workspaceId)) return null;
			const { ws } = wsParts(group.workspaceId);
			if (ws === "") return null;
			return (0, react_jsx_runtime.jsx)(ArxaDirRows, { dir: ws, depth: ws.split("/").length, mode: "full" }, "arxa-files");
		};
		/** D83: the Trash surface rides the GROUPED org tree's tail (gen
		 * splice 6z) — directly under the last org row, ALWAYS, instead of
		 * the sidebar's very bottom where the stock sessions region pushed
		 * it hundreds of px below the orgs once an org is open. The flat
		 * "In one list" stock mode has no org rows — no trash there. */
		const ARXA_TRASH_AFTER_ORGS = () => orgT ? (0, react_jsx_runtime.jsx)(TrashSection, { t: orgT, key: "arxa-trash" }) : null;
		/** T4 v2: the separate tail Files section is GONE (user direction —
		 * files belong inside the tree under the owning row). ArxaDirRows +
		 * ARXA_LEAF_FILES render inline instead; the tree-read route and the
		 * arxa-av-open bridge are unchanged. */
		const ARXA_SELECT_WS = (workspaceId) => {
			const { orgId, ws } = wsParts(workspaceId);
			if (ws !== "") orgStore.selectRow({ orgId, rowId: ws });
		};
		/** Container-row emission map (v2 collapse fix, 2026-08-30): every
		 * container row is keyed at its OWN pseudo workspace (orgItems pushes
		 * one pseudo item per container) — no anchoring at leaves, no pending
		 * rows: a leafless dock (empty Projects) renders its own group, so the
		 * + to create the first project is always reachable. A container
		 * group renders exactly its OrgContainerRow; collapse gates only
		 * DESCENDANTS (leafHidden walks ancestor prefixes, never the
		 * container's own key). */
		const buildEmit = (s) => {
			const emit = {};
			for (const o of s.orgs || []) {
				const tree = o.tree;
				const counts = (tree && tree.sessionsByWorkspace) || {};
				const total = Object.values(counts).reduce((a, b) => a + b, 0);
				const countUnder = (prefix) => {
					let n = 0;
					for (const [k, v] of Object.entries(counts)) if (k === prefix || k.startsWith(prefix + "/")) n += v;
					return n;
				};
				emit[o.id] = [{ kind: "org", orgId: o.id, key: o.id, depth: 0, label: o.name, slug: o.slug, open: o.open, count: total, connected: !!o.connected }];
				if (!tree || !Array.isArray(tree.docks)) continue;
				for (const d of tree.docks) {
					if (d.workspace) continue;
					emit[o.id + "|" + d.slug] = [{ kind: "dock", orgId: o.id, key: o.id + "|" + d.slug, depth: 1, label: orgT("tree.dock." + d.slug), slug: d.slug, count: d.slug === "projects" ? countUnder("projects") : countUnder(d.slug), ...(d.slug === "projects" ? { plus: "project" } : {}) }];
					if (d.slug === "projects") for (const p of tree.projects || []) emit[o.id + "|projects/" + p.slug] = [{ kind: "project", orgId: o.id, key: o.id + "|projects/" + p.slug, depth: 2, label: p.name, slug: p.slug, count: countUnder("projects/" + p.slug), connected: !!p.connected }];
				}
			}
			return emit;
		};
		// Stable subscribe identity — a fresh arrow per render would make React
		// resubscribe every time, and each 0-to-1 resubscription fires refresh(),
		// looping the render (React #185).
		const orgSubscribe = (l) => orgStore.subscribe(l);
		function useOrg(selector) {
			const snap = (0, react.useSyncExternalStore)(orgSubscribe, orgStore.get, orgStore.get);
			return selector(snap);
		}
		/** Constant-false directory-flow source: the stock add path is spliced to
		* a name prompt (orgs are scaffolded, not adopted folders), so the native
		* directory picker flow stays permanently unavailable. */
		const orgNoFlow = { getSnapshot: () => false, subscribe: () => () => {} };
		// Hook faces are STABLE module-scope identities, bound at the component
		// boundary (see OrgBrowser): the slot renderer merges its STANDARD runtime
		// hooks (useSessions/useWorkspaces) OVER inject props, so declaring them in
		// the inject face loses — passing them as plain props cannot be overridden.
		let orgHostDescription = void 0;
		// Client runtime sessions service (dsh-client-runtime): open(id)
		// focuses a conversation into the content area; clear() empties it
		// AND wipes the persisted selection (the restore source at boot).
		// arxa is the sole driver of the content area (2026-08-30): rows and
		// resume open conversations by the row's dshSessionId; a boot with
		// nothing to resume clears — pre-arxa/hero stranding sessions stop
		// riding along. Null when the service is absent (degrade silently).
		let arxaClientSessions = null;
		const orgUseWorkspaces = (sel) => useOrg((s) => sel(s.workspacesView));
		const orgUseSessions = (sel) => useOrg((s) => sel(s.sessionsView));
		const orgUseDirectoryFlow = (sel) => sel(orgNoFlow.getSnapshot());
		const orgUseHostDescription = (sel) => sel(orgHostDescription);
		/** CTA gate (D70/D71) is DECLARATIVE now (2026-09-01): the shell
		 * button reads window.__ARXA_SIDEBAR__.ctaReady/ctaTitle at render —
		 * see the lever comments at createOrgStore. The imperative DOM gate
		 * that lived here lost the re-render race (constant orgTick churn
		 * reset b.disabled) and left the CTA enabled but dead. */
		/** Container row (v2, grilled 2026-08-30): org, dock, or project —
		 * NEVER hosts sessions (no +). Org rows carry the org actions menu
		 * (open / close / trash); docks and projects are fixed containers:
		 * collapse only. Click = collapse/expand ALL children; switching
		 * orgs is implicit through any action inside one, or explicit via
		 * the org menu. Docks/projects use the stock folder glyph
		 * (open/closed by expansion) — the exact folder icon the docks
		 * always had; the org row gets the organisation glyph. */
		/** Organisation glyph (D82 hoisted from the org row): the building
		 * mark every org surface shares — the tree row AND the trash
		 * section's org group read as "organisation" through it. */
		function OrgGlyph({ size }) {
			return (0, react_jsx_runtime.jsxs)("svg", {
				width: size ?? 15,
				height: size ?? 15,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.3,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					(0, react_jsx_runtime.jsx)("rect", { x: "2.5", y: "1.5", width: "8", height: "13", rx: "1" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M10.5 6h3v8.5" }),
					(0, react_jsx_runtime.jsx)("path", { d: "M5 4.5h3M5 7.5h3M5 10.5h3" })
				]
			});
		}
		/**
		 * D97: fold the org.sync sweep (org repo + every project repo) into
		 * ONE row badge. A failure ANYWHERE wins the label — the whole point
		 * of a manual sync door is that a refused push is SEEN, so a green
		 * "in sync" must never paint over a "push-failed: … without workflow
		 * scope". The engine's raw status words ride the tooltip untranslated
		 * (diagnostic vocabulary, not UI copy).
		 */
		const ARXA_SYNC_BAD = /^(push-failed|error|fetch-failed|no-creds|diverged|no-manifest)/;
		function arxaSyncSummary(rows) {
			const list = Array.isArray(rows) ? rows : [];
			const detail = list.map((r) => (r.slug || "org") + ": " + r.status).join("\n");
			const bad = list.find((r) => ARXA_SYNC_BAD.test(String(r.status)));
			if (bad) return { key: "rows.sync.failed", detail, bad: true };
			const pushed = list.filter((r) => r.status === "pushed" || r.status === "pulled").length;
			return { key: pushed ? "rows.sync.pushed" : "rows.sync.ok", detail: detail || "nothing to sync", bad: false };
		}
		function OrgContainerRow({ d, offset }) {
			const expandedMap = useOrg((s) => s.expanded ?? {});
			const isOrg = d.kind === "org";
			const open = !!expandedMap[d.key];
			const [menuOpen, setMenuOpen] = (0, react.useState)(false);
			// D97: last sync outcome for THIS row — null (never synced this
			// session) | { busy: true } | { key, detail, bad }.
			const [syncState, setSyncState] = (0, react.useState)(null);
			// D80: BOTH row kinds carry a menu; D80 scope fix: ONLY org + project
			// rows — fixed docks (Meetings/Account/…) and containers are
			// infrastructure, never renamable. D82: every row gets a proper
			// design-system glyph (edit / folder / GitHub mark / trash).
			// D87: "Close" is GONE from the menu — it closed whatever org was
			// open server-side (unscoped, invisible, switch already tears down).
			// "Move to Trash" (danger, local-only + restorable) stays — the Trash
			// row LISTS entries but the verb that creates them must live on the org.
			const showMenu = isOrg || d.kind === "project";
			const ghMark16 = (0, react_jsx_runtime.jsx)("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true", children: (0, react_jsx_runtime.jsx)("path", { d: GH_MARK }) });
			const items = isOrg ? [
				{ id: "rename", label: orgT("menu.org.rename"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {}) },
				{ id: "open", label: orgT("menu.org.open"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) },
				// D97: org rows ONLY — org.sync sweeps the org AND every project
				// under it, so on a project row the same item would silently do
				// far more than its label promises.
				{ id: "sync", label: orgT("menu.org.sync"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {}) },
				d.connected === false ? { id: "connect", label: orgT("menu.org.connect"), icon: ghMark16 } : { id: "disconnect", label: orgT("menu.org.disconnect"), icon: ghMark16 },
				{ type: "separator", id: "sep-org-trash" },
				{ id: "trash", label: orgT("menu.org.trash"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}), danger: true }
			] : [
				{ id: "rename", label: orgT("menu.project.rename"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {}) },
				d.connected === false ? { id: "connect", label: orgT("menu.project.connect"), icon: ghMark16 } : { id: "disconnect", label: orgT("menu.project.disconnect"), icon: ghMark16 },
				{ id: "trash", label: orgT("menu.project.trash"), icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}), danger: true }
			];
			const onSelect = (id) => {
				setMenuOpen(false);
				if (id === "open") orgStore.mutate("org.open", { orgId: d.orgId }).catch(() => {});
				// D97: NOT orgStore.mutate — mutate() throws the result away
				// (`.then((r) => refresh())`), and the sweep’s per-repo status IS
				// the deliverable here. ORG_POST direct, then refresh by hand so a
				// push that moved main repaints the rows.
				else if (id === "sync" && isOrg) {
					setSyncState({ busy: true });
					ORG_POST("org.sync", { orgId: d.orgId })
						.then((b) => { setSyncState(arxaSyncSummary(b.result)); return orgStore.refresh(); })
						.catch((e) => setSyncState({ key: "rows.sync.failed", detail: String(e?.message ?? e), bad: true }));
				}
				else if (id === "connect" && isOrg) window.dispatchEvent(new CustomEvent("arxa-publish-org", { detail: { orgId: d.orgId, orgName: d.label || d.orgId } }));
			else if (id === "connect") window.dispatchEvent(new CustomEvent("arxa-publish-org", { detail: { orgId: d.orgId, projectSlug: d.slug, orgName: d.label || d.orgId, projectName: d.label || d.slug } }));
			else if (id === "disconnect" && isOrg) window.dispatchEvent(new CustomEvent("arxa-disconnect-github", { detail: { kind: "org", orgId: d.orgId, name: d.label || d.orgId, slug: d.slug || "" } }));
			else if (id === "disconnect") window.dispatchEvent(new CustomEvent("arxa-disconnect-github", { detail: { kind: "project", orgId: d.orgId, projectSlug: d.slug, name: d.label || d.slug, slug: d.slug } }));
				else if (id === "rename" && isOrg) window.dispatchEvent(new CustomEvent("arxa-rename-org", { detail: { orgId: d.orgId, orgName: d.label || "" } }));
				else if (id === "rename") window.dispatchEvent(new CustomEvent("arxa-rename-project", { detail: { orgId: d.orgId, projectSlug: d.slug, projectName: d.label || "" } }));
				else if (id === "trash" && isOrg) orgStore.mutate("org.trash", { orgId: d.orgId }).catch(() => {});
				else if (id === "trash") orgStore.mutate("project.trash", { orgId: d.orgId, projectSlug: d.slug }).catch(() => {});
			};
			// T4 v2: the row's own directory content rides UNDER the row when
			// expanded — files belong where they live, not in a tail section.
			// files-only mode: subdirectories that ALREADY exist as tree rows
			// (the five docks at org root, fixed containers at dock rows) are
			// suppressed via hideDirs so nothing is listed twice — every OTHER
			// directory renders (D94, 2026-09-01: stage containers, targets,
			// .github/ — generated files visible in the sidebar, not just on
			// GitHub). Project rows hide nothing: their tree is real content.
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsxs)("div", {
				className: clsx(Rows_module_css_default.projectRow, menuOpen && Rows_module_css_default.menuOpen),
				role: "treeitem",
				"aria-expanded": open,
				onClick: () => {
					orgStore.toggleExpand(d.key);
					// T4 v2: expanding an org row OPENS the org (single handle) —
					// the inline file listings ride the open-org tree-read lane;
					// a collapsed-row browse would 403 with no handle at all.
					if (isOrg && !open) orgStore.mutate("org.open", { orgId: d.orgId }).catch(() => {});
				},
				style: { marginLeft: (offset ?? 4 + d.depth * 14) + "px", cursor: "pointer", borderRadius: 6, marginTop: isOrg ? 4 : 0, fontWeight: isOrg ? 600 : void 0 },
				children: [
					(0, react_jsx_runtime.jsx)("span", {
						className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder),
						children: isOrg ? (0, react_jsx_runtime.jsx)(OrgGlyph, {}) : open ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {})
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron),
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, open && Rows_module_css_default.arrowOpen) })
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.projectText,
						children: (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.title, children: d.label })
					}),
					// D91: connected marker — GitHub mark ONLY on rows with a repo
					// behind them (org + project rows). Local-only rows carry NO mark.
					(isOrg || d.kind === "project") && d.connected === true ? (0, react_jsx_runtime.jsx)("span", {
						title: orgT("rows.ghSynced"),
						style: { display: "inline-flex", alignItems: "center", marginLeft: 6, opacity: 0.55, flex: "none" },
						children: ghMark16
					}) : null,
					// D97: the sync outcome sits beside the GitHub mark. A failure paints
					// in the error alias and STAYS until the next sync — a manual sync door
					// whose refusal is invisible is worse than no door. Raw per-repo status
					// words ride the tooltip.
					syncState ? (0, react_jsx_runtime.jsx)("span", {
						title: syncState.detail || undefined,
						"data-arxa-sync": syncState.busy ? "busy" : syncState.bad ? "failed" : "ok",
						style: { fontSize: 11, flex: "none", marginLeft: 6, marginRight: 2, opacity: syncState.bad ? 1 : 0.55, color: syncState.bad ? "var(--dsw-alias-state-error-primary)" : undefined },
						children: orgT(syncState.busy ? "rows.sync.busy" : syncState.key)
					}) : null,
					d.count > 0 ? (0, react_jsx_runtime.jsx)("span", {
						style: { fontSize: 11, opacity: 0.55, flex: "none", marginRight: 4 },
						children: String(d.count)
					}) : null,
					(0, react_jsx_runtime.jsx)("span", {
						className: Rows_module_css_default.rowActions,
						children: [
							d.plus === "project" && (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Rows_module_css_default.iconButton,
								"aria-label": orgT("menu.org.newProject"),
								title: orgT("menu.org.newProject"),
								onClick: (e) => {
									e.stopPropagation();
									// D78: named creation through a modal (like create-org) —
									// no pregenerated names; the route still auto-names when
									// a caller omits the name.
									window.dispatchEvent(new CustomEvent("arxa-create-project", { detail: { orgId: d.orgId } }));
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
							}),
							showMenu && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
							open: menuOpen,
							onClose: () => {
								setMenuOpen(false);
							},
							items,
							onSelect,
							portal: true,
							closeOnPointerLeave: true,
							anchor: (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: Rows_module_css_default.iconButton,
								"aria-label": isOrg ? orgT("actions.workspace.aria", { name: d.label }) : orgT("actions.project.aria", { name: d.label }),
								onClick: (e) => {
									e.stopPropagation();
									setMenuOpen((v) => !v);
								},
								children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEllipsisOutline16, {})
							})
						})]
					})
				]
				}, d.key),
				open ? (0, react_jsx_runtime.jsx)(ArxaDirRows, { dir: d.kind === "org" ? "" : d.kind === "dock" ? d.slug : "projects/" + d.slug, depth: d.depth + 1, mode: "files-only", hideDirs: d.kind === "org" ? ARXA_ROW_HIDDEN.org : d.kind === "dock" ? (ARXA_ROW_HIDDEN.docks[d.slug] || {}) : null }, "arxa-dir:" + d.key) : null
			] }, d.key);
		}
		function TrashSection({ t }) {
			// D80/D81/D82: the trash is a PERMANENT, discoverable row. Two groups:
			// trashed ORGANISATIONS (workspace-root trash) and the open org's
			// trashed projects (org-local). D82 redesign in the design-system
			// idiom: header reuses the tree-row chevron (arrow/arrowOpen),
			// entries reuse the 28px rowActions icon buttons under Tooltips
			// (restore = refresh glyph, delete-forever = trash glyph in the
			// critical ink), and the section auto-opens while anything is
			// trashed so the destructive door is reachable the moment it exists.
  			// Delete forever is the destructive door — it rides the confirmation
			// modal and REALLY deletes the GitHub repos (grilled 2026-08-30).
			const view = useOrg((s) => s.trashView);
			const orgRows = useOrg((s) => s.orgTrash) || [];
			const rows = view.rows || [];
			const total = rows.length + orgRows.length;
			// D82: auto-open while entries exist; the user's first toggle wins.
			const [manual, setManual] = (0, react.useState)(null);
			const open = manual === null ? total > 0 : manual;
			const toggle = () => setManual(!open);
			const restore = (entryId) => {
				orgStore.mutate("trash.restore", { entryId }).catch(() => {});
			};
			const restoreOrg = (entryId) => {
				orgStore.mutate("orgtrash.restore", { entryId }).catch(() => {});
			};
			const purge = (scope, entryId, name) => {
				window.dispatchEvent(new CustomEvent("arxa-purge-trash", { detail: { scope, entryId, name } }));
			};
			const entryAction = (label, Icon, onClick, danger) => (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label,
				side: "bottom",
				children: (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: Rows_module_css_default.iconButton,
					"aria-label": label,
					onClick: (e) => { e.stopPropagation(); onClick(); },
					style: danger ? { color: "var(--dsw-alias-label-error)" } : void 0,
					children: (0, react_jsx_runtime.jsx)(Icon, {})
				})
			});
			// D84: the group labels drop the trashed prefix and the glyph —
			// design-system caption (10px, tertiary ink) aligned at the entry
			// icon column (18px depth-1 margin + 8px row padding); the rows
			// below carry the org/folder glyphs.
			const groupLabel = (text) => (0, react_jsx_runtime.jsx)("div", {
				style: { fontSize: 10, lineHeight: "16px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)", padding: "8px 8px 2px 26px" },
				children: text
			});
			// D84: entries are stock project rows (34px, 14px title, hover wash)
			// at the depth-1 margin — the trash reads exactly like the tree
			// above it. Bare "slot" (not "folder"): the folder class is swapped
			// for the chevron on hover, and entries carry no chevron.
			const entryRow = (e, glyph, onRestore, onPurge) => (0, react_jsx_runtime.jsxs)("div", {
				className: Rows_module_css_default.projectRow,
				style: { marginLeft: 18, marginTop: 2, cursor: "default" },
				children: [
					(0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.slot, children: glyph }),
					(0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.projectText, children: (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.title, title: e.entryId, children: e.name }) }),
					// D83: the two icon buttons get a real gap — they rendered
					// edge-to-edge (row CSS carries no gap for bare children). D92b:
					// 12px, user-tuned (iconButton is a bare 16×16, padding 0,
					// so the gap IS the glyph-to-glyph distance).
					(0, react_jsx_runtime.jsx)("span", { style: { display: "flex", gap: 12, flex: "none", alignItems: "center" }, children: [
						entryAction(t("trash.restore"), _deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, onRestore),
						entryAction(t("trash.deleteForever"), _deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, onPurge, true)
					] })
				]
			}, e.entryId);
			return (0, react_jsx_runtime.jsxs)("div", {
				style: { borderTop: "1px solid var(--dsw-alias-border-l2)", marginTop: 8, padding: "0 0 8px", opacity: total === 0 ? 0.45 : 1 },
				children: [
					// D84: the Trash row IS an org row — same projectRow class, 34px
					// height, 14px/600 title, hover glyph→chevron swap and the plain
					// 11px count — minus the kebab menu (nothing to configure here).
					(0, react_jsx_runtime.jsxs)("div", {
						className: Rows_module_css_default.projectRow,
						role: "treeitem",
						"aria-expanded": open,
						tabIndex: 0,
						onClick: toggle,
						onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") toggle(); },
						style: { marginLeft: 4, marginTop: 4, borderRadius: 6, cursor: "pointer", fontWeight: 600 },
						children: [
							(0, react_jsx_runtime.jsx)("span", { className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTrashOutline16, {}) }),
							(0, react_jsx_runtime.jsx)("span", { className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, open && Rows_module_css_default.arrowOpen) }) }),
							(0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.projectText, children: (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.title, children: t("trash.section") }) }),
							total > 0 ? (0, react_jsx_runtime.jsx)("span", { style: { fontSize: 11, opacity: 0.55, flex: "none", marginRight: 4 }, children: String(total) }) : null
						]
					}),
					open && total === 0 && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", padding: "4px 8px 2px 26px" }, children: t("trash.empty") }),
					open && orgRows.length > 0 && groupLabel(t("trash.orgSection")),
					open && orgRows.map((e) => entryRow(e, (0, react_jsx_runtime.jsx)(OrgGlyph, {}), () => restoreOrg(e.entryId), () => purge("org", e.entryId, e.name))),
					open && rows.length > 0 && groupLabel(t("trash.projectSection")),
					open && rows.map((e) => entryRow(e, (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {}), () => restore(e.entryId), () => purge("project", e.entryId, e.name))),
				]
			});
		}
		/** D90/T4 v2 (2026-09-01, user direction): org files live INSIDE the
		 * tree — under the row that owns the directory — never in a separate
		 * tail section. ArxaDirRows lazily lists ONE directory of the open
		 * org (tree-read token per attempt, one 403 retry) and recurses for
		 * subdirectories. Modes:
		 *   - "files-only" under rows whose subdirectories ALREADY exist as
		 *     tree rows (org root → the five docks, dock → its fixed
		 *     containers): files land in place, hideDirs suppresses the
		 *     duplicates, every other directory renders (D94);
		 *   - "full" inside leaf worktrees, where the tree is real content —
		 *     subdirectories expand in place, file rows open the docked
		 *     viewer column through the arxa-av-open bridge. */
		/** 2026-09-03: Material Icon Theme glyphs for the org tree (files +
		 * folders, full color). The curated subset bundle is served by the
		 * artifact-viewer vendor route on this same origin; one promise per
		 * page load dedupes every ArxaDirRows mount. Failure degrades to the
		 * stock dsh glyphs — the tree never blocks on decoration. */
		/** D94 (2026-09-01): directories that already exist as TREE ROWS at
		 * their parent level, so ArxaDirRows does not list them twice. The
		 * fixed vocabulary (D42 five docks + dock containers) is stable
		 * template data — keying by slug is exact. Project rows hide
		 * NOTHING: stage containers, targets and free-form folders are real
		 * sidebar content. */
		const ARXA_ROW_HIDDEN = {
			org: { projects: 1, notes: 1, meetings: 1, account: 1, communications: 1 },
			docks: {
				meetings: { scheduler: 1, notes: 1 },
				account: { receipts: 1, invoices: 1, subscriptions: 1, profile: 1 },
				communications: { emails: 1, messages: 1, comments: 1 },
				notes: {},
			},
		};
		let __arxaIconsPromise = null;
		function arxaIcons() {
			if (typeof window !== "undefined" && window.ArxaIcons) return Promise.resolve(window.ArxaIcons);
			if (!__arxaIconsPromise) __arxaIconsPromise = new Promise((resolve) => {
				const done = () => resolve((typeof window !== "undefined" && window.ArxaIcons) || null);
				// Reuse the viewer's tag when it is already fetching the same
				// bundle — never two fetches of icons.js on one page.
				const existing = document.querySelector('script[data-arxa-vendor="icons.js"]');
				if (existing) {
					existing.addEventListener("load", done, { once: true });
					existing.addEventListener("error", () => resolve(null), { once: true });
					return;
				}
				const s = document.createElement("script");
				s.dataset.arxaVendor = "icons.js";
				s.src = "/__arxa/artifacts/vendor/icons.js";
				s.onload = done;
				s.onerror = () => resolve(null);
				document.head.appendChild(s);
			});
			return __arxaIconsPromise;
		}
		function ArxaDirRows({ dir, depth, mode, hideDirs }) {
			const [entry, setEntry] = (0, react.useState)(null);
			const [openDirs, setOpenDirs] = (0, react.useState)({});
			const [matIcons, setMatIcons] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				let dead = false;
				void arxaIcons().then((I) => { if (!dead) setMatIcons(I); });
				return () => { dead = true; };
			}, []);
			const load = (0, react.useCallback)(async (theDir) => {
				setEntry({ status: "loading", dirs: [], files: [] });
				// One fresh token per attempt; a 403 retries ONCE with a newly
				// minted token (mint-to-use race seen once live 2026-08-31).
				const mint = async () => {
					const tokRes = await fetch("/__arxa/artifacts/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "tree-read" }) });
					const tokBody = await tokRes.json().catch(() => ({}));
					if (!tokRes.ok) throw new Error(tokBody.error || ("token " + tokRes.status));
					return tokBody.token || "";
				};
				const list = async (token) => {
					const res = await fetch("/__arxa/artifacts/tree?dir=" + encodeURIComponent(theDir || "") + "&avt=" + encodeURIComponent(token));
					const body = await res.json().catch(() => ({}));
					return { ok: res.ok, status: res.status, body };
				};
				try {
					let out = await list(await mint());
					if (!out.ok && out.status === 403) out = await list(await mint());
					if (!out.ok) throw new Error(out.body.error || ("tree " + out.status));
					setEntry({ status: "ready", dirs: out.body.dirs || [], files: out.body.files || [] });
				} catch (e) {
					setEntry({ status: "error", dirs: [], files: [], error: String((e && e.message) || e) });
				}
			}, []);
			(0, react.useEffect)(() => { void load(dir); }, [dir, load]);
			if (!entry) return null;
			// Rows compensate for the org-subtree container: the container already
			// carries the depth-1 indent (measured live: file rowX 48 vs dock
			// rowX 30), so the top-level listing starts at 0 and each nested
			// dir level adds one 14px step — file text lands exactly in the
			// dock text column (2026-09-01 alignment report).
			const childStyle = (d) => ({ marginLeft: (Math.max(0, d - 1) * 14) + "px" });
			const openFile = (relPath) => {
				try { window.dispatchEvent(new CustomEvent("arxa-av-open", { detail: { relPath } })); } catch { /* no bridge — ignore */ }
			};
			const statusRow = (d, text) => (0, react_jsx_runtime.jsx)("div", { style: { ...childStyle(d), fontSize: 12, opacity: 0.6, padding: "2px 8px" }, children: text });
			const fileRow = (relPath, name, d) => (0, react_jsx_runtime.jsxs)("div", {
				className: Rows_module_css_default.projectRow,
				role: "treeitem",
				onClick: () => openFile(relPath),
				style: { ...childStyle(d), cursor: "pointer", borderRadius: 6 },
				children: [
					// The tree's icon column, made real: a HARD-width 16px slot
					// carrying the file glyph, so file text lands exactly in the
					// org/dock text column (tree rows: same 4+d*14 margin, one
					// 16px slot, 6px gap). Hard box, not the classed slot — the
					// slot's flex-derived width collapsed in WKWebView on the
					// focused row (2026-09-01). The old blank 24px stub pushed
					// file names ~22px past their siblings (user report).
					(0, react_jsx_runtime.jsx)("span", { style: { flex: "none", width: 16, flexBasis: 16, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center" }, children: matIcons ? (0, react_jsx_runtime.jsx)("span", { style: { width: 16, height: 16, display: "inline-flex" }, dangerouslySetInnerHTML: { __html: matIcons.file(name) } }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBrowseOutline16, {}) }),
					(0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.projectText, children: (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.title, style: { opacity: 0.92 }, children: name }) })
				]
			}, "f:" + relPath);
			const dirRow = (sub, d) => (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsxs)("div", {
					className: Rows_module_css_default.projectRow,
					role: "treeitem",
					"aria-expanded": !!openDirs[sub],
					onClick: () => setOpenDirs((s) => ({ ...s, [sub]: !s[sub] })),
					style: { ...childStyle(d), fontWeight: 500, cursor: "pointer", borderRadius: 6 },
					children: [
						(0, react_jsx_runtime.jsx)("span", { className: clsx(Rows_module_css_default.slot, Rows_module_css_default.chevron), children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconTriangleRightFill14, { className: clsx(Rows_module_css_default.arrow, openDirs[sub] && Rows_module_css_default.arrowOpen) }) }),
						(0, react_jsx_runtime.jsx)("span", { className: clsx(Rows_module_css_default.slot, Rows_module_css_default.folder), children: matIcons ? (0, react_jsx_runtime.jsx)("span", { style: { width: 16, height: 16, display: "inline-flex" }, dangerouslySetInnerHTML: { __html: matIcons.folder(sub, !!openDirs[sub]) } }) : openDirs[sub] ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderOpen16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {}) }),
						(0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.projectText, children: (0, react_jsx_runtime.jsx)("span", { className: Rows_module_css_default.title, children: sub }) })
					]
				}),
				openDirs[sub] ? (0, react_jsx_runtime.jsx)(ArxaDirRows, { dir: dir ? dir + "/" + sub : sub, depth: depth + 1, mode }, "arxa-dir:" + (dir ? dir + "/" + sub : sub)) : null
			] }, "d:" + sub);
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				entry.status === "loading" ? statusRow(depth, "…") : null,
				entry.status === "error" ? statusRow(depth, /no org open/i.test(entry.error || "") ? orgT("files.openHint") : entry.error) : null,
				entry.status === "ready" && entry.dirs.length === 0 && entry.files.length === 0 ? statusRow(depth, orgT("files.empty")) : null,
				entry.status === "ready" ? entry.files.map((f) => fileRow(dir ? dir + "/" + f : f, f, depth)) : null,
				entry.status === "ready" && depth < 5 ? entry.dirs.filter((sub) => !(hideDirs && hideDirs[sub])).map((sub) => dirRow(sub, depth)) : null
			] });
		}
				/** Create-organisation modal (Q3, webview-safe): replaces window.prompt,
		* which WKWebView (the Tauri shell) does not implement — prompt returned
		* null there and org creation silently no-oped. Also owns the D36 first
		* run: with no workspace root chosen yet, the modal collects the root
		* location and the host saves it before the org is scaffolded. Errors
		* surface in the modal — nothing is swallowed.
		* The open/close conversation is COMPONENT-LOCAL state driven by the
		* "arxa-create-org" window event (fired by the spliced + flow): store
		* emits here would tick the shell into re-rendering the slot, and each
		* remount re-fired the stock auto-open effect — an emit loop that
		* ended in React #185. Same-value setState bails out; emits stay
		* reserved for server-truth changes. */
		/** GitHub brand mark (Octicons mark-github-16, MIT) inlined as one path —
		 * zero-dep house rule; fill follows currentColor so it themes with the
		 * shell. Rendered inside the sign-in CTA. */
		const GH_MARK = "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8";
		/** One error line for every org modal (Phase 2 dedup, conformance
		 * plan): one role, one look, one home — the REAL
		 * --dsw-alias-label-error token, no invented names, no hex fallbacks. */
		function ErrorNote({ msg }) {
			if (!msg) return null;
			return (0, react_jsx_runtime.jsx)("div", { role: "alert", style: { marginTop: 10, fontSize: 12, color: "var(--dsw-alias-label-error)" }, children: msg });
		}
		function OrgCreateModal({ t, createWorkspace, open, onClose }) {
			const [name, setName] = (0, react.useState)("");
			const [location, setLocation] = (0, react.useState)("~/Arxa");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [ghLinked, setGhLinked] = (0, react.useState)(null);
			/** D90: Publish-to-GitHub toggle — ON by default (grilled): OFF
			 * creates the org LOCAL-ONLY (no repo, no heal). Unlinked accounts
			 * get the toggle disabled + a hint pointing at the org menu —
			 * local-only creation is always allowed, never a sign-in wall. */
			const [ghPublish, setGhPublish] = (0, react.useState)(true);
			/** Create-time history question (2025-08): when the picked folder
			 * already holds content, does org history track it? Default = arxa's
			 * files only (non-intrusive, VS Code-parity); opting in versions the
			 * whole folder. The folder-info route answers has-content? — a count
			 * only, nothing else leaves the machine. */
			/** D92: live collision state for the RESOLVED target (parent root
			 * + slug(name)) — { path, exists, entryCount, isOrg } from the
			 * debounced folder-info route; null while name/location are blank. */
			const [folderInfo, setFolderInfo] = (0, react.useState)(null);
			/** Host homedir (create.defaults) so the preview expands `~` itself. */
			const [homeDir, setHomeDir] = (0, react.useState)(null);
			const nameRef = (0, react.useRef)(null);
			const checkGh = () => {
				ORG_POST("github.status").then((r) => setGhLinked(!!(r.result && r.result.linked)), () => setGhLinked(null));
			};
			(0, react.useEffect)(() => {
				if (open) {
					setName("");
					setLocation("~/Arxa");
					setBusy(false);
					setError(null);
					setGhLinked(null);
					setGhPublish(true);
					setFolderInfo(null);
					checkGh();
					// D92: sticky last-used parent root + the homedir for ~ expansion.
					ORG_POST("create.defaults").then((r) => {
						if (r && r.ok && typeof r.result?.root === "string" && r.result.root.trim() !== "") setLocation(r.result.root);
						if (r && r.ok && typeof r.result?.home === "string") setHomeDir(r.result.home);
					}, () => {});
					if (nameRef.current !== null) nameRef.current.focus();
				}
			}, [open]);
			/** Mirror of the engine slug (workspace/lib/slug.js, D79): case
			 * preserved, apostrophes vanish, non-alphanumerics kebab, edges
			 * trimmed; the engine refuses names that slug to nothing. */
			const slugFor = (raw) => raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
			const expandLoc = (raw) => {
				const loc = raw.trim();
				if (homeDir && loc === "~") return homeDir;
				if (homeDir && loc.startsWith("~/")) return homeDir + loc.slice(1);
				return loc;
			};
			/** D92: the preview — the true destination, absolute, per keystroke. */
			const previewPath = location.trim() === "" ? "" : expandLoc(location) + "/" + (name.trim() === "" ? "\u2026" : slugFor(name));
			/** Ask the host whether the RESOLVED target (root + slug) already
			 * holds content — debounced per keystroke, a count-only round trip. */
			(0, react.useEffect)(() => {
				const loc = location.trim();
				const nm = name.trim();
				const expanded = expandLoc(loc);
				if (!loc || !nm || busy || expanded.startsWith("~")) return;
				const id = window.setTimeout(() => {
					fetch("/__arxa/sidebar/folder-info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: expanded + "/" + slugFor(nm) }) }).then((r) => r.json()).then((b) => {
						setFolderInfo(b && b.ok ? b : null);
					}, () => {});
				}, 250);
				return () => window.clearTimeout(id);
			}, [location, name, busy, homeDir]);
			if (!open) return null;
			const ghAvailable = ghLinked !== false;
			const publishOn = ghAvailable && ghPublish;
			const blocked = !!(folderInfo && folderInfo.exists && folderInfo.entryCount > 0);
			const canSubmit = name.trim() !== "" && !busy && location.trim() !== "" && !blocked;
			const dismiss = () => {
				if (!busy) onClose();
			};
			const submit = () => {
				if (!canSubmit) return;
				const orgName = name.trim();
				setBusy(true);
				setError(null);
				// Through the store, not ORG_POST: mutate refreshes server truth
				// before onClose, so the welcome gate (orgs.length === 0) lifts
				// the moment the create lands. A bare POST left the stale empty
				// list up for the 5s poll — the gate lingered, and any tap on
				// the welcome card re-opened this modal (create-again loop).
				const ready = orgStore.mutate("org.create-at", { name: orgName, path: location.trim(), link: publishOn });
				ready.then(() => {
					onClose();
				}, (e) => {
					setBusy(false);
					const msg = e instanceof Error ? e.message : String(e);
					if (msg === "linked-required") {
						setGhLinked(false);
						setError(t("github.signin.required"));
						return;
					}
					setError(msg);
				});
			};
			const field = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "transparent", color: "inherit" };
			/** Click the location field → the OS folder locator. Desktop shell:
			* the Tauri dialog when the global API is injected; otherwise the
			* host-side macOS locator (osascript choose folder in the user's
			* GUI session). Plain typing remains the fallback everywhere. */
			const browseLocation = (e) => {
				e.preventDefault();
				const dlg = window.__TAURI__ && window.__TAURI__.dialog;
				if (dlg && typeof dlg.open === "function") {
					const opts = { directory: true, multiple: false, title: t("org.create.location") };
					if (location.startsWith("/")) opts.defaultPath = location;
					Promise.resolve(dlg.open(opts)).then((picked) => {
						if (typeof picked === "string" && picked.trim() !== "") {
							setLocation(picked.replace(/\/+$/, "") || picked);
						}
					}, () => {});
					return;
				}
				setError(null);
				fetch("/__arxa/sidebar/pick-folder", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ title: t("org.create.location") })
				}).then((r) => r.json()).then((b) => {
					if (b && b.ok && typeof b.path === "string" && b.path.trim() !== "") setLocation(b.path);
					else if (b && !b.canceled) setError(b.error || "folder locator unavailable");
				}, () => {});
			};
			const label = { fontSize: 11, opacity: 0.55, margin: "10px 0 4px" };
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: dismiss,
				closeLabel: t("cancel"),
				title: t("org.create.title"),
				footer: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "outline",
						onClick: dismiss,
						children: t("cancel")
					}),
					(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						disabled: !canSubmit,
						onClick: submit,
						children: t("org.create.submit")
					})
				] }),
				children: (0, react_jsx_runtime.jsxs)("div", { children: [
					(0, react_jsx_runtime.jsx)("div", { style: label, children: t("field.workspaceName") }),
					(0, react_jsx_runtime.jsx)("input", {
						ref: nameRef,
						value: name,
						placeholder: t("field.workspaceName"),
						onChange: (e) => setName(e.target.value),
						onKeyDown: (e) => {
							if (e.key === "Enter") submit();
						},
						style: field
					}),
					(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: label, children: t("org.create.location") }),
						(0, react_jsx_runtime.jsx)("input", {
							value: location,
							spellCheck: false,
							placeholder: t("org.create.location"),
							onClick: browseLocation,
							onChange: (e) => setLocation(e.target.value),
							onKeyDown: (e) => {
								if (e.key === "Enter") submit();
							},
							style: field
						}),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.65, marginTop: 6, wordBreak: "break-all" }, children: t("org.create.preview") + ": " + (previewPath || "\u2026") }),
						folderInfo && folderInfo.exists && folderInfo.entryCount > 0 && (folderInfo.isOrg ? (0, react_jsx_runtime.jsxs)("div", { style: { marginTop: 10, padding: "8px 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, fontSize: 12 }, children: [
							(0, react_jsx_runtime.jsx)("div", { children: t("org.create.exists.org").replace("{name}", name.trim()) }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", disabled: busy, onClick: () => { if (!busy) { onClose(); orgStore.mutate("org.open", folderInfo.path).catch(() => {}); } }, style: { marginTop: 6, fontSize: 12, cursor: "pointer" }, children: t("org.create.exists.open") })
						] }) : (0, react_jsx_runtime.jsx)(ErrorNote, { msg: t("org.create.exists.nonempty") })),
						// D90: the Publish-to-GitHub switch — pill + knob, ARIA switch role.
						(0, react_jsx_runtime.jsx)("div", { style: { marginTop: 12, padding: "8px 10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6 }, children: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 }, children: [
							(0, react_jsx_runtime.jsx)("button", {
								type: "button",
								role: "switch",
								"aria-checked": publishOn ? "true" : "false",
								"aria-label": t("org.create.ghToggle"),
								disabled: !ghAvailable || busy,
								onClick: () => setGhPublish((v) => !v),
								style: { width: 28, height: 16, borderRadius: 999, border: "1px solid var(--dsw-alias-border-l2)", background: publishOn ? "var(--dsw-alias-brand-primary)" : "transparent", position: "relative", flex: "none", cursor: ghAvailable ? "pointer" : "default", padding: 0, opacity: ghAvailable ? 1 : 0.5, transition: "background 120ms" },
								children: (0, react_jsx_runtime.jsx)("span", { style: { position: "absolute", top: 1, left: publishOn ? 13 : 1, width: 12, height: 12, borderRadius: "50%", background: publishOn ? "var(--dsw-alias-label-primary-inverted, #fff)" : "var(--dsw-alias-label-secondary)", transition: "left 120ms" } })
							}),
							(0, react_jsx_runtime.jsx)("span", { children: t("org.create.ghToggle") })
							] }) }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, marginTop: 6 }, children: ghAvailable ? t(publishOn ? "org.create.ghOnHint" : "org.create.ghOffHint") : t("org.create.ghUnavailableHint") }),
					] }),
					(0, react_jsx_runtime.jsx)(ErrorNote, { msg: error })
				] })
			});
		}
		/** D77 publish modal (the PLATO lesson): publish used to be a swallowed
		 * mutate — `.catch(() => {})` meant confirm/loading/success/error never
		 * existed and a refused publish looked like nothing happened. The org
		 * menu now dispatches "arxa-publish-org"; OrgBrowser owns the open
		 * conversation (same component-local pattern as OrgCreateModal — store
		 * emits here would re-render the slot mid-flight) and THIS modal runs
		 * the phases: confirm → busy → done | error. ORG_POST, not mutate:
		 * mutate discards the response body, and the publish result carries
		 * ok/reason/repoUrl/projects that every phase needs to name WHY. */
		function OrgPublishModal({ t, target, onClose }) {
			const [phase, setPhase] = (0, react.useState)("confirm");
			const [result, setResult] = (0, react.useState)(null);
			const [errMsg, setErrMsg] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				setPhase("confirm"); setResult(null); setErrMsg(null);
			}, [target]);
			if (!target) return null;
			const dismiss = () => { if (phase !== "busy") onClose(); };
			const reasonText = (reason) => {
				const r = String(reason || "");
				if (r.indexOf("initial-snapshot-pending") === 0) return t("publish.errPending");
				if (r === "not-linked" || r === "linked-required") return t("publish.errNotLinked");
				if (r === "github-unavailable") return t("publish.errUnavailable");
				return r || t("publish.errGeneric");
			};
			const confirm = () => {
				setPhase("busy"); setErrMsg(null);
				ORG_POST(target.projectSlug ? "project.connect" : "github.publish", target.projectSlug ? { orgId: target.orgId, projectSlug: target.projectSlug } : { orgId: target.orgId }).then((b) => {
					const res = b && b.result;
					if (res && res.ok) { setResult(res); setPhase("done"); orgStore.refresh(); }
					else { setErrMsg(reasonText(res && res.reason)); setPhase("error"); }
				}, (e) => {
					setErrMsg(reasonText(e instanceof Error ? e.message : String(e))); setPhase("error");
				});
			};
			const openExternal = (url) => (e) => {
				e.preventDefault();
				fetch("/__arxa/sidebar/open-external", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
			};
			const projects = (result && result.projects) || [];
			const allSkipped = result && result.skipped === "published" && projects.every((p) => p.ok && p.skipped === "published");
			const linkStyle = { color: "var(--dsw-alias-brand-primary)", cursor: "pointer" };
			const footer = (phase === "done" || phase === "error") ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				phase === "done" && result && result.repoUrl ? (0, react_jsx_runtime.jsx)("a", { href: result.repoUrl, onClick: openExternal(result.repoUrl), style: { ...linkStyle, fontSize: 13, marginRight: "auto" }, children: t("publish.openOnGithub") }) : null,
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", onClick: onClose, children: t("publish.close") })
			] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: dismiss, children: t("publish.cancel") }),
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: phase !== "confirm", onClick: confirm, children: phase === "busy" ? t("publish.busyCta") : t("publish.confirmCta") })
			] });
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: dismiss,
				closeLabel: t("publish.cancel"),
				title: t(target.projectSlug ? "publish.projectTitle" : "publish.title"),
				footer,
				children: (0, react_jsx_runtime.jsxs)("div", { children: [
					phase === "confirm" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 8 }, children: target.projectSlug ? (target.projectName || target.projectSlug) : target.orgName }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75 }, children: t(target.projectSlug ? "publish.projectConfirmDesc" : "publish.confirmDesc") })
					] }),
					phase === "busy" && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75 }, children: t("publish.busy") }),
					phase === "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 10 }, children: allSkipped ? t("publish.already") : t("publish.done") }),
						result && result.repoUrl ? (0, react_jsx_runtime.jsxs)("div", { style: { fontSize: 12, marginBottom: 8 }, children: [
							result.slug || target.orgName, " — ",
							(0, react_jsx_runtime.jsx)("a", { href: result.repoUrl, onClick: openExternal(result.repoUrl), style: linkStyle, children: result.repoUrl })
						] }) : null,
						projects.map((p, i) => (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: p.ok ? 0.85 : 1, marginTop: 4 }, children: (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							p.slug, " — ",
							p.ok ? (0, react_jsx_runtime.jsx)("a", { href: p.repoUrl, onClick: openExternal(p.repoUrl), style: linkStyle, children: p.repoUrl }) : (0, react_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-error)" }, children: reasonText(p.reason) })
						] }) }, p.slug + ":" + i))
					] }),
					phase === "error" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--dsw-alias-label-error)" }, children: t("publish.errTitle") }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.85 }, children: errMsg }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.5, marginTop: 8 }, children: target.orgName })
					] })
				] })
			});
		}
		/** D78 create-project modal: the Projects dock + used to fire a
		 * nameless mutate — the project got a pregenerated counter name and
		 * the user never chose anything. Same conversation shape as the
		 * create-org modal: name REQUIRED, no path picker (a project lives
		 * inside its org), busy while the scaffold + first publish run,
		 * errors surfaced verbatim (linked-required, publish-failed…).
		 * The server still auto-names when a caller omits the name; the UI
		 * never does. ORG_POST, not mutate — the created slug feeds the
		 * success state and mutate throws the body away. */
		function OrgProjectModal({ t, target, onClose }) {
			const [name, setName] = (0, react.useState)("");
			const [phase, setPhase] = (0, react.useState)("input");
			const [errMsg, setErrMsg] = (0, react.useState)(null);
			const [created, setCreated] = (0, react.useState)(null);
			const nameRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setName(""); setPhase("input"); setErrMsg(null); setCreated(null);
				if (target && nameRef.current) window.setTimeout(() => { try { nameRef.current.focus(); } catch {} }, 50);
			}, [target]);
			if (!target) return null;
			const dismiss = () => { if (phase !== "busy") onClose(); };
			const submit = () => {
				const n = name.trim();
				if (n === "" || phase === "busy") return;
				setPhase("busy"); setErrMsg(null);
				ORG_POST("project.create", { orgId: target.orgId, name: n }).then((b) => {
					const res = b && b.result;
					setCreated(res || {});
					setPhase("done");
					orgStore.refresh();
				}, (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					setErrMsg(msg === "linked-required" ? t("project.errNotLinked") : msg);
					setPhase("input");
				});
			};
			const field = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "transparent", color: "inherit" };
			const footer = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: dismiss, children: phase === "done" ? t("project.close") : t("publish.cancel") }),
				phase !== "done" && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: name.trim() === "" || phase === "busy", onClick: submit, children: phase === "busy" ? t("project.creating") : t("project.create") })
			] });
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: dismiss,
				closeLabel: t("publish.cancel"),
				title: t("project.title"),
				footer,
				children: (0, react_jsx_runtime.jsxs)("div", { children: [
					phase !== "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 }, children: t("project.nameLabel") }),
						(0, react_jsx_runtime.jsx)("input", {
							ref: nameRef,
							value: name,
							placeholder: t("project.namePlaceholder"),
							onChange: (e) => setName(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") submit(); },
							style: field
						}),
						phase === "busy" && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 10 }, children: t("project.busy") }),
						(0, react_jsx_runtime.jsx)(ErrorNote, { msg: errMsg })
					] }),
					phase === "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 }, children: t("project.done") }),
						created && created.slug && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75 }, children: created.slug }),
						created && created.manifest && created.manifest.repoUrl && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 6 }, children: t("project.doneRepo") })
					] })
				] })
			});
		}
		/** D80 (grilled): rename is a FULL MOVE — folder + manifest +
		 * sessions + the GitHub repo PATCH, pre-flighted synchronously.
		 * Same phase machine as create/publish; repoRenamePending is the
		 * net for post-move failures (the next heal finishes the ride). */
		function OrgRenameModal({ t, target, onClose }) {
			const [name, setName] = (0, react.useState)("",);
			const [phase, setPhase] = (0, react.useState)("input");
			const [errMsg, setErrMsg] = (0, react.useState)(null);
			const [renamed, setRenamed] = (0, react.useState)(null);
			const nameRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				setName(target ? String(target.currentName || "") : ""); setPhase("input"); setErrMsg(null); setRenamed(null);
				if (target && nameRef.current) window.setTimeout(() => { try { nameRef.current.focus(); nameRef.current.select(); } catch {} }, 50);
			}, [target]);
			if (!target) return null;
			const dismiss = () => { if (phase !== "busy") onClose(); };
			const submit = () => {
				const n = name.trim();
				if (n === "" || n === target.currentName || phase === "busy") return;
				setPhase("busy"); setErrMsg(null);
				const call = target.kind === "org"
					? ORG_POST("org.rename", { orgId: target.orgId, name: n })
					: ORG_POST("project.rename", { orgId: target.orgId, projectSlug: target.projectSlug, name: n });
				call.then((b) => {
					setRenamed((b && b.result) || {});
					setPhase("done");
					orgStore.refresh();
				}, (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					setErrMsg(msg === "linked-required" ? t("project.errNotLinked") : msg);
					setPhase("input");
				});
			};
			const field = { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "transparent", color: "inherit" };
			const footer = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: dismiss, children: phase === "done" ? t("rename.close") : t("publish.cancel") }),
				phase !== "done" && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: name.trim() === "" || name.trim() === target.currentName || phase === "busy", onClick: submit, children: phase === "busy" ? t("rename.busy") : t("rename.cta") })
			] });
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: dismiss,
				closeLabel: t("publish.cancel"),
				title: target.kind === "org" ? t("rename.orgTitle") : t("rename.projectTitle"),
				footer,
				children: (0, react_jsx_runtime.jsxs)("div", { children: [
					phase !== "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, marginBottom: 4 }, children: t("rename.nameLabel") }),
						(0, react_jsx_runtime.jsx)("input", {
						ref: nameRef,
						value: name,
						onChange: (e) => setName(e.target.value),
						onKeyDown: (e) => { if (e.key === "Enter") submit(); },
						style: field
						}),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, marginTop: 8 }, children: target.kind === "org" ? t("rename.orgNote") : t("rename.projectNote") }),
						phase === "busy" && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 10 }, children: t("rename.busy") }),
						(0, react_jsx_runtime.jsx)(ErrorNote, { msg: errMsg })
					] }),
					phase === "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 }, children: t("rename.done") }),
						renamed && renamed.slug && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75 }, children: renamed.slug }),
						renamed && renamed.manifest && renamed.manifest.repoUrl && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 6 }, children: renamed.manifest.repoUrl })
					] })
				] })
			});
		}
		/** D81→D88: the FINAL gate for Delete forever — GitHub-style, the
		 * user must retype the entry's exact row label before the button
		 * arms; the trash entry goes away AND its GitHub repos are really
		 * deleted. The wording states the blast radius; a 403 (token without
		 * delete_repo) surfaces the re-link guidance verbatim. */
		function OrgPurgeModal({ t, target, onClose }) {
			const [phase, setPhase] = (0, react.useState)("confirm");
			const [errMsg, setErrMsg] = (0, react.useState)(null);
			// D88: the typed confirmation (case-sensitive row label) plus the
			// success summary of exactly what was removed.
			const [typed, setTyped] = (0, react.useState)("");
			const [summary, setSummary] = (0, react.useState)(null);
			// D85: a 403 delete_repo refusal upgrades IN place — the device flow
			// runs from the modal (code shows inline) and the purge auto-retries
			// the moment the re-link lands. Root cause: OAuth refresh tokens can
			// NEVER add scopes; a link created before SCOPES gained delete_repo
			// stays scope-stale until the user re-authorizes (github-link.json
			// 2026-08-30: scopes [read:user, repo] from 05:24, delete_repo landed
			// later that day).
			const [relinking, setRelinking] = (0, react.useState)(false);
			const [devCode, setDevCode] = (0, react.useState)(null);
			(0, react.useEffect)(() => { setPhase("confirm"); setErrMsg(null); setTyped(""); setRelinking(false); setDevCode(null); setSummary(null); }, [target]);
			if (!target) return null;
			// D88: busy LOCKS the modal — Close and Escape are dead while the
			// irreversible purge is in flight; you cannot walk away from a
			// half-answered destructive operation.
			const dismiss = () => { if (phase !== "busy") onClose(); };
			const matches = typed === target.name;
			const submit = () => {
				if (phase === "busy") return;
				setPhase("busy"); setErrMsg(null);
				ORG_POST(target.scope === "org" ? "orgtrash.purge" : "projecttrash.purge", { entryId: target.entryId }).then((r) => {
					// D88 success summary: exactly what left the machine.
					const res = r && r.result;
					const parts = [target.name];
					if (res && Array.isArray(res.deletedRepos) && res.deletedRepos.length > 0) parts.push(res.deletedRepos.join(", "));
					setSummary(parts.join(" — "));
					setPhase("done");
					orgStore.refresh();
					setTimeout(onClose, 1100);
				}, (e) => {
					const msg = e instanceof Error ? e.message : String(e);
					setErrMsg(msg); setPhase("confirm");
				});
			};
			// D85: run the device flow from the error itself. github.device
			// surfaces the one-time code the moment GitHub issues it (the
			// Settings sign-in polls the same act); when github.link resolves
			// the stored token carries delete_repo and the SAME purge reruns.
			const relink = () => {
				if (relinking) return;
				setRelinking(true); setErrMsg(null);
				const poll = setInterval(() => {
					ORG_POST("github.device").then((r) => {
						const d = r.result;
						if (d && d.userCode) setDevCode(d);
					}, () => {});
				}, 700);
				ORG_POST("github.link").then(() => {
					clearInterval(poll);
					setRelinking(false); setDevCode(null);
					submit();
				}, (e) => {
					clearInterval(poll);
					setRelinking(false); setDevCode(null);
					setErrMsg(e instanceof Error ? e.message : String(e));
				});
			};
			const footer = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", disabled: phase === "busy", onClick: dismiss, children: phase === "done" ? t("purge.close") : t("publish.cancel") }),
				phase !== "done" && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: !matches || phase === "busy", onClick: submit, children: phase === "busy" ? t("purge.busy") : t("purge.confirm") })
			] });
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open: true,
				onClose: dismiss,
				closeLabel: t("publish.cancel"),
				title: target.scope === "org" ? t("purge.orgTitle") : t("purge.projectTitle"),
				footer,
				children: (0, react_jsx_runtime.jsxs)("div", { children: [
					phase !== "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, marginBottom: 8 }, children: target.name }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginBottom: 8 }, children: target.scope === "org" ? t("purge.orgWarn") : t("purge.projectWarn") }),
						// D88: GitHub-style typed gate — Delete forever stays dead until
						// the EXACT row label (case-sensitive) is retyped.
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, margin: "10px 0 4px" }, children: t("purge.typeName").replace("{name}", target.name) }),
						(0, react_jsx_runtime.jsx)("input", {
							value: typed,
							onChange: (e) => setTyped(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter" && matches) submit(); },
							placeholder: target.name,
							disabled: phase === "busy",
							autoComplete: "off",
							spellCheck: false,
							style: { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "inherit" }
						}),
						(0, react_jsx_runtime.jsx)(ErrorNote, { msg: errMsg }),
						// D85: the scope-stale 403 carries "re-link GitHub" verbatim — offer
						// the upgrade HERE instead of dead-ending: button first, then the
						// one-time code + URL once the flow starts, auto-retry on success.
						errMsg && errMsg.includes("re-link GitHub") && !relinking && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: relink, style: { marginTop: 10 }, children: t("purge.relink") }),
					// D88: any other failure gets an explicit retry.
					errMsg && !errMsg.includes("re-link GitHub") && !relinking && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: submit, style: { marginTop: 10 }, children: t("purge.retry") }),
						relinking && (0, react_jsx_runtime.jsxs)("div", { style: { marginTop: 10, padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, fontSize: 12 }, children: [
							(0, react_jsx_runtime.jsx)("div", { style: { opacity: 0.75, marginBottom: 6 }, children: t("purge.relinkHint") }),
							(0, react_jsx_runtime.jsx)("div", { children: devCode ? devCode.verificationUri : "https://github.com/login/device" }),
							devCode && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600, letterSpacing: "0.08em", marginTop: 4 }, children: devCode.userCode })
						] }),
					] }),
					phase === "done" && (0, react_jsx_runtime.jsxs)("div", { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: t("purge.done") }),
						summary && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 6 }, children: summary })
					] })
				] })
			});
		}
		/** Welcome gate (D69): with no organisation in recents the app IS a
		 * blank page with one clickable card — covering any stray dsh-home
		 * sessions the stock boot may restore. Creating the first org (or
		 * opening the create modal) lifts it. Phase 2 (conformance plan):
		 * registered into the frame's declared shell.overlay slot instead of
		 * fighting the shell with a hand-layered fixed z-index war — the
		 * overlay layer owns positioning AND pointer events, so this gate is
		 * lens-screenshot-able like every other overlay. */
		function WelcomeGate({ t }) {
			const count = useOrg((s) => s.orgs.length);
			if (count > 0) return null;
			return (0, react_jsx_runtime.jsx)("div", {
				style: { position: "absolute", inset: 0, background: "var(--dsw-alias-bg-base)", display: "flex", alignItems: "center", justifyContent: "center" },
				children: (0, react_jsx_runtime.jsxs)("div", {
					role: "button",
					tabIndex: 0,
					onClick: () => window.dispatchEvent(new Event("arxa-create-org")),
					onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") window.dispatchEvent(new Event("arxa-create-org")); },
					style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 14, padding: "28px 34px", textAlign: "center", cursor: "pointer", maxWidth: 380, background: "var(--dsw-alias-bg-layer-1)" },
					children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 17, fontWeight: 600, marginBottom: 8 }, children: t("welcome.title") }),
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, opacity: 0.65, marginBottom: 18 }, children: t("welcome.desc") }),
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 10, justifyContent: "center" }, children: [
							(0, react_jsx_runtime.jsx)("button", {
								onClick: () => window.dispatchEvent(new Event("arxa-create-org")),
								style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer", background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)" },
								children: t("welcome.studio")
							}),
							(0, react_jsx_runtime.jsx)("button", {
								disabled: true,
								title: t("welcome.businessSoon"),
								style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "not-allowed", background: "transparent", color: "inherit", opacity: 0.5 },
								children: t("welcome.business")
							})
						] })
					]
				})
			});
		}
		/** D90: the Disconnect GitHub conversation — per org (covering every
	 * project repo under it) or per single project. Grilled shape: Keep on
	 * GitHub is the DEFAULT; "remove too" arms only after the exact repo
	 * slug is retyped (D88-style typed gate); busy locks the modal; a
	 * scope-stale 403 offers the in-modal re-link + auto-retry (D85). */
	function OrgDisconnectModal({ t, target, onClose }) {
		const [phase, setPhase] = (0, react.useState)("confirm");
		const [errMsg, setErrMsg] = (0, react.useState)(null);
		const [removeRepos, setRemoveRepos] = (0, react.useState)(false);
		const [typed, setTyped] = (0, react.useState)("");
		const [summary, setSummary] = (0, react.useState)(null);
		const [relinking, setRelinking] = (0, react.useState)(false);
		const [devCode, setDevCode] = (0, react.useState)(null);
		(0, react.useEffect)(() => { setPhase("confirm"); setErrMsg(null); setRemoveRepos(false); setTyped(""); setRelinking(false); setDevCode(null); setSummary(null); }, [target]);
		if (!target) return null;
		const dismiss = () => { if (phase !== "busy") onClose(); };
		const matches = typed === target.slug;
		const submit = () => {
			if (phase === "busy" || (removeRepos && !matches)) return;
			setPhase("busy"); setErrMsg(null);
			ORG_POST(target.kind === "project" ? "project.disconnect" : "org.disconnect", target.kind === "project" ? { orgId: target.orgId, projectSlug: target.projectSlug, removeRepos } : { orgId: target.orgId, removeRepos }).then((r) => {
				const res = r && r.result;
				const removed = res && Array.isArray(res.removedRepos) ? res.removedRepos : res && res.removed && res.repo ? [res.repo] : [];
				setSummary(removed.length > 0 ? t("disconnect.doneRemoved").replace("{repos}", removed.join(", ")) : t("disconnect.doneKept"));
				setPhase("done");
				orgStore.refresh();
				setTimeout(onClose, 1100);
			}, (e) => {
				setErrMsg(e instanceof Error ? e.message : String(e)); setPhase("confirm");
			});
		};
		const relink = () => {
			if (relinking) return;
			setRelinking(true); setErrMsg(null);
			const poll = setInterval(() => {
				ORG_POST("github.device").then((r) => {
					const d = r.result;
					if (d && d.userCode) setDevCode(d);
				}, () => {});
			}, 700);
			ORG_POST("github.link").then(() => {
				clearInterval(poll);
				setRelinking(false); setDevCode(null);
				submit();
			}, (e) => {
				clearInterval(poll);
				setRelinking(false); setDevCode(null);
				setErrMsg(e instanceof Error ? e.message : String(e));
			});
		};
		const footer = (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", disabled: phase === "busy", onClick: dismiss, children: phase === "done" ? t("purge.close") : t("publish.cancel") }),
			phase !== "done" && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "primary", disabled: phase === "busy" || (removeRepos && !matches), onClick: submit, children: phase === "busy" ? t("disconnect.busy") : t("disconnect.cta") })
		] });
		return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: true,
			onClose: dismiss,
			closeLabel: t("publish.cancel"),
			title: t("disconnect.title"),
			footer,
			children: (0, react_jsx_runtime.jsxs)("div", { children: [
				phase !== "done" && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, marginBottom: 8 }, children: target.name }),
					(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginBottom: 8 }, children: target.kind === "project" ? t("disconnect.projectWarn") : t("disconnect.orgWarn") }),
					(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }, children: [
						(0, react_jsx_runtime.jsx)("input", { type: "radio", name: "arxa-disconnect-mode", checked: !removeRepos, onChange: () => { setRemoveRepos(false); setTyped(""); }, disabled: phase === "busy" }),
						t("disconnect.keep")
					] }),
					(0, react_jsx_runtime.jsxs)("label", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", marginTop: 4 }, children: [
						(0, react_jsx_runtime.jsx)("input", { type: "radio", name: "arxa-disconnect-mode", checked: removeRepos, onChange: () => setRemoveRepos(true), disabled: phase === "busy" }),
						t("disconnect.remove")
					] }),
					removeRepos && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 11, opacity: 0.55, margin: "10px 0 4px" }, children: t("disconnect.typeRepo").replace("{name}", target.slug) }),
						(0, react_jsx_runtime.jsx)("input", {
							value: typed,
							onChange: (e) => setTyped(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter" && matches) submit(); },
							placeholder: target.slug,
							disabled: phase === "busy",
							autoComplete: "off",
							spellCheck: false,
							style: { width: "100%", boxSizing: "border-box", fontSize: 13, padding: "6px 8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 6, background: "transparent", color: "inherit", fontFamily: "inherit" }
						})
					] }),
					(0, react_jsx_runtime.jsx)(ErrorNote, { msg: errMsg }),
					errMsg && errMsg.includes("re-link GitHub") && !relinking && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: relink, style: { marginTop: 10 }, children: t("purge.relink") }),
					errMsg && !errMsg.includes("re-link GitHub") && !relinking && (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, { variant: "outline", onClick: submit, style: { marginTop: 10 }, children: t("purge.retry") }),
					relinking && (0, react_jsx_runtime.jsxs)("div", { style: { marginTop: 10, padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, fontSize: 12 }, children: [
						(0, react_jsx_runtime.jsx)("div", { style: { opacity: 0.75, marginBottom: 6 }, children: t("purge.relinkHint") }),
						(0, react_jsx_runtime.jsx)("div", { children: devCode ? devCode.verificationUri : "https://github.com/login/device" }),
						devCode && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 16, fontWeight: 600, letterSpacing: "0.08em", marginTop: 4 }, children: devCode.userCode })
					] })
				] }),
				phase === "done" && (0, react_jsx_runtime.jsxs)("div", { children: [
					(0, react_jsx_runtime.jsx)("div", { style: { fontSize: 13, fontWeight: 600 }, children: t("disconnect.done") }),
					summary && (0, react_jsx_runtime.jsx)("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 6 }, children: summary })
				] })
			] })
		});
	}
	function OrgBrowser(props) {
			// Data hooks are pinned HERE, at the component boundary: the slot
			// renderer merges its STANDARD runtime hooks (useSessions/useWorkspaces)
			// over inject props, so declaring them in the inject face loses. Passing
			// them straight to the stock component cannot be overridden.
			const patched = { ...props, useWorkspaces: orgUseWorkspaces, useSessions: orgUseSessions, useDirectoryFlow: orgUseDirectoryFlow, useHostDescription: orgUseHostDescription };
			// Create-org conversation lives HERE (local state, event-triggered by
			// the spliced + flow) — see OrgCreateModal for why it must not emit.
			const [creating, setCreating] = (0, react.useState)(false);
			/** D77: the publish conversation rides the same pattern — the menu
			 * row dispatches, this boundary holds { orgId, orgName } | null.
			 * D78: the same for named project creation (the Projects dock +). */
			const [publishing, setPublishing] = (0, react.useState)(null);
			const [creatingProject, setCreatingProject] = (0, react.useState)(null);
			// D80: the rename conversation — { kind, orgId, projectSlug?, currentName } | null.
			const [renaming, setRenaming] = (0, react.useState)(null);
			// D81: the purge conversation — { scope, entryId, name } | null.
			const [purging, setPurging] = (0, react.useState)(null);
			// D90: the disconnect conversation — { kind, orgId, projectSlug?, name, slug } | null.
			const [disconnecting, setDisconnecting] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				const open = () => setCreating(true);
				const onPublish = (e) => {
					const d = (e && e.detail) || {};
					// D90: project rows dispatch the same event with a projectSlug —
					// the publish modal then runs project.connect, scoped to one repo.
					if (d && d.orgId && d.projectSlug) setPublishing({ orgId: String(d.orgId), projectSlug: String(d.projectSlug), orgName: String(d.orgName || d.orgId), projectName: String(d.projectName || d.projectSlug) });
					else if (d && d.orgId) setPublishing({ orgId: String(d.orgId), orgName: String(d.orgName || d.orgId) });
				};
				const onDisconnect = (e) => {
					const d = (e && e.detail) || {};
					if (d && d.orgId && d.slug) setDisconnecting({ kind: d.kind === "project" ? "project" : "org", orgId: String(d.orgId), projectSlug: d.projectSlug ? String(d.projectSlug) : void 0, name: String(d.name || d.orgId), slug: String(d.slug) });
				};
				const onCreateProject = (e) => {
					const d = (e && e.detail) || {};
					if (d && d.orgId) setCreatingProject({ orgId: String(d.orgId) });
				};
				window.addEventListener("arxa-create-org", open);
				window.addEventListener("arxa-publish-org", onPublish);
				window.addEventListener("arxa-create-project", onCreateProject);
				const onRenameOrg = (e) => {
					const d = (e && e.detail) || {};
					if (d && d.orgId) setRenaming({ kind: "org", orgId: String(d.orgId), currentName: String(d.orgName || d.orgId) });
				};
				const onRenameProject = (e) => {
					const d = (e && e.detail) || {};
					if (d && d.orgId && d.projectSlug) setRenaming({ kind: "project", orgId: String(d.orgId), projectSlug: String(d.projectSlug), currentName: String(d.projectName || d.projectSlug) });
				};
				window.addEventListener("arxa-rename-org", onRenameOrg);
				window.addEventListener("arxa-rename-project", onRenameProject);
				const onPurge = (e) => {
					const d = (e && e.detail) || {};
					if (d && d.entryId) setPurging({ scope: String(d.scope || "project"), entryId: String(d.entryId), name: String(d.name || d.entryId) });
				};
				window.addEventListener("arxa-purge-trash", onPurge);
			window.addEventListener("arxa-disconnect-github", onDisconnect);
				return () => {
					window.removeEventListener("arxa-create-org", open);
					window.removeEventListener("arxa-publish-org", onPublish);
					window.removeEventListener("arxa-create-project", onCreateProject);
				window.removeEventListener("arxa-rename-org", onRenameOrg);
				window.removeEventListener("arxa-rename-project", onRenameProject);
				window.removeEventListener("arxa-purge-trash", onPurge);
				window.removeEventListener("arxa-disconnect-github", onDisconnect);
				};
			}, []);
			orgT = props.t; // stock-scope render sites read the locale through this
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
				children: [
					// WelcomeGate no longer mounts here (Phase 2): it registers
					// into the frame's shell.overlay slot in apply() — the
					// declared overlay surface, not a hand-layered fixed div.
					// D83: TrashSection no longer mounts here — ARXA_TRASH_AFTER_ORGS
					// renders it inside the org tree, right under the last org row.
					(0, react_jsx_runtime.jsx)(WorkspaceBrowser, patched),
					(0, react_jsx_runtime.jsx)(OrgCreateModal, { t: props.t, createWorkspace: props.createWorkspace, open: creating, onClose: () => setCreating(false) }),
					(0, react_jsx_runtime.jsx)(OrgPublishModal, { t: props.t, target: publishing, onClose: () => setPublishing(null) }),
					(0, react_jsx_runtime.jsx)(OrgProjectModal, { t: props.t, target: creatingProject, onClose: () => setCreatingProject(null) }),
				(0, react_jsx_runtime.jsx)(OrgRenameModal, { t: props.t, target: renaming, onClose: () => setRenaming(null) }),
				(0, react_jsx_runtime.jsx)(OrgPurgeModal, { t: props.t, target: purging, onClose: () => setPurging(null) }),
			(0, react_jsx_runtime.jsx)(OrgDisconnectModal, { t: props.t, target: disconnecting, onClose: () => setDisconnecting(null) })
				]
			});
		}
		/** Locale relabels: same menu shapes, honest org vocabulary (Q3–Q5). */
		const enOver = {
			"section.workspaces": "Organisations",
			"files.section": "Files",
			"files.empty": "No files",
			"workspace.add": "New organisation…",
			"menu.addWorkspace": "New organisation…",
			"menu.trash": "Trash",
			"menu.org.rename": "Rename…",
"menu.org.trash": "Move to Trash",
			"menu.project.rename": "Rename…",
			"menu.project.trash": "Move to Trash",
			"trash.empty": "Trash is empty",
			"rename.orgTitle": "Rename organisation",
			"rename.projectTitle": "Rename project",
			"rename.nameLabel": "New name",
			"rename.cta": "Rename",
			"rename.busy": "Renaming — moving the folder and syncing GitHub…",
			"rename.done": "Renamed",
			"rename.close": "Close",
			"rename.orgNote": "The organisation folder and its GitHub repo are renamed together.",
			"rename.projectNote": "The project folder and its GitHub repo are renamed together.",
			"trash.section": "Trash",
			"trash.restore": "Restore",
			"trash.restoreAll": "Restore all",
			"delete.workspace": "Close organisation",
			"delete.desc": "This closes “{name}”. Its sessions stay in the org registry; nothing on disk is deleted.",
			"delete.pending": "Closing organisation…",
			"rename.workspace.title": "Rename organisation",
			"field.workspaceName": "Organisation name",
			"conflict.named": "An organisation named “{name}” already exists.",
			"actions.workspace.aria": "Organisation actions for {name}",
			"actions.project.aria": "Project actions for {name}",
			"trash.orgSection": "Organisations",
			"trash.projectSection": "Projects",
			"trash.deleteForever": "Delete forever",
			"purge.orgTitle": "Delete organisation forever?",
			"purge.projectTitle": "Delete project forever?",
			"purge.orgWarn": "This permanently deletes the organisation folder AND every GitHub repo it owns — the org repo and each published project repo. This cannot be undone.",
			"purge.projectWarn": "This permanently deletes the trashed folder AND the project's GitHub repo. This cannot be undone.",
			"purge.confirm": "Delete forever",
			"purge.busy": "Deleting — removing the GitHub repos and the trashed folder…",
			"purge.done": "Deleted forever",
			// D85: the in-modal delete_repo upgrade path (device flow + auto-retry).
			"purge.relink": "Re-link GitHub & retry",
			"purge.relinkHint": "One-time permission upgrade: the saved GitHub link predates the delete permission. Enter this code at the URL below to authorize — the delete retries automatically.",
			"purge.typeName": "Type {name} exactly to confirm.",
			"purge.retry": "Try again",
			"disconnect.title": "Disconnect from GitHub",
			"disconnect.orgWarn": "Unlinks this organisation and every project repository under it. Your files stay on this device.",
			"disconnect.projectWarn": "Unlinks this project's repository. Your files stay on this device.",
			"disconnect.keep": "Keep the repositories on GitHub",
			"disconnect.remove": "Also remove them from GitHub",
			"disconnect.typeRepo": "Type {name} to confirm removal.",
			"disconnect.cta": "Disconnect",
			"disconnect.busy": "Disconnecting…",
			"disconnect.done": "Disconnected from GitHub",
			"disconnect.doneKept": "Disconnected — repositories kept on GitHub.",
			"disconnect.doneRemoved": "Disconnected — removed from GitHub: {repos}",
			"rows.ghSynced": "Synced with GitHub",
			"org.create.ghToggle": "Publish to GitHub",
			"org.create.ghOnHint": "A private GitHub repository is created and kept in sync.",
			"org.create.ghOffHint": "This organisation stays on this device only. Connect it later from its menu.",
			"org.create.ghUnavailableHint": "GitHub isn't linked — the organisation will be created on this device only. Connect it later from its menu.",
			"purge.close": "Close",
			"groupBy.workspace": "Project",
			"orderBy.manual": "As created",
			"orderBy.updated": "Newest first",
			"picker.loading": "Loading organisations…",
			"status.idle": "Open",
			"status.completed": "Parked",
			"org.create.title": "New organisation",
			"org.create.submit": "Create organisation",
			"org.create.location": "Location",
			"org.create.preview": "Creates at",
			"org.create.exists.nonempty": "That folder already exists and isn't empty — change the name or the location.",
			"org.create.exists.org": "{name} already lives here.",
			"org.create.exists.open": "Open it instead",
			"github.signin.desc": "arxa studio manages everything through git. Link your GitHub account to create an organisation — your projects publish as private repos under it.",
			"github.signin.button": "Sign in with GitHub",
			"github.signin.codeHint": "Enter this one-time code at github.com/login/device — your browser should have opened there",
			"github.signin.copy": "Copy",
			"github.signin.copied": "Copied ✓",
			"github.signin.openLink": "Open github.com/login/device",
			"github.signin.busy": "Waiting for GitHub…",
			"github.signin.failed": "GitHub sign-in did not complete — try again.",
			"github.signin.required": "Link your GitHub account first.",
			"newSession.selectFirst": "Select a workspace to start a session",
			"files.openHint": "Open this organisation to browse its files",
			"newSession.snapshotPending": "Preparing git snapshot — sessions unlock when it lands",
			"welcome.title": "Welcome to arxa studio",
			"welcome.desc": "Create your first organisation to start — arxa studio manages everything through git.",
			"welcome.studio": "arxa studio",
			"welcome.business": "arxa business",
			"welcome.businessSoon": "arxa business (agency) — coming soon",
			"tree.dock.projects": "Projects",
			"hero.guide": "Sessions start inside a workspace — open an organisation, expand to a folder row, hover it and press + to start a session.",
			"tree.dock.notes": "Notes",
			"tree.dock.meetings": "Meetings",
			"tree.dock.account": "Account",
			"tree.dock.communications": "Communications",
			"tree.ws.notes": "Notes",
			"tree.ws.meetings/scheduler": "Scheduler",
			"tree.ws.meetings/notes": "Notes",
			"tree.ws.account/receipts": "Receipts",
			"tree.ws.account/invoices": "Invoices",
			"tree.ws.account/subscriptions": "Subscriptions",
			"tree.ws.account/profile": "Profile",
			"tree.ws.communications/emails": "Emails",
			"tree.ws.communications/messages": "Messages",
			"tree.ws.communications/comments": "Comments",
			"tree.pc.design": "Design",
			"tree.pc.config": "Config",
			"tree.pc.deploy": "Deploy",
			"tree.pc.diagrams": "Diagrams",
			"tree.pc.intake": "Intake",
			"tree.pc.architecture": "Architecture",
			"tree.pc.notes": "Notes",
			"tree.pc.build": "Build",
			"tree.pc.moodboard": "Moodboard",
			"tree.pc.scaffold": "Scaffold",
			"menu.org.open": "Open organisation",
			"menu.org.sync": "Sync with GitHub",
			"rows.sync.busy": "Syncing…",
			"rows.sync.ok": "In sync",
			"rows.sync.pushed": "Synced",
			"rows.sync.failed": "Sync failed",
			"menu.org.newProject": "New project",
			"menu.org.connect": "Connect to GitHub",
			"menu.org.disconnect": "Disconnect GitHub…",
			"menu.project.connect": "Connect to GitHub",
			"menu.project.disconnect": "Disconnect GitHub…",
			"publish.title": "Publish to GitHub",
			"publish.confirmDesc": "Creates one private GitHub repo for this organisation and one per project, then pushes the full commit history. Session branches stay local.",
			"publish.projectTitle": "Connect project to GitHub",
			"publish.projectConfirmDesc": "Creates a private GitHub repository for this project and pushes its full history.",
			"publish.confirmCta": "Publish",
			"publish.busyCta": "Publishing…",
			"publish.busy": "Publishing… first publish can take a moment while history is pushed.",
			"publish.done": "Published to GitHub",
			"publish.already": "Already published — everything is up to date",
			"publish.openOnGithub": "Open on GitHub",
			"publish.close": "Close",
			"publish.cancel": "Cancel",
			"publish.errTitle": "Publish failed",
			"publish.errGeneric": "The publish failed — try again.",
			"publish.errNotLinked": "GitHub isn\u2019t linked. Create an organisation and sign in with GitHub first, then publish again.",
			"publish.errUnavailable": "The GitHub link is unavailable right now — try again in a moment.",
			"publish.errPending": "The first git snapshot of this organisation is still running — publishing unlocks the moment it completes.",
			"project.title": "New project",
			"project.nameLabel": "Project name",
			"project.namePlaceholder": "e.g. Aurora Website",
			"project.create": "Create project",
			"project.creating": "Creating\u2026",
			"project.busy": "Creating the project, scaffolding its stages and publishing it\u2026",
			"project.done": "Project created",
			"project.doneRepo": "Private GitHub repo created and history pushed.",
			"project.close": "Close",
			"project.errNotLinked": "GitHub isn\u2019t linked. Create an organisation and sign in with GitHub first, then try again.",
		};
		const plOver = {
			"section.workspaces": "Organizacje",
			"files.section": "Pliki",
			"files.empty": "Brak plików",
			"workspace.add": "Nowa organizacja…",
			"menu.addWorkspace": "Nowa organizacja…",
			"menu.trash": "Kosz",
			"menu.org.rename": "Zmień nazwę…",
		"menu.org.trash": "Przenieś do Kosza",
			"menu.project.rename": "Zmień nazwę…",
			"menu.project.trash": "Przenieś do Kosza",
			"trash.empty": "Kosz jest pusty",
			"rename.orgTitle": "Zmień nazwę organizacji",
			"rename.projectTitle": "Zmień nazwę projektu",
			"rename.nameLabel": "Nowa nazwa",
			"rename.cta": "Zmień nazwę",
			"rename.busy": "Zmiana nazwy — przenoszenie folderu i synchronizacja z GitHub…",
			"rename.done": "Nazwa zmieniona",
			"rename.close": "Zamknij",
			"rename.orgNote": "Folder organizacji i jej repo na GitHub zmieniają nazwę razem.",
			"rename.projectNote": "Folder projektu i jego repo na GitHub zmieniają nazwę razem.",
			"trash.section": "Kosz",
			"trash.restore": "Przywróć",
			"trash.restoreAll": "Przywróć wszystko",
			"delete.workspace": "Zamknij organizację",
			"delete.desc": "To zamyka „{name}”. Jej sesje pozostają w rejestrze organizacji; nic na dysku nie zostaje usunięte.",
			"delete.pending": "Zamykanie organizacji…",
			"rename.workspace.title": "Zmień nazwę organizacji",
			"field.workspaceName": "Nazwa organizacji",
			"conflict.named": "Organizacja o nazwie „{name}” już istnieje.",
			"actions.workspace.aria": "Akcje organizacji dla {name}",
			"actions.project.aria": "Akcje projektu dla {name}",
			"trash.orgSection": "Organizacje",
			"trash.projectSection": "Projekty",
			"trash.deleteForever": "Usuń na zawsze",
			"purge.orgTitle": "Usunąć organizację na zawsze?",
			"purge.projectTitle": "Usunąć projekt na zawsze?",
			"purge.orgWarn": "To trwale usuwa folder organizacji ORAZ każde repo GitHub, które do niej należy — repo organizacji i każde opublikowane repo projektu. Tej operacji nie można cofnąć.",
			"purge.projectWarn": "To trwale usuwa folder z Kosza ORAZ repo projektu na GitHub. Tej operacji nie można cofnąć.",
			"purge.confirm": "Usuń na zawsze",
			"purge.busy": "Usuwanie repo z GitHub i folderu z Kosza…",
			"purge.done": "Usunięto na zawsze",
			// D85: the in-modal delete_repo upgrade path (device flow + auto-retry).
			"purge.relink": "Połącz ponownie z GitHub i ponów",
			"purge.relinkHint": "Jednorazowe rozszerzenie uprawnień: zapisane połączenie z GitHub powstało przed uprawnieniem do usuwania. Wpisz ten kod pod poniższym adresem URL, aby autoryzować — usuwanie ponowi się automatycznie.",
			"purge.typeName": "Wpisz dokładnie {name}, aby potwierdzić.",
			"purge.retry": "Spróbuj ponownie",
			"disconnect.title": "Odłącz od GitHub",
			"disconnect.orgWarn": "Odłącza tę organizację i każde repozytorium projektu pod nią. Twoje pliki pozostają na tym urządzeniu.",
			"disconnect.projectWarn": "Odłącza repozytorium tego projektu. Twoje pliki pozostają na tym urządzeniu.",
			"disconnect.keep": "Zachowaj repozytoria na GitHub",
			"disconnect.remove": "Usuń je również z GitHub",
			"disconnect.typeRepo": "Wpisz {name}, aby potwierdzić usunięcie.",
			"disconnect.cta": "Odłącz",
			"disconnect.busy": "Odłączanie…",
			"disconnect.done": "Odłączono od GitHub",
			"disconnect.doneKept": "Odłączono — repozytoria zachowane na GitHub.",
			"disconnect.doneRemoved": "Odłączono — usunięto z GitHub: {repos}",
			"rows.ghSynced": "Zsynchronizowano z GitHub",
			"org.create.ghToggle": "Opublikuj na GitHub",
			"org.create.ghOnHint": "Zostaje utworzone prywatne repozytorium GitHub i jest na bieżąco synchronizowane.",
			"org.create.ghOffHint": "Ta organizacja pozostaje tylko na tym urządzeniu. Połącz ją później z jej menu.",
			"org.create.ghUnavailableHint": "GitHub nie jest połączony — organizacja zostanie utworzona tylko na tym urządzeniu. Połącz ją później z jej menu.",
			"purge.close": "Zamknij",
			"groupBy.workspace": "Projekt",
			"orderBy.manual": "Według kolejności utworzenia",
			"orderBy.updated": "Najnowsze pierwsze",
			"picker.loading": "Ładowanie organizacji…",
			"status.idle": "Otwarta",
			"status.completed": "Zaparkowana",
			"org.create.title": "Nowa organizacja",
			"org.create.submit": "Utwórz organizację",
			"org.create.location": "Lokalizacja",
			"org.create.preview": "Utworzy w",
			"org.create.exists.nonempty": "Ten folder już istnieje i nie jest pusty — zmień nazwę lub lokalizację.",
			"org.create.exists.org": "{name} już tu istnieje.",
			"org.create.exists.open": "Otwórz ją zamiast tego",
			"github.signin.desc": "arxa studio zarządza wszystkim przez git. Połącz swoje konto GitHub, aby utworzyć organizację — twoje projekty publikują się jako prywatne repo pod nią.",
			"github.signin.button": "Zaloguj się przez GitHub",
			"github.signin.codeHint": "Wpisz ten jednorazowy kod na github.com/login/device — przeglądarka powinna była się tam otworzyć",
			"github.signin.copy": "Kopiuj",
			"github.signin.copied": "Skopiowano ✓",
			"github.signin.openLink": "Otwórz github.com/login/device",
			"github.signin.busy": "Oczekiwanie na GitHub…",
			"github.signin.failed": "Logowanie do GitHub nie powiodło się — spróbuj ponownie.",
			"github.signin.required": "Najpierw połącz swoje konto GitHub.",
			"newSession.selectFirst": "Wybierz obszar roboczy, aby rozpocząć sesję",
			"files.openHint": "Otwórz tę organizację, aby przeglądać jej pliki",
			"newSession.snapshotPending": "Przygotowywanie migawki git — sesje odblokują się, gdy będzie gotowa",
			"welcome.title": "Witamy w arxa studio",
			"welcome.desc": "Utwórz pierwszą organizację, aby zacząć — arxa studio zarządza wszystkim przez git.",
			"welcome.studio": "arxa studio",
			"welcome.business": "arxa business",
			"welcome.businessSoon": "arxa business (agencja) — wkrótce",
			"tree.dock.projects": "Projekty",
			"hero.guide": "Sesje zaczynają się wewnątrz obszaru roboczego — otwórz organizację, rozwiń do wiersza folderu, najedź na niego i naciśnij +, aby rozpocząć sesję.",
			"tree.dock.notes": "Notatki",
			"tree.dock.meetings": "Spotkania",
			"tree.dock.account": "Konto",
			"tree.dock.communications": "Komunikacja",
			"tree.ws.notes": "Notatki",
			"tree.ws.meetings/scheduler": "Harmonogram",
			"tree.ws.meetings/notes": "Notatki",
			"tree.ws.account/receipts": "Paragony",
			"tree.ws.account/invoices": "Faktury",
			"tree.ws.account/subscriptions": "Subskrypcje",
			"tree.ws.account/profile": "Profil",
			"tree.ws.communications/emails": "E-maile",
			"tree.ws.communications/messages": "Wiadomości",
			"tree.ws.communications/comments": "Komentarze",
			"tree.pc.design": "Design",
			"tree.pc.config": "Konfiguracja",
			"tree.pc.deploy": "Wdrożenie",
			"tree.pc.diagrams": "Diagramy",
			"tree.pc.intake": "Intake",
			"tree.pc.architecture": "Architektura",
			"tree.pc.notes": "Notatki",
			"tree.pc.build": "Build",
			"tree.pc.moodboard": "Moodboard",
			"tree.pc.scaffold": "Scaffold",
			"menu.org.open": "Otwórz organizację",
			"menu.org.sync": "Synchronizuj z GitHub",
			"rows.sync.busy": "Synchronizowanie…",
			"rows.sync.ok": "Zsynchronizowano",
			"rows.sync.pushed": "Zsynchronizowano",
			"rows.sync.failed": "Błąd synchronizacji",
			"menu.org.newProject": "Nowy projekt",
			"menu.org.connect": "Połącz z GitHub",
			"menu.org.disconnect": "Odłącz GitHub…",
			"menu.project.connect": "Połącz z GitHub",
			"menu.project.disconnect": "Odłącz GitHub…",
			"publish.title": "Opublikuj na GitHub",
			"publish.confirmDesc": "Tworzy jedno prywatne repo GitHub dla tej organizacji i po jednym na projekt, a następnie wypycha pełną historię commitów. Branche sesji pozostają lokalne.",
			"publish.projectTitle": "Połącz projekt z GitHub",
			"publish.projectConfirmDesc": "Tworzy prywatne repozytorium GitHub dla tego projektu i wypycha jego pełną historię.",
			"publish.confirmCta": "Opublikuj",
			"publish.busyCta": "Publikowanie…",
			"publish.busy": "Publikowanie… pierwsza publikacja może chwilę potrwać, gdy historia jest wypychana.",
			"publish.done": "Opublikowano na GitHub",
			"publish.already": "Już opublikowano — wszystko jest aktualne",
			"publish.openOnGithub": "Otwórz na GitHub",
			"publish.close": "Zamknij",
			"publish.cancel": "Anuluj",
			"publish.errTitle": "Publikacja nie powiodła się",
			"publish.errGeneric": "Publikacja nie powiodła się — spróbuj ponownie.",
			"publish.errNotLinked": "GitHub nie jest połączony. Najpierw utwórz organizację i zaloguj się przez GitHub, a potem opublikuj ponownie.",
			"publish.errUnavailable": "Połączenie z GitHub jest teraz niedostępne — spróbuj ponownie za chwilę.",
			"publish.errPending": "Pierwsza migawka git tej organizacji wciąż trwa — publikacja odblokuje się zaraz po jej zakończeniu.",
			"project.title": "Nowy projekt",
			"project.nameLabel": "Nazwa projektu",
			"project.namePlaceholder": "np. Strona Aurora",
			"project.create": "Utwórz projekt",
			"project.creating": "Tworzenie…",
			"project.busy": "Tworzenie projektu, przygotowywanie jego etapów i publikowanie…",
			"project.done": "Projekt utworzony",
			"project.doneRepo": "Utworzono prywatne repo GitHub i wypchnięto historię.",
			"project.close": "Zamknij",
			"project.errNotLinked": "GitHub nie jest połączony. Najpierw utwórz organizację i zaloguj się przez GitHub, a potem spróbuj ponownie.",
		};
		const frOver = {
			"section.workspaces": "Organisations",
			"files.section": "Fichiers",
			"files.empty": "Aucun fichier",
			"workspace.add": "Nouvelle organisation…",
			"menu.addWorkspace": "Nouvelle organisation…",
			"menu.trash": "Corbeille",
			"menu.org.rename": "Renommer…",
		"menu.org.trash": "Déplacer vers la corbeille",
			"menu.project.rename": "Renommer…",
			"menu.project.trash": "Déplacer vers la corbeille",
			"trash.empty": "La corbeille est vide",
			"rename.orgTitle": "Renommer l’organisation",
			"rename.projectTitle": "Renommer le projet",
			"rename.nameLabel": "Nouveau nom",
			"rename.cta": "Renommer",
			"rename.busy": "Renommage — déplacement du dossier et synchronisation avec GitHub…",
			"rename.done": "Renommé",
			"rename.close": "Fermer",
			"rename.orgNote": "Le dossier de l’organisation et son repo GitHub sont renommés ensemble.",
			"rename.projectNote": "Le dossier du projet et son repo GitHub sont renommés ensemble.",
			"trash.section": "Corbeille",
			"trash.restore": "Restaurer",
			"trash.restoreAll": "Tout restaurer",
			"delete.workspace": "Fermer l’organisation",
			"delete.desc": "Ceci ferme « {name} ». Ses sessions restent dans le registre de l’organisation ; rien n’est supprimé du disque.",
			"delete.pending": "Fermeture de l’organisation…",
			"rename.workspace.title": "Renommer l’organisation",
			"field.workspaceName": "Nom de l’organisation",
			"conflict.named": "Une organisation nommée « {name} » existe déjà.",
			"actions.workspace.aria": "Actions de l’organisation pour {name}",
			"actions.project.aria": "Actions du projet pour {name}",
			"trash.orgSection": "Organisations",
			"trash.projectSection": "Projets",
			"trash.deleteForever": "Supprimer définitivement",
			"purge.orgTitle": "Supprimer l’organisation définitivement ?",
			"purge.projectTitle": "Supprimer le projet définitivement ?",
			"purge.orgWarn": "Ceci supprime définitivement le dossier de l’organisation ET tous les repos GitHub qu’elle possède — le repo de l’organisation et chaque repo de projet publié. Cette action est irréversible.",
			"purge.projectWarn": "Ceci supprime définitivement le dossier de la corbeille ET le repo GitHub du projet. Cette action est irréversible.",
			"purge.confirm": "Supprimer définitivement",
			"purge.busy": "Suppression des repos GitHub et du dossier de la corbeille…",
			"purge.done": "Supprimé définitivement",
			// D85: the in-modal delete_repo upgrade path (device flow + auto-retry).
			"purge.relink": "Re-lier GitHub et réessayer",
			"purge.relinkHint": "Mise à niveau unique des autorisations : le lien GitHub enregistré est antérieur à l’autorisation de suppression. Saisissez ce code à l’URL ci-dessous pour autoriser — la suppression réessaiera automatiquement.",
			"purge.typeName": "Saisissez {name} exactement pour confirmer.",
			"purge.retry": "Réessayer",
			"disconnect.title": "Se déconnecter de GitHub",
			"disconnect.orgWarn": "Délie cette organisation et chaque dépôt de projet sous elle. Vos fichiers restent sur cet appareil.",
			"disconnect.projectWarn": "Délie le dépôt de ce projet. Vos fichiers restent sur cet appareil.",
			"disconnect.keep": "Conserver les dépôts sur GitHub",
			"disconnect.remove": "Les supprimer aussi de GitHub",
			"disconnect.typeRepo": "Saisissez {name} pour confirmer la suppression.",
			"disconnect.cta": "Déconnecter",
			"disconnect.busy": "Déconnexion…",
			"disconnect.done": "Déconnecté de GitHub",
			"disconnect.doneKept": "Déconnecté — dépôts conservés sur GitHub.",
			"disconnect.doneRemoved": "Déconnecté — supprimés de GitHub : {repos}",
			"rows.ghSynced": "Synchronisé avec GitHub",
			"org.create.ghToggle": "Publier sur GitHub",
			"org.create.ghOnHint": "Un dépôt GitHub privé est créé et synchronisé en continu.",
			"org.create.ghOffHint": "Cette organisation reste uniquement sur cet appareil. Connectez-la plus tard depuis son menu.",
			"org.create.ghUnavailableHint": "GitHub n’est pas lié — l’organisation sera créée uniquement sur cet appareil. Connectez-la plus tard depuis son menu.",
			"purge.close": "Fermer",
			"groupBy.workspace": "Projet",
			"orderBy.manual": "Par ordre de création",
			"orderBy.updated": "Les plus récents d’abord",
			"picker.loading": "Chargement des organisations…",
			"status.idle": "Ouverte",
			"status.completed": "En pause",
			"org.create.title": "Nouvelle organisation",
			"org.create.submit": "Créer l’organisation",
			"org.create.location": "Emplacement",
			"org.create.preview": "Sera créée dans",
			"org.create.exists.nonempty": "Ce dossier existe déjà et n’est pas vide — changez le nom ou l’emplacement.",
			"org.create.exists.org": "{name} est déjà ici.",
			"org.create.exists.open": "L’ouvrir à la place",
			"github.signin.desc": "arxa studio gère tout via git. Liez votre compte GitHub pour créer une organisation — vos projets sont publiés comme des repos privés sous elle.",
			"github.signin.button": "Se connecter avec GitHub",
			"github.signin.codeHint": "Saisissez ce code à usage unique sur github.com/login/device — votre navigateur a dû s’y ouvrir",
			"github.signin.copy": "Copier",
			"github.signin.copied": "Copié ✓",
			"github.signin.openLink": "Ouvrir github.com/login/device",
			"github.signin.busy": "En attente de GitHub…",
			"github.signin.failed": "La connexion à GitHub n’a pas abouti — réessayez.",
			"github.signin.required": "Liez d’abord votre compte GitHub.",
			"newSession.selectFirst": "Sélectionnez un espace de travail pour démarrer une session",
			"files.openHint": "Ouvrez cette organisation pour parcourir ses fichiers",
			"newSession.snapshotPending": "Préparation de l’instantané git — les sessions se débloqueront quand il sera prêt",
			"welcome.title": "Bienvenue dans arxa studio",
			"welcome.desc": "Créez votre première organisation pour commencer — arxa studio gère tout via git.",
			"welcome.studio": "arxa studio",
			"welcome.business": "arxa business",
			"welcome.businessSoon": "arxa business (agence) — bientôt disponible",
			"tree.dock.projects": "Projets",
			"hero.guide": "Les sessions démarrent dans un espace de travail — ouvrez une organisation, dépliez jusqu’à une ligne de dossier, survolez-la et appuyez sur + pour démarrer une session.",
			"tree.dock.notes": "Notes",
			"tree.dock.meetings": "Réunions",
			"tree.dock.account": "Compte",
			"tree.dock.communications": "Communications",
			"tree.ws.notes": "Notes",
			"tree.ws.meetings/scheduler": "Planificateur",
			"tree.ws.meetings/notes": "Notes",
			"tree.ws.account/receipts": "Reçus",
			"tree.ws.account/invoices": "Factures",
			"tree.ws.account/subscriptions": "Abonnements",
			"tree.ws.account/profile": "Profil",
			"tree.ws.communications/emails": "E-mails",
			"tree.ws.communications/messages": "Messages",
			"tree.ws.communications/comments": "Commentaires",
			"tree.pc.design": "Design",
			"tree.pc.config": "Configuration",
			"tree.pc.deploy": "Déploiement",
			"tree.pc.diagrams": "Diagrammes",
			"tree.pc.intake": "Intake",
			"tree.pc.architecture": "Architecture",
			"tree.pc.notes": "Notes",
			"tree.pc.build": "Build",
			"tree.pc.moodboard": "Moodboard",
			"tree.pc.scaffold": "Scaffold",
			"menu.org.open": "Ouvrir l’organisation",
			"menu.org.sync": "Synchroniser avec GitHub",
			"rows.sync.busy": "Synchronisation…",
			"rows.sync.ok": "Synchronisé",
			"rows.sync.pushed": "Synchronisé",
			"rows.sync.failed": "Échec de la synchronisation",
			"menu.org.newProject": "Nouveau projet",
			"menu.org.connect": "Connecter à GitHub",
			"menu.org.disconnect": "Déconnecter GitHub…",
			"menu.project.connect": "Connecter à GitHub",
			"menu.project.disconnect": "Déconnecter GitHub…",
			"publish.title": "Publier sur GitHub",
			"publish.confirmDesc": "Crée un repo GitHub privé pour cette organisation et un par projet, puis pousse l’historique complet des commits. Les branches de session restent locales.",
			"publish.projectTitle": "Connecter le projet à GitHub",
			"publish.projectConfirmDesc": "Crée un dépôt GitHub privé pour ce projet et pousse tout son historique.",
			"publish.confirmCta": "Publier",
			"publish.busyCta": "Publication…",
			"publish.busy": "Publication… la première publication peut prendre un moment pendant que l’historique est poussé.",
			"publish.done": "Publié sur GitHub",
			"publish.already": "Déjà publié — tout est à jour",
			"publish.openOnGithub": "Ouvrir sur GitHub",
			"publish.close": "Fermer",
			"publish.cancel": "Annuler",
			"publish.errTitle": "Échec de la publication",
			"publish.errGeneric": "La publication a échoué — réessayez.",
			"publish.errNotLinked": "GitHub n’est pas lié. Créez d’abord une organisation et connectez-vous avec GitHub, puis publiez à nouveau.",
			"publish.errUnavailable": "Le lien GitHub est indisponible pour le moment — réessayez dans un instant.",
			"publish.errPending": "Le premier instantané git de cette organisation est toujours en cours — la publication se débloquera dès qu’il sera terminé.",
			"project.title": "Nouveau projet",
			"project.nameLabel": "Nom du projet",
			"project.namePlaceholder": "p. ex. Site Aurora",
			"project.create": "Créer le projet",
			"project.creating": "Création…",
			"project.busy": "Création du projet, génération de ses étapes et publication…",
			"project.done": "Projet créé",
			"project.doneRepo": "Repo GitHub privé créé et historique poussé.",
			"project.close": "Fermer",
			"project.errNotLinked": "GitHub n’est pas lié. Créez d’abord une organisation et connectez-vous avec GitHub, puis réessayez.",
		};
		//#endregion
		//#region lib/types/client/index.js
		/** Dictionary namespace owned by this plugin. */
		const NS = "workspace";
		/**
		* Required services (cordis fiber inject). The target slots are declared by
		* the ui-sidebar / ui-conversation applies, whose activation order relative
		* to this one is NOT constrained: dsh.client.inject edges are informational
		* (loading/prefetch metadata, never apply sequencing) and neither owner
		* provides a waitable service. apply therefore depends on each slot
		* declaration through `slots.inject()` instead of assuming order.
		*/
		const inject = [
			"slots",
			"sessions",
			"workspaces",
			"locale",
			"connection"
		];
		/**
		* Register the browser and picker once their slot declarations are on the
		* ledger. Inject factories return plain callbacks; data reads use the
		* framework's global hooks.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			// Locale world (Phase 0/2, conformance plan): arxa ships en/pl/fr —
			// zhOver is DELETED (the stock zh dicts ride along as dead weight
			// and are never selected); plOver/frOver are sparse override dicts
			// — the lookup chain falls back per-key to en (enOver merged), so a
			// missing translation shows English, never a raw key.
			ctx.effect(() => ctx.locale.register(NS, { zh, en: { ...en, ...enOver }, pl: plOver, fr: frOver }), "arxa-sidebar-workspace: dictionaries");
			orgHostDescription = ctx.get("connection").hostDescription;
			// Client runtime sessions service (2026-08-30): open(id) focuses a
			// conversation into the content area; clear() empties it and wipes
			// the persisted selection. arxa drives the content area — resume
			// opens the org session conversation like dsh; a boot with nothing
			// to resume clears (stranding pre-arxa sessions stop riding along).
			try { arxaClientSessions = ctx.get("sessions") } catch { arxaClientSessions = null }
			// Live cross-client propagation (2026-08-30): dsh pushes registry
			// changes (archive/rename/open from ANY client) into the runtime
			// stores over the live connection; the org view used to learn of
			// them only on the 5s poll. Refresh on every store bump — the
			// trailing debounce coalesces bursts and refresh() is sig-gated,
			// so an unchanged snapshot is a no-op. The poll stays as the
			// backstop for arxa-only mutations that never touch a dsh store.
			let liveRefreshTimer = 0;
			// Once and for all (2026-08-30): dsh startup policy re-opens the recent
			// workspace resident blank session on slow boots AFTER the bounded
			// re-assert window — the rider must lose every race, not just fast
			// ones. Invariant: with no user/resume open (currentSessionId null)
			// the only legal bound session is an OPEN org one. Enforced on every
			// store bump, forever; org/user opens win via the same guards.
			const orgDshIds = () => {
				const ids = new Set();
				const st = orgStore.get();
				for (const o of st.orgs || []) for (const x of o.sessions || []) if (x.dshSessionId && x.state === "open") ids.add(x.dshSessionId);
				return ids;
			};
			const enforceNoRiders = () => {
				if (orgStore.get().currentSessionId) return;
				const snap = arxaClientSessions && arxaClientSessions.list && typeof arxaClientSessions.list.getSnapshot === "function" ? arxaClientSessions.list.getSnapshot() : null;
				const cur = snap ? snap.current : void 0;
				if (cur === void 0 || cur === null) return;
				if (orgDshIds().has(cur)) return;
				try { arxaClientSessions.clear() } catch { /* degrade */ }
			};
			const liveRefresh = () => {
				if (liveRefreshTimer) return;
				liveRefreshTimer = window.setTimeout(() => { liveRefreshTimer = 0; orgStore.refresh().then(enforceNoRiders).catch(() => {}); }, 250);
			};
			try { ctx.get("workspaces").list.subscribe(() => { enforceNoRiders(); liveRefresh(); }) } catch { /* degrade */ }
			try { if (arxaClientSessions && typeof arxaClientSessions.list.subscribe === "function") arxaClientSessions.list.subscribe(() => { enforceNoRiders(); liveRefresh(); }) } catch { /* degrade */ }
			const browserInjected = () => ({
				// use* hooks are pinned in OrgBrowser — see the region snippet.
				startSession: (workspaceId) => {
					// v2 (grilled 2026-08-30): the ONLY creation path is a workspace
					// row own + — the composite id encodes org + workspace path. The
					// legacy org-level fallback is GONE (it created org-root worktrees).
					const s = String(workspaceId ?? "");
					const i = s.indexOf("|");
					if (i > 0 && i < s.length - 1) orgStore.mutate("workspace.new-session", { orgId: s.slice(0, i), workspace: s.slice(i + 1) }).catch(() => {});
				},
				open: (sessionId) => {
					const orgId = orgOfSession(sessionId);
					// Host revive first (spawns the engine conversation when the row
					// lacks one), then the mutate-carried refresh lands the fresh
					// dshSessionId, THEN focus the conversation — dsh own row-open call.
					if (orgId !== void 0) orgStore.mutate("session.open", { orgId, sessionId }).then(() => arxaOpenConversation(sessionId)).catch(() => {});
				},
				// Local derivation already matches session + org names (Q4); the content
				// search fetch is an honest empty — we hold no transcript index.
				searchSessions: async () => ({ items: [], hasMore: false }),
				searchResultLimit: 20,
				renameSession: (sessionId, title) => {
					// One rename, every surface: the registry name is the display truth;
					// git stays keyed by the session id (grilled 2026-08-30).
					const orgId = orgOfSession(sessionId);
					if (orgId !== void 0 && typeof title === "string" && title.trim() !== "") orgStore.mutate("session.rename", { orgId, sessionId, name: title.trim() }).catch(() => {});
				},
				forkSession: () => {},
				archiveSession: (sessionId) => {
					const orgId = orgOfSession(sessionId);
					if (orgId !== void 0) orgStore.mutate("session.archive", { orgId, sessionId }).catch(() => {});
				},
				insertSessionBefore: async () => {},
				renameWorkspace: async () => {}, // fixed folders are not renamable (v2)
				deleteWorkspace: async () => {}, // leaf rows never delete; org close lives on the org row menu (v2)
				insertWorkspaceBefore: async () => {},
				createWorkspace: async (input) => {
					await orgStore.mutate("org.create", { name: input?.name });
					const s = orgStore.get();
					return { workspaceId: (s.orgs.find((o) => o.open) || {}).id };
				},
				trash: () => orgStore.toggleTrash(),
				hooks: { directoryFlow: orgNoFlow, hostDescription: orgHostDescription },
			});
			ctx.slots.inject("sidebar.workspaces", () => ctx.slots.register({
				name: "sidebar.workspaces",
				children: { "sidebar.workspaces.directoryFlow": {
					kind: "single",
					scope: "root"
				} },
				store: createWorkspaceViewStore(),
				inject: browserInjected,
				locale: NS
			}, OrgBrowser));
			// Empty-state guidance (2026-08-30): the stock hero workspace picker
			// is gone from this build — its menu fed dsh own workspace registry
			// and submitting created raw engine sessions outside the org model
			// (the stranding-session factory). Occupy the slot with the arxa way
			// instead; without a picked workspace the hero composer stays inert.
			ctx.slots.inject("conversation.hero.workspace", () => ctx.slots.register({
				name: "conversation.hero.workspace",
				locale: NS
			}, ArxaHeroGuide));
			// Welcome gate (Phase 2, conformance plan): the frame declares
			// shell.overlay (kind:list, scope:root) — the gate registers THERE
			// instead of fighting the shell with position:fixed + z-index
			// 2147483000. The overlay layer owns positioning, z-order and
			// pointer events; the gate renders null once an org exists.
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "arxa-welcome-gate",
				order: 100,
				locale: NS
			}, WelcomeGate));
		}
		exports.apply = apply;
		exports.inject = inject;

			return module.exports;
		  })(require);
		  const wsApply = wsExports.apply;
		  const shellApply = exports.apply;
		  exports.apply = (ctx) => { shellApply(ctx); wsApply(ctx); };
		}
		return module.exports;
	}
});

