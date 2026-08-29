// Browser half of arxa-sidebar.
// COPIED/ADAPTED FROM: @deepseek-ai/dsh-client-ui-sidebar lib/client.js
// (dsh 0.1.1-rc.2). The stock SidebarRoot shell is kept whole — logoRow
// (brand mark/name slots + fold toggle), New-session CTA, sidebar.workspaces
// region, foot (sidebar.settings + sidebar.footer.action), collapse/rail/
// scrollbar-linger behaviour, locale dicts, slot children map — with:
//   1. class prefix aXa_sb_ (was hHd-Xa_), module id arxa-sidebar;
//   2. brand fallbacks "arxa"/"studio" (arxa-brand registrants override);
//   3. an OrgSection (per-org state + CTAs from /__arxa/sidebar/*) spliced
//      into regionArea above the workspaces registrant, divider-separated.
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
		const css = ".aXa_sb_root{--dsh-sidebar-inline-padding:12px;height:100%;padding:6px var(--dsh-sidebar-inline-padding);box-sizing:border-box;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);flex-direction:column;font-size:14px;display:flex}.aXa_sb_root.aXa_sb_collapsed{padding:18px 10px 6px}.aXa_sb_root.aXa_sb_quietBars{--dsh-scrollbar-thumb:transparent;--dsh-scrollbar-thumb-hover:transparent}.aXa_sb_fading>*{opacity:0;transition:opacity .15s var(--ds-ease-in-out)}.aXa_sb_wide{animation:aXa_sb_wide-in .2s var(--ds-ease-in-out)}@keyframes aXa_sb_wide-in{0%{opacity:0}}.aXa_sb_railIn .aXa_sb_iconButton,.aXa_sb_railIn .aXa_sb_newSession,.aXa_sb_railIn .aXa_sb_regionArea{animation:aXa_sb_rail-in .15s var(--ds-ease-in-out) backwards}.aXa_sb_railIn .aXa_sb_footArea{animation:aXa_sb_rail-fade-in .15s var(--ds-ease-in-out) backwards}@keyframes aXa_sb_rail-in{0%{opacity:0;transform:translate(49px)}}@keyframes aXa_sb_rail-fade-in{0%{opacity:0}}.aXa_sb_logoRow{box-sizing:border-box;flex:none;justify-content:flex-end;align-items:center;gap:8px;height:60px;margin-bottom:8px;padding:8px 0 8px 4px;display:flex;overflow:hidden}.aXa_sb_collapsed .aXa_sb_logoRow{justify-content:flex-start;height:36px;margin-bottom:12px;padding:0}.aXa_sb_brand{min-width:0;color:inherit;cursor:pointer;background:0 0;border:none;flex:1;align-items:center;padding:0;display:inline-flex;overflow:hidden}.aXa_sb_brandIdentity{align-items:center;gap:8px;min-width:0;height:24px;display:inline-flex}.aXa_sb_brandMark{flex:none;justify-content:center;align-items:center;display:inline-flex}.aXa_sb_brandName{letter-spacing:.04em;align-items:center;gap:6px;min-width:0;height:24px;font-size:18px;font-weight:600;line-height:24px;display:inline-flex}.aXa_sb_fallbackBrandName{letter-spacing:0;white-space:nowrap;font-size:17px}.aXa_sb_iconButton{cursor:pointer;width:28px;height:28px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.aXa_sb_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_collapsed .aXa_sb_iconButton{width:36px;height:36px}.aXa_sb_collapsed .aXa_sb_toggle .aXa_sb_panelIcon{display:none}.aXa_sb_collapsed .aXa_sb_toggle:hover .aXa_sb_panelIcon{display:inline}.aXa_sb_collapsed .aXa_sb_toggle:hover .aXa_sb_railMark{display:none}.aXa_sb_railMark{justify-content:center;align-items:center;display:inline-flex}.aXa_sb_collapsed .aXa_sb_iconButton{color:var(--dsw-alias-label-primary)}.aXa_sb_buildRevision{height:16px;color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);border-radius:3px;align-items:center;padding:0 4px;font-size:8px;font-weight:500;line-height:16px;display:inline-flex}.aXa_sb_newSession{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);height:38px;color:var(--dsw-alias-label-primary);cursor:pointer;border-radius:12px;flex:none;justify-content:center;align-items:center;gap:6px;margin:0 2px 8px;padding:8px 16px;font-size:14px;font-weight:500;line-height:22px;display:flex;overflow:hidden}.aXa_sb_newSession:hover{background:var(--dsw-alias-button-floating-hover)}.aXa_sb_collapsed .aXa_sb_newSession{background:0 0;border-color:#0000;align-self:flex-start;gap:0;width:36px;height:36px;margin:0 0 12px;padding:0}.aXa_sb_collapsed .aXa_sb_newSession:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_newSessionLabel{white-space:nowrap;max-width:200px;overflow:hidden}.aXa_sb_collapsed .aXa_sb_newSessionLabel{max-width:0}.aXa_sb_regionArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-sidebar-inline-padding));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:hidden}.aXa_sb_collapsed .aXa_sb_regionArea{margin-left:0;margin-right:0;padding-left:0}.aXa_sb_footArea{flex-direction:column;flex:none;display:flex}.aXa_sb_settingsArea,.aXa_sb_footerActions{flex:none;width:100%;min-width:0}.aXa_sb_footerActions{display:flex}.aXa_sb_collapsed .aXa_sb_footArea{align-items:center}.aXa_sb_collapsed .aXa_sb_settingsArea,.aXa_sb_collapsed .aXa_sb_footerActions{justify-content:center;width:auto;display:flex}@media (prefers-reduced-motion:reduce){.aXa_sb_wide,.aXa_sb_fading>*,.aXa_sb_railIn .aXa_sb_iconButton,.aXa_sb_railIn .aXa_sb_newSession,.aXa_sb_railIn .aXa_sb_footArea,.aXa_sb_railIn .aXa_sb_regionArea{transition:none;animation:none}}";
		const orgCss = ".aXa_sb_orgSection{flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:6px;padding-bottom:6px;font-size:13px}.aXa_sb_org{display:flex;align-items:center;gap:8px;padding:8px 4px;font-weight:600}.aXa_sb_orgDot{width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-primary);flex:none}.aXa_sb_switch{margin:0 4px 8px;padding:4px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;width:calc(100% - 8px)}.aXa_sb_tree{max-height:180px;overflow-y:auto;padding:0 2px}.aXa_sb_proj{display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;cursor:pointer}.aXa_sb_proj:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_proj[data-selected=true]{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_chip{font-size:10px;padding:1px 5px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);opacity:.8}.aXa_sb_badge{font-size:10px;padding:1px 5px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_ctas{display:flex;flex-direction:column;gap:6px;padding:8px 4px 2px}.aXa_sb_cta{padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;cursor:pointer;text-align:left}.aXa_sb_cta:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_cta:disabled{opacity:.45;cursor:default}.aXa_sb_orgEmpty{opacity:.6;padding:4px}.aXa_sb_sessGroup{margin:2px 0 4px}.aXa_sb_sessLabel{opacity:.55;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:4px 4px 2px}.aXa_sb_sessRow{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:3px 4px;border-radius:6px}.aXa_sb_sessRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.aXa_sb_sessState{opacity:.5;font-size:11px}";
		const tagId = "arxa-sidebar/SidebarRoot.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "arxa-sidebar";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css + orgCss;
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
		//#region arxa: per-org surface (spliced into regionArea, above sidebar.workspaces)
		// Data faces are ours (/__arxa/sidebar/*); the section renders as a
		// divided block INSIDE the copied shell so brand/toggle/new-session/
		// workspaces/settings all keep their stock placement.
		const fetchOrgState = async (selectedProject) => {
			const q = selectedProject ? `?project=${encodeURIComponent(selectedProject)}` : "";
			const r = await fetch(`/__arxa/sidebar/state${q}`);
			return r.json();
		};
		const postOrgAction = (action, arg, project) => fetch("/__arxa/sidebar/action", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action, arg, project })
		});
		function OrgSection({ wide }) {
			const h = react.createElement;
			const [state, setState] = (0, react.useState)(null);
			const [selected, setSelected] = (0, react.useState)(null);
			const refresh = (0, react.useCallback)(() => {
				fetchOrgState(selected).then(setState).catch(() => {});
			}, [selected]);
			(0, react.useEffect)(() => {
				refresh();
				const t = setInterval(refresh, 5e3);
				window.addEventListener("focus", refresh);
				return () => {
					clearInterval(t);
					window.removeEventListener("focus", refresh);
				};
			}, [refresh]);
			const act = (action, arg) => postOrgAction(action, arg, selected).then(refresh);
			const org = state?.org;
			const projects = state?.projects ?? [];
			const ctas = state?.cta ?? [];
			const sessions = state?.parkedSessions ?? [];
			const selProj = projects.find((p) => p.id === selected) ?? null;
			const sessRow = (s) => h("div", { key: s.id, className: "aXa_sb_sessRow", title: s.parkedReason || s.state }, h("span", null, s.name), h("span", { className: "aXa_sb_sessState" }, s.state));
			const sessGroup = (key, label, rows) => rows.length ? h("div", { key, className: "aXa_sb_sessGroup" }, h("div", { className: "aXa_sb_sessLabel" }, label), ...rows.map(sessRow)) : null;
			const sessBlock = h("div", { className: "aXa_sb_tree" }, selected ? [
				sessGroup("sel", selProj ? selProj.name : "Project", sessions.filter((s) => selProj && s.project === selProj.slug)),
				sessGroup("org", "Org", sessions.filter((s) => s.project == null))
			].filter(Boolean) : [
				...projects.map((p) => sessGroup(p.id, p.name, sessions.filter((s) => s.project === p.slug))),
				sessGroup("org", "Org", sessions.filter((s) => s.project == null))
			].filter(Boolean));
			if (!wide) return h("div", { className: "aXa_sb_orgSection" }, h("span", { className: "aXa_sb_orgDot", title: org ? org.name : "arxa", "aria-hidden": "true" }));
			const tree = projects.map((p) => h(
				"div",
				{
					key: p.id,
					className: "aXa_sb_proj",
					"data-selected": String(selected === p.id),
					onClick: () => setSelected(selected === p.id ? null : p.id)
				},
				h("span", null, p.name),
				...(p.versionChips ?? []).map((c, i) => h("span", { key: `c${i}`, className: "aXa_sb_chip" }, c)),
				...(p.sessionBadges ?? []).map((b, i) => h("span", { key: `b${i}`, className: "aXa_sb_badge" }, b))
			));
			return h(
				"div",
				{ className: "aXa_sb_orgSection" },
				h(
					"div",
					{ className: "aXa_sb_org" },
					h("span", { className: "aXa_sb_orgDot", "aria-hidden": "true" }),
					h("span", null, org ? org.name : "No organisation open")
				),
				(state?.orgs?.length ?? 0) > 1 ? h(
					"select",
					{
						className: "aXa_sb_switch",
						value: org?.id ?? "",
						onChange: (e) => act("org.switch", e.target.value)
					},
					...state.orgs.map((o) => h("option", { key: o.id, value: o.id }, o.name))
				) : null,
				org ? h("div", { className: "aXa_sb_tree" }, tree.length ? tree : h("div", { className: "aXa_sb_orgEmpty" }, "No projects yet")) : null,
				org && sessions.length ? sessBlock : null,
				h("div", { className: "aXa_sb_ctas" }, ...ctas.map((c) => h(
					"button",
					{
						key: c.id,
						className: "aXa_sb_cta",
						disabled: !!c.disabled,
						title: c.reserved ? "Reserved (Phase D3)" : void 0,
						onClick: () => act(c.action)
					},
					c.label
				)))
			);
		}
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
					(0, react_jsx_runtime.jsxs)("div", {
						className: SidebarRoot_module_css_default.regionArea,
						children: [(0, react_jsx_runtime.jsx)(OrgSection, { wide }), renderSlot("sidebar.workspaces", {
							wide,
							expandSidebar: () => {
								if (collapsed) toggleSidebar();
							}
						})]
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
		const en = {
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
				en
			}), "ui-sidebar: dictionaries");
			const injectProps = () => ({
				startSession: (workspaceId) => {
					ctx.workspaces.startSession(workspaceId);
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
		return module.exports;
	}
});

