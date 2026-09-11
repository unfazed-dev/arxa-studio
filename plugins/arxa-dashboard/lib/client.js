// Browser half of arxa-dashboard (docs/plans/org-row-dashboard.md, D8/D9/D12/D13).
// Hand-written (git-card grammar): React via require('react'), no JSX.
//
// This plugin owns NO slot. The hero slot (conversation.hero.workspace,
// kind:single) belongs to arxa-sidebar; its ArxaHeroGuide renders
// `window.__ARXA_DASHBOARD__.Root` while a row is selected and no session is
// bound, and marks the composer stack `data-arxa-dashboard` so the CSS below
// can reshape the hero (top-aligned, wider, composer + brand hidden).
// Everything registered here is undone on dispose.
//
// Sessions card (D13, 2026-09-09): every registry session of the row is a
// clickable card. Click = expand to a concise point-form summary of the
// latest turns (dsh's own turnOutline previews via session.summary) with an
// "Open session" button that runs the sidebar's openCreated flow — the same
// server open + reveal + conversation focus a tree row uses.

window.__ModuleLoader__.load({
  id: 'arxa-dashboard',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const NS = 'arxa-dashboard'
    const ROUTE = '/__arxa/dashboard/action'
    const SIDEBAR_ROUTE = '/__arxa/sidebar/action'
    const CSS_TAG = 'arxa-dashboard/Dashboard.css'
    // Only data-* hooks and this plugin's own aXa_db_ classes — never stock
    // hashed classes. `:has()` lifts the hero's vertical centering.
    const CSS = [
      "[data-conversation-scroll]:has([data-arxa-dashboard]){justify-content:flex-start!important;padding-top:20px}",
      "[data-arxa-dashboard]{width:min(1180px,100%)!important;padding-bottom:24px!important}",
      "[data-arxa-dashboard] [data-slot='conversation.hero.brand.mark'],[data-arxa-dashboard] [data-slot='conversation.hero.agentPreset'],[data-arxa-dashboard] [data-slot='conversation.input.dock']{display:none!important}",
      // D12: no welcome over a dashboard — the hero headline (brand mark +
      // "Flowing High" + preview badge) is the element whose child span holds
      // the brand.mark slot; it lives OUTSIDE the composer stack, so key it off
      // the page carrying a dashboard. Data hooks only, no hashed classes.
      "body:has([data-arxa-dashboard]) :has(> span > [data-slot='conversation.hero.brand.mark']){display:none!important}",
      "[data-arxa-dashboard-seat]{display:block;width:100%;padding:0 20px;box-sizing:border-box}",
      ".aXa_db_root{color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}",
      ".aXa_db_head{display:flex;align-items:flex-start;flex-wrap:wrap;gap:16px;padding:4px 0 16px;border-bottom:.5px solid var(--dsw-alias-border-l3)}",
      ".aXa_db_title{flex:1 1 240px;min-width:0}",
      ".aXa_db_kind{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_name{font-size:22px;line-height:28px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aXa_db_path{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aXa_db_actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:none}",
      ".aXa_db_btn{font:inherit;font-size:13px;line-height:20px;padding:5px 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-primary);cursor:pointer}",
      ".aXa_db_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}",
      ".aXa_db_btn:disabled{opacity:.5;cursor:default}",
      ".aXa_db_btnPrimary{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}",
      ".aXa_db_btnSmall{font-size:12px;line-height:18px;padding:3px 10px}",
      ".aXa_db_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:12px;padding-top:16px}",
      // Layered surfaces (2026-09-09 operator ask: cards need a contrast step):
      // page ← stat card (layer-1) ← session card (layer-2) ← expanded (layer-3).
      ".aXa_db_card{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;min-height:96px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.18)}",
      ".aXa_db_cardWide{grid-column:1/-1}",
      ".aXa_db_nums{display:flex;gap:18px;margin-top:10px;flex-wrap:wrap}",
      ".aXa_db_num{display:flex;flex-direction:column;min-width:64px}",
      ".aXa_db_numVal{font-size:20px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary)}",
      ".aXa_db_numKey{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_chart{display:block;margin-top:10px;margin-bottom:2px;max-width:100%;height:auto;overflow:visible}",
      ".aXa_db_chartRow{display:flex;gap:14px;margin-top:10px;min-width:0;align-items:stretch}",
      ".aXa_db_chartCol{display:flex;flex-direction:column;min-width:0}",
      ".aXa_db_chartCol .aXa_db_chart{margin-top:0}",
      ".aXa_db_wdWrap{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end}",
      ".aXa_db_wd{width:100%;height:auto;max-height:143px;margin-top:0}",
      ".aXa_db_wdLabel{fill:var(--dsw-alias-label-tertiary);font-size:9px}",
      ".aXa_db_cell{fill:var(--dsw-alias-state-business-primary)}",
      ".aXa_db_cellZero{fill:var(--dsw-alias-label-primary);fill-opacity:.1}",
      ".aXa_db_bar{fill:var(--dsw-alias-state-business-primary);fill-opacity:.7}",
      ".aXa_db_meta{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:2px}",
      ".aXa_db_range{display:inline-flex;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden}",
      ".aXa_db_range .aXa_db_btn{border:0;border-radius:0;padding:4px 9px;font-size:12px}",
      ".aXa_db_range .aXa_db_btn[aria-pressed='true']{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".aXa_db_cardTitle{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px}",
      ".aXa_db_count{font-weight:400;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_muted{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-top:8px}",
      ".aXa_db_sessions{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:10px;margin-top:10px}",
      ".aXa_db_session{border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;text-align:left;font:inherit;color:inherit;min-width:0;box-shadow:0 1px 2px rgba(0,0,0,.16)}",
      ".aXa_db_session:hover{background:var(--dsw-alias-bg-layer-3)}",
      ".aXa_db_session[aria-expanded='true']{grid-column:1/-1;background:var(--dsw-alias-bg-layer-3);cursor:default}",
      ".aXa_db_facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:12.5px;line-height:19px;margin-top:2px}",
      ".aXa_db_factKey{color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
      ".aXa_db_factVal{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aXa_db_sessionHead{display:flex;align-items:center;gap:8px;min-width:0}",
      ".aXa_db_sessionName{flex:1;min-width:0;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".aXa_db_chip{font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);flex:none}",
      ".aXa_db_chipSample{border-style:dashed;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_sampleNote{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:8px}",
      ".aXa_db_chipLive{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".aXa_db_sessionMeta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}",
      ".aXa_db_summary{margin-top:10px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l3)}",
      ".aXa_db_donut{display:flex;align-items:center;gap:14px;margin:10px 0 2px}",
      ".aXa_db_arc{fill:none;stroke:var(--dsw-alias-state-business-primary)}",
      ".aXa_db_legend{display:grid;grid-template-columns:max-content max-content;gap:0 8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_legendVal{color:var(--dsw-alias-label-secondary);text-align:right}",
      ".aXa_db_sessionBars{display:grid;grid-template-columns:max-content 1fr max-content;align-items:center;gap:3px 8px;margin-top:6px;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_track{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}",
      ".aXa_db_fill{display:block;height:4px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}",
      ".aXa_db_barVal{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}",
      ".aXa_db_summaryFoot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-tertiary)}",

      // ---- step 4.5 (§14): the reference restyle ------------------------
      // NAV PILLS (Q3) — the org and its five fixed docks. Active pill rides
      // the ONE active-row style (operator, 2026-09-12): the settings-nav /
      // sidebar soft-accent fill on --dsw-specific-sidebar-nav-item-active —
      // the palette wash tints it, text stays label-primary. The old inverted
      // black pill (label-primary fill + inverted text) read un-themed.
      ".aXa_db_nav{display:flex;gap:6px;padding:0 0 14px;align-items:center}",
      ".aXa_db_navPill{flex:none;font:inherit;font-size:12.5px;line-height:18px;padding:5px 12px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;transition:background-color .12s var(--ds-ease-in-out),color .12s var(--ds-ease-in-out)}",
      ".aXa_db_navPill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      ".aXa_db_navPillOn{background:var(--dsw-specific-sidebar-nav-item-active);border-color:transparent;color:var(--dsw-alias-label-primary)}",
      ".aXa_db_navPillOn:hover{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary)}",

      // THE RAIL (operator addition) — one primitive, three consumers: the
      // pill overflow, the session hand, and any card whose content outgrows
      // its bento height. `contain` is load-bearing on a trackpad: MDN is
      // explicit that it disables the native horizontal swipe navigation.
      ".aXa_db_rail{display:flex;gap:10px;min-width:0;overscroll-behavior-x:contain;scrollbar-width:thin}",
      ".aXa_db_railX{overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scroll-padding-inline-start:2px;padding-bottom:2px}",
      ".aXa_db_railY{flex-direction:column;overflow-y:auto;overflow-x:hidden;scroll-snap-type:y proximity;overscroll-behavior-y:contain;min-height:0}",
      ".aXa_db_rail>*{scroll-snap-align:start}",
      ".aXa_db_railX::-webkit-scrollbar,.aXa_db_railY::-webkit-scrollbar{height:6px;width:6px}",
      ".aXa_db_railX::-webkit-scrollbar-thumb,.aXa_db_railY::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:3px}",

      // HERO + TOOLBAR (Q2) — one filled pill in the hero, chips below.
      ".aXa_db_hero{display:flex;align-items:flex-start;flex-wrap:wrap;gap:12px 16px;padding:2px 0 12px}",
      ".aXa_db_bar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:0 0 14px;border-bottom:.5px solid var(--dsw-alias-border-l3);min-width:0}",
      ".aXa_db_heroName{font-size:28px;line-height:34px;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",

      // THE BENTO (Q4) — 12 columns, and every rung sums to 12, so a resize
      // never opens a hole. Rows stretch to a common height; the card body is
      // a column whose last block takes margin-top:auto, so a short card
      // FILLS instead of leaving a dead bottom.
      ".aXa_db_bento{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;padding-top:16px;align-items:stretch}",
      ".aXa_db_bentoCard{display:flex;flex-direction:column;min-width:0;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;padding:14px 16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .12s var(--ds-ease-in-out),box-shadow .12s var(--ds-ease-in-out)}",
      ".aXa_db_bentoCard:hover{transform:translateY(-1px);box-shadow:0 3px 10px rgba(0,0,0,.20)}",
      ".aXa_db_bentoBody{display:flex;flex-direction:column;min-width:0;flex:1;margin-top:10px}",
      ".aXa_db_bentoBody>:last-child:not(:first-child){margin-top:auto}",
      ".aXa_db_bentoBody>.aXa_db_railY{flex:1;min-height:0;margin-top:0}",
      ".aXa_db_heroCta{flex:none;margin-left:auto;border-radius:999px;padding:7px 16px}",
      // Accent fill means LIVE, nothing else (Q9).
      ".aXa_db_bentoCardLive{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}",
      ".aXa_db_bentoCardLive .aXa_db_cardTitle,.aXa_db_bentoCardLive .aXa_db_numKey,.aXa_db_bentoCardLive .aXa_db_legend,.aXa_db_bentoCardLive .aXa_db_legendRow,.aXa_db_bentoCardLive .aXa_db_gaugeKey,.aXa_db_bentoCardLive .aXa_db_muted{color:rgba(255,255,255,.82)}",
      ".aXa_db_bentoCardLive .aXa_db_gaugeVal{color:#fff}",
      ".aXa_db_bentoCardLive .aXa_db_dot{background:#fff}",
      ".aXa_db_bentoCardLive .aXa_db_sep{border-top-color:rgba(255,255,255,.28)}",
      ".aXa_db_bentoCardLive .aXa_db_numVal,.aXa_db_bentoCardLive .aXa_db_legendVal{color:#fff}",
      ".aXa_db_bentoCardLive .aXa_db_arc{stroke:#fff}",
      "@media (max-width:1099px){.aXa_db_span5,.aXa_db_span4,.aXa_db_span3{grid-column:span 6}.aXa_db_span6{grid-column:span 6}.aXa_db_span6Wide{grid-column:span 12}}",
      "@media (min-width:1100px){.aXa_db_span5{grid-column:span 5}.aXa_db_span4{grid-column:span 4}.aXa_db_span3{grid-column:span 3}.aXa_db_span6,.aXa_db_span6Wide{grid-column:span 6}}",
      "@media (max-width:699px){.aXa_db_span5,.aXa_db_span4,.aXa_db_span3,.aXa_db_span6,.aXa_db_span6Wide{grid-column:span 12}}",
      ".aXa_db_span12{grid-column:span 12}",

      // THE SESSION CAROUSEL (§14 Q5, revised 2026-09-10 by the operator: no
      // peeking, no fan — plain horizontal scrolling cards). Credit-card
      // tiles side by side on the shared rail; the card you are on is the one
      // that lifts, and that is a SELECTION fact, never a scroll fact.
      ".aXa_db_hand{gap:12px;padding:6px 2px 10px;align-items:flex-start}",
      ".aXa_db_bank{position:relative;flex:none;display:flex;flex-direction:column;width:min(264px,100%);height:166px;padding:12px 14px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;text-align:left;cursor:pointer;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.18);transition:transform .12s var(--ds-ease-in-out),box-shadow .12s var(--ds-ease-in-out)}",
      ".aXa_db_bank:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.22)}",
      ".aXa_db_bankOn{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px;box-shadow:0 4px 12px rgba(0,0,0,.22)}",
      // Accent fill = LIVE, nothing else (Q9).
      ".aXa_db_bankLive{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:#fff}",
      ".aXa_db_bankLive .aXa_db_bankMeta,.aXa_db_bankLive .aXa_db_numKey{color:rgba(255,255,255,.80)}",
      ".aXa_db_bankLive .aXa_db_chip{border-color:rgba(255,255,255,.45);color:#fff}",
            ".aXa_db_bankTop{display:flex;align-items:flex-start;gap:8px;min-width:0}",
      ".aXa_db_bankName{flex:1;min-width:0;font-size:14.5px;line-height:19px;font-weight:600;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}",
      ".aXa_db_bankChips{display:flex;align-items:center;gap:6px;flex:none}",
      ".aXa_db_bankFig{margin-top:auto;display:flex;flex-direction:column}",
      ".aXa_db_bankMeta{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",

      // THE DETAIL PANEL (Q7) — opens BENEATH the rail, one at a time. A single
      // animatable property, so it composites and reduced-motion kills it whole.
      ".aXa_db_panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .18s var(--ds-ease-in-out)}",
      ".aXa_db_panelOpen{grid-template-rows:1fr}",
      ".aXa_db_panelIn{overflow:hidden;min-height:0}",

      // TIME (Q6) + the reference's delta chip and area line (Q9).
      ".aXa_db_gauge{position:relative;display:flex;justify-content:center;padding:2px 0 6px}",
      ".aXa_db_gaugeMid{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}",
      ".aXa_db_gaugeKey{font-size:11px;color:var(--dsw-alias-label-tertiary);text-align:center;margin-top:-2px}",
      ".aXa_db_gaugeVal{font-size:22px;line-height:24px;font-weight:600}",
      ".aXa_db_gaugeKey{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_legendRow{display:grid;grid-template-columns:8px 1fr max-content;align-items:center;gap:4px 8px;font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:4px}",
      ".aXa_db_dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}",
      ".aXa_db_sep{margin-top:8px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l3)}",
      ".aXa_db_delta{font-size:11px;line-height:16px;padding:0 6px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap}",
      ".aXa_db_deltaUp{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}",
      ".aXa_db_area{fill:var(--dsw-alias-state-business-primary);fill-opacity:.16}",
      ".aXa_db_line{fill:none;stroke:var(--dsw-alias-state-business-primary);stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}",
      ".aXa_db_peak{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);stroke-width:.5}",
      ".aXa_db_peakText{fill:var(--dsw-alias-label-secondary);font-size:9px}",
      ".aXa_db_chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}",
      ".aXa_db_chipBtn{cursor:pointer;background:transparent;font-family:inherit;transition:background .12s var(--ds-ease-in-out),color .12s var(--ds-ease-in-out)}",
      ".aXa_db_chipBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
      ".aXa_db_chipOn{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}",
      // Delivery (step 5): one row per repo. No new colour tokens — CI state
      // rides the same business accent / label tiers every other card uses.
      ".aXa_db_repoRow{display:flex;align-items:center;gap:8px;padding:6px 0;border-top:.5px solid var(--dsw-alias-border-l3);font-size:12px}",
      ".aXa_db_repoRow:first-child{border-top:0}",
      ".aXa_db_repoName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}",
      ".aXa_db_repoVal{color:var(--dsw-alias-label-secondary);flex:none;font-variant-numeric:tabular-nums}",
      ".aXa_db_ci{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}",
      ".aXa_db_ciGreen{background:var(--dsw-alias-state-business-primary)}",
      ".aXa_db_ciRed{background:var(--dsw-alias-state-error-primary)}",
      ".aXa_db_ciPending{background:var(--dsw-alias-label-secondary);animation:aXa_db_pulse 1.4s var(--ds-ease-in-out) infinite}",
      "@keyframes aXa_db_pulse{50%{opacity:.35}}",

      // MOTION (Q8) — six moves, house grammar, and the reduced-motion block
      // every studio stylesheet ends with.
      ".aXa_db_bentoCard{animation:aXa_db_card-in .18s var(--ds-ease-in-out) backwards}",
      "@keyframes aXa_db_card-in{0%{opacity:0;transform:translateY(6px)}}",
      ".aXa_db_bento>:nth-child(2){animation-delay:30ms}.aXa_db_bento>:nth-child(3){animation-delay:60ms}.aXa_db_bento>:nth-child(4){animation-delay:90ms}.aXa_db_bento>:nth-child(5){animation-delay:120ms}.aXa_db_bento>:nth-child(n+6){animation-delay:150ms}",
      "@media (prefers-reduced-motion:reduce){.aXa_db_bentoCard,.aXa_db_navPill,.aXa_db_bank,.aXa_db_panel{animation:none;transition:none}.aXa_db_bentoCard:hover,.aXa_db_bank:hover{transform:none}}",
    ].join('')

    function ensureCss() {
      if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']')) return null
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = CSS_TAG
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { try { tag.remove() } catch {} }
    }

    const en = {
      'sessions.donutTitle': '{n} {state}',
      'sessions.bar.tokens': 'tokens',
      'sessions.bar.engine': 'engine',
      'sessions.bar.focus': 'focus',
      'sessions.totalTokens': 'Tokens',
      'sessions.totalEngine': 'Model + tool',
      'sessions.totalFocus': 'Focus',
      'facts.model': 'Model time',
      'facts.tool': 'Tool time',
      'facts.wall': 'Wall span',
      'facts.focus': 'Focus time',
      'facts.tokensIn': 'Tokens in',
      'facts.tokensOut': 'Tokens out',
      'facts.tokensCache': 'Cache read / write',
      'kind.org': 'Organisation',
      'kind.category': 'Category',
      'kind.project': 'Project',
      'cta.newSession': 'New session in {row}',
      'cta.refresh': 'Refresh',
      'state.loading': 'Loading…',
      'state.missing': 'This folder does not exist on disk yet.',
      'state.error': 'Could not load this row: {error}',
      'group.activity': 'Activity',
      'sessions.filterNote': 'Click to show only these sessions; click again to clear.',
      'sessions.noneInState': 'No {state} sessions in this row.',
      'group.sessions': 'Sessions',
      'group.repository': 'Repository',
      'group.delivery': 'Delivery',
      'time.none': 'No time recorded yet.',
      'time.focusNote': 'Time you sat with these sessions — a different clock from the engine\u2019s, so it is not added in.',
      'activity.vsPrev': 'vs the previous {n}',
      'sessions.states': 'open {open} · parked {parked} · archived {archived}',
      'group.time': 'Time',
      'nav.label': 'Dashboards in this organisation',
      'group.engine': 'Engine',
      'engine.not-set-up': 'The arxa engine has not run here yet.',
      'engine.not-applicable': 'Engine runs per project — pick a project row.',
      'engine.phaseKey': 'Phase',
      'engine.phaseNote': 'The least advanced project decides the phase for a whole organisation.',
      'engine.withEngine': 'Projects with runs',
      'engine.shipped': 'Shipped',
      'engine.step': '{n}/{of}',
      'engine.screens': '{n} screens',
      'engine.screensNote': 'Screens declared in the frozen structure.json.',
      'engine.someMissing': '{n} more scanned, none of them has run the engine.',
      'engine.phase.unknown': 'Not started',
      'engine.phase.intake': 'Intake',
      'engine.phase.prototype': 'Prototype',
      'engine.phase.design': 'Design',
      'engine.phase.scaffold': 'Scaffold',
      'engine.phase.review': 'Review',
      'engine.phase.build': 'Build',
      'engine.phase.deploy': 'Deploy',
      'delivery.unavailable': 'GitHub is not reachable from here.',
      'delivery.not-linked': 'GitHub is not linked. Connect it in Settings to see delivery.',
      'delivery.relink': 'The GitHub session expired — re-link GitHub in Settings.',
      'delivery.local-only': 'local only',
      'delivery.mainCi': 'main',
      'delivery.rate': 'CI pass rate',
      'delivery.rateNote': 'Share of concluded workflow runs on main that succeeded, over the last 20 runs per repository.',
      'delivery.linked': 'Linked repos',
      'delivery.truncated': '+{n} more repositories not fetched.',
      'delivery.ci.green': 'Passing',
      'delivery.ci.red': 'Failing',
      'delivery.ci.pending': 'Running',
      'delivery.ci.none': 'No checks',
      'delivery.ci.unknown': 'Unknown',
      'sessions.none': 'No sessions in this row yet.',
      'sessions.sample': 'Sample',
      'sessions.sampleNote': 'Sample data — sessions you create in this row replace these cards.',
      'sessions.sampleOpen': 'Sample sessions cannot be opened.',
      'sessions.unavailable': 'Session list is not available in this build.',
      'sessions.open': 'Open session',
      'sessions.close': 'Close',
      'sessions.turns': '{n} turns',
      'sessions.tokens': '{n} tokens',
      'sessions.noConversation': 'No conversation attached to this session.',
      'sessions.noProjection': 'No recorded turns yet.',
      'sessions.state.open': 'open',
      'sessions.state.parked': 'parked',
      'sessions.state.archived': 'archived',
      'sessions.running': 'running',
      'facts.goal': 'Goal',
      'facts.lastDone': 'Last done',
      'facts.next': 'Next',
      'facts.files': 'Files touched',
      'facts.commands': 'Commands',
      'facts.lastCommand': 'Last command',
      'facts.tools': 'Tools',
      'facts.turns': 'Turns',
      'facts.lastTool': 'Last tool',
      'facts.more': '+{n} more',
      'facts.none': 'No tool activity recorded yet.',
      'facts.todosKey': 'To-dos',
      'facts.todos': '{done} done · {open} open',
      'head.created': 'Created {v}',
      'head.updated': 'updated {v}',
      'range.label': 'Range',
      'range.30': '30d',
      'range.90': '90d',
      'range.365': '1y',
      'range.all': 'All',
      'activity.current': 'Current streak',
      'activity.longest': 'Longest streak',
      'activity.commits': 'Commits',
      'activity.days': '{n} days',
      'activity.active': 'Active days',
      'activity.wd.mon': 'M', 'activity.wd.tue': 'T', 'activity.wd.wed': 'W', 'activity.wd.thu': 'T', 'activity.wd.fri': 'F', 'activity.wd.sat': 'S', 'activity.wd.sun': 'S',
      'activity.wdCell': '{day} · {n} commits',
      'activity.busiest': 'Busiest: {day} · {n}',
      'activity.churn': '+{a} −{r} lines',
      'activity.none': 'No commits in this range.',
      'activity.cell': '{day} · {n} commits',
      'activity.week': 'Week of {day} · {n} commits',
      'activity.unavailable': 'Git figures are not available in this build.',
      'repo.files': 'Files',
      'repo.folders': 'Folders',
      'repo.branches': 'Branches',
      'repo.contributors': 'Contributors',
      'repo.lastCommit': 'Last commit',
      'repo.dirty': 'Uncommitted',
      'repo.clean': 'clean',
      'repo.modified': '{n} modified',
      'repo.added': '{n} added',
      'repo.deleted': '{n} deleted',
      'repo.untracked': '{n} untracked',
      'repo.repos': 'Repositories',
      'age.now': 'just now',
      'age.m': '{n}m ago',
      'age.h': '{n}h ago',
      'age.d': '{n}d ago',
    }
    const pl = {
      'sessions.donutTitle': '{n} {state}',
      'sessions.bar.tokens': 'tokeny',
      'sessions.bar.engine': 'silnik',
      'sessions.bar.focus': 'skupienie',
      'sessions.totalTokens': 'Tokeny',
      'sessions.totalEngine': 'Model + narzędzia',
      'sessions.totalFocus': 'Skupienie',
      'facts.model': 'Czas modelu',
      'facts.tool': 'Czas narzędzi',
      'facts.wall': 'Rozpiętość',
      'facts.focus': 'Czas skupienia',
      'facts.tokensIn': 'Tokeny wejściowe',
      'facts.tokensOut': 'Tokeny wyjściowe',
      'facts.tokensCache': 'Cache odczyt / zapis',
      'kind.org': 'Organizacja',
      'kind.category': 'Kategoria',
      'kind.project': 'Projekt',
      'cta.newSession': 'Nowa sesja w {row}',
      'cta.refresh': 'Odśwież',
      'state.loading': 'Wczytywanie…',
      'state.missing': 'Ten folder jeszcze nie istnieje na dysku.',
      'state.error': 'Nie udało się wczytać tego wiersza: {error}',
      'group.activity': 'Aktywność',
      'sessions.filterNote': 'Kliknij, aby pokazać tylko te sesje; kliknij ponownie, aby wyczyścić.',
      'sessions.noneInState': 'Brak sesji w stanie {state} w tym wierszu.',
      'group.sessions': 'Sesje',
      'group.repository': 'Repozytorium',
      'group.delivery': 'Dostarczanie',
      'time.none': 'Nie zapisano jeszcze czasu.',
      'time.focusNote': 'Czas sp\u0119dzony przy tych sesjach — inny zegar ni\u017c silnika, wi\u0119c nie jest doliczany.',
      'activity.vsPrev': 'wzgl\u0119dem poprzednich {n}',
      'sessions.states': 'otwarte {open} · wstrzymane {parked} · zarchiwizowane {archived}',
      'group.time': 'Czas',
      'nav.label': 'Pulpity w tej organizacji',
      'group.engine': 'Silnik',
      'engine.not-set-up': 'Silnik arxa jeszcze tu nie działał.',
      'engine.not-applicable': 'Silnik działa na projekt — wybierz wiersz projektu.',
      'engine.phaseKey': 'Faza',
      'engine.phaseNote': 'Najmniej zaawansowany projekt decyduje o fazie całej organizacji.',
      'engine.withEngine': 'Projekty z przebiegami',
      'engine.shipped': 'Wdrożone',
      'engine.step': '{n}/{of}',
      'engine.screens': 'ekrany: {n}',
      'engine.screensNote': 'Ekrany zadeklarowane w zamrożonym structure.json.',
      'engine.someMissing': 'Przeskanowano jeszcze {n}, żaden nie uruchomił silnika.',
      'engine.phase.unknown': 'Nie rozpoczęto',
      'engine.phase.intake': 'Wywiad',
      'engine.phase.prototype': 'Prototyp',
      'engine.phase.design': 'Projekt',
      'engine.phase.scaffold': 'Rusztowanie',
      'engine.phase.review': 'Przegląd',
      'engine.phase.build': 'Budowa',
      'engine.phase.deploy': 'Wdrożenie',
      'delivery.unavailable': 'GitHub jest nieosiągalny.',
      'delivery.not-linked': 'GitHub nie jest połączony. Połącz go w Ustawieniach, aby zobaczyć dostarczanie.',
      'delivery.relink': 'Sesja GitHub wygasła — połącz GitHub ponownie w Ustawieniach.',
      'delivery.local-only': 'tylko lokalnie',
      'delivery.mainCi': 'main',
      'delivery.rate': 'Skuteczność CI',
      'delivery.rateNote': 'Udział zakończonych przebiegów na gałęzi main, które się powiodły, z ostatnich 20 przebiegów na repozytorium.',
      'delivery.linked': 'Połączone repozytoria',
      'delivery.truncated': '+{n} repozytoriów nie pobrano.',
      'delivery.ci.green': 'Powodzenie',
      'delivery.ci.red': 'Niepowodzenie',
      'delivery.ci.pending': 'W toku',
      'delivery.ci.none': 'Brak sprawdzeń',
      'delivery.ci.unknown': 'Nieznane',
      'sessions.none': 'Brak sesji w tym wierszu.',
      'sessions.sample': 'Przykład',
      'sessions.sampleNote': 'Dane przykładowe — sesje utworzone w tym wierszu zastąpią te karty.',
      'sessions.sampleOpen': 'Przykładowych sesji nie można otworzyć.',
      'sessions.unavailable': 'Lista sesji nie jest dostępna w tej wersji.',
      'sessions.open': 'Otwórz sesję',
      'sessions.close': 'Zamknij',
      'sessions.turns': '{n} tur',
      'sessions.tokens': '{n} tokenów',
      'sessions.noConversation': 'Do tej sesji nie jest dołączona rozmowa.',
      'sessions.noProjection': 'Brak zapisanych tur.',
      'sessions.state.open': 'otwarta',
      'sessions.state.parked': 'zaparkowana',
      'sessions.state.archived': 'zarchiwizowana',
      'sessions.running': 'działa',
      'facts.goal': 'Cel',
      'facts.lastDone': 'Ostatnio zrobione',
      'facts.next': 'Następne',
      'facts.files': 'Zmienione pliki',
      'facts.commands': 'Polecenia',
      'facts.lastCommand': 'Ostatnie polecenie',
      'facts.tools': 'Narzędzia',
      'facts.turns': 'Tury',
      'facts.lastTool': 'Ostatnie narzędzie',
      'facts.more': '+{n} więcej',
      'facts.none': 'Brak zapisanej aktywności narzędzi.',
      'facts.todosKey': 'Zadania',
      'facts.todos': '{done} zrobione · {open} otwarte',
      'head.created': 'Utworzono {v}',
      'head.updated': 'zaktualizowano {v}',
      'range.label': 'Zakres',
      'range.30': '30 dni',
      'range.90': '90 dni',
      'range.365': '1 rok',
      'range.all': 'Wszystko',
      'activity.current': 'Bieżąca seria',
      'activity.longest': 'Najdłuższa seria',
      'activity.commits': 'Commity',
      'activity.days': '{n} dni',
      'activity.active': 'Dni aktywne',
      'activity.wd.mon': 'P', 'activity.wd.tue': 'W', 'activity.wd.wed': 'Ś', 'activity.wd.thu': 'C', 'activity.wd.fri': 'P', 'activity.wd.sat': 'S', 'activity.wd.sun': 'N',
      'activity.wdCell': '{day} · {n} commitów',
      'activity.busiest': 'Najwięcej: {day} · {n}',
      'activity.churn': '+{a} −{r} linii',
      'activity.none': 'Brak commitów w tym zakresie.',
      'activity.cell': '{day} · {n} commitów',
      'activity.week': 'Tydzień od {day} · {n} commitów',
      'activity.unavailable': 'Dane z gita nie są dostępne w tej wersji.',
      'repo.files': 'Pliki',
      'repo.folders': 'Foldery',
      'repo.branches': 'Gałęzie',
      'repo.contributors': 'Współautorzy',
      'repo.lastCommit': 'Ostatni commit',
      'repo.dirty': 'Niezatwierdzone',
      'repo.clean': 'czysto',
      'repo.modified': '{n} zmienionych',
      'repo.added': '{n} dodanych',
      'repo.deleted': '{n} usuniętych',
      'repo.untracked': '{n} nieśledzonych',
      'repo.repos': 'Repozytoria',
      'age.now': 'przed chwilą',
      'age.m': '{n} min temu',
      'age.h': '{n} godz. temu',
      'age.d': '{n} dni temu',
    }
    const fr = {
      'sessions.donutTitle': '{n} {state}',
      'sessions.bar.tokens': 'jetons',
      'sessions.bar.engine': 'moteur',
      'sessions.bar.focus': 'attention',
      'sessions.totalTokens': 'Jetons',
      'sessions.totalEngine': 'Modèle + outils',
      'sessions.totalFocus': 'Attention',
      'facts.model': 'Temps modèle',
      'facts.tool': 'Temps outils',
      'facts.wall': 'Durée totale',
      'facts.focus': 'Temps d’attention',
      'facts.tokensIn': 'Jetons entrants',
      'facts.tokensOut': 'Jetons sortants',
      'facts.tokensCache': 'Cache lecture / écriture',
      'kind.org': 'Organisation',
      'kind.category': 'Catégorie',
      'kind.project': 'Projet',
      'cta.newSession': 'Nouvelle session dans {row}',
      'cta.refresh': 'Actualiser',
      'state.loading': 'Chargement…',
      'state.missing': 'Ce dossier n’existe pas encore sur le disque.',
      'state.error': 'Impossible de charger cette ligne : {error}',
      'group.activity': 'Activité',
      'sessions.filterNote': 'Cliquez pour n’afficher que ces sessions ; cliquez à nouveau pour effacer.',
      'sessions.noneInState': 'Aucune session {state} dans cette ligne.',
      'group.sessions': 'Sessions',
      'group.repository': 'Dépôt',
      'group.delivery': 'Livraison',
      'time.none': 'Aucun temps enregistr\u00e9 pour l\u2019instant.',
      'time.focusNote': 'Temps pass\u00e9 sur ces sessions — une autre horloge que celle du moteur, donc non additionn\u00e9e.',
      'activity.vsPrev': 'par rapport aux {n} pr\u00e9c\u00e9dents',
      'sessions.states': 'ouvertes {open} · en pause {parked} · archiv\u00e9es {archived}',
      'group.time': 'Temps',
      'nav.label': 'Tableaux de bord de cette organisation',
      'group.engine': 'Moteur',
      'engine.not-set-up': 'Le moteur arxa n\'a pas encore tourné ici.',
      'engine.not-applicable': 'Le moteur tourne par projet — choisissez une ligne de projet.',
      'engine.phaseKey': 'Phase',
      'engine.phaseNote': 'Le projet le moins avancé décide de la phase de toute l\'organisation.',
      'engine.withEngine': 'Projets avec exécutions',
      'engine.shipped': 'Livrés',
      'engine.step': '{n}/{of}',
      'engine.screens': '{n} écrans',
      'engine.screensNote': 'Écrans déclarés dans le structure.json figé.',
      'engine.someMissing': '{n} autres analysés, aucun n’a lancé le moteur.',
      'engine.phase.unknown': 'Non démarré',
      'engine.phase.intake': 'Cadrage',
      'engine.phase.prototype': 'Prototype',
      'engine.phase.design': 'Design',
      'engine.phase.scaffold': 'Ossature',
      'engine.phase.review': 'Revue',
      'engine.phase.build': 'Build',
      'engine.phase.deploy': 'Déploiement',
      'delivery.unavailable': 'GitHub est injoignable depuis ici.',
      'delivery.not-linked': 'GitHub n\'est pas lié. Liez-le dans les Réglages pour voir la livraison.',
      'delivery.relink': 'La session GitHub a expiré — reliez GitHub dans les Réglages.',
      'delivery.local-only': 'local uniquement',
      'delivery.mainCi': 'main',
      'delivery.rate': 'Taux de réussite CI',
      'delivery.rateNote': 'Part des exécutions terminées sur main qui ont réussi, sur les 20 dernières exécutions par dépôt.',
      'delivery.linked': 'Dépôts liés',
      'delivery.truncated': '+{n} dépôts non récupérés.',
      'delivery.ci.green': 'Réussi',
      'delivery.ci.red': 'Échec',
      'delivery.ci.pending': 'En cours',
      'delivery.ci.none': 'Aucune vérification',
      'delivery.ci.unknown': 'Inconnu',
      'sessions.none': 'Aucune session dans cette ligne.',
      'sessions.sample': 'Exemple',
      'sessions.sampleNote': 'Données d’exemple — les sessions créées dans cette ligne remplacent ces cartes.',
      'sessions.sampleOpen': 'Les sessions d’exemple ne peuvent pas être ouvertes.',
      'sessions.unavailable': 'La liste des sessions n’est pas disponible dans cette version.',
      'sessions.open': 'Ouvrir la session',
      'sessions.close': 'Fermer',
      'sessions.turns': '{n} tours',
      'sessions.tokens': '{n} jetons',
      'sessions.noConversation': 'Aucune conversation rattachée à cette session.',
      'sessions.noProjection': 'Aucun tour enregistré.',
      'sessions.state.open': 'ouverte',
      'sessions.state.parked': 'en attente',
      'sessions.state.archived': 'archivée',
      'sessions.running': 'en cours',
      'facts.goal': 'Objectif',
      'facts.lastDone': 'Dernière action',
      'facts.next': 'Suivant',
      'facts.files': 'Fichiers touchés',
      'facts.commands': 'Commandes',
      'facts.lastCommand': 'Dernière commande',
      'facts.tools': 'Outils',
      'facts.turns': 'Tours',
      'facts.lastTool': 'Dernier outil',
      'facts.more': '+{n} de plus',
      'facts.none': 'Aucune activité d’outil enregistrée.',
      'facts.todosKey': 'Tâches',
      'facts.todos': '{done} faits · {open} ouverts',
      'head.created': 'Créé le {v}',
      'head.updated': 'mis à jour {v}',
      'range.label': 'Période',
      'range.30': '30 j',
      'range.90': '90 j',
      'range.365': '1 an',
      'range.all': 'Tout',
      'activity.current': 'Série en cours',
      'activity.longest': 'Plus longue série',
      'activity.commits': 'Commits',
      'activity.days': '{n} jours',
      'activity.active': 'Jours actifs',
      'activity.wd.mon': 'L', 'activity.wd.tue': 'M', 'activity.wd.wed': 'M', 'activity.wd.thu': 'J', 'activity.wd.fri': 'V', 'activity.wd.sat': 'S', 'activity.wd.sun': 'D',
      'activity.wdCell': '{day} · {n} commits',
      'activity.busiest': 'Record : {day} · {n}',
      'activity.churn': '+{a} −{r} lignes',
      'activity.none': 'Aucun commit sur cette période.',
      'activity.cell': '{day} · {n} commits',
      'activity.week': 'Semaine du {day} · {n} commits',
      'activity.unavailable': 'Les chiffres git ne sont pas disponibles dans cette version.',
      'repo.files': 'Fichiers',
      'repo.folders': 'Dossiers',
      'repo.branches': 'Branches',
      'repo.contributors': 'Contributeurs',
      'repo.lastCommit': 'Dernier commit',
      'repo.dirty': 'Non validé',
      'repo.clean': 'propre',
      'repo.modified': '{n} modifiés',
      'repo.added': '{n} ajoutés',
      'repo.deleted': '{n} supprimés',
      'repo.untracked': '{n} non suivis',
      'repo.repos': 'Dépôts',
      'age.now': 'à l’instant',
      'age.m': 'il y a {n} min',
      'age.h': 'il y a {n} h',
      'age.d': 'il y a {n} j',
    }
    const DICTS = { en, pl, fr }
    /** Local t(): the hero slot renders us OUTSIDE our own locale scope, so
      * resolve through the registered dsh locale when reachable and fall
      * back to the dictionaries here. `{row}`-style params are substituted. */
    let localeService = null
    const t = (key, params) => {
      let s
      try { s = localeService && typeof localeService.t === 'function' ? localeService.t(NS + '.' + key) : undefined } catch { s = undefined }
      if (typeof s !== 'string' || s === '' || s === NS + '.' + key) {
        const lang = (typeof navigator !== 'undefined' && navigator.language || 'en').slice(0, 2)
        s = (DICTS[lang] || en)[key] || en[key] || key
      }
      return params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s
    }

    const postAction = async (route, action, arg) => {
      const r = await fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, arg }) })
      const b = await r.json().catch(() => ({}))
      if (!b.ok) { const e = new Error(b.error || action); e.code = b.error || action; throw e }
      return b.result
    }

    const KIND_LABEL = { org: 'kind.org', dock: 'kind.category', category: 'kind.category', project: 'kind.project' }
    // Stat cards first, the (full-width) session list last.
    const GROUPS = ['activity', 'repository', 'delivery', 'engine', 'sessions']

    const fmtNum = (n) => {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '–'
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
      if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'
      return String(n)
    }
    const fmtAge = (v) => {
      const ts = typeof v === 'number' ? v : Date.parse(v || '')
      if (!Number.isFinite(ts) || ts <= 0) return ''
      const s = Math.max(0, (Date.now() - ts) / 1000)
      if (s < 60) return t('age.now')
      if (s < 3600) return t('age.m', { n: Math.floor(s / 60) })
      if (s < 86400) return t('age.h', { n: Math.floor(s / 3600) })
      return t('age.d', { n: Math.floor(s / 86400) })
    }
    /** Durations read as one unit, the one that carries the size (D10). */
    const fmtMs = (ms) => {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 1000) return null
      const sec = Math.round(ms / 1000)
      if (sec < 60) return sec + 's'
      const min = Math.round(sec / 60)
      if (min < 60) return min + 'm'
      return Math.floor(min / 60) + 'h' + (min % 60 ? ' ' + (min % 60) + 'm' : '')
    }
    /** Tier-2 figures for one session row: tokens, model and tool time, wall
      * span (first checkpoint → last prompt) and the focus time the heartbeat
      * banked. Absent unit ⇒ null, never zero — zero is a claim. */
    const figuresOf = (row) => {
      const m = (row && row.metrics) || {}
      const st = m.stats || null
      // Registry stamps are ISO on creation and ms-epoch after any annotation
      // (git-workspace's writer stamps Date.now()) — read both, like fmtAge does.
      const ts = (v) => (typeof v === 'number' ? v : Date.parse(v || ''))
      const start = typeof m.createdAt === 'number' ? m.createdAt : ts(row && row.createdAt)
      const end = typeof m.lastPromptAt === 'number' ? m.lastPromptAt : ts(row && row.updatedAt)
      return {
        tokens: m.tokens && typeof m.tokens.total === 'number' ? m.tokens.total : null,
        model: st ? st.llmMs : null,
        tool: st ? st.toolMs : null,
        engine: st ? st.llmMs + st.toolMs : null,
        wall: Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : null,
        focus: typeof row.focusMs === 'number' && row.focusMs > 0 ? row.focusMs : null,
      }
    }
    const stateLabel = (s) => (s === 'open' || s === 'parked' || s === 'archived' ? t('sessions.state.' + s) : String(s || ''))
    const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s || '')

    /** Sample rows for an EMPTY row (2026-09-09 operator ask: see the cards
      * before real sessions exist). Client-only: nothing is written, nothing
      * is posted; the summary rides inline so no host verb runs for them. */
    const sampleRows = () => {
      const now = Date.now()
      const mk = (id, name, state, running, minsAgo, turns, tokens, summary, activity) => ({
        id, name, state, running, sample: true, project: null, workspace: null,
        createdAt: new Date(now - (minsAgo + 90) * 60000).toISOString(), updatedAt: new Date(now - minsAgo * 60000).toISOString(),
        // Derived from the turn count so the tier-2 bars have something to scale.
        metrics: { stats: { turns, llmMs: turns * 9000, toolMs: turns * 4000 }, tokens: { total: tokens, uncachedInput: Math.round(tokens * 0.18), output: Math.round(tokens * 0.12), cacheRead: Math.round(tokens * 0.64), cacheWrite: Math.round(tokens * 0.06) }, lastPromptAt: now - minsAgo * 60000 },
        focusMs: turns * 60000,
        summary: { turnCount: turns, ...summary }, activity,
      })
      return [
        mk('sample-1', 'sample-brief-260909-001', 'open', true, 4, 12, 48200,
          { goal: 'Tighten the LensCo pilot brief and file it under communications', todos: { done: 3, open: 1, lastDone: 'Add the 12 000 EUR budget line from proposal §2', nextOpen: 'Send the brief to the client folder' } },
          { toolCalls: 19, tools: [{ name: 'Edit', n: 7 }, { name: 'Read', n: 9 }, { name: 'Bash', n: 3 }], files: ['communications/brief.md', 'proposals/lensco.md', 'intake/registry.json'], filesTotal: 3, commands: 3, lastCommand: 'git commit -m "brief: budget line"', lastTool: 'Bash', lastToolAt: now - 4 * 60000 }),
        mk('sample-2', 'sample-ci-fix-260908-002', 'open', false, 180, 7, 21900,
          { goal: 'Make the deploy gate pass on main', todos: null },
          { toolCalls: 11, tools: [{ name: 'Bash', n: 6 }, { name: 'Edit', n: 2 }, { name: 'Read', n: 3 }], files: ['pipeline/evidence.js', 'config/evidence.json'], filesTotal: 2, commands: 6, lastCommand: 'arxa gate run --stage deploy', lastTool: 'Bash', lastToolAt: now - 180 * 60000 }),
        mk('sample-3', 'sample-notes-260907-003', 'parked', false, 2900, 3, 6400,
          { goal: null, todos: { done: 5, open: 0, lastDone: 'Assign owners and Friday due dates to the 5 actions', nextOpen: null } },
          { toolCalls: 4, tools: [{ name: 'Read', n: 2 }, { name: 'Write', n: 2 }], files: ['meetings/2026-09-07.md', 'notes/actions.md'], filesTotal: 2, commands: 0, lastCommand: null, lastTool: 'Write', lastToolAt: now - 2900 * 60000 }),
      ]
    }

    /** One session card (§14 Q5, revised 2026-09-10: plain carousel — no fan,
      * no peek, no vertical text). Name, state chips, the big tokens figure,
      * and `turns · age`. The engine, wall and focus figures live in the
      * panel, not on the face (operator, 2026-09-10: the bars at the bottom of
      * the cards are gone). The summary is NOT in here either: it opens in the
      * panel beneath the rail, so the carousel keeps its shape. */
    function SessionCard({ row, selected, onSelect }) {
      const m = row.metrics || {}
      const stats = m.stats || null
      const fig = figuresOf(row)
      const meta = []
      if (stats) meta.push(t('sessions.turns', { n: stats.turns }))
      const age = fmtAge(m.lastPromptAt || row.updatedAt || row.createdAt)
      if (age) meta.push(age)
      return h('button', {
        type: 'button',
        className: 'aXa_db_bank' + (selected ? ' aXa_db_bankOn' : '') + (row.running ? ' aXa_db_bankLive' : ''),
        'aria-expanded': selected ? 'true' : 'false',
        'aria-label': row.name,
        title: row.name,
        'data-arxa-dashboard-session': row.id,
        'data-arxa-dashboard-sample': row.sample ? '' : undefined,
        onClick: onSelect,
      },
        h('span', { className: 'aXa_db_bankTop' },
          h('span', { className: 'aXa_db_bankName' }, row.name),
          h('span', { className: 'aXa_db_bankChips' },
            row.sample ? h('span', { className: 'aXa_db_chip aXa_db_chipSample' }, t('sessions.sample')) : null,
            // running IMPLIES open — two chips saying the same thing starved
            // the name to two clipped lines (seen through the lens 2026-09-10).
            row.running
              ? h('span', { className: 'aXa_db_chip aXa_db_chipLive' }, t('sessions.running'))
              : h('span', { className: 'aXa_db_chip' }, stateLabel(row.state)),
          ),
        ),
        h('span', { className: 'aXa_db_bankFig' },
          h('span', { className: 'aXa_db_numVal' }, typeof fig.tokens === 'number' ? fmtNum(fig.tokens) : '—'),
          h('span', { className: 'aXa_db_numKey' }, t('sessions.bar.tokens')),
          meta.length ? h('span', { className: 'aXa_db_bankMeta' }, meta.join(' · ')) : null,
        ),
      )
    }

    /** The expanded summary (§14 Q7) — full width, beneath the rail, one at a
      * time. Facts only, never transcript text (2026-09-09 operator rule). */
    function SessionPanel({ orgId, row, onClose, onOpen }) {
      const [sum, setSum] = React.useState(null)
      const [err, setErr] = React.useState(null)
      React.useEffect(() => {
        let cancelled = false
        setSum(null); setErr(null)
        if (row.sample) { setSum({ summary: row.summary, activity: row.activity }); return undefined }
        postAction(ROUTE, 'session.summary', { orgId, sessionId: row.id })
          .then((r) => { if (!cancelled) setSum(r) })
          .catch((e) => { if (!cancelled) setErr(String(e && e.code || e)) })
        return () => { cancelled = true }
      }, [orgId, row.id])
      const m = row.metrics || {}
      const tokens = m.tokens || null
      const fig = figuresOf(row)
      const facts = []
      const fact = (key, val) => { if (val !== null && val !== undefined && val !== '') facts.push(h('div', { key: key + facts.length, className: 'aXa_db_factKey' }, t(key)), h('div', { key: key + 'v' + facts.length, className: 'aXa_db_factVal', title: typeof val === 'string' ? val : undefined }, val)) }
      if (sum && sum.summary) {
        const sm = sum.summary
        fact('facts.goal', sm.goal)
        if (sm.todos) { fact('facts.lastDone', sm.todos.lastDone); fact('facts.next', sm.todos.nextOpen); fact('facts.todosKey', t('facts.todos', { done: sm.todos.done, open: sm.todos.open })) }
      }
      const act = sum && sum.activity
      if (act) {
        if (act.files && act.files.length) fact('facts.files', act.files.join(', ') + (act.filesTotal > act.files.length ? ' ' + t('facts.more', { n: act.filesTotal - act.files.length }) : ''))
        if (act.commands) fact('facts.commands', String(act.commands))
        fact('facts.lastCommand', act.lastCommand ? clip(act.lastCommand, 120) : null)
        if (act.tools && act.tools.length) fact('facts.tools', act.tools.map((x) => x.name + ' ×' + x.n).join(' · '))
        if (act.lastTool) fact('facts.lastTool', act.lastTool + (act.lastToolAt ? ' · ' + fmtAge(act.lastToolAt) : ''))
      }
      if (sum && sum.summary && sum.summary.turnCount) fact('facts.turns', String(sum.summary.turnCount))
      // Time and token facts ride the ROW's own metrics, so they stand even when
      // the conversation has no projection to summarise.
      fact('facts.model', fmtMs(fig.model))
      fact('facts.tool', fmtMs(fig.tool))
      fact('facts.wall', fmtMs(fig.wall))
      fact('facts.focus', fmtMs(fig.focus))
      if (tokens && typeof tokens.uncachedInput === 'number') {
        fact('facts.tokensIn', fmtNum(tokens.uncachedInput))
        fact('facts.tokensOut', fmtNum(tokens.output))
        fact('facts.tokensCache', fmtNum(tokens.cacheRead) + ' / ' + fmtNum(tokens.cacheWrite))
      }
      const muted = (text) => h('div', { className: 'aXa_db_muted' }, text)
      const grid = facts.length ? h('div', { className: 'aXa_db_facts', 'data-arxa-dashboard-facts': '' }, facts) : null
      let body = null
      if (err) body = muted(t('state.error', { error: err }))
      else if (!sum) body = muted(t('state.loading'))
      else if (sum.reason === 'no-conversation') body = h(React.Fragment, null, muted(t('sessions.noConversation')), grid)
      else if (sum.reason === 'no-projection') body = h(React.Fragment, null, muted(t('sessions.noProjection')), grid)
      else if (!grid) body = muted(t('facts.none'))
      else body = grid
      return h('div', { className: 'aXa_db_summary', 'data-arxa-dashboard-summary': row.id },
        h('div', { className: 'aXa_db_sessionHead' }, h('span', { className: 'aXa_db_sessionName', title: row.name }, row.name)),
        body,
        h('div', { className: 'aXa_db_summaryFoot' },
          h('span', null, ''),
          h('span', { style: { display: 'flex', gap: 8 } },
            h('button', { type: 'button', className: 'aXa_db_btn aXa_db_btnSmall', onClick: onClose }, t('sessions.close')),
            h('button', { type: 'button', className: 'aXa_db_btn aXa_db_btnSmall aXa_db_btnPrimary', disabled: !!row.sample, title: row.sample ? t('sessions.sampleOpen') : undefined, 'data-arxa-dashboard-open': row.id, onClick: () => { if (!row.sample) onOpen() } }, t('sessions.open')),
          ),
        ),
      )
    }

    /** Locale date for the header stamp — the registry writes ISO on creation
      * and a ms number after any annotation, so read both. */
    const fmtDate = (v) => {
      const ts = typeof v === 'number' ? v : Date.parse(v || '')
      return Number.isFinite(ts) ? new Date(ts).toLocaleDateString() : ''
    }
    /** LOCAL `YYYY-MM-DD` n days back — the same key shape the host's `ymd()`
      * writes into the activity days map (lib/repo.js), so a UTC round trip
      * never shifts a cell by a day. */
    const dayBack = (n) => {
      const d = new Date()
      d.setDate(d.getDate() - n)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }
    /** Key/value fact grid — absent values are dropped, never rendered as zero. */
    const factsGrid = (items, attrs) => h('div', { className: 'aXa_db_facts', ...attrs }, items.flatMap(([key, val], i) => (val === null || val === undefined || val === '' ? [] : [
      h('div', { key: 'k' + i, className: 'aXa_db_factKey' }, t(key)),
      h('div', { key: 'v' + i, className: 'aXa_db_factVal', title: typeof val === 'string' ? val : undefined }, val),
    ])))

    function ActivityBody({ a }) {
      if (!a) return h('div', { className: 'aXa_db_muted' }, t('state.loading'))
      if (a.reason) return h('div', { className: 'aXa_db_muted' }, t('activity.unavailable'))
      const byDay = {}
      for (const d of a.days || []) byDay[d.day] = d.count
      const N = 91
      let max = 0
      for (let i = 0; i < N; i++) max = Math.max(max, byDay[dayBack(i)] || 0)
      const cells = []
      for (let i = 0; i < N; i++) {
        const day = dayBack(N - 1 - i); const n = byDay[day] || 0
        cells.push(h('rect', { key: day, x: Math.floor(i / 7) * 13, y: (i % 7) * 13, width: 11, height: 11, rx: 2, className: n ? 'aXa_db_cell' : 'aXa_db_cellZero', fillOpacity: n ? 0.3 + 0.7 * (n / max) : undefined, 'data-arxa-dashboard-day': day },
          h('title', null, t('activity.cell', { day, n }))))
      }
      const weeks = Array.isArray(a.weeks) ? a.weeks : []
      const wmax = Math.max(1, ...weeks)
      // The reference's area line over the SAME weekly series the bars drew
      // (Q9) — smoothed through the midpoints, so no data point is invented
      // and no control point wanders off the series.
      const W = 169
      const H = 40
      const px = (i) => (weeks.length < 2 ? W / 2 : (i * (W - 6)) / (weeks.length - 1) + 3)
      const py = (n) => H - 3 - Math.round((H - 8) * n / wmax)
      let d = ''
      weeks.forEach((n, i) => {
        const x = px(i); const y = py(n)
        if (!i) { d = 'M' + x + ' ' + y; return }
        const x0 = px(i - 1); const y0 = py(weeks[i - 1]); const mx = (x0 + x) / 2
        d += ' C' + mx + ' ' + y0 + ' ' + mx + ' ' + y + ' ' + x + ' ' + y
      })
      const peak = weeks.length ? weeks.indexOf(Math.max(...weeks)) : -1
      const bars = weeks.length ? [
        h('path', { key: 'a', className: 'aXa_db_area', d: d + ' L' + px(weeks.length - 1) + ' ' + H + ' L' + px(0) + ' ' + H + ' Z' }),
        h('path', { key: 'l', className: 'aXa_db_line', d, 'data-arxa-dashboard-line': String(weeks.length) },
          h('title', null, t('activity.week', { day: dayBack(6), n: weeks[weeks.length - 1] }))),
        // One label pill, on the peak week — the reference's floating tag.
        peak >= 0 && weeks[peak] > 0 ? h('g', { key: 'p', transform: 'translate(' + Math.min(W - 34, Math.max(0, px(peak) - 17)) + ' ' + Math.max(0, py(weeks[peak]) - 14) + ')' },
          h('rect', { className: 'aXa_db_peak', width: 34, height: 12, rx: 6 },
            h('title', null, t('activity.week', { day: dayBack((weeks.length - 1 - peak) * 7 + 6), n: weeks[peak] }))),
          h('text', { className: 'aXa_db_peakText', x: 17, y: 8.5, textAnchor: 'middle' }, fmtNum(weeks[peak]))) : null,
      ].filter(Boolean) : []
      // Delta vs the PREVIOUS equal window (Q9). No previous window (range
      // "all"), or a previous window with no commits to divide by, reads "—".
      const prev = typeof a.prevCommits === 'number' ? a.prevCommits : null
      const pct = prev !== null && prev > 0 ? Math.round(100 * (a.commits - prev) / prev) : null
      const delta = pct === null ? null : h('span', {
        className: 'aXa_db_delta' + (pct > 0 ? ' aXa_db_deltaUp' : ''),
        title: t('activity.vsPrev', { n: a.since || '' }),
        'data-arxa-dashboard-delta': String(pct),
      }, (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '· ') + Math.abs(pct) + '%')
      // The fill beside the charts (operator, 2026-09-11): two fixed-169px SVGs
      // left a dead band in a span-5 card. Weekday totals ride the SAME days[]
      // the heatmap drew — no new fetch, no invented points.
      const wdTotals = new Array(7).fill(0)
      for (const d of a.days || []) wdTotals[(new Date(d.day + 'T00:00:00').getDay() + 6) % 7] += d.count
      const WD = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
      const wdMax = Math.max(1, ...wdTotals)
      const best = wdTotals.indexOf(Math.max(...wdTotals))
      const wdBar = (k) => { const n = wdTotals[WD.indexOf(k)]; const bh = Math.max(4, Math.round(98 * n / wdMax)); return h('rect', { key: k, x: WD.indexOf(k) * 22 + 6, y: 108 - bh, width: 12, height: bh, rx: 2, className: 'aXa_db_cell', fillOpacity: n === 0 ? 0.12 : WD.indexOf(k) === best ? 1 : 0.55 }, h('title', null, t('activity.wdCell', { day: t('activity.wd.' + k), n }))) }
      const strip = a.commits ? h('svg', { className: 'aXa_db_chart aXa_db_wd', viewBox: '0 0 154 120', preserveAspectRatio: 'xMidYMax meet', role: 'img', 'data-arxa-dashboard-weekday': WD[best] },
        WD.map(wdBar),
        WD.map((k) => h('text', { key: 'l' + k, x: WD.indexOf(k) * 22 + 12, y: 118, textAnchor: 'middle', className: 'aXa_db_wdLabel' }, t('activity.wd.' + k)))) : null
      const activeDays = (a.days || []).length
      const rangeN = parseInt(a.since, 10)
      const activeVal = Number.isFinite(rangeN) && rangeN > 0 ? activeDays + ' / ' + rangeN : String(activeDays)
      const fmtK = (n) => n >= 1000 ? (Math.round(n / 100) / 10) + 'k' : fmtNum(n)
      const num = (key, val) => h('div', { className: 'aXa_db_num' }, h('div', { className: 'aXa_db_numVal' }, val), h('div', { className: 'aXa_db_numKey' }, t(key)))
      return h(React.Fragment, null,
        h('div', { className: 'aXa_db_nums' }, num('activity.current', t('activity.days', { n: a.current })), num('activity.longest', t('activity.days', { n: a.longest })), num('activity.commits', delta ? h(React.Fragment, null, fmtNum(a.commits), ' ', delta) : fmtNum(a.commits)), num('activity.active', activeVal)),
        h('div', { className: 'aXa_db_chartRow' },
          h('div', { className: 'aXa_db_chartCol' },
            h('svg', { className: 'aXa_db_chart', viewBox: '0 0 169 91', width: 169, height: 91, role: 'img', 'data-arxa-dashboard-heatmap': '' }, cells),
            weeks.length ? h('svg', { className: 'aXa_db_chart', viewBox: '0 0 169 40', width: 169, height: 40, role: 'img', 'data-arxa-dashboard-bars': '' }, bars) : null),
          strip ? h('div', { className: 'aXa_db_wdWrap' }, strip,
            h('div', { className: 'aXa_db_meta', 'data-arxa-dashboard-busiest': WD[best] }, t('activity.busiest', { day: t('activity.wd.' + WD[best]), n: wdTotals[best] }))) : null),
        a.commits === 0 ? h('div', { className: 'aXa_db_muted' }, t('activity.none')) : null,
        a.churn ? h('div', { className: 'aXa_db_meta', 'data-arxa-dashboard-churn': '' }, t('activity.churn', { a: fmtK(a.churn.added), r: fmtK(a.churn.removed) })) : null,
      )
    }
    /** Delivery (step 5, D4/D7) — GitHub through github-link, per-user and
      * local-first. The card never blocks: unlinked, relink-needed and
      * local-only repos each say so, and a repo whose runs could not be read
      * shows an em dash, never a zero (absent unit ⇒ null).
      *
      * ponytail: CI state + workflow success rate only. Pull requests belong
      * to the git card, which already owns the review flow; add a PR figure
      * here when the operator asks for one.
      */
    const CI_CLASS = { green: ' aXa_db_ciGreen', red: ' aXa_db_ciRed', pending: ' aXa_db_ciPending' }
    function DeliveryBody({ d }) {
      if (!d) return h('div', { className: 'aXa_db_muted' }, t('state.loading'))
      if (d.reason) return h('div', { className: 'aXa_db_muted', 'data-arxa-dashboard-delivery': d.reason }, t('delivery.' + d.reason))
      const repos = Array.isArray(d.repos) ? d.repos : []
      const head = h('div', { className: 'aXa_db_nums', 'data-arxa-dashboard-delivery': d.ci || 'none' },
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, d.ci ? t('delivery.ci.' + d.ci) : '\u2014'),
          h('div', { className: 'aXa_db_numKey' }, t('delivery.mainCi'))),
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, d.rate === null || d.rate === undefined ? '\u2014' : d.rate + '%'),
          h('div', { className: 'aXa_db_numKey', title: t('delivery.rateNote') }, t('delivery.rate'))),
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, fmtNum(d.linkedRepos)),
          h('div', { className: 'aXa_db_numKey' }, t('delivery.linked'))))
      const rows = repos.map((r) => h('div', { key: r.name, className: 'aXa_db_repoRow', 'data-arxa-dashboard-repo-row': r.reason || (r.ci && r.ci.state) || 'unknown' },
        h('span', { className: 'aXa_db_ci' + (r.ci && CI_CLASS[r.ci.state] ? CI_CLASS[r.ci.state] : ''), title: r.ci && r.ci.state ? t('delivery.ci.' + r.ci.state) : t('delivery.ci.unknown') }),
        h('span', { className: 'aXa_db_repoName', title: r.owner ? r.owner + '/' + r.repo : r.name }, r.name),
        r.reason
          ? h('span', { className: 'aXa_db_chip' }, t('delivery.' + r.reason))
          : h('span', { className: 'aXa_db_repoVal' }, r.runs && r.runs.rate !== null ? r.runs.rate + '%' : '\u2014'),
        h('span', { className: 'aXa_db_repoVal' }, r.runs && r.runs.lastAt ? fmtAge(r.runs.lastAt) : '\u2014'),
      ))
      return h(React.Fragment, null, head,
        h('div', { className: 'aXa_db_sep' }, rows),
        d.truncated > 0 ? h('div', { className: 'aXa_db_muted' }, t('delivery.truncated', { n: d.truncated })) : null)
    }
    /** Engine (step 6, D5) — the arxa engine's own on-disk state. Nothing here
      * is inferred: a project that never ran the engine says so, and every
      * figure it cannot read is an em dash. A category row has no engine data
      * by construction and states that rather than vanishing — a missing card
      * would leave a hole in the bento.
      *
      * ponytail: the phase FSM, the deploy ledger and structure.json. The
      * gate-run log (pipeline/state/memory/events.jsonl) rotates at 50 MB and
      * needs a bounded tail read; phaseStatus already carries the verdict at
      * phase granularity. Add the log when per-gate history is asked for.
      */
    function EngineBody({ e }) {
      if (!e) return h('div', { className: 'aXa_db_muted' }, t('state.loading'))
      if (e.reason) return h('div', { className: 'aXa_db_muted', 'data-arxa-dashboard-engine': e.reason }, t('engine.' + e.reason))
      const projects = Array.isArray(e.projects) ? e.projects : []
      const head = h('div', { className: 'aXa_db_nums', 'data-arxa-dashboard-engine': e.phase || 'none' },
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, e.phase ? t('engine.phase.' + e.phase) : '\u2014'),
          h('div', { className: 'aXa_db_numKey', title: t('engine.phaseNote') }, t('engine.phaseKey'))),
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, fmtNum(e.withEngine)),
          h('div', { className: 'aXa_db_numKey' }, t('engine.withEngine'))),
        h('div', { className: 'aXa_db_num' },
          h('div', { className: 'aXa_db_numVal' }, e.shipped === null || e.shipped === undefined ? '\u2014' : fmtNum(e.shipped)),
          h('div', { className: 'aXa_db_numKey' }, t('engine.shipped'))))
      const rows = projects.map((p) => h('div', { key: p.name, className: 'aXa_db_repoRow', 'data-arxa-dashboard-engine-row': p.phase || 'unknown' },
        h('span', { className: 'aXa_db_repoName', title: p.targets && p.targets.length ? p.targets.join(', ') : undefined }, p.name),
        h('span', { className: 'aXa_db_chip' }, p.phase ? t('engine.phase.' + p.phase) : t('engine.phase.unknown')),
        h('span', { className: 'aXa_db_repoVal' }, p.step ? t('engine.step', { n: p.step, of: p.steps }) : '\u2014'),
        h('span', { className: 'aXa_db_repoVal', title: t('engine.screensNote') }, p.screens === null ? '\u2014' : t('engine.screens', { n: p.screens })),
        h('span', { className: 'aXa_db_repoVal' }, p.updatedAt ? fmtAge(p.updatedAt) : '\u2014'),
      ))
      return h(React.Fragment, null, head,
        h('div', { className: 'aXa_db_sep' }, rows),
        e.scanned > e.withEngine ? h('div', { className: 'aXa_db_muted' }, t('engine.someMissing', { n: e.scanned - e.withEngine })) : null)
    }
    function RepositoryBody({ r }) {
      if (!r) return h('div', { className: 'aXa_db_muted' }, t('state.loading'))
      if (r.reason) return h('div', { className: 'aXa_db_muted' }, t('activity.unavailable'))
      const d = r.dirty || {}
      const dirty = [['repo.modified', d.modified], ['repo.added', d.added], ['repo.deleted', d.deleted], ['repo.untracked', d.untracked]].filter((x) => x[1] > 0).map(([k, n]) => t(k, { n })).join(' · ')
      const lc = r.lastCommit
      return factsGrid([
        ['repo.files', fmtNum(r.files)], ['repo.folders', fmtNum(r.folders)], ['repo.branches', fmtNum(r.branches)], ['repo.contributors', fmtNum(r.contributors)],
        ['repo.lastCommit', lc ? clip(lc.subject, 44) + ' · ' + lc.author + ' · ' + fmtAge(lc.at) : null],
        ['repo.dirty', dirty || t('repo.clean')],
        ['repo.repos', r.repos > 1 ? String(r.repos) : null],
      ], { 'data-arxa-dashboard-repo': '' })
    }

    /** Sessions card head (D6/D10): the open / parked / archived donut and the
      * row's three tier-2 totals. Circumference 100 ⇒ one dash pair is a percent. */
    /** The rail (§14, operator addition): ONE scroller, three consumers —
      * the nav-pill overflow, the session hand, and any card whose content
      * outgrows its bento height. Content slides instead of growing the card
      * or being truncated, so the grid keeps its shape at every width.
      * `overscroll-behavior-x:contain` is load-bearing, not polish: without it
      * a two-finger horizontal scroll on a trackpad chains out of the rail and
      * fires the shell's own back-navigation (MDN: `contain` disables it). */
    const Rail = ({ axis, hook, label, extra, onKeyDown, children }) => h('div', {
      className: 'aXa_db_rail ' + (axis === 'y' ? 'aXa_db_railY' : 'aXa_db_railX') + (extra ? ' ' + extra : ''),
      tabIndex: 0, role: 'group', 'aria-label': label || undefined,
      'data-arxa-dashboard-rail': hook || (axis === 'y' ? 'y' : 'x'),
      onKeyDown,
    }, children)

    /** One bento card (§14 Q4). `span` is a 12-column class, not a number of
      * pixels: every rung sums to exactly 12, so resizing never opens a hole.
      * `scroll` picks the rail axis for the body ('x' | 'y' | undefined). */
    function Card({ span, title, count, live, scroll, hook, children }) {
      const body = scroll === 'x' || scroll === 'y'
        ? h(Rail, { axis: scroll, hook: hook ? hook + ':' + scroll : scroll, label: title }, children)
        : children
      return h('div', {
        className: 'aXa_db_bentoCard aXa_db_span' + span + (live ? ' aXa_db_bentoCardLive' : ''),
        'data-arxa-dashboard-group': hook || undefined,
        'data-arxa-dashboard-span': String(span),
      },
        title ? h('div', { className: 'aXa_db_cardTitle' }, title,
          count === null || count === undefined ? null : h('span', { className: 'aXa_db_count' }, String(count))) : null,
        h('div', { className: 'aXa_db_bentoBody' }, body))
    }

    /** In-org dashboard navigation (§14 Q3): the org plus its five fixed
      * docks. A project selection lights `Projects` — that list is unbounded,
      * so the sidebar keeps owning it. The bridge refuses a selection it does
      * not recognise, so a stale pill cannot strand the hero. */
    function NavPills({ sel }) {
      const bridge = typeof window !== 'undefined' ? window.__ARXA_SIDEBAR__ : undefined
      const rows = bridge && typeof bridge.orgRows === 'function' ? bridge.orgRows(sel.orgId) : []
      if (!Array.isArray(rows) || rows.length < 2) return null
      const active = String(sel.rowId || '').split('/')[0]
      return h('div', { className: 'aXa_db_nav', 'data-arxa-dashboard-nav': String(rows.length) },
        h(Rail, { axis: 'x', hook: 'nav', label: t('nav.label') }, rows.map((r) => h('button', {
          key: r.rowId || 'org',
          type: 'button',
          className: 'aXa_db_navPill' + (r.rowId === active ? ' aXa_db_navPillOn' : ''),
          'aria-current': r.rowId === active ? 'page' : undefined,
          onClick: () => { if (bridge && typeof bridge.selectRow === 'function') bridge.selectRow({ orgId: sel.orgId, rowId: r.rowId, kind: r.kind, label: r.label }) },
        }, r.label))))
    }

    /** The Sessions band header (§14 Q6): three small integers as CHIPS, not a
      * chart — the donut that used to live here was decoration sitting in the
      * slot the durations needed. Row totals stay. */
    /** The head counts double as the filter (step 7): clicking a state chip is
      * the drill-down into that state, clicking it again clears it. Counts are
      * always of ALL the row's sessions, so a filtered view still tells you how
      * many you are not looking at. */
    function SessionsHead({ rows, state, onState }) {
      const counts = { open: 0, parked: 0, archived: 0 }
      for (const r of rows) if (counts[r.state] !== undefined) counts[r.state] += 1
      const total = counts.open + counts.parked + counts.archived
      const figs = rows.map(figuresOf)
      const sum = (k) => figs.reduce((n, f) => n + (f[k] || 0), 0)
      const some = (k) => figs.some((f) => typeof f[k] === 'number' && f[k] > 0)
      const chips = ['open', 'parked', 'archived'].filter((k) => counts[k] > 0).map((k) => h('button', {
        key: k, type: 'button', className: 'aXa_db_chip aXa_db_chipBtn' + (state === k ? ' aXa_db_chipOn' : ''),
        'aria-pressed': state === k ? 'true' : 'false',
        'data-arxa-dashboard-filter': k,
        title: t('sessions.filterNote'),
        onClick: () => onState(state === k ? null : k),
      }, t('sessions.state.' + k) + ' ' + counts[k]))
      const num = (key, val) => (val ? h('div', { key, className: 'aXa_db_num' }, h('div', { className: 'aXa_db_numVal' }, val), h('div', { className: 'aXa_db_numKey' }, t(key))) : null)
      const nums = [num('sessions.totalTokens', some('tokens') ? fmtNum(sum('tokens')) : null), num('sessions.totalEngine', fmtMs(sum('engine'))), num('sessions.totalFocus', fmtMs(sum('focus')))].filter(Boolean)
      if (!total && !nums.length) return null
      return h(React.Fragment, null,
        chips.length ? h('div', { className: 'aXa_db_chips', 'data-arxa-dashboard-states': String(total) }, chips) : null,
        nums.length ? h('div', { className: 'aXa_db_nums', 'data-arxa-dashboard-totals': '' }, nums) : null,
      )
    }

    /** Time (§14 Q6) — the reference's gauge, over the one composition that is
      * actually a composition: engine time = model + tool.
      *
      * The grill said "ring = model / tool / focus". Focus is a DIFFERENT
      * CLOCK: the operator sits with a session while the model runs, so adding
      * focus into the same ring would total two overlapping axes and invent
      * time nobody spent. Focus keeps its own figure under the rule. */
    function TimeBody({ rows }) {
      const figs = (rows || []).map(figuresOf)
      const sum = (k) => figs.reduce((n, f) => n + (f[k] || 0), 0)
      const model = sum('model')
      const tool = sum('tool')
      const focus = sum('focus')
      const engine = model + tool
      if (!engine && !focus) return h('div', { className: 'aXa_db_muted' }, t('time.none'))
      let at = 0
      const arcs = [['model', model], ['tool', tool]].map(([k, v], i) => {
        const pct = engine ? 100 * v / engine : 0
        const off = 25 - at
        at += pct
        if (!pct) return null
        return h('circle', { key: k, className: 'aXa_db_arc', cx: 21, cy: 21, r: 15.915, strokeWidth: 6, strokeOpacity: i ? 0.45 : 1, strokeDasharray: pct.toFixed(2) + ' ' + (100 - pct).toFixed(2), strokeDashoffset: off },
          h('title', null, t(i ? 'facts.tool' : 'facts.model') + ' ' + fmtMs(v)))
      }).filter(Boolean)
      const legend = [['facts.model', model, 1], ['facts.tool', tool, 0.45]].filter(([, v]) => v > 0).flatMap(([key, v, op], i) => [
        h('span', { key: 'd' + i, className: 'aXa_db_dot', style: { opacity: op } }),
        h('span', { key: 'k' + i }, t(key)),
        h('span', { key: 'v' + i, className: 'aXa_db_legendVal' }, fmtMs(v)),
      ])
      return h(React.Fragment, null,
        engine ? h('div', { className: 'aXa_db_gauge', 'data-arxa-dashboard-donut': String(engine) },
          h('svg', { viewBox: '0 0 42 42', width: 96, height: 96, role: 'img' }, arcs),
          h('div', { className: 'aXa_db_gaugeMid' },
            h('div', { className: 'aXa_db_gaugeVal' }, fmtMs(engine)))) : null,
        engine ? h('div', { className: 'aXa_db_gaugeKey' }, t('sessions.totalEngine')) : null,
        legend.length ? h('div', { className: 'aXa_db_legendRow' }, legend) : null,
        focus ? h('div', { className: engine ? 'aXa_db_sep' : '', 'data-arxa-dashboard-focus': String(focus) },
          h('div', { className: 'aXa_db_numVal' }, fmtMs(focus)),
          h('div', { className: 'aXa_db_numKey', title: t('time.focusNote') }, t('sessions.totalFocus'))) : null,
      )
    }


    function Root({ selection }) {
      const sel = selection || {}
      const [tick, setTick] = React.useState(0)
      const [range, setRange] = React.useState(90)
      const [row, setRow] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [sessions, setSessions] = React.useState(null)
      const [delivery, setDelivery] = React.useState(null)
      const [engine, setEngine] = React.useState(null)
      const [openId, setOpenId] = React.useState(null)
      const [stateFilter, setStateFilter] = React.useState(null)
      // D7: the refresh button — and only it — bypasses the host's 60 s
      // GitHub cache. Selecting another row still reads the cache.
      const freshRef = React.useRef(false)
      const alive = React.useRef(true)
      React.useEffect(() => () => { alive.current = false }, [])
      React.useEffect(() => {
        let cancelled = false
        setError(null)
        const arg = { orgId: sel.orgId, rowId: sel.rowId || '' }
        setRow((cur) => (cur ? { ...cur, activity: null, repository: null } : cur))
        postAction(ROUTE, 'row.stats', { ...arg, range })
          .then((r) => { if (!cancelled && alive.current) setRow(r) })
          .catch((e) => { if (!cancelled && alive.current) setError(String(e && e.code || e)) })
        postAction(ROUTE, 'row.sessions', arg)
          .then((r) => { if (!cancelled && alive.current) setSessions(r) })
          .catch((e) => { if (!cancelled && alive.current) setSessions({ reason: String(e && e.code || e), rows: [] }) })
        // Delivery is its own request: a slow or rate-limited GitHub must never
        // hold up the local tier-1 figures beside it.
        const fresh = freshRef.current
        freshRef.current = false
        setDelivery(null)
        postAction(ROUTE, 'row.delivery', { ...arg, fresh })
          .then((r) => { if (!cancelled && alive.current) setDelivery(r) })
          .catch((e) => { if (!cancelled && alive.current) setDelivery({ reason: 'unavailable', detail: String(e && e.code || e) }) })
        setStateFilter(null)
        setOpenId(null)
        setEngine(null)
        postAction(ROUTE, 'row.engine', arg)
          .then((r) => { if (!cancelled && alive.current) setEngine(r) })
          .catch(() => { if (!cancelled && alive.current) setEngine({ reason: 'not-set-up', projects: [] }) })
        return () => { cancelled = true }
      }, [sel.orgId, sel.rowId, tick, range])
      // Re-render when the sidebar re-emits (selection / CTA levers / row
      // changes), same tick the shell CTA uses.
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        const on = () => bump((n) => n + 1)
        window.addEventListener('arxa-sidebar-state', on)
        return () => window.removeEventListener('arxa-sidebar-state', on)
      }, [])

      const bridge = typeof window !== 'undefined' ? window.__ARXA_SIDEBAR__ : undefined
      const isOrg = !sel.rowId
      const ctaReady = !isOrg && !!bridge && bridge.ctaReady === true
      const ctaTitle = !isOrg && bridge ? bridge.ctaTitle : undefined
      const rowLabel = sel.label || (row && row.name) || sel.rowId || ''
      const notice = (code) => window.dispatchEvent(new CustomEvent('arxa-sidebar-notice', { detail: { code: String(code) } }))
      const onNewSession = () => {
        if (!ctaReady) return
        fetch(SIDEBAR_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'workspace.new-session', arg: { orgId: sel.orgId, workspace: sel.rowId } }) })
          .then((r) => r.json()).then((b) => {
            if (!b || !b.ok) { notice((b && b.error) || 'unknown'); return }
            if (b.result && b.result.id && bridge && typeof bridge.openCreated === 'function') bridge.openCreated(sel.orgId, b.result.id)
          }).catch((e) => notice((e && e.message) || e))
      }
      /** Open = the sidebar's own flow (server session.open → reveal → focus). */
      const openSession = (id) => {
        if (bridge && typeof bridge.openCreated === 'function') bridge.openCreated(sel.orgId, id)
        else notice('sidebar-not-ready')
      }

      const realRows = sessions && Array.isArray(sessions.rows) ? sessions.rows : []
      const showSamples = !!sessions && !sessions.reason && realRows.length === 0
      const rows = showSamples ? sampleRows() : realRows
      // The head counts every session; only the carousel is filtered (step 7).
      const shown = stateFilter ? rows.filter((x) => x.state === stateFilter) : rows
      const head = rows.length ? h(SessionsHead, { rows, state: stateFilter, onState: setStateFilter }) : null
      const selected = shown.find((x) => x.id === openId) || null
      // The hand (Q5) + the panel beneath it (Q7). One panel, one open card.
      const cards = h(React.Fragment, null,
        h(Rail, {
          axis: 'x', hook: 'hand', extra: 'aXa_db_hand', label: t('group.sessions'),
          // Step 7 keyboard order: the rail is one tab stop, arrows walk the
          // cards inside it (the standard carousel pattern), Escape closes the
          // open summary. Home/End jump to the ends.
          onKeyDown: (ev) => {
            const step = { ArrowRight: 1, ArrowLeft: -1 }[ev.key]
            if (ev.key === 'Escape') { if (openId) { setOpenId(null); ev.preventDefault() } return }
            if (!step && ev.key !== 'Home' && ev.key !== 'End') return
            const els = [...ev.currentTarget.querySelectorAll('[data-arxa-dashboard-session]')]
            if (!els.length) return
            const at = els.indexOf(document.activeElement)
            const next = ev.key === 'Home' ? 0 : ev.key === 'End' ? els.length - 1 : Math.min(els.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))
            els[next].focus()
            ev.preventDefault()
          },
        },
          shown.map((s) => h(SessionCard, {
            key: s.id, row: s, selected: openId === s.id,
            onSelect: () => setOpenId((cur) => (cur === s.id ? null : s.id)),
          }))),
        stateFilter && !shown.length ? h('div', { className: 'aXa_db_muted' }, t('sessions.noneInState', { state: t('sessions.state.' + stateFilter) })) : null,
        h('div', { className: 'aXa_db_panel' + (selected ? ' aXa_db_panelOpen' : ''), 'data-arxa-dashboard-panel': selected ? selected.id : '' },
          h('div', { className: 'aXa_db_panelIn' }, selected ? h(SessionPanel, {
            key: selected.id, orgId: sel.orgId, row: selected,
            onClose: () => setOpenId(null), onOpen: () => openSession(selected.id),
          }) : null)),
      )
      const sessionsBody = !sessions
        ? h('div', { className: 'aXa_db_muted' }, t('state.loading'))
        : sessions.reason
          ? h('div', { className: 'aXa_db_muted' }, t('sessions.unavailable'))
          : showSamples
            ? h(React.Fragment, null, h('div', { className: 'aXa_db_muted' }, t('sessions.none')), h('div', { className: 'aXa_db_sampleNote', 'data-arxa-dashboard-samples': '' }, t('sessions.sampleNote')), head, cards)
            : h(React.Fragment, null, head, cards)

      return h('div', { className: 'aXa_db_root', 'data-arxa-dashboard-root': sel.kind || 'org' },
        h(NavPills, { sel }),
        h('div', { className: 'aXa_db_hero' },
          h('div', { className: 'aXa_db_title' },
            h('div', { className: 'aXa_db_kind' }, t(KIND_LABEL[sel.kind] || 'kind.org') + (isOrg || !sel.orgName ? '' : ' · ' + sel.orgName)),
            h('div', { className: 'aXa_db_heroName', title: rowLabel, 'data-arxa-dashboard-name': '' }, rowLabel),
            h('div', { className: 'aXa_db_path' }, error ? t('state.error', { error }) : row ? (row.exists ? row.path : t('state.missing')) : t('state.loading')),
            row && (row.createdAt || row.updatedAt) ? h('div', { className: 'aXa_db_meta', 'data-arxa-dashboard-times': '' }, [row.createdAt ? t('head.created', { v: fmtDate(row.createdAt) }) : null, row.updatedAt ? t('head.updated', { v: fmtAge(row.updatedAt) }) : null].filter(Boolean).join(' · ')) : null,
          ),
          isOrg ? null : h('button', { type: 'button', className: 'aXa_db_btn aXa_db_btnPrimary aXa_db_heroCta', disabled: !ctaReady, title: ctaTitle, onClick: onNewSession, 'data-arxa-dashboard-cta': '' }, t('cta.newSession', { row: rowLabel })),
        ),
        h('div', { className: 'aXa_db_bar' },
          h('div', { className: 'aXa_db_range', role: 'group', 'aria-label': t('range.label'), 'data-arxa-dashboard-range': String(range) },
            [30, 90, 365, 'all'].map((r) => h('button', { key: r, type: 'button', className: 'aXa_db_btn', 'aria-pressed': range === r ? 'true' : 'false', onClick: () => setRange(r) }, t('range.' + r)))),
          h('button', { type: 'button', className: 'aXa_db_btn', onClick: () => { freshRef.current = true; setTick((n) => n + 1) }, 'aria-label': t('cta.refresh'), title: t('cta.refresh') }, t('cta.refresh')),
        ),
        h('div', { className: 'aXa_db_bento' },
          h(Card, { span: '12', hook: 'sessions', title: t('group.sessions'), count: sessions && !sessions.reason ? realRows.length : null }, sessionsBody),
          h(Card, { span: '5', hook: 'activity', title: t('group.activity') }, h(ActivityBody, { a: error ? { reason: error } : row && row.activity })),
          // The repository card is the y-rail case: a long fact list slides
          // inside a card that keeps its grid height.
          h(Card, { span: '4', hook: 'repository', title: t('group.repository'), scroll: 'y' }, h(RepositoryBody, { r: error ? { reason: error } : row && row.repository })),
          h(Card, { span: '3', hook: 'time', title: t('group.time'), live: rows.some((x) => x.running) }, h(TimeBody, { rows })),
          h(Card, { span: '6', hook: 'delivery', title: t('group.delivery'), scroll: 'y' }, h(DeliveryBody, { d: delivery })),
          h(Card, { span: '6Wide', hook: 'engine', title: t('group.engine'), scroll: 'y' }, h(EngineBody, { e: engine })),
        ),
      )
    }

    /** Focus time (D10) — the one figure dsh cannot know: how long the operator
      * actually sat with a session. The dashboard is never on screen while a
      * session IS bound, so the heartbeat lives out here, beside Root, and asks
      * the sidebar bridge what the content area is showing.
      *
      * No timer of our own and none needed: the sidebar emits
      * `arxa-sidebar-state` on every store tick (~5 s) — that is the clock —
      * and `visibilitychange` closes the slice the moment the window hides. A
      * slice over FOCUS_MAX_MS is a slept machine, dropped rather than posted
      * (the host refuses it anyway).
      * ponytail: wall-clock attention, not eye tracking — a visible window
      * behind another app still counts; add idle detection when it matters. */
    const FOCUS_SLICE_MS = 30000
    const FOCUS_MAX_MS = 120000
    function startFocus() {
      let mark = null
      const bound = () => {
        const b = typeof window !== 'undefined' ? window.__ARXA_SIDEBAR__ : undefined
        const s = b && typeof b.boundSession === 'function' ? b.boundSession() : null
        return s && typeof s.orgId === 'string' && typeof s.sessionId === 'string' ? s : null
      }
      const close = () => {
        if (!mark) return
        const ms = Date.now() - mark.at
        const was = mark
        mark = null
        if (ms < 1000 || ms > FOCUS_MAX_MS) return
        postAction(ROUTE, 'session.focus', { orgId: was.orgId, sessionId: was.sessionId, deltaMs: ms }).catch(() => {})
      }
      const sample = () => {
        const b = typeof document !== 'undefined' && document.visibilityState === 'visible' ? bound() : null
        if (mark && (!b || b.sessionId !== mark.sessionId || Date.now() - mark.at >= FOCUS_SLICE_MS)) close()
        if (b && !mark) mark = { orgId: b.orgId, sessionId: b.sessionId, at: Date.now() }
      }
      window.addEventListener('arxa-sidebar-state', sample)
      document.addEventListener('visibilitychange', sample)
      sample()
      return () => {
        window.removeEventListener('arxa-sidebar-state', sample)
        document.removeEventListener('visibilitychange', sample)
        close()
      }
    }

    function apply(ctx) {
      ctx.effect(() => ensureCss() || (() => {}), 'arxa-dashboard: css')
      try { ctx.locale.register(NS, { en, pl, fr }); localeService = ctx.locale } catch { localeService = null }
      ctx.effect(() => {
        window.__ARXA_DASHBOARD__ = { Root, version: 3 }
        window.dispatchEvent(new Event('arxa-dashboard-ready'))
        return () => {
          if (window.__ARXA_DASHBOARD__ && window.__ARXA_DASHBOARD__.Root === Root) delete window.__ARXA_DASHBOARD__
          window.dispatchEvent(new Event('arxa-dashboard-ready'))
        }
      }, 'arxa-dashboard: root seam')
      ctx.effect(() => startFocus(), 'arxa-dashboard: focus heartbeat')
    }

    exports.name = NS
    exports.inject = ['locale']
    exports.apply = apply
    exports.Root = Root
    return module.exports
  },
})
