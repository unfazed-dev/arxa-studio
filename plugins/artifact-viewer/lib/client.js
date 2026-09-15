// Browser half of arxa-artifact-viewer — DSH plugin-UI conformance rebuild
// (docs/plans/dsh-plugin-ui-conformance.md, Phase 1, grilled 2026-09-02).
// Hand-written __ModuleLoader__ bundle (the documented no-build style —
// dsh-cordis-client-runner), fully on the contract: primitives, --dsw-*
// tokens, locale NS (en/pl/fr), every side effect inside ctx.effect.
//
// 0.6.0 (grilled 2026-09-15, "own the column"): the tabbed viewer OCCUPIES
// the frame's rightbar grid track — a React portal into [data-rightbar-col].
// The stock frame (dsh-client-ui-layout) owns the column geometry and its
// drag handle; we own the content: a tab strip (multi-file, persisted per
// org in localStorage), the stock document header replica (path, renderer
// dropdown over dsh primitives Menu — MarkdownText is dsh's exact markdown
// renderer imported from dsh-client-ui-primitives — wrap toggle, reload),
// fullscreen/collapse strip-end controls, and a session-less edge chip as
// the way back in while collapsed. EVERY file open (dashboard or
// conversation) lands in the strip — no openResource routing, no jumps, no
// sheet overlay (the 0.5.x sheet is deleted). While the strip holds tabs
// the column carries data-arxa-owns and the stock sidebar-right surface is
// CSS-hidden (rule A of the grill: the right column IS this viewer); close
// the last tab and the stock surface returns. The documentPreviews EDITOR
// renderer stays registered so the stock document tab still renders files
// editable in the not-owning lane.
//
// Claude-window model (support.claude.com article 9487310):
//   * auto-open: the FIRST produced file of a turn opens a tab by itself.
//   * automatic edit: markdown is rendered-primary (MarkdownText) with the
//     renderer dropdown as the source toggle; code/text open directly
//     editable; the session ensure runs at OPEN time (D80); guards (no org,
//     >cap, binary) make a lane view-only with the reason shown.
//   * auto-save: debounced ~1.5 s through POST /__arxa/artifacts/write; no
//     edit/save buttons; one StateDot carries clean/dirty/saving/conflict;
//     the 409/D86 external-change flow offers reload-theirs / overwrite.
//
// Runtime: store-based ingress — apply() owns ONE ctx.effect listener for
// the public 'arxa-av-open' window event, parks the payload in a store the
// ViewerShell consumes (no retry ladder, no __ARXA_AV_PENDING__, no 4 s
// session poll — session tracking subscribes the dsh sessions service
// snapshot store).cribes the dsh sessions service
// snapshot store).
window.__ModuleLoader__.load({
  id: 'arxa-artifact-viewer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const P = require('@deepseek-ai/dsh-client-ui-primitives')
    // Sheet fallback host comment retired with the sheet (0.6.0): the shell
    // mounts a second React root (portaled into the rightbar column) and
    // still needs the client API.
    const ReactDOM = require('react-dom')
    const ReactDOMClient = require('react-dom/client')

    const TOKEN_ROUTE = '/__arxa/artifacts/token'
    const WRITE_ROUTE = '/__arxa/artifacts/write'
    const STATE_ROUTE = '/__arxa/sidebar/state'
    const ACTION_ROUTE = '/__arxa/sidebar/action'
    // insight.* live in the arxa-git-card host (docs/plans/git-card-stock-dock-rebuild.md A2)
    const CARD_ROUTE = '/__arxa/git-card/action'
    const SIDEBAR_ROUTE = '/__arxa/sidebar/action'
    const EVENTS_ROUTE = '/__arxa/artifacts/events'
    const ROOTS_ROUTE = '/__arxa/artifacts/roots'
    const WT_ROUTE = '/__arxa/artifacts/wt'
    const VENDOR = (n) => '/__arxa/artifacts/vendor/' + n
    const LSP_ROUTE = '/__arxa/artifacts/lsp'
    const TRACE_ROUTE = '/__arxa/artifacts/trace'

    /** Where a click's time goes, one engine-log line per open (2026-09-07).
     *  The harness measures a first open at ~0.5s and the user sees seconds;
     *  the phases here are the ones the harness cannot see: the click reaching
     *  the panel, the routes, the bundle import, the boot, the paint. Marks
     *  are relative to the click; the line is posted when the editor paints
     *  or the open fails. Best effort: never blocks or throws. */
    const trace = (() => {
      let cur = null
      const now = () => Math.round(performance.now())
      return {
        /** t0 is the CLICK (the ingress listener stamps it into the store
         *  payload); the panel may not even be mounted yet at that point. */
        begin (relPath, t0 = now(), mounted = true) {
          cur = { relPath, t0, marks: [], bundleWarm: !!monacoMod }
          if (!mounted) cur.marks.push('panel-mounted=' + (now() - t0))
        },
        mark (name) { if (cur) cur.marks.push(name + '=' + (now() - cur.t0)) },
        end (outcome) {
          if (!cur) return
          const line = { relPath: cur.relPath, outcome, totalMs: now() - cur.t0, bundleWarm: cur.bundleWarm, marks: cur.marks.join(' ') }
          cur = null
          try { void fetch(TRACE_ROUTE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(line), keepalive: true }) } catch {}
        },
      }
    })()
    // Mirrors LANG_SERVERS in lib/lsp.js. Only languages with a server that has
    // actually been RUN — an entry here for a server the host cannot start just
    // buys a socket that closes 4004.
    const LSP_LANGS = {
      '.rs': 'rust', '.dart': 'dart',
      '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
      '.js': 'typescript', '.jsx': 'typescript', '.mjs': 'typescript', '.cjs': 'typescript',
      '.html': 'html', '.htm': 'html',
      '.css': 'css', '.scss': 'css', '.less': 'css',
      '.json': 'json', '.jsonc': 'json',
    }
    /** The monaco language ids each server owns. One server, several ids:
     *  typescript-language-server serves javascript too, the css server serves
     *  scss and less, the json server serves jsonc. */
    const LSP_SELECTORS = {
      typescript: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
      css: ['css', 'scss', 'less'],
      json: ['json', 'jsonc'],
    }
    /** What the Install strip calls each language, and what to say when arxa
     *  cannot fetch it. dart and rust ship inside a toolchain — offering a
     *  download for either would be a lie. */
    const LSP_NAMES = {
      rust: 'Rust', dart: 'Dart', typescript: 'TypeScript', html: 'HTML', css: 'CSS', json: 'JSON',
    }
    const EDITABLE_LANES = new Set(['markdown', 'code', 'text'])
    const AUTOSAVE_MS = 1500
    const NS = 'arxa-artifact-viewer'

    const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss',
      '.py', '.rb', '.go', '.rs', '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.env', '.json', '.jsonc', '.yaml', '.yml',
      '.dart'])
    const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp'])
    const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a'])
    const VIDEO = new Set(['.mp4', '.webm', '.mov'])

    function kindFor(name) {
      const ext = (name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase()
      if (ext === '.md') return { lane: 'markdown', ext }
      if (IMAGE.has(ext)) return { lane: 'image', ext }
      if (AUDIO.has(ext)) return { lane: 'audio', ext }
      if (VIDEO.has(ext)) return { lane: 'video', ext }
      if (ext === '.html' || ext === '.htm' || ext === '.mdx') return { lane: 'iframe', ext }
      if (ext === '.pdf') return { lane: 'pdf', ext }
      if (CODE.has(ext)) return { lane: 'code', ext, lang: ext.replace('.', '') }
      return { lane: 'text', ext }
    }

    // ---- styles (aXa_av_* — every value from the --dsw-* token vocabulary) --
    const css = ''
      + '.aXa_av_root{display:flex;flex-direction:column;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px}'
      // Column occupant (0.6.0): the rightbar column node (position:relative
      // in the stock frame) hosts our shell; the shell fills it exactly. The
      // ownership rule hides the stock sidebar-right surface while we hold
      // tabs (grill rule A: the right column IS this viewer).
      + '.aXa_av_colHost{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base)}'
      + '[data-rightbar-col][data-arxa-owns] > :not(.aXa_av_colHost){display:none!important}'
      // Tab strip: the strip replaces the 0.5.x capsule row; chips carry the
      // same stock vocabulary the capsule used (border l2, radius 8).
      + '.aXa_av_strip{flex:none;height:35px;display:flex;align-items:center;gap:4px;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;scrollbar-width:none}'
      + '.aXa_av_strip::-webkit-scrollbar{display:none}'
      + '.aXa_av_tab{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 4px 0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;max-width:220px;background:transparent;cursor:pointer;font:inherit;color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_tab:hover{background:var(--dsw-alias-interactive-bg-hover)}'
      + '.aXa_av_tab[data-active]{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_tabTitle{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.aXa_av_tabClose{flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}'
      + '.aXa_av_tabClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_stripEnd{margin-left:auto;display:inline-flex;align-items:center;gap:2px;flex:none}'
      + '.aXa_av_docHead{flex:none;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}'
      + '.aXa_av_docPath{flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left}'
      + '.aXa_av_docDir{color:var(--dsw-alias-label-tertiary)}'
      + '.aXa_av_docName{color:var(--dsw-alias-label-primary);direction:ltr;unicode-bidi:embed}'
      + '.aXa_av_rendererName{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary)}'
      // Renderer dropdown anchor: the stock viewerTool face — a bordered
      // pill whose label IS the active renderer, opening P.Menu.
      + '.aXa_av_tool{flex:none;display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:12px}'
      + '.aXa_av_tool:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_iconBtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}'
      + '.aXa_av_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_iconBtn:disabled{cursor:default;opacity:.5}'
      + '.aXa_av_iconBtn:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary)}'
      // Changed-on-disk banner (stock textpreview face): note + reload-now.
      + '.aXa_av_changed{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;align-items:center;gap:10px;margin:0;padding:6px 10px;font-size:12px;display:flex}'
      + '.aXa_av_changedAction{cursor:pointer;padding:0;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-decoration:underline}'
      // MarkdownText document host: the stock MarkdownBody padding.
      + '.aXa_av_mdDoc{flex:1;min-height:0;overflow:auto;padding:16px}'
      // Session-less way back in while the frame collapses the column: a
      // slim chip pinned to the frame's right edge (stock ExpandButton slot
      // lives in the conversation header — session-bound, not ours to host).
      + '.aXa_av_edgeChip{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:30;width:22px;height:64px;display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:8px 0 0 8px;background:var(--dsw-specific-sidebar-fill);color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}'
      + '.aXa_av_edgeChip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}'
      + '.aXa_av_scroll{flex:1;min-height:0;overflow:auto;padding:10px 12px}'
      + '.aXa_av_idle{flex:1;min-height:0;overflow:auto;padding:16px 12px;display:flex;flex-direction:column;gap:12px}'
      + '.aXa_av_hint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:18px}'
      + '.aXa_av_sectionTitle{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}'
      + '.aXa_av_changeRow{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;padding:6px 8px;border-radius:6px;cursor:pointer;overflow:hidden}'
      + '.aXa_av_changeRow:hover{background:var(--dsw-alias-interactive-bg-hover)}'
      + '.aXa_av_changePath{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.aXa_av_note{margin:8px 12px 0;padding:8px 10px;border-radius:8px;font-size:12px;line-height:17px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_note[data-tone=error]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-error)}'
      + '.aXa_av_note[data-tone=warn]{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label)}'
      + '.aXa_av_conflict{margin:8px 12px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1);display:flex;align-items:center;gap:8px;flex-wrap:wrap}'
      + '.aXa_av_conflictText{flex:1;min-width:140px;font-size:12px;line-height:17px;color:var(--dsw-alias-label-error)}'
      + '.aXa_av_editorWrap{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}'
      // Monaco scrolls itself and sizes to the container; the wrapper's
      // overflow:auto would add a second scrollbar around it.
      + '.aXa_av_monaco{overflow:hidden;display:flex;flex-direction:column}'
      + '.aXa_av_lspHost{flex:1;min-height:0}'
      + '.aXa_av_lspBar{flex:none;display:flex;gap:8px;align-items:center;padding:4px 10px;font-size:12px;'
      + 'border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_lspBar button{font:inherit;cursor:pointer;padding:1px 8px;border-radius:5px;'
      + 'border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}'
      + '.aXa_av_lspBar button[disabled]{opacity:.5;cursor:default}'
      + '.aXa_av_monaco .monaco-editor{height:100%}'
      + '.aXa_av_fileIcon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center}'
      + '.aXa_av_fileIcon svg{width:16px;height:16px;display:block}'
      + '.aXa_av_media{padding:12px;display:flex;justify-content:center}'
      + '.aXa_av_media img{max-width:100%;border-radius:8px;border:1px solid var(--dsw-alias-border-l2)}'
      + '.aXa_av_media audio,.aXa_av_media video{width:100%}'
      + '.aXa_av_iframe{flex:1;min-height:0;width:100%;border:none;border-top:1px solid var(--dsw-alias-border-l2);background:#fff}'
      + '.aXa_av_pdfBar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}'
      + '.aXa_av_pdfPage{font-size:12px;color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_pdfCanvasWrap{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;justify-content:center;align-items:flex-start}'
      + '.aXa_av_pdfCanvas{border:1px solid var(--dsw-alias-border-l2);background:#fff;border-radius:4px}'
      // Insight surface (Phase 4 A3): reports, not files. Four streak steps
      // are token-defined so the grid reads in light AND dark.
      + '.aXa_av_streakGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11px,1fr));gap:3px}'
      + '.aXa_av_streakCell{width:11px;height:11px;border-radius:2px;background:var(--dsw-alias-bg-layer-2)}'
      + '.aXa_av_streakCell[data-level="2"]{background:color-mix(in oklab,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-bg-layer-2))}'
      + '.aXa_av_streakCell[data-level="3"]{background:color-mix(in oklab,var(--dsw-alias-brand-primary) 60%,var(--dsw-alias-bg-layer-2))}'
      + '.aXa_av_streakCell[data-level="4"]{background:var(--dsw-alias-brand-primary)}'
      + '.aXa_av_insightInput{flex:none;width:130px;padding:2px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit}'

    // >>> insight-css — GENERATED by scripts/gen-insight-css.mjs from @deepseek-ai/dsh-client-ui-tool
    // ToolRow.module.css (absorbed ToolDetails at 0.1.5; dsh 0.1.5-rc.2), 1 stock hashed prefixes rewritten → aXa_ins_ (the raw prefixes are deliberately not named here — selftest asserts none leak).
    // Do not hand-edit — `--check` is the selftest drift gate.
    const INSIGHT_CSS = ".aXa_ins_root{flex-direction:column;display:flex}.aXa_ins_row{position:relative;overflow:hidden}.aXa_ins_root[data-state=running] .aXa_ins_row:after{content:\"\";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite aXa_ins_dsh-tool-row-sweep;position:absolute;top:0;bottom:0;left:0}@keyframes aXa_ins_dsh-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}.aXa_ins_leading{flex-shrink:0}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_leading,.aXa_ins_root[data-tool^=cordis_] .aXa_ins_title{color:var(--dsw-alias-state-business-primary)}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_title{font-weight:500}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_sep{background:var(--dsw-alias-state-business-primary)}.aXa_ins_chevron{color:var(--dsw-alias-label-secondary)}.aXa_ins_title{font-weight:400}.aXa_ins_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.aXa_ins_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}.aXa_ins_summarySuffix{white-space:nowrap;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);flex:none;margin-left:4px}.aXa_ins_diffStat{font-family:var(--ds-font-family-code);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 2px);color:var(--dsw-alias-label-caption);margin-left:10px;transform:translateY(.5px)}.aXa_ins_fileLink{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:inherit;text-align:left;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-secondary);text-decoration:underline dotted;text-decoration-color:var(--dsw-alias-label-tertiary);text-underline-offset:3px;cursor:pointer;background:0 0;border:none;flex:0 auto;margin:0;padding:0;text-decoration-thickness:1px;overflow:hidden}.aXa_ins_fileLink:hover{color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}.aXa_ins_errorSummary{color:var(--dsw-alias-state-error-primary)}.aXa_ins_bodyWrap{flex-direction:column;display:flex}.aXa_ins_inspectButton{border:.5px solid var(--dsw-alias-border-l3);corner-shape:round;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;border-radius:999px;align-self:flex-start;align-items:center;gap:4px;margin:4px 0 2px 4px;padding:2px 8px;font-size:11px;line-height:16px;transition:opacity .1s;display:inline-flex}.aXa_ins_root:hover .aXa_ins_inspectButton,.aXa_ins_inspectButton:focus-visible{opacity:1}.aXa_ins_inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}.aXa_ins_bodyScroll{max-height:260px;overflow-y:auto}.aXa_ins_ioCard{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);border-radius:12px;flex-direction:column;margin:4px 0 4px 4px;display:flex}.aXa_ins_ioSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}.aXa_ins_ioSection::-webkit-scrollbar-thumb{background-clip:padding-box;border:2px solid #0000;border-radius:6px}.aXa_ins_ioSection::-webkit-scrollbar-track{margin:6px 0}.aXa_ins_ioLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}.aXa_ins_ioDivider{background:var(--dsw-alias-border-l2);flex:none;height:.5px}.aXa_ins_ioText{white-space:pre-wrap;word-break:break-word;min-width:0;color:var(--dsw-alias-label-secondary)}.aXa_ins_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}.aXa_ins_codeBody,.aXa_ins_terminalBody,.aXa_ins_diffBody,.aXa_ins_readBody,.aXa_ins_imageBody,.aXa_ins_searchBody,.aXa_ins_webBody{margin:4px 0 4px 4px}.aXa_ins_searchRecovery{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:4px 0 4px 4px}.aXa_ins_imageLabel{overflow-wrap:anywhere;font:var(--dsw-font-sm-13);color:var(--dsw-alias-label-secondary);margin-bottom:4px}.aXa_ins_imageMeta{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}.aXa_ins_codeBody{--dsl-code-block-content-font:var(--dsw-font-markdown-code-block-small)}.aXa_ins_terminalBody{--dsl-terminal-font:var(--dsw-font-markdown-code-block-small);--dsl-terminal-line-height:18px;--dsl-terminal-output-max-height:224px;border:.5px solid var(--dsw-alias-border-l1)}.aXa_ins_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}"
    const I = {
      "bodyScroll": "aXa_ins_bodyScroll",
      "bodyWrap": "aXa_ins_bodyWrap",
      "chevron": "aXa_ins_chevron",
      "codeBody": "aXa_ins_codeBody",
      "diffBody": "aXa_ins_diffBody",
      "diffStat": "aXa_ins_diffStat",
      "dsh-tool-row-sweep": "aXa_ins_dsh-tool-row-sweep",
      "errorSummary": "aXa_ins_errorSummary",
      "fileLink": "aXa_ins_fileLink",
      "imageBody": "aXa_ins_imageBody",
      "imageLabel": "aXa_ins_imageLabel",
      "imageMeta": "aXa_ins_imageMeta",
      "inspectButton": "aXa_ins_inspectButton",
      "ioCard": "aXa_ins_ioCard",
      "ioDivider": "aXa_ins_ioDivider",
      "ioLabel": "aXa_ins_ioLabel",
      "ioSection": "aXa_ins_ioSection",
      "ioText": "aXa_ins_ioText",
      "leading": "aXa_ins_leading",
      "readBody": "aXa_ins_readBody",
      "root": "aXa_ins_root",
      "row": "aXa_ins_row",
      "searchBody": "aXa_ins_searchBody",
      "searchRecovery": "aXa_ins_searchRecovery",
      "sep": "aXa_ins_sep",
      "summary": "aXa_ins_summary",
      "summarySuffix": "aXa_ins_summarySuffix",
      "terminalBody": "aXa_ins_terminalBody",
      "title": "aXa_ins_title",
      "visuallyHidden": "aXa_ins_visuallyHidden",
      "webBody": "aXa_ins_webBody"
    }
    // <<< insight-css

    function ensureCss() {
      const tagId = 'arxa-artifact-viewer/panel.css'
      if (typeof document === 'undefined' || document.querySelector('style[data-plugin-css="' + tagId + '"]')) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'arxa-artifact-viewer'
      tag.dataset.pluginCss = tagId
      tag.textContent = css + INSIGHT_CSS
      document.head.appendChild(tag)
    }

    // ---- locale dictionaries (en source of truth; pl/fr grilled 2026-09-02) --
    const en = {
      'title': 'Artifacts',
      'idle.hint': 'Open an artifact from the file tree or a produced-file chip.',
      'idle.changes': 'Changes in this session',
      'lane.markdown': 'markdown',
      'lane.code': 'code',
      'lane.text': 'text',
      'lane.image': 'image',
      'lane.audio': 'audio',
      'lane.video': 'video',
      'lane.pdf': 'pdf',
      'lane.iframe': 'page',
      'lane.unknown': 'file',
      'guard.tooLarge': 'File is {size} MB — over the {cap} MB edit cap; read-only',
      'guard.binary': 'Binary file — view only',
      'guard.noOrg': 'Open an organisation to edit this file',
      'action.reload': 'Reload',
      'renderer.editor': 'arxa editor',
      'renderer.markdown': 'Markdown',
      'action.openWith': 'Open with',
      'wrap.on': 'Wrap lines',
      'wrap.off': 'Wrap lines',
      'action.fullscreen': 'Fullscreen',
      'action.restore': 'Restore panel',
      'action.collapse': 'Collapse panel',
      'action.expand': 'Expand panel',
      'changed.note': 'Changed on disk',
      'changed.reload': 'Reload now',
      'md.copy': 'Copy',
      'md.copied': 'Copied',
      'md.footnotes': 'Footnotes',
      'action.format': 'Format document (Shift+Alt+F)',
      'action.prettier.on': 'Prettier: on',
      'action.prettier.off': 'Prettier: off',
      'format.failed': 'format:',
      'action.download': 'Download',
      'action.maximize': 'Maximize',
      'state.dirty': 'Unsaved changes',
      'state.saving': 'Saving…',
      'state.saved': 'Saved',
      'state.conflict': 'Changed externally',
      'conflict.note': 'This file changed on disk while you edited.',
      'conflict.reload': 'Reload theirs',
      'conflict.overwrite': 'Overwrite with mine',
      'session.badge': 'Editing in session {name}',
      'version.none': 'No versions minted',
      'page.of': '{page} / {pages}',
      'unknown.note': 'No renderer for this type',
      'error.session': 'Could not open a session for editing: {reason}',
      'error.load': 'Failed to load {path}: {reason}',
      'saved.wipPending': 'Saved (WIP commit pending: {warning})',
      'saved.committed': 'Saved · WIP committed to {session}',
      'insight.title.streak': 'Commit streak',
      'insight.title.review': 'Review',
      'insight.review.needs': 'Needs you',
      'insight.review.reviews': 'Reviews',
      'insight.review.threads': 'Threads',
      'insight.review.comments': 'Comments',
      'insight.review.issues': 'Issues',
      'insight.review.commits': 'Commit notes',
      'insight.review.ci': 'CI',
      'insight.review.empty': 'Nothing on this pull request yet.',
      'insight.review.nopr': 'No pull request yet — it opens on this session\u2019s first push.',
      'insight.review.refresh': 'Refresh',
      'insight.review.reply': 'Reply',
      'insight.review.send': 'Send',
      'insight.review.resolve': 'Resolve',
      'insight.review.unresolve': 'Reopen',
      'insight.review.resolved': 'Resolved',
      'insight.review.outdated': 'Outdated',
      'insight.review.bots': 'Show bot comments',
      'insight.review.openPr': 'Open on GitHub',
      'insight.review.changes-requested': 'asked for changes',
      'insight.review.unresolved-thread': 'unresolved',
      'insight.review.mention': 'mentioned you',
      'insight.review.ci-failed': 'CI failed',
      'insight.title.sessions': 'Sessions',
      'insight.title.jobs': 'Background jobs',
      'insight.title.subagents': 'Subagents',
      'agents.jobs.empty': 'No background jobs',
      'agents.subagents.empty': 'No subagents',
      'agents.pause': 'Pause',
      'agents.resume': 'Resume',
      'agents.cancel': 'Cancel',
      'agents.why.one-shot': 'A one-shot subagent runs to completion — it cannot be paused or stopped.',
      'agents.why.not-running': 'Nothing is running right now.',
      'agents.why.send-message': 'A paused subagent resumes when you send it a message.',
      'agents.why.no-terminate-verb': 'The engine has no way to terminate a subagent — pause is the only stop.',
      'agents.why.jobs-have-no-pause': 'Background jobs cannot be paused — only cancelled.',
      'agents.why.no-job-api': 'This engine build exposes no way to control a background job — it can only be watched.',
      'agents.why.already-finished': 'This one has already finished.',
      'agents.why.owner-not-live': 'This session is not live, so its jobs cannot be reached.',
      'agents.why.service-unavailable': 'This engine build does not provide that service.',
      'agents.why.unavailable': 'Not available here.',
      'insight.loading': 'Loading…',
      'insight.streak.days': 'Last 90 days',
      'insight.unavailable': 'Not available for this repository.',
      'insight.seatRequired': 'Open this from a session — the report follows the session’s branch.',
      'insight.streak.current': 'Current',
      'insight.streak.longest': 'Longest',
      'insight.streak.empty': 'No commits in the last 90 days.',
      'insight.ci.open': 'Open',
      'insight.ci.empty': 'No workflow runs on this branch.',
      'insight.ci.rerun': 'Re-run',
      'insight.ci.cancel': 'Cancel',
      'insight.sessions.open': 'Open',
      'insight.sessions.rename': 'Rename',
      'insight.sessions.archive': 'Archive',
      'insight.sessions.empty': 'No sessions in this organisation.',
      'lsp.none': 'No {lang} language server.',
      'lsp.hint': 'No {lang} language server — install its SDK ({cmd}) to get one.',
      'lsp.install': 'Install',
      'lsp.installing': 'Installing…',
    }
    const pl = {
      'title': 'Artefakty',
      'idle.hint': 'Otwórz artefakt z drzewa plików lub ze znacznika wyprodukowanego pliku.',
      'idle.changes': 'Zmiany w tej sesji',
      'lane.markdown': 'markdown',
      'lane.code': 'kod',
      'lane.text': 'tekst',
      'lane.image': 'obraz',
      'lane.audio': 'audio',
      'lane.video': 'wideo',
      'lane.pdf': 'pdf',
      'lane.iframe': 'strona',
      'lane.unknown': 'plik',
      'guard.tooLarge': 'Plik ma {size} MB — powyżej limitu edycji {cap} MB; tylko do odczytu',
      'guard.binary': 'Plik binarny — tylko podgląd',
      'guard.noOrg': 'Otwórz organizację, aby edytować ten plik',
      'action.reload': 'Odśwież',
      'renderer.editor': 'arxa editor',
      'renderer.markdown': 'Markdown',
      'action.openWith': 'Otwórz za pomocą',
      'wrap.on': 'Zawijaj wiersze',
      'wrap.off': 'Zawijaj wiersze',
      'action.fullscreen': 'Pełny ekran',
      'action.restore': 'Przywróć panel',
      'action.collapse': 'Zwiń panel',
      'action.expand': 'Rozwiń panel',
      'changed.note': 'Zmieniono na dysku',
      'changed.reload': 'Wczytaj ponownie',
      'md.copy': 'Kopiuj',
      'md.copied': 'Skopiowano',
      'md.footnotes': 'Przypisy',
      'action.format': 'Formatuj dokument (Shift+Alt+F)',
      'action.prettier.on': 'Prettier: włączony',
      'action.prettier.off': 'Prettier: wyłączony',
      'format.failed': 'formatowanie:',
      'action.download': 'Pobierz',
      'action.maximize': 'Maksymalizuj',
      'state.dirty': 'Niezapisane zmiany',
      'state.saving': 'Zapisywanie…',
      'state.saved': 'Zapisano',
      'state.conflict': 'Zmieniono zewnętrznie',
      'conflict.note': 'Ten plik zmienił się na dysku podczas edycji.',
      'conflict.reload': 'Wczytaj ich wersję',
      'conflict.overwrite': 'Nadpisz moją wersją',
      'session.badge': 'Edycja w sesji {name}',
      'version.none': 'Brak wybitych wersji',
      'page.of': '{page} / {pages}',
      'unknown.note': 'Brak renderera dla tego typu',
      'error.session': 'Nie udało się otworzyć sesji do edycji: {reason}',
      'error.load': 'Nie udało się załadować {path}: {reason}',
      'saved.wipPending': 'Zapisano (commit WIP oczekuje: {warning})',
      'saved.committed': 'Zapisano · WIP zacommitowano do {session}',
      // TODO native review (conformance decision 4): machine-drafted.
      'insight.title.streak': 'Passa commitów',
      'insight.title.review': 'Recenzja',
      'insight.review.needs': 'Wymaga Ciebie',
      'insight.review.reviews': 'Recenzje',
      'insight.review.threads': 'Wątki',
      'insight.review.comments': 'Komentarze',
      'insight.review.issues': 'Zgłoszenia',
      'insight.review.commits': 'Notatki do commitów',
      'insight.review.ci': 'CI',
      'insight.review.empty': 'Nic jeszcze w tym pull requeście.',
      'insight.review.nopr': 'Brak pull requesta — otworzy się przy pierwszym pushu tej sesji.',
      'insight.review.refresh': 'Odśwież',
      'insight.review.reply': 'Odpowiedz',
      'insight.review.send': 'Wyślij',
      'insight.review.resolve': 'Rozwiąż',
      'insight.review.unresolve': 'Otwórz ponownie',
      'insight.review.resolved': 'Rozwiązany',
      'insight.review.outdated': 'Nieaktualny',
      'insight.review.bots': 'Pokaż komentarze botów',
      'insight.review.openPr': 'Otwórz na GitHubie',
      'insight.review.changes-requested': 'poprosił o zmiany',
      'insight.review.unresolved-thread': 'nierozwiązany',
      'insight.review.mention': 'wspomniał o Tobie',
      'insight.review.ci-failed': 'CI nie przeszło',
      'insight.title.sessions': 'Sesje',
      'insight.title.jobs': 'Zadania w tle',
      'insight.title.subagents': 'Podagenci',
      'agents.jobs.empty': 'Brak zadań w tle',
      'agents.subagents.empty': 'Brak podagentów',
      'agents.pause': 'Wstrzymaj',
      'agents.resume': 'Wznów',
      'agents.cancel': 'Anuluj',
      'agents.why.one-shot': 'Podagent jednorazowy działa do końca — nie można go wstrzymać ani zatrzymać.',
      'agents.why.not-running': 'Nic teraz nie działa.',
      'agents.why.send-message': 'Wstrzymany podagent wznawia się po wysłaniu mu wiadomości.',
      'agents.why.no-terminate-verb': 'Silnik nie potrafi zakończyć podagenta — wstrzymanie to jedyne zatrzymanie.',
      'agents.why.jobs-have-no-pause': 'Zadań w tle nie można wstrzymać — tylko anulować.',
      'agents.why.no-job-api': 'Ta wersja silnika nie pozwala sterować zadaniem w tle — można je tylko obserwować.',
      'agents.why.already-finished': 'To już się zakończyło.',
      'agents.why.owner-not-live': 'Ta sesja nie jest aktywna, więc jej zadania są nieosiągalne.',
      'agents.why.service-unavailable': 'Ta wersja silnika nie udostępnia tej usługi.',
      'agents.why.unavailable': 'Niedostępne tutaj.',
      'insight.loading': 'Wczytywanie…',
      'insight.streak.days': 'Ostatnie 90 dni',
      'insight.unavailable': 'Niedostępne dla tego repozytorium.',
      'insight.seatRequired': 'Otwórz z poziomu sesji — raport podąża za gałęzią sesji.',
      'insight.streak.current': 'Obecna',
      'insight.streak.longest': 'Najdłuższa',
      'insight.streak.empty': 'Brak commitów w ciągu ostatnich 90 dni.',
      'insight.ci.open': 'Otwórz',
      'insight.ci.empty': 'Brak przebiegów workflow na tej gałęzi.',
      'insight.ci.rerun': 'Uruchom ponownie',
      'insight.ci.cancel': 'Anuluj',
      'insight.sessions.open': 'Otwórz',
      'insight.sessions.rename': 'Zmień nazwę',
      'insight.sessions.archive': 'Archiwizuj',
      'insight.sessions.empty': 'Brak sesji w tej organizacji.',
      'lsp.none': 'Brak serwera języka {lang}.',
      'lsp.hint': 'Brak serwera języka {lang} — zainstaluj jego SDK ({cmd}), aby go uzyskać.',
      'lsp.install': 'Zainstaluj',
      'lsp.installing': 'Instalowanie…',
    }
    const fr = {
      'title': 'Artefacts',
      'idle.hint': 'Ouvrez un artefact depuis l’arborescence ou une puce de fichier produit.',
      'idle.changes': 'Modifications de cette session',
      'lane.markdown': 'markdown',
      'lane.code': 'code',
      'lane.text': 'texte',
      'lane.image': 'image',
      'lane.audio': 'audio',
      'lane.video': 'vidéo',
      'lane.pdf': 'pdf',
      'lane.iframe': 'page',
      'lane.unknown': 'fichier',
      'guard.tooLarge': 'Le fichier fait {size} Mo — au-delà de la limite d’édition de {cap} Mo ; lecture seule',
      'guard.binary': 'Fichier binaire — aperçu seul',
      'guard.noOrg': 'Ouvrez une organisation pour modifier ce fichier',
      'action.reload': 'Recharger',
      'renderer.editor': 'arxa editor',
      'renderer.markdown': 'Markdown',
      'action.openWith': 'Ouvrir avec',
      'wrap.on': 'Retour à la ligne',
      'wrap.off': 'Retour à la ligne',
      'action.fullscreen': 'Plein écran',
      'action.restore': 'Restaurer le panneau',
      'action.collapse': 'Réduire le panneau',
      'action.expand': 'Déployer le panneau',
      'changed.note': 'Modifié sur le disque',
      'changed.reload': 'Recharger',
      'md.copy': 'Copier',
      'md.copied': 'Copié',
      'md.footnotes': 'Notes de bas de page',
      'action.format': 'Formatter le document (Maj+Alt+F)',
      'action.prettier.on': 'Prettier : activé',
      'action.prettier.off': 'Prettier : désactivé',
      'format.failed': 'formatage :',
      'action.download': 'Télécharger',
      'action.maximize': 'Agrandir',
      'state.dirty': 'Modifications non enregistrées',
      'state.saving': 'Enregistrement…',
      'state.saved': 'Enregistré',
      'state.conflict': 'Modifié extérieurement',
      'conflict.note': 'Ce fichier a changé sur le disque pendant votre modification.',
      'conflict.reload': 'Charger leur version',
      'conflict.overwrite': 'Écraser avec la mienne',
      'session.badge': 'Modification dans la session {name}',
      'version.none': 'Aucune version créée',
      'page.of': '{page} / {pages}',
      'unknown.note': 'Aucun moteur de rendu pour ce type',
      'error.session': 'Impossible d’ouvrir une session pour modifier : {reason}',
      'error.load': 'Échec du chargement de {path} : {reason}',
      'saved.wipPending': 'Enregistré (commit WIP en attente : {warning})',
      'saved.committed': 'Enregistré · WIP commité dans {session}',
      // TODO native review (conformance decision 4): machine-drafted.
      'insight.title.streak': 'Série de commits',
      'insight.title.review': 'Revue',
      'insight.review.needs': 'Requiert votre attention',
      'insight.review.reviews': 'Revues',
      'insight.review.threads': 'Fils',
      'insight.review.comments': 'Commentaires',
      'insight.review.issues': 'Tickets',
      'insight.review.commits': 'Notes de commit',
      'insight.review.ci': 'CI',
      'insight.review.empty': 'Rien encore sur cette pull request.',
      'insight.review.nopr': 'Pas encore de pull request — elle s\u2019ouvre au premier push de cette session.',
      'insight.review.refresh': 'Actualiser',
      'insight.review.reply': 'Répondre',
      'insight.review.send': 'Envoyer',
      'insight.review.resolve': 'Résoudre',
      'insight.review.unresolve': 'Rouvrir',
      'insight.review.resolved': 'Résolu',
      'insight.review.outdated': 'Obsolète',
      'insight.review.bots': 'Afficher les commentaires des bots',
      'insight.review.openPr': 'Ouvrir sur GitHub',
      'insight.review.changes-requested': 'a demandé des modifications',
      'insight.review.unresolved-thread': 'non résolu',
      'insight.review.mention': 'vous a mentionné',
      'insight.review.ci-failed': 'CI en échec',
      'insight.title.sessions': 'Sessions',
      'insight.title.jobs': 'Tâches en arrière-plan',
      'insight.title.subagents': 'Sous-agents',
      'agents.jobs.empty': 'Aucune tâche en arrière-plan',
      'agents.subagents.empty': 'Aucun sous-agent',
      'agents.pause': 'Suspendre',
      'agents.resume': 'Reprendre',
      'agents.cancel': 'Annuler',
      'agents.why.one-shot': 'Un sous-agent à usage unique va jusqu’au bout — impossible de le suspendre ou de l’arrêter.',
      'agents.why.not-running': 'Rien ne tourne pour le moment.',
      'agents.why.send-message': 'Un sous-agent suspendu reprend lorsque vous lui envoyez un message.',
      'agents.why.no-terminate-verb': 'Le moteur ne sait pas terminer un sous-agent — suspendre est le seul arrêt.',
      'agents.why.jobs-have-no-pause': 'Les tâches en arrière-plan ne se suspendent pas — elles s’annulent.',
      'agents.why.no-job-api': 'Cette version du moteur n’offre aucun contrôle sur une tâche en arrière-plan — seulement son suivi.',
      'agents.why.already-finished': 'Celle-ci est déjà terminée.',
      'agents.why.owner-not-live': 'Cette session n’est pas active, ses tâches sont donc inaccessibles.',
      'agents.why.service-unavailable': 'Cette version du moteur ne fournit pas ce service.',
      'agents.why.unavailable': 'Indisponible ici.',
      'insight.loading': 'Chargement…',
      'insight.streak.days': '90 derniers jours',
      'insight.unavailable': 'Indisponible pour ce dépôt.',
      'insight.seatRequired': 'Ouvrez depuis une session — le rapport suit la branche de la session.',
      'insight.streak.current': 'Actuelle',
      'insight.streak.longest': 'Plus longue',
      'insight.streak.empty': 'Aucun commit sur les 90 derniers jours.',
      'insight.ci.open': 'Ouvrir',
      'insight.ci.empty': 'Aucune exécution de workflow sur cette branche.',
      'insight.ci.rerun': 'Relancer',
      'insight.ci.cancel': 'Annuler',
      'insight.sessions.open': 'Ouvrir',
      'insight.sessions.rename': 'Renommer',
      'insight.sessions.archive': 'Archiver',
      'insight.sessions.empty': 'Aucune session dans cette organisation.',
      'lsp.none': 'Aucun serveur de langage {lang}.',
      'lsp.hint': 'Aucun serveur de langage {lang} — installez son SDK ({cmd}) pour en obtenir un.',
      'lsp.install': 'Installer',
      'lsp.installing': 'Installation…',
    }

    // ---- ingress store (the 0px-column race dies here) ----------------------
    // apply() requests; the mounted panel consumes. The store holds a pending
    // open until the panel exists — no retries, no parked window global.
    function createAvStore() {
      let state = { pending: null, tick: 0, sessionId: null, rootId: null }
      const subs = new Set()
      const emit = () => { for (const fn of [...subs]) { try { fn() } catch {} } }
      return {
        getSnapshot: () => state,
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
        request(payload) { state = { ...state, pending: payload, rootId: payload?.rootId || null, tick: state.tick + 1 }; emit() },
        consume() {
          if (!state.pending) return null
          const p = state.pending
          state = { ...state, pending: null }
          emit()
          return p
        },
        setSession(id) { if (state.sessionId !== id) { state = { ...state, sessionId: id }; emit() } },
      }
    }

    // ---- vendored lane engines (unchanged) -----------------------------------
    const loadedVendors = {}
    function ensureVendor(name, globalName) {
      if (loadedVendors[name]) return loadedVendors[name]
      loadedVendors[name] = new Promise((resolve, rejectP) => {
        if (window[globalName]) return resolve(window[globalName])
        // Marker lets other loaders (the sidebar's icon loader) reuse the tag
        // instead of double-fetching the same bundle on one page.
        const existing = name === 'icons.js'
          ? document.querySelector('script[data-arxa-vendor="icons.js"]')
          : null
        if (existing) {
          existing.addEventListener('load', () => resolve(window[globalName]), { once: true })
          existing.addEventListener('error', () => rejectP(new Error('failed to load vendor bundle: ' + name)), { once: true })
          return
        }
        const s = document.createElement('script')
        if (name === 'icons.js') s.dataset.arxaVendor = name
        s.src = VENDOR(name)
        s.onload = () => resolve(window[globalName])
        s.onerror = () => rejectP(new Error('failed to load vendor bundle: ' + name))
        document.head.appendChild(s)
      })
      return loadedVendors[name]
    }

    /** The Monaco/VS Code bundle. A dynamic import(), NOT a <script> tag like
     *  ensureVendor above: this graph is ESM and spawns workers, which an IIFE
     *  cannot be. Built by lib/monaco-build and served off the same vendor
     *  route. Absent in a checkout that has never run its build — the caller
     *  surfaces the load error in the editor pane rather than blanking it. */
    let monacoMod = null
    function ensureMonaco() {
      monacoMod ??= import(VENDOR('arxa-monaco.js'))
      return monacoMod
    }

    // ---- VS Code 2026 palette + formatting plumbing (grilled 2026-09-03) -----
    // The editor surfaces adopt the vendored 2026 Dark/Light port (themes.js)
    // following the dsh shell's dark flag (body[data-ds-dark-theme]); every
    // other surface keeps the --dsw-* vocabulary.
    function isDarkMode() {
      return !!(typeof document !== 'undefined' && document.body && document.body.hasAttribute('data-ds-dark-theme'))
    }
    const paletteSubs = new Set()
    let paletteWatchArmed = false
    function watchPalette(fn) {
      paletteSubs.add(fn)
      if (!paletteWatchArmed && typeof MutationObserver !== 'undefined' && document.body) {
        paletteWatchArmed = true
        new MutationObserver(() => { for (const sub of paletteSubs) sub(isDarkMode()) })
          .observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      }
      return () => paletteSubs.delete(fn)
    }

    // Monaco measures glyph width from the font it is TOLD, so the shell's
    // choice has to be read and passed rather than left to CSS. The fallback
    // is the same explicit Fira-free stack the CodeMirror rule carried
    // (2026-09-03): the dsh code token lists Fira Code third and resolves to
    // it in WKWebView, which made the Default pill render Fira and the font
    // toggle a visual no-op.
    function studioEditorFont() {
      return getComputedStyle(document.documentElement)
        .getPropertyValue('--arxa-editor-font').trim()
        || '"SF Mono", ui-monospace, "JetBrains Mono", Consolas, "Liberation Mono", Menlo, monospace'
    }

    // The studio's canvas as hex VS Code can eat. Computed colors come back
    // oklab()/oklch() in modern WebKit, which VS Code's color parser
    // refuses — and the canvas readback trick does not help either: Chrome
    // serializes an oklab source right back as the oklab() string (measured
    // 2026-09-15). So: canvas normalises rgb()/named/hex, and oklab/oklch
    // convert by hand (Björn Ottosson's matrices; unitless floats only — a
    // % form falls back to null, no override rather than a wrong one).
    // Read fresh every call — the canvas moves with the studio's palette.
    let normCtx = null
    function cssColorToHex(c) {
      if (typeof c !== 'string' || !c || c === 'transparent') return null
      normCtx ??= document.createElement('canvas').getContext('2d')
      normCtx.fillStyle = 'black'
      normCtx.fillStyle = c
      const rb = normCtx.fillStyle
      if (typeof rb === 'string' && rb[0] === '#') return rb
      const m = /^okl(ch|ab)\(([^)]+)\)/.exec(c)
      if (!m) return null
      const n = m[2].trim().split(/[\s/]+/).map(Number)
      if (n.length < 3 || n.slice(0, 3).some(Number.isNaN)) return null
      let L = n[0], a = n[1], b = n[2]
      if (m[1] === 'ch') { const rad = n[2] * Math.PI / 180; a = n[1] * Math.cos(rad); b = n[1] * Math.sin(rad) }
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b
      const s_ = L - 0.0894841775 * a - 1.291485548 * b
      const l = l_ * l_ * l_, mm = m_ * m_ * m_, s = s_ * s_ * s_
      const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
      ]
      const enc = (v) => {
        const x = Math.min(1, Math.max(0, v))
        const g = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
        return Math.round(g * 255).toString(16).padStart(2, '0')
      }
      return '#' + enc(lin[0]) + enc(lin[1]) + enc(lin[2])
    }

    function studioCanvas() {
      return cssColorToHex(getComputedStyle(document.body).backgroundColor)
    }

    function studioColors() {
      const canvas = studioCanvas()
      return canvas ? { canvas } : null
    }

    function FileIcon({ name }) {
      const [svg, setSvg] = React.useState(null)
      React.useEffect(() => {
        let dead = false
        ensureVendor('icons.js', 'ArxaIcons').then((I) => {
          if (!dead && I && typeof I.file === 'function') setSvg(I.file(name))
        }).catch(() => { /* generic header still fine without the glyph */ })
        return () => { dead = true }
      }, [name])
      if (!svg) return null
      return h('span', { className: 'aXa_av_fileIcon', dangerouslySetInnerHTML: { __html: svg } })
    }

    // Wrap glyphs lifted verbatim from the stock documentpreview bundle
    // (IconNowrapFill16 / IconWrapFill16, dsh 0.1.5-rc.2) — dsh keeps them
    // bundle-local, so the paths are copied rather than imported.
    const IconNowrapFill16 = ({ size = 16, className }) => h('svg', {
      width: size, height: size, className, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
    }, h('path', {
      d: 'M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM14 9L19 12L14 15V13H5V11H14V9Z',
      fill: 'currentColor',
    }))
    const IconWrapFill16 = ({ size = 16, className }) => h('svg', {
      width: size, height: size, className, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg',
    }, h('path', {
      d: 'M1.5 2.5H3.5V21.5H1.5V2.5ZM20.5 2.5H22.5V21.5H20.5V2.5ZM6.75 5H11.5A6 6 0 0 1 12 16.98V19L7 16L12 13V14.97A4 4 0 0 0 11.5 7H6.75V5Z',
      fill: 'currentColor',
    }))

    async function fetchTokenRaw(payload) {
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    async function fetchToken(relPath, writeFor, rootId) {
      const payload = writeFor
        ? { scope: 'write', worktreeId: writeFor }
        : rootId && relPath == null
          ? { scope: 'write', rootId }
          : { relPath, ...(rootId ? { rootId } : {}) }
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    async function fetchRoot(rootId) {
      const res = await fetch(ROOTS_ROUTE)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('roots route ' + res.status))
      const root = (body.roots || []).find((row) => rootId ? row.id === rootId : row.kind === 'org')
      if (rootId && !root) throw new Error('root not open')
      return root || null
    }

    function matchesArtifactEvent(ev, relPath, eventRootId) {
      return !!ev && ev.relPath === relPath && (!eventRootId || ev.rootId === eventRootId)
    }

    /** D80 transparent ensure: an open session of the open org — the most
     * recently updated open row — else a fresh session in the 'notes' dock
     * via the sidebar action. Throws loud when no org is open. */
    async function ensureSession() {
      const res = await fetch(STATE_ROUTE)
      const state = await res.json().catch(() => ({}))
      const orgs = state.orgs || []
      const open = orgs.find((o) => o.open) || orgs[0]
      if (!open) throw new Error('no org open')
      const rows = (open.sessions || []).filter((s) => s.state === 'open')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (rows.length > 0) return rows[0]
      const mk = await fetch(ACTION_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'workspace.new-session', arg: { workspace: 'notes' } }),
      })
      const mkBody = await mk.json().catch(() => ({}))
      if (!mkBody.ok) throw new Error('session create failed: ' + (mkBody.error || mk.status))
      const after = await (await fetch(STATE_ROUTE)).json().catch(() => ({}))
      const fresh = ((after.orgs || []).find((o) => o.open || o === open) || open).sessions || []
      const freshOpen = fresh.filter((s) => s.state === 'open')
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      if (freshOpen.length === 0) throw new Error('session created but registry row not visible')
      return freshOpen[0]
    }

    // ---- lane components ------------------------------------------------------
    /** The editable surface: real VS Code (Monaco + the built-in grammar
     *  extensions), replacing CodeMirror for code, text and markdown source.
     *
     *  `docRef.current` holds the bundle's handle, not a monaco object. Five
     *  call sites in Panel read the live document through it, and keeping the
     *  seam narrow is what stops phases 4-6 from rewriting all of them. */
    function CodeView({ relPath, absPath, session, rootId, text, editable, docRef, onDirty, diffOriginal, wrap = false, t }) {
      const ref = React.useRef(null)
      // The uri the part currently holds, and a counter that ticks when it
      // lands. The mode effect below needs both: what to open, and a signal that
      // opening is now possible.
      const openedRef = React.useRef(null)
      const [opened, setOpened] = React.useState(0)
      // The open effect reads the text through a ref so a `text` change does
      // not re-open the file: re-opening with the loaded bytes wiped what the
      // user had typed (2026-09-07). Disk changes take the effect below.
      const textRef = React.useRef(text)
      textRef.current = text
      // null while the language service is fine (or irrelevant); a row from
      // /lsp/status when there is no server for this file's language.
      const [lsp, setLsp] = React.useState(null)
      const connectLsp = React.useCallback(async (lang, token, init) => {
        const M = await ensureMonaco()
        const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + LSP_ROUTE
        return M.connectLanguageServer(lang, { url: wsUrl, token, relPath, uriPath: absPath, session, rootId,
          selector: LSP_SELECTORS[lang] || [lang], init: init || null })
      }, [relPath, absPath, session, rootId])
      const installLsp = React.useCallback(async () => {
        if (!lsp) return
        const lang = lsp.lang
        setLsp((cur) => (cur ? { ...cur, busy: true, error: null } : cur))
        try {
          const { token } = await fetchTokenRaw({ scope: 'lsp-install', rootId })
          const res = await fetch(LSP_ROUTE + '/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lang, avt: token, rootId }),
          })
          const body = await res.json().catch(() => ({}))
          if (!res.ok || !body.ok) {
            setLsp((cur) => (cur ? { ...cur, busy: false, error: body.reason || body.error || ('install ' + res.status) } : cur))
            return
          }
          // Installed: the strip goes away and the service starts on this file
          // — no reopen, because the model is already the right one.
          setLsp(null)
          const { token: t2 } = await fetchTokenRaw({ scope: 'lsp', rootId })
          const st2 = await fetch(LSP_ROUTE + '/status?avt=' + encodeURIComponent(t2)
            + (rootId ? '&rootId=' + encodeURIComponent(rootId) : ''))
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)
          await connectLsp(lang, t2, st2 && st2.langs && st2.langs[lang] ? st2.langs[lang].init : null)
        } catch (e) {
          setLsp((cur) => (cur ? { ...cur, busy: false, error: String((e && e.message) || e) } : cur))
        }
      }, [lsp, connectLsp])
      React.useEffect(() => {
        let dead = false
        let handle = null
        ;(async () => {
          trace.mark('codeview')
          const M = await ensureMonaco()
          trace.mark('import')
          if (dead || !ref.current) return
          // The model is keyed on the file's REAL path when the host resolved
          // one. That is what makes a language server's diagnostics land on the
          // right file: a model at /<relPath> names a path the server has never
          // heard of, so every underline would be attributed to a file that
          // does not exist. Falls back to the relative path when there is no
          // absPath — the editor works either way, only the language service
          // needs the real identity.
          handle = await M.openFile(ref.current, absPath || ('/' + relPath), textRef.current, {
            editable: !!editable,
            dark: isDarkMode(),
            // Monaco has to be TOLD its font (it measures glyph width from
            // it); studioEditorFont is the one read of the shell token.
            fontFamily: studioEditorFont(),
            colors: studioColors(),
            onChange: () => { if (onDirty) onDirty() },
          })
          trace.mark('open')
          // The await above can outlive the effect: dispose what we just made
          // rather than leaking an editor into a detached container.
          if (dead) { handle.dispose(); handle = null; return }
          // Painted = the first frame after the part laid the editor out.
          requestAnimationFrame(() => requestAnimationFrame(() => trace.end('painted')))
          if (docRef) docRef.current = handle
          // Shift-Alt-F is NOT rebound here any more. addCommand only exists on
          // a standalone editor, and the file now opens in VS Code's editor
          // part, whose control is a plain ICodeEditor. It does not need one:
          // the keybindings service already maps Shift-Alt-F to
          // editor.action.formatDocument, which formats through the language
          // server. The toolbar Format button still runs prettier — that is the
          // lane that covers markdown and yaml, which no server does.
          openedRef.current = absPath || ('/' + relPath)
          setOpened((n) => n + 1)
          // Language service, best effort and always last: the editor is fully
          // usable without one, so nothing here may fail the open. A file with
          // no server, no project manifest, or no installed binary simply gets
          // no diagnostics.
          const lang = LSP_LANGS[(relPath.match(/\.[a-z]+$/i) || [''])[0].toLowerCase()]
          if (lang && absPath) {
            void (async () => {
              try {
                const { token } = await fetchTokenRaw({ scope: 'lsp', rootId })
                if (dead) return
                // ASK before connecting. The host accepts the upgrade first and
                // only then closes 4004 when there is no binary, so the close
                // code cannot answer "is there a server" in time to decide
                // whether to offer an Install.
                const st = await fetch(LSP_ROUTE + '/status?avt=' + encodeURIComponent(token)
                  + (rootId ? '&rootId=' + encodeURIComponent(rootId) : ''))
                  .then((r) => (r.ok ? r.json() : null)).catch(() => null)
                if (dead) return
                const row = st && st.langs ? st.langs[lang] : null
                if (row && row.available === false) { setLsp({ lang, ...row }); return }
                await connectLsp(lang, token, row && row.init)
              } catch { /* no language service; the editor is unaffected */ }
            })()
          }
        })().catch((e) => { trace.end('editor-error'); if (ref.current) ref.current.textContent = String(e && e.message || e) })
        return () => {
          dead = true
          if (handle) handle.dispose()
          if (docRef) docRef.current = null
        }
      }, [relPath, absPath, session, rootId, editable])
      // Bytes changed on disk under a CLEAN buffer — the watcher push and
      // reload-theirs are the only writers of `text` after the open. Push them
      // into the open document. Guarded on the uri: at a file switch `text`
      // changes before the new open lands, and the old document must not get
      // the new file's bytes.
      React.useEffect(() => {
        const uri = absPath || ('/' + relPath)
        if (opened === 0 || openedRef.current !== uri) return
        ensureMonaco().then((M) => M.updateFile(uri, text)).catch(() => { /* the open effect owns errors */ })
      }, [text])
      // Source and diff are both TABS in one editor part, not two React
      // subtrees: each is an editor input on the same file. So the mode is a
      // command, and switching keeps the model, the undo history and the
      // language client alive. Re-opening the input that is already up is a
      // focus, so this is safe to run whenever it re-fires.
      //
      // There is no rendered markdown preview (2026-09-07): it was VS Code's
      // webview, and it put a second, washed-out copy of every .md next to the
      // Monaco one. Markdown is source in Monaco, like every other file.
      React.useEffect(() => {
        const uri = openedRef.current
        if (!uri || opened === 0) return
        void (async () => {
          const M = await ensureMonaco()
          if (diffOriginal != null) {
            // Side-by-side or inline is VS Code's own call, made on every
            // layout from its 900px breakpoint — so maximising the pane flips
            // the diff to two columns, and narrowing it flips back. Forcing it
            // from the pane width at open froze the first decision.
            await M.openDiff(uri, diffOriginal, {
              // The diff button is gated on the lane, not on canEdit, so a
              // read-only file can reach it — and the modified side is the same
              // model auto-save watches.
              editable,
            })
          } else {
            // Unpinned, like the open itself: a pinned tab outlives the file
            // switch, and the strip filled with every file ever clicked.
            await M.openEditor(uri, { pinned: false })
          }
        })().catch(() => { /* a mode switch is not worth an error surface */ })
      }, [opened, diffOriginal, editable])

      // Wrap toggle (stock wrap-tool parity, 0.6.0): a per-VIEW monaco
      // override — instance updateOptions wins over the width-derived config
      // the bundle's ResizeObserver keeps writing on resize.
      React.useEffect(() => {
        const handle = docRef.current
        if (handle && handle.editor && typeof handle.editor.updateOptions === 'function') {
          handle.editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' })
        }
      }, [wrap, opened])

      // The strip keeps its slot whether or not it is showing: React
      // reconciles these children by position, and letting the host div move
      // from index 1 to index 0 would unmount the live editor.
      return h('div', { className: 'aXa_av_editorWrap aXa_av_monaco' },
        lsp ? h('div', { className: 'aXa_av_lspBar' }, [
          h('span', { key: 't' }, lsp.installable
            ? t('lsp.none', { lang: LSP_NAMES[lsp.lang] || lsp.lang })
            : t('lsp.hint', { lang: LSP_NAMES[lsp.lang] || lsp.lang, cmd: lsp.cmd })),
          lsp.installable
            ? h('button', {
              key: 'b',
              type: 'button',
              disabled: !!lsp.busy,
              onClick: installLsp,
            }, lsp.busy ? t('lsp.installing') : t('lsp.install'))
            : null,
          lsp.error ? h('span', { key: 'e', style: { opacity: 0.8 } }, lsp.error) : null,
        ]) : null,
        h('div', { className: 'aXa_av_lspHost', ref }))
    }

    function PdfView({ url, t }) {
      const wrapRef = React.useRef(null)
      const canvasRef = React.useRef(null)
      const docRef = React.useRef(null)
      const [pages, setPages] = React.useState(0)
      const [page, setPage] = React.useState(1)
      const [note, setNote] = React.useState('')
      React.useEffect(() => {
        let dead = false
        ;(async () => {
          try {
            const Pf = await ensureVendor('pdf.js', 'ArxaPDF')
            const buf = await (await fetch(url)).arrayBuffer()
            if (dead) return
            const doc = await Pf.getDocument({ data: buf }).promise
            docRef.current = doc
            setPages(doc.numPages)
            setPage(1)
          } catch (e) { if (!dead) setNote(String((e && e.message) || e)) }
        })()
        return () => { dead = true }
      }, [url])
      React.useEffect(() => {
        let dead = false
        ;(async () => {
          try {
            const doc = docRef.current
            const canvas = canvasRef.current
            if (!doc || !canvas) return
            const pg = await doc.getPage(page)
            if (dead) return
            const base = pg.getViewport({ scale: 1 })
            const scale = Math.max(0.2, Math.min(3, ((wrapRef.current ? wrapRef.current.clientWidth : 600) - 4) / base.width))
            const viewport = pg.getViewport({ scale })
            canvas.width = Math.floor(viewport.width)
            canvas.height = Math.floor(viewport.height)
            await pg.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          } catch (e) { if (!dead) setNote(String((e && e.message) || e)) }
        })()
        return () => { dead = true }
      }, [url, page, pages])
      return h(React.Fragment, null,
        h('div', { className: 'aXa_av_pdfBar' },
          h(P.Tooltip, { label: t('previous'), delayMs: 500, side: 'bottom' },
            h('button', { className: 'aXa_av_iconBtn', onClick: () => setPage((p) => Math.max(1, p - 1)), disabled: page <= 1, 'aria-label': t('previous') },
              h(P.IconChevronLeftOutline14, { size: 14 }))),
          h('span', { className: 'aXa_av_pdfPage' }, t('page.of', { page, pages: pages || '…' })),
          h(P.Tooltip, { label: t('next'), delayMs: 500, side: 'bottom' },
            h('button', { className: 'aXa_av_iconBtn', onClick: () => setPage((p) => Math.min(pages || 1, p + 1)), disabled: !pages || page >= pages, 'aria-label': t('next') },
              h(P.IconChevronRightOutline14, { size: 14 })))),
        note
          ? h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note)
          : h('div', { className: 'aXa_av_pdfCanvasWrap', ref: wrapRef },
            h('canvas', { ref: canvasRef, className: 'aXa_av_pdfCanvas' })))
    }

    /** Save-status dot semantics (StateDot states harvested from stock jobs). */
    function dotStateOf(savePhase, dirty) {
      if (savePhase === 'conflict' || savePhase === 'error') return 'error'
      if (savePhase === 'saving') return 'ongoing'
      if (dirty) return 'warning'
      return 'done'
    }

    // ---- insight panel (Phase 4 A3) -----------------------------------------
    // The column is not only a file surface: the git card's three
    // "Insights" links open it on a REPORT instead — commit streak, CI runs,
    // sessions across the org. Same ingress event, same column; only the
    // payload differs (`kind: 'insight'`).
    // Every read goes through the git-card action route the card already uses,
    // so there is one server surface, not two.
    // `agent.*` lives on the SIDEBAR host, not the card host — a session's
    // children and jobs are not a git concern. Same prefix split the sidebar
    // bundle uses, kept in one place on each side.
    const ROUTE_FOR = (action) => (/^agent\./.test(action) ? SIDEBAR_ROUTE : CARD_ROUTE)
    const postAction = async (action, arg) => {
      const r = await fetch(ROUTE_FOR(action), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, arg }),
      })
      const b = await r.json().catch(() => ({}))
      if (!b.ok) throw new Error(b.error || action)
      return b.result
    }
    /** Streak intensity is a class, never an inline colour: the four steps are
     * token-defined so light and dark both read. */
    const streakLevel = (count) => (count >= 8 ? 4 : count >= 4 ? 3 : count >= 1 ? 2 : 1)
    /** Subagent / job row → StateDot vocabulary. A paused-or-cold child and a
     * killed job both read as `warning`: stopped, but not by completing. */
    const agentDot = (row) => {
      if (row.kind === 'job') {
        if (row.status === 'completed') return 'done'
        if (row.status === 'failed') return 'error'
        if (row.status === 'running') return 'ongoing'
        return 'warning'
      }
      return row.activity === 'running' ? 'ongoing' : 'warning'
    }
    /** CI conclusion → StateDot vocabulary (done|ongoing|warning|error). */
    const ciState = (run) => {
      if (run.asleep) return 'warning'
      if (run.status && run.status !== 'completed') return 'ongoing'
      if (run.conclusion === 'success') return 'done'
      if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'error'
      return 'warning'
    }
    function InsightPanel({ t, view, sessionId, orgId, given }) {
      const [phase, setPhase] = React.useState('loading')
      const [data, setData] = React.useState(null)
      const [note, setNote] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [tick, setTick] = React.useState(0)
      const [renaming, setRenaming] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      // D1/D3: the reply box is per-thread and opens on demand — a permanently
      // mounted textarea on every row turns the panel into a form. `replyTo`
      // holds the key of the one open box ('pr' or a thread id).
      const [replyTo, setReplyTo] = React.useState(null)
      const [replyText, setReplyText] = React.useState('')
      const [showBots, setShowBots] = React.useState(false)
      const freshRef = React.useRef(false)
      const load = React.useCallback(() => {
        let live = true
        setPhase('loading')
        // Jobs never round-trip: JobView is push-only, so the rows arrive
        // from the sidebar's store through the open event. Nothing on the host
        // can enumerate or stop them (no job.* RPC, no jobs on the ApiProxy).
        if (view === 'jobs') { setData({ jobs: given || [] }); setPhase('ready'); return () => {} }
        const action = view === 'subagents' ? 'agent.list' : 'insight.' + view
        // `fresh` rides a ref, not state: the refresh button must bypass the
        // host's 60s cache, and a state flag would need its own render pass
        // before load() could read it. Consumed here so the NEXT load is a
        // normal cached one.
        const wantFresh = freshRef.current
        freshRef.current = false
        const arg = view === 'sessions' ? { orgId } : (wantFresh ? { sessionId, fresh: true } : { sessionId })
        postAction(action, arg).then((res) => {
          if (!live) return
          // The server says "unavailable" rather than inventing an empty
          // report — a repo with no GitHub link has no CI to show, and an
          // empty list would read as "your CI is fine".
          if (res && res.reason === 'unavailable') { setPhase('unavailable'); return }
          setData(res || {}); setPhase('ready')
        }, (e) => {
          if (!live) return
          // The host's seat refusals are dev-facing strings ("insight.streak
          // serves session seats"); translate the one the org seat always
          // hits, pass anything else through verbatim so real faults stay
          // diagnosable.
          const m = String((e && e.message) || e)
          setNote(/serves session seats/.test(m) ? t('insight.seatRequired') : m)
          setPhase('error')
        })
        return () => { live = false }
      }, [view, sessionId, orgId, given])
      React.useEffect(() => load(), [load, tick])
      // Stock grammar (docs/plans/git-card-stock-dock-rebuild.md §4): the
      // report is a ToolDetails card body; metrics are ToolRow IN/OUT
      // sections; runs and sessions are DisclosureRows exactly as tool calls
      // are. `I` + INSIGHT_CSS are lifted from the stock bundle by
      // scripts/gen-insight-css.mjs — nothing here is hand-styled except the
      // streak heat grid (no stock primitive) and the inline rename field.
      const root = (children) => h('div', { className: I.cardBody + ' ' + I.root, 'data-arxa-insight': view }, children)
      const empty = (text) => root(h('div', { className: I.empty }, text))
      if (phase === 'loading') return empty(t('insight.loading'))
      if (phase === 'unavailable') return empty(t('insight.unavailable'))
      if (phase === 'error') return root(h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note))
      const d = data || {}
      const ioSection = (key, label, body) => h('div', { key, className: I.ioSection },
        h('span', { className: I.ioLabel }, label),
        h('span', { className: I.ioText }, body))
      const divider = (key) => h('span', { key, className: I.ioDivider, 'aria-hidden': true })
      // A DisclosureRow that never expands: leading dot, title, then the
      // collapsed summary (sep · summary · suffix) — the stock ToolRow face.
      const row = (key, icon, title, summary, suffix) => h(P.DisclosureRow, {
        key, icon, title, open: false, expandable: false, onToggle: () => {},
        rowClassName: I.row, leadingClassName: I.leading, titleClassName: I.title, chevronClassName: I.chevron,
        collapsedContent: h(React.Fragment, null,
          summary ? h('span', { className: I.sep, 'aria-hidden': true }) : null,
          summary ? h('span', { className: I.summary }, summary) : null,
          suffix || null),
      })
      // Row actions reuse the host actions the card ALREADY owns — this panel
      // is a second place to reach them, never a second way to do them.
      const act = (label, action, arg) => {
        setBusy(label); setNote('')
        postAction(action, arg).then((r) => {
          setBusy(null)
          // A refused verb comes back ok:false with a reason — say it rather
          // than refreshing as though the action had landed.
          if (r && r.ok === false) { setNote(t('agents.why.' + String(r.reason || 'unavailable'))); return }
          setTick((n) => n + 1)
        }, (e) => { setBusy(null); setNote(String((e && e.message) || e)) })
      }
      // Trailing actions wear the stock ToolRow inspect-button face (revealed on row hover / focus).
      const trailing = (label, onClick, disabled) => h('button', {
        type: 'button', className: I.inspectButton, disabled: busy != null || disabled === true, onClick,
      }, label)
      if (view === 'streak') {
        const days = d.days || []
        if (days.length === 0) return empty(t('insight.streak.empty'))
        return root(h('div', { className: 'aXa_av_scroll' },
          h('div', { className: I.ioCard },
            ioSection('current', t('insight.streak.current'), String(d.current || 0)),
            divider('d1'),
            ioSection('longest', t('insight.streak.longest'), String(d.longest || 0)),
            divider('d2'),
            ioSection('days', t('insight.streak.days'),
              h('span', { className: 'aXa_av_streakGrid' },
                days.map((x) => h('span', {
                  key: x.day,
                  className: 'aXa_av_streakCell',
                  'data-level': String(streakLevel(x.count || 0)),
                  title: x.day + ' · ' + (x.count || 0),
                })))))))
      }
      // Q5 (2026-09-03): the session's children, in full, with the same
      // controls the header dropdown carries. The capability map rides on
      // every row from the host — a disabled button here says WHY on hover
      // rather than pretending the verb exists. See the sidebar host's
      // agent.* block for why a subagent pauses and a job cancels.
      if (view === 'jobs' || view === 'subagents') {
        const list = (view === 'jobs' ? d.jobs : d.subagents) || []
        if (list.length === 0) return empty(t(view === 'jobs' ? 'agents.jobs.empty' : 'agents.subagents.empty'))
        const verbAction = (row, verb) => {
          const allowed = row.can && row.can[verb] === true
          const why = row.why && row.why[verb]
          return h('button', {
            key: verb,
            type: 'button',
            className: I.inspectButton,
            disabled: busy != null || !allowed,
            title: allowed ? t('agents.' + verb) : t('agents.why.' + String(why || 'unavailable')),
            onClick: () => act('agent-' + verb, 'agent.' + verb, { sessionId, kind: row.kind, id: row.id }),
          }, t('agents.' + verb))
        }
        return root(h('div', { className: 'aXa_av_scroll' },
          note && h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note),
          list.map((row0) => row(row0.id,
            h(P.StateDot, { state: agentDot(row0) }),
            row0.label || row0.id,
            [row0.mode || row0.jobKind, row0.status || row0.activity, row0.detail].filter(Boolean).join(' · '),
            h(React.Fragment, null, ['pause', 'resume', 'cancel'].map((v) => verbAction(row0, v)))))))
      }
      // ---- the review surface (D1-D7) ------------------------------------
      // Replaces the retired standalone `ci` view: its per-run controls live
      // in the CI group at the bottom, so nothing that was reachable stopped
      // being reachable. The CARD header only ever reaches the newest run —
      // per-run re-run/cancel exists only here, which is why these buttons
      // had to move rather than be dropped with the view.
      if (view === 'review') {
        if (d.reason === 'no-pr' || !d.pr) return empty(t('insight.review.nopr'))
        const rt = (s2) => t('insight.review.' + s2)
        const when = (iso) => (iso ? String(iso).slice(0, 10) : '')
        const line = (x) => String(x.body || '').split('\n').find((l) => l.trim() !== '') || ''
        const visible = (list) => (showBots ? list : list.filter((c) => c.bot !== true))
        const send = (key, arg) => {
          const text = replyText.trim()
          if (text === '') return
          setReplyText(''); setReplyTo(null)
          act(key, 'insight.reply', { sessionId, number: d.pr.number, text, ...arg })
        }
        // One box, moved between rows. Enter sends, Escape abandons — the same
        // contract as the sidebar's wake box, so the two never teach different
        // habits for the same gesture.
        const replyBox = (key, arg) => (replyTo !== key ? null : h('input', {
          className: 'aXa_av_insightInput', autoFocus: true, value: replyText,
          placeholder: rt('reply'),
          onChange: (e) => setReplyText(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); send(key, arg) }
            if (e.key === 'Escape') { e.preventDefault(); setReplyTo(null); setReplyText('') }
          },
        }))
        const replyBtn = (key) => trailing(rt('reply'), () => { setReplyTo(replyTo === key ? null : key); setReplyText('') }, false)
        const section = (key, label, children) => (children.length === 0 ? null
          : h(React.Fragment, { key }, ioSection(key + '-h', label, String(children.length)), children))

        const needs = d.needs || []
        const threads = d.threads || []
        const runs = d.ci || []
        return root(h('div', { className: 'aXa_av_scroll' },
          note && h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note),
          // Header: what this is, and the two things you always want — a manual
          // refresh (D5 caches for 60s) and the way out to GitHub.
          h('div', { className: I.ioCard },
            ioSection('pr', '#' + d.pr.number, String(d.pr.title || '')),
            divider('dh'),
            ioSection('acts', '',
              h(React.Fragment, null,
                trailing(rt('refresh'), () => { freshRef.current = true; setTick((n) => n + 1) }, false),
                trailing(rt('bots'), () => setShowBots(!showBots), false),
                d.pr.url ? h('a', { className: I.summarySuffix, href: d.pr.url, target: '_blank', rel: 'noreferrer' }, rt('openPr')) : null))),
          // D3: the band. Everything here is something a person must act on.
          needs.length === 0 ? null : h(React.Fragment, null,
            ioSection('needs-h', rt('needs'), String(needs.length)),
            needs.map((n, i) => row('n' + i,
              h(P.StateDot, { state: n.kind === 'ci-failed' || n.kind === 'changes-requested' ? 'error' : 'warning' }),
              rt(n.kind),
              [n.by, n.path ? n.path + (n.line ? ':' + n.line : '') : null, n.job,
                (n.steps || []).map((x) => x.name).join(', ')].filter(Boolean).join(' · '),
              n.url ? h('a', { className: I.summarySuffix, href: n.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))),
          // D3: grouped below, each chronological as the host returned it.
          section('reviews', rt('reviews'), visible(d.reviews || []).map((r2) => row('rv' + r2.id,
            h(P.StateDot, { state: r2.state === 'APPROVED' ? 'done' : r2.state === 'CHANGES_REQUESTED' ? 'error' : 'warning' }),
            String(r2.login || ''),
            [String(r2.state || '').toLowerCase(), when(r2.createdAt), line(r2)].filter(Boolean).join(' · '),
            r2.url ? h('a', { className: I.summarySuffix, href: r2.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))),
          section('threads', rt('threads'), threads.map((th) => h(React.Fragment, { key: 'th' + th.id },
            row('t' + th.id,
              h(P.StateDot, { state: th.resolved ? 'done' : th.outdated ? 'warning' : 'error' }),
              String(th.path || '') + (th.line ? ':' + th.line : ''),
              [th.resolved ? rt('resolved') : null, th.outdated ? rt('outdated') : null,
                line(th.comments[0] || {})].filter(Boolean).join(' · '),
              h(React.Fragment, null,
                th.replyTo ? replyBtn(th.id) : null,
                trailing(th.resolved ? rt('unresolve') : rt('resolve'),
                  () => act('res' + th.id, 'insight.resolve', { sessionId, threadId: th.id, resolved: !th.resolved }), false))),
            replyBox(th.id, { commentId: th.replyTo })))),
          section('comments', rt('comments'), visible(d.comments || []).map((c) => row('c' + c.id,
            h(P.StateDot, { state: 'ongoing' }), String(c.login || ''),
            [when(c.createdAt), line(c)].filter(Boolean).join(' · '),
            c.url ? h('a', { className: I.summarySuffix, href: c.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))),
          // A bare reply to the PR itself — the one box that is always offered.
          h(React.Fragment, null,
            ioSection('reply-h', '', replyBtn('pr')),
            replyBox('pr', {})),
          section('issues', rt('issues'), (d.issues || []).map((i2) => row('i' + i2.number,
            h(P.StateDot, { state: i2.state === 'CLOSED' ? 'done' : 'ongoing' }),
            '#' + i2.number + ' ' + String(i2.title || ''),
            String((i2.comments || []).length) + ' · ' + String(i2.state || '').toLowerCase(),
            i2.url ? h('a', { className: I.summarySuffix, href: i2.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))),
          section('commits', rt('commits'), visible(d.commitNotes || []).map((c) => row('cn' + c.id,
            h(P.StateDot, { state: 'ongoing' }),
            String(c.oid || '').slice(0, 7) + ' ' + String(c.headline || ''),
            [c.login, line(c)].filter(Boolean).join(' · '),
            c.url ? h('a', { className: I.summarySuffix, href: c.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))),
          section('ci', rt('ci'), runs.map((run) => {
            const live = run.status !== 'completed'
            return row('run' + run.id,
              h(P.StateDot, { state: ciState(run) }),
              run.name || String(run.id),
              String(run.conclusion || run.status || '') + (run.headSha ? ' · ' + String(run.headSha).slice(0, 7) : ''),
              h(React.Fragment, null,
                trailing(t('insight.ci.rerun'), () => act('ci-rerun', 'card.ci.rerun', { sessionId, runId: run.id }), live),
                trailing(t('insight.ci.cancel'), () => act('ci-cancel', 'card.ci.cancel', { sessionId, runId: run.id }), !live),
                run.url ? h('a', { className: I.summarySuffix, href: run.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))
          })),
          needs.length === 0 && threads.length === 0 && (d.comments || []).length === 0 && (d.reviews || []).length === 0
            ? h('div', { className: I.empty }, rt('empty')) : null))
      }
      // sessions
      const rows = d.rows || []
      if (rows.length === 0) return empty(t('insight.sessions.empty'))
      const sessionDot = (state) => (state === 'open' ? 'ongoing' : state === 'archived' ? 'done' : 'warning')
      return root(h('div', { className: 'aXa_av_scroll' },
        note && h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note),
        rows.map((row0) => row(row0.id,
          h(P.StateDot, { state: sessionDot(row0.state) }),
          // Rename is an inline field, never window.prompt — Tauri's
          // WKWebView does not implement prompt (the sidebar learned this
          // the hard way and the selftest still guards it there).
          renaming === row0.id
            ? h('input', {
              className: 'aXa_av_insightInput', value: draft, autoFocus: true,
              'aria-label': t('insight.sessions.rename'),
              onChange: (e) => setDraft(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Escape') { setRenaming(null); return }
                if (e.key !== 'Enter' || draft.trim() === '') return
                setRenaming(null)
                act('rename', 'session.rename', { orgId: row0.orgId || orgId, sessionId: row0.id, name: draft.trim() })
              },
            })
            : (row0.name || row0.id),
          String(row0.state || '') + (row0.repo ? ' · ' + String(row0.repo) : ''),
          h(React.Fragment, null,
            trailing(t('insight.sessions.open'), () => act('open', 'session.open', { orgId: row0.orgId || orgId, sessionId: row0.id })),
            trailing(t('insight.sessions.rename'), () => { setRenaming(row0.id); setDraft(row0.name || row0.id) }),
            trailing(t('insight.sessions.archive'), () => act('archive', 'session.archive', { orgId: row0.orgId || orgId, sessionId: row0.id })))))))
    }
    function ArtifactPanel(props) {
      const frameProps = props || {}
      const t = frameProps.t || ((k) => k)
      const store = frameProps.avStore
      const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const [open, setOpen] = React.useState(false)
      const [state, setState] = React.useState({ phase: 'idle' })
      const [session, setSession] = React.useState(null)
      const [dirty, setDirty] = React.useState(false)
      const [savePhase, setSavePhase] = React.useState('idle') // idle|saving|saved|error|conflict
      const [saveNote, setSaveNote] = React.useState('')
      const [changes, setChanges] = React.useState([])
      // Stock textpreview parity (0.6.0): the changed-on-disk banner. A clean
      // buffer auto-reloads (better than stock's ask-first), and the banner
      // still appears for 5 s so the swap on screen is explained.
      const [changedFlash, setChangedFlash] = React.useState(0)
      React.useEffect(() => {
        if (!changedFlash) return
        const id = setTimeout(() => setChangedFlash(0), 5000)
        return () => clearTimeout(id)
      }, [changedFlash])
      const docRef = React.useRef(null)
      const mtimeRef = React.useRef(null)
      const dirtyRef = React.useRef(false)
      const externalRef = React.useRef(null)
      const wtRef = React.useRef(null)
      const saveTimer = React.useRef(null)
      const maxBytesRef = React.useRef(5 * 1024 * 1024)
      const seenSessionRef = React.useRef(null)
      const openArtifactRef = React.useRef(null)
      const openWorktreeRef = React.useRef(null)
      const openRequestRef = React.useRef(0)
      React.useEffect(() => { dirtyRef.current = dirty }, [dirty])

      const lane = state.kind ? state.kind.lane : null
      const editableLane = EDITABLE_LANES.has(lane)
      const canEdit = editableLane && !state.readOnly && (!!session || !!state.rootId)

      // D82 cap from the host settings namespace when available.
      React.useEffect(() => {
        let live = true
        ;(async () => {
          try {
            const conn = frameProps.hostCtx && frameProps.hostCtx.connection
            const { result } = await conn.api.settings.describe({})
            const row = result.ok && result.value.namespaces.find((n) => n.ns === 'arxa-artifact-viewer')
            if (live && row && row.value && Number(row.value.maxEditBytes) > 0) maxBytesRef.current = Number(row.value.maxEditBytes)
          } catch { /* default cap stands */ }
        })()
        return () => { live = false }
      }, [])

      // Open requests arrive as a PROP (0.6.0): the ViewerShell (or the stock
      // DocumentBody) owns the payload; a fresh object identity is a new open,
      // and the shell's reload is the same payload re-issued with a new tick.
      // The panel itself no longer consumes the shared store — only the shell
      // does — so a stock-tab panel and a strip tab can never race a payload.
      // The panel's mount time — the trace mark above needs it even though the
      // payload now arrives as a prop.
      const mountedAtRef = React.useRef(Math.round(performance.now()))
      React.useEffect(() => {
        const p = frameProps.request
        if (!p) return
        if (p.relPath && p.t0 != null) {
          trace.begin(p.relPath, p.t0)
          trace.mark('panel-mounted=' + (mountedAtRef.current - p.t0) + ' consumed')
        }
        if (p.kind === 'insight') {
          openRequestRef.current++
          setOpen(true)
          setState({ phase: 'insight', view: p.view, sessionId: p.sessionId || null, orgId: p.orgId || null, rows: p.rows || null })
          return
        }
        // Decision B (2026-09-07): a plain tree open goes through the CURRENT
        // session's copy when there is a session. That copy is where this
        // viewer's own saves land (D38: main is never edited directly), so it
        // is the only one that shows the user's edits — opening the org copy
        // made a saved edit look lost on the next click. A file the session
        // has no copy of (untracked in the org) falls back to the org lane.
        const rootId = p.rootId || null
        const sid = rootId ? null : (p.sessionId || store.getSnapshot().sessionId || null)
        if (p.relPath && p.t0 == null) trace.begin(p.relPath)
        if (rootId && p.relPath) {
          void (openArtifactRef.current && openArtifactRef.current(p.relPath, rootId))
        } else if (sid && p.relPath) {
          void Promise.resolve(openWorktreeRef.current && openWorktreeRef.current(sid, p.relPath, { quiet: true })).then((ok) => {
            if (ok) return
            void (openArtifactRef.current && openArtifactRef.current(p.relPath))
          })
        } else if (p.relPath) {
          void (openArtifactRef.current && openArtifactRef.current(p.relPath))
        }
      }, [frameProps.request])

      // D93 session switch: the dsh sessions service is the event source
      // (the 4 s ensureSession poll is gone). A current-session change resets
      // the panel to idle and re-binds the changes list.
      const refreshChanges = React.useCallback(async (sessionId) => {
        if (!sessionId) { setChanges([]); return }
        try {
          const { token } = await fetchTokenRaw({ scope: 'changes-read', worktreeId: sessionId })
          const r = await fetch('/__arxa/artifacts/session-changes?session=' + encodeURIComponent(sessionId) + '&avt=' + encodeURIComponent(token))
          const body = await r.json().catch(() => ({}))
          if (r.ok) setChanges(body.files || [])
        } catch { setChanges([]) }
      }, [])
      React.useEffect(() => {
        const id = snap.sessionId || null
        const prev = seenSessionRef.current
        if (prev === id) return
        seenSessionRef.current = id
        void refreshChanges(id)
        // 0.6.0: the persistent strip supersedes the 2026-09-01 close-on-
        // switch directive — tabs SURVIVE a session change (each worktree tab
        // holds its own session; org/root tabs are session-free), the way VS
        // Code tabs survive navigating between folders. Only the insight
        // report re-points at the new current session so it re-fetches; the
        // sessions view is org-keyed and ignores this.
        if (open && state.phase === 'insight') { setState((st) => ({ ...st, sessionId: id })) }
        // state.phase is a dep on purpose: the insight re-point reads it.
      }, [snap.sessionId, open, refreshChanges, state.phase])
      // D86 external-change push. Org lane: the org watcher. Worktree lane:
      // the same route with ?session= (host watches the worktree for this
      // connection). Clean buffer auto-reloads; dirty buffer conflicts.
      // The stream is TOKEN-GATED (Task 7): mint the lane's class first —
      // changes-read for a worktree, tree-read for a root or the org — and
      // open the EventSource only with it. A 403 makes the browser fail the
      // connection permanently (the SSE spec does not retry non-200s), so
      // onerror closes and re-mints instead of dying on a stale TTL.
      React.useEffect(() => {
        if (!open || !state.relPath || state.phase !== 'ready') return
        let disposed = false
        let es = null
        let retry = null
        const connect = async () => {
          if (disposed) return
          let q = ''
          try {
            if (wtRef.current) {
              const { token } = await fetchTokenRaw({ scope: 'changes-read', worktreeId: wtRef.current.sessionId })
              q = '?session=' + encodeURIComponent(wtRef.current.sessionId) + '&avt=' + encodeURIComponent(token)
            } else if (state.eventRootId) {
              const { token } = await fetchTokenRaw({ scope: 'tree-read', rootId: state.eventRootId })
              q = '?root=' + encodeURIComponent(state.eventRootId) + '&avt=' + encodeURIComponent(token)
            } else {
              const { token } = await fetchTokenRaw({ scope: 'tree-read' })
              q = '?avt=' + encodeURIComponent(token)
            }
          } catch {
            // No authority, no stream: the view still works, only live reload
            // is missing. Try again rather than block or crash.
            retry = setTimeout(connect, 5000)
            return
          }
          if (disposed) return
          es = new EventSource(EVENTS_ROUTE + q)
          es.onmessage = (m) => {
            try {
              const ev = JSON.parse(m.data)
              if (!matchesArtifactEvent(ev, state.relPath, state.eventRootId)) return
              if (dirtyRef.current) {
                externalRef.current = ev.mtimeMs
                setSavePhase('conflict')
                setSaveNote('')
              } else {
                const request = openRequestRef.current
                void (async () => {
                  try {
                    let text
                    let readMtime = ev.mtimeMs
                    if (wtRef.current) {
                      const { token } = await fetchTokenRaw({ scope: 'wt-read', worktreeId: wtRef.current.sessionId, relPath: state.relPath })
                      const r = await fetch('/__arxa/artifacts/wt?session=' + encodeURIComponent(wtRef.current.sessionId) + '&path=' + encodeURIComponent(state.relPath) + '&avt=' + encodeURIComponent(token))
                      if (!r.ok) return
                      readMtime = Number(r.headers.get('x-arxa-mtime-ms')) || ev.mtimeMs
                      text = await r.text()
                    } else if (state.rootId) {
                      const { token } = await fetchToken(state.relPath, null, state.rootId)
                      const r = await fetch(WT_ROUTE + '?root=' + encodeURIComponent(state.rootId) + '&path=' + encodeURIComponent(state.relPath) + '&avt=' + encodeURIComponent(token))
                      if (!r.ok) return
                      readMtime = Number(r.headers.get('x-arxa-mtime-ms')) || ev.mtimeMs
                      text = await r.text()
                    } else {
                      const { token, origin } = await fetchToken(state.relPath, null, null)
                      const r = await fetch(origin + '/' + encodeURI(state.relPath) + '?avt=' + encodeURIComponent(token))
                      if (!r.ok) return
                      text = await r.text()
                    }
                    if (disposed || request !== openRequestRef.current) return
                    // The buffer may have become dirty while token/read awaited.
                    // Keep those edits and surface the same conflict UI as an
                    // event that arrived dirty in the first place.
                    if (dirtyRef.current) {
                      externalRef.current = readMtime
                      setSavePhase('conflict')
                      setSaveNote('')
                      return
                    }
                    mtimeRef.current = readMtime
                    setState((s) => ({ ...s, text }))
                    setChangedFlash(Date.now())
                  } catch { /* transient */ }
                })()
              }
            } catch {}
          }
          es.onerror = () => {
            try { es.close() } catch {}
            // Re-mint, then reconnect: the token that opened this stream has
            // a short TTL, and EventSource never retries a non-200 itself.
            if (!disposed) retry = setTimeout(connect, 3000)
          }
        }
        void connect()
        return () => { disposed = true; if (retry) clearTimeout(retry); if (es) { try { es.close() } catch {} } }
      }, [open, state.relPath, state.phase, state.rootId, state.eventRootId])

      const resetForOpen = () => {
        setDirty(false); setSavePhase('idle'); setSaveNote(''); mtimeRef.current = null
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      }

      /** Editable lanes ensure the session AT OPEN (D80 transparent ensure,
       * moved off the old edit toggle): the lane lands already-editable, or
       * view-only with the reason when the ensure/guards refuse. */
      const applyEditability = async (kind, relPath, text, len, prebound, rootId) => {
        const cap = maxBytesRef.current
        if (len > cap) {
          return { readOnly: true, guardNote: t('guard.tooLarge', { size: Math.round(len / 1048576 * 10) / 10, cap: Math.round(cap / 1048576 * 10) / 10 }), session: prebound || null }
        }
        if (text.slice(0, 8192).includes('\u0000')) {
          return { readOnly: true, guardNote: t('guard.binary'), session: prebound || null }
        }
        if (prebound) return { readOnly: false, guardNote: '', session: prebound }
        if (rootId) return { readOnly: false, guardNote: '', session: null }
        try {
          const s = await ensureSession()
          return { readOnly: false, guardNote: '', session: s }
        } catch (e) {
          const reason = String(e && e.message || e)
          return { readOnly: true, guardNote: reason === 'no org open' ? t('guard.noOrg') : t('error.session', { reason }), session: null }
        }
      }

      const openArtifact = async (relPathArg, rootId = null) => {
        const relPath = String(relPathArg || '').trim().replace(/^\/+/, '')
        if (!relPath) return
        const request = ++openRequestRef.current
        resetForOpen()
        setSession(null)
        setOpen(true)
        wtRef.current = null
        setState({ phase: 'loading', relPath, rootId })
        trace.mark(rootId ? 'root:loading' : 'org:loading')
        try {
          const [{ token, origin, absPath }, root] = await Promise.all([
            fetchToken(relPath, null, rootId),
            fetchRoot(rootId),
          ])
          if (request !== openRequestRef.current) return
          trace.mark('token')
          const url = rootId
            ? WT_ROUTE + '?root=' + encodeURIComponent(rootId) + '&path=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token)
            : origin + '/' + encodeURI(relPath) + '?avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          if (EDITABLE_LANES.has(kind.lane)) {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            if (request !== openRequestRef.current) return
            const readMtime = rootId ? Number(r.headers.get('x-arxa-mtime-ms')) || null : null
            const len = Number(r.headers.get('content-length') || '0')
            const text = await r.text()
            trace.mark('bytes')
            const edit = await applyEditability(kind, relPath, text, len, null, rootId)
            if (request !== openRequestRef.current) return
            if (rootId) mtimeRef.current = readMtime
            trace.mark('session')
            setSession(edit.session)
            setState({ phase: 'ready', kind, relPath, url, text, absPath, rootId,
              eventRootId: root?.id ?? null, rootName: rootId ? root?.name ?? null : null,
              readOnly: edit.readOnly, guardNote: edit.guardNote })
          } else {
            if (request !== openRequestRef.current) return
            setState({ phase: 'ready', kind, relPath, url, rootId,
              eventRootId: root?.id ?? null, rootName: rootId ? root?.name ?? null : null })
            trace.end('ready:' + kind.lane)
          }
        } catch (e) {
          if (request !== openRequestRef.current) return
          trace.end('error')
          setState({ phase: 'error', relPath, note: t('error.load', { path: relPath, reason: String(e && e.message || e) }) })
        }
      }

      const openWorktree = async (sessionId, relPath, { quiet = false } = {}) => {
        if (!sessionId || !relPath) return false
        const request = ++openRequestRef.current
        resetForOpen()
        setOpen(true)
        setState({ phase: 'loading', relPath })
        trace.mark('wt:loading')
        wtRef.current = { sessionId }
        try {
          const prebound = { id: sessionId, name: sessionId }
          setSession(prebound)
          const { token, absPath } = await fetchTokenRaw({ scope: 'wt-read', worktreeId: sessionId, relPath })
          if (request !== openRequestRef.current) return true
          trace.mark('token')
          const url = '/__arxa/artifacts/wt?session=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          if (EDITABLE_LANES.has(kind.lane)) {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            if (request !== openRequestRef.current) return true
            const readMtime = Number(r.headers.get('x-arxa-mtime-ms')) || null
            const len = Number(r.headers.get('content-length') || '0')
            const text = await r.text()
            trace.mark('bytes')
            const edit = await applyEditability(kind, relPath, text, len, prebound, null)
            if (request !== openRequestRef.current) return true
            mtimeRef.current = readMtime
            setSession(edit.session)
            setState({ phase: 'ready', kind, relPath, url, text, absPath, readOnly: edit.readOnly, guardNote: edit.guardNote, wt: sessionId })
            return true
          }
          if (request !== openRequestRef.current) return true
          setState({ phase: 'ready', kind, relPath, url, wt: sessionId })
          trace.end('ready:' + kind.lane)
          return true
        } catch (e) {
          if (request !== openRequestRef.current) return true
          trace.mark('wt:miss')
          // quiet: the caller has an org-lane fallback, and a file the session
          // has no copy of must not flash an error on its way there.
          if (!quiet) setState({ phase: 'error', relPath, note: t('error.load', { path: relPath, reason: String(e && e.message || e) }) })
          return false
        }
      }
      openArtifactRef.current = openArtifact
      openWorktreeRef.current = openWorktree

      const save = async (force = false) => {
        if ((!session && !state.rootId) || !state.relPath || !docRef.current) return
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
        // Freeze one coherent write before the token wait. Navigation replaces
        // docRef.current; reading it after await could send the new document's
        // bytes to the old root/path captured by this render.
        const request = openRequestRef.current
        const targetRootId = state.rootId ?? null
        const targetSessionId = session?.id ?? null
        const targetRelPath = state.relPath
        let content
        try { content = docRef.current.getText() }
        catch (e) { setSavePhase('error'); setSaveNote(String(e && e.message || e)); return }
        const expectedMtimeMs = mtimeRef.current
        setSavePhase('saving'); setSaveNote('')
        try {
          const { token } = await fetchToken(null, targetSessionId, targetRootId)
          const res = await fetch(WRITE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-arxa-write-token': token },
            body: JSON.stringify({
              ...(targetRootId ? { rootId: targetRootId } : { worktreeId: targetSessionId }),
              relPath: targetRelPath,
              content,
              ...(!force && expectedMtimeMs != null ? { expectedMtimeMs } : {}),
            }),
          })
          const body = await res.json().catch(() => ({}))
          if (request !== openRequestRef.current) return
          if (res.status === 409) {
            setSavePhase('conflict'); setSaveNote('')
            if (body.mtimeMs) mtimeRef.current = body.mtimeMs
            return
          }
          if (!res.ok) throw new Error(body.error || ('write ' + res.status))
          mtimeRef.current = body.mtimeMs
          setDirty(false)
          setSavePhase('saved')
          setSaveNote(body.committed ? t('saved.committed', { session: state.rootName || session?.name || targetRootId }) : t('saved.wipPending', { warning: body.warning || '?' }))
        } catch (e) {
          if (request !== openRequestRef.current) return
          setSavePhase('error'); setSaveNote(String(e && e.message || e))
        }
      }

      /** Auto-save: 1.5 s after the last keystroke (Claude: no save button). */
      const onDirty = () => {
        setDirty(true)
        if (savePhase === 'saved') setSavePhase('idle')
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => { void save() }, AUTOSAVE_MS)
      }
      React.useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

      const reloadTheirs = async () => {
        const rel = state.relPath
        if (!rel) return
        if (wtRef.current) await openWorktree(wtRef.current.sessionId, rel)
        else await openArtifact(rel, state.rootId ?? null)
      }

      // The 2026 palette effect is gone with CodeMirror. It read ArxaTheme out of
      // the CM bundle to theme the editor, the markdown preview and the pane
      // background; VS Code paints all three itself now, from its own theme.
      const filename = state.relPath ? state.relPath.split('/').pop() : null

      const dotState = dotStateOf(savePhase, dirty)
      const dotVisible = editableLane && state.phase === 'ready' && (dirty || savePhase !== 'idle' || canEdit)
      const dotLabel = savePhase === 'conflict' ? t('state.conflict')
        : savePhase === 'saving' ? t('state.saving')
        : dirty ? t('state.dirty')
        : savePhase === 'saved' ? (saveNote || t('state.saved'))
        : session ? t('session.badge', { name: session.name }) : (state.rootName || t('state.saved'))

      // ---- chrome handoff (0.6.0) ----------------------------------------------
      // The panel renders BARE, always: the ViewerShell owns the tab strip
      // and the document header (path, renderer dropdown, wrap, reload) for
      // strip tabs; the stock document tab owns the same chrome for its own
      // lane. What the panel still owns is the META those headers need —
      // reported up through onMeta whenever a value moves.
      const isInsight = state.phase === 'insight'
      const pathText = isInsight ? String(state.orgId || state.sessionId || '') : String(state.absPath || state.relPath || '')
      const onMetaRef = React.useRef(frameProps.onMeta)
      React.useEffect(() => { onMetaRef.current = frameProps.onMeta })
      React.useEffect(() => {
        if (!onMetaRef.current) return
        onMetaRef.current({
          filename, pathText, isInsight, view: state.view || null, phase: state.phase,
          lane, editableLane, canEdit: !!canEdit, dirty, savePhase, dotState, dotLabel, dotVisible,
        })
      }, [filename, pathText, isInsight, state.view, state.phase, lane, editableLane, canEdit, dirty, savePhase, dotState, dotLabel, dotVisible])

      // ---- body ----------------------------------------------------------------
      let body = null
      if (state.phase === 'idle') {
        body = h('div', { className: 'aXa_av_idle' },
          h('div', { className: 'aXa_av_hint' }, t('idle.hint')),
          changes.length > 0 && h(React.Fragment, null,
            h('div', { className: 'aXa_av_sectionTitle' }, t('idle.changes')),
            changes.map((f) => h('button', {
              key: f.relPath || f, className: 'aXa_av_changeRow',
              onClick: () => {
                const rel = f.relPath || f
                const s = seenSessionRef.current
                if (s) void openWorktree(s, rel)
              },
            },
              h(P.IconEditOutline16, { size: 14 }),
              h('span', { className: 'aXa_av_changePath' }, f.relPath || f)))))
      } else if (state.phase === 'insight') {
        body = h(InsightPanel, { t, view: state.view, sessionId: state.sessionId, orgId: state.orgId, given: state.rows || null })
      } else if (state.phase === 'loading') {
        body = h('div', { className: 'aXa_av_idle' }, h('div', { className: 'aXa_av_hint' }, t('loading') + ' ' + state.relPath))
      } else if (state.phase === 'error') {
        body = h('div', { className: 'aXa_av_idle' }, h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, state.note))
      } else if (state.phase === 'ready') {
        const notes = []
        if (state.guardNote) notes.push(h('div', { key: 'guard', className: 'aXa_av_note' }, state.guardNote))
        if (changedFlash) {
          notes.push(h('div', { key: 'changed', className: 'aXa_av_changed' },
            h('span', null, t('changed.note')),
            h('button', { type: 'button', className: 'aXa_av_changedAction', onClick: () => { void reloadTheirs() } }, t('changed.reload'))))
        }
        if (savePhase === 'conflict') {
          notes.push(h('div', { key: 'conflict', className: 'aXa_av_conflict' },
            h('span', { className: 'aXa_av_conflictText' }, t('conflict.note')),
            h(P.Button, { variant: 'outline', onClick: () => { void reloadTheirs() } }, t('conflict.reload')),
            h(P.Button, { variant: 'primary', onClick: () => { void save(true) } }, t('conflict.overwrite'))))
        } else if ((savePhase === 'error' || savePhase === 'saved') && saveNote) {
          notes.push(h('div', { key: 'note', className: 'aXa_av_note', 'data-tone': savePhase === 'error' ? 'error' : undefined }, saveNote))
        }

        let surface = null
        // Markdown has TWO renderers (0.6.0, stock openWith parity): dsh's
        // exact MarkdownText (rendered-primary, read-only) and the arxa
        // editor (monaco source, editable). The shell's dropdown picks.
        const renderedMd = lane === 'markdown' && frameProps.renderer !== 'editor'
        if (renderedMd) {
          surface = h('div', { key: 'surface', className: 'aXa_av_mdDoc', 'data-arxa-md': state.relPath },
            h(P.MarkdownText, {
              text: state.text, streaming: false,
              labels: { code: { copyLabel: t('md.copy'), copiedLabel: t('md.copied') }, footnotes: t('md.footnotes') },
            }))
        } else if (editableLane) {
          // Keyed: the notes above it come and go (the "saved" note lands
          // 1.5s after the first keystroke), and an unkeyed sibling shifting
          // index is a remount of the live editor.
          surface = h(CodeView, { key: 'surface', relPath: state.relPath, absPath: state.absPath, session: state.wt ?? null, rootId: state.rootId ?? null, text: state.text, editable: canEdit, docRef, onDirty, wrap: !!frameProps.wrap, t })
        } else if (lane === 'image') {
          surface = h('div', { className: 'aXa_av_scroll' }, h('div', { className: 'aXa_av_media' }, h('img', { src: state.url, alt: state.relPath })))
        } else if (lane === 'audio') {
          surface = h('div', { className: 'aXa_av_scroll' }, h('div', { className: 'aXa_av_media' }, h('audio', { src: state.url, controls: true })))
        } else if (lane === 'video') {
          surface = h('div', { className: 'aXa_av_scroll' }, h('div', { className: 'aXa_av_media' }, h('video', { src: state.url, controls: true })))
        } else if (lane === 'iframe') {
          surface = h('iframe', { src: state.url, sandbox: 'allow-scripts', title: state.relPath, className: 'aXa_av_iframe' })
        } else if (lane === 'pdf') {
          surface = h(PdfView, { url: state.url, t })
        } else {
          surface = h('div', { className: 'aXa_av_idle' }, h('div', { className: 'aXa_av_hint' }, state.note || t('unknown.note')))
        }
        body = h(React.Fragment, null, ...notes, surface)
      }

      return h('div', { className: 'aXa_av_root' }, h('div', { className: 'aXa_av_body' }, body))
    }

    /** Decode a dsh resource address for a session workspace file — the same
     *  grammar dsh-client-ui-sidebar-files builds (`dsh-resource://file/
     *  session/<id>/<workspace-relative-path>`, segments encodeURIComponent'd
     *  with ':' restored). The document-preview slot hands the panel its file
     *  as this address; the av-open lane hands it the same parts directly. */
    function parseFileAddress(addr) {
      const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(String(addr || ''))
      if (!m) return null
      const dec = (s) => { try { return decodeURIComponent(s) } catch { return s } }
      return { sessionId: dec(m[1]), relPath: m[2].split('/').map(dec).join('/') }
    }

    /** Document-preview seat body: one rightbar document tab mounting the
     *  EDITOR (the not-owning lane — the strip above owns the column while
     *  it holds tabs). The slot hands us resourceAddress (the dsh-resource://
     *  file address); decode it into the panel's `request` prop exactly like
     *  an av-open payload, so worktree-first resolution, guards and the save
     *  flow apply to stock-opened files identically. BARE: the stock tab
     *  already drew the capsule and document header. */
    function DocumentBody(props) {
      const addr = props.resourceAddress
      const request = React.useMemo(() => {
        const f = parseFileAddress(addr)
        return f ? { sessionId: f.sessionId, relPath: f.relPath, t0: Math.round(performance.now()) } : null
      }, [addr])
      return h(ArtifactPanel, { ...props, request, bare: true })
    }

    // ---- the column occupant (0.6.0) ----------------------------------------
    /** The tabbed viewer that OWNS the rightbar track: portal-mounted into
     *  the frame's [data-rightbar-col] node (position:relative in the stock
     *  layout), so the stock grid gives the column its width, the stock drag
     *  handle resizes it, and nothing floats over the centre — "no sheet
     *  overlap" is by construction. Tabs: one per open identity (file+lane /
     *  insight), all panels stay mounted (editors, dirty buffers and save
     *  timers survive switches — VS Code tab semantics), inactive ones
     *  display:none. Persisted per org in localStorage. While the strip holds
     *  tabs the column carries data-arxa-owns and CSS hides the stock
     *  sidebar-right surface (grill rule A: the right column IS this viewer);
     *  closing the last tab releases it back.
     *  kimitail: no drag-reorder of chips, no per-tab dirty dot in the chip
     *  beyond the StateDot — add when asked. */
    function ViewerShell({ avStore, hostCtx, t }) {
      const store = avStore
      const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const [tabs, setTabs] = React.useState([])
      const [activeId, setActiveId] = React.useState(null)
      const [metas, setMetas] = React.useState({})
      const [frameState, setFrameState] = React.useState({ collapsed: false, fullscreen: false })
      const [colNode, setColNode] = React.useState(null)

      const layoutCall = (fn) => {
        try { const L = hostCtx && hostCtx.layout; if (L) fn(L) } catch { /* face not wired yet */ }
      }

      const defaultRendererFor = (p) => (p.kind !== 'insight' && kindFor(p.relPath || '').lane === 'markdown' ? 'markdown' : 'editor')
      const tabIdOf = (p) => p.kind === 'insight'
        ? 'insight:' + p.view + ':' + (p.orgId || p.sessionId || '')
        : p.rootId ? 'root:' + p.rootId + ':' + p.relPath
        : p.sessionId ? 'wt:' + p.sessionId + ':' + p.relPath
        : 'org:' + p.relPath
      const makeTab = (p) => ({ id: tabIdOf(p), payload: p, wrap: false, renderer: defaultRendererFor(p) })

      const openTabRef = React.useRef(null)
      const openTab = (p) => {
        const id = tabIdOf(p)
        setTabs((cur) => cur.some((x) => x.id === id)
          ? cur.map((x) => (x.id === id ? { ...x, payload: p } : x))
          : cur.concat(makeTab(p)))
        setActiveId(id)
        layoutCall((L) => L.openRightbar(true, false))
      }
      openTabRef.current = openTab

      // Ingress: ONE consumer for the parking lot — apply()'s listener parks,
      // the shell opens the tab.
      React.useEffect(() => {
        const p = store.consume()
        if (p) openTabRef.current(p)
      }, [snap.tick, store])

      // Locate the column node, then watch the FRAME's presentation attrs
      // (the layout package sets data-rightbar-collapsed / -fullscreen on the
      // frame root, not the column). col.parentElement is the frame — the
      // layout JSX lays them as siblings; if a future dsh wraps the column,
      // the observer never fires and only the edge chip degrades.
      React.useEffect(() => {
        if (typeof document === 'undefined' || !document.body) return () => {}
        let dead = false
        let obs = null
        let wait = null
        const readFrame = (frame) => setFrameState({
          collapsed: frame.hasAttribute('data-rightbar-collapsed'),
          fullscreen: frame.hasAttribute('data-rightbar-fullscreen'),
        })
        const attach = (col) => {
          if (dead) return
          setColNode(col)
          const frame = col.parentElement
          if (!frame) return
          readFrame(frame)
          obs = new MutationObserver(() => readFrame(frame))
          obs.observe(frame, { attributes: true, attributeFilter: ['data-rightbar-collapsed', 'data-rightbar-fullscreen'] })
        }
        const col = document.querySelector('[data-rightbar-col]')
        if (col) { attach(col); return () => { dead = true; if (obs) obs.disconnect() } }
        // The frame has not rendered its track yet — wait for it the same way
        // the auto-open observer waits for rows (no timers).
        wait = new MutationObserver(() => {
          const c = document.querySelector('[data-rightbar-col]')
          if (c) { wait.disconnect(); attach(c) }
        })
        wait.observe(document.body, { childList: true, subtree: true })
        return () => { dead = true; wait.disconnect(); if (obs) obs.disconnect() }
      }, [])

      // Ownership: hold the column while any tab lives; release on empty.
      React.useEffect(() => {
        if (!colNode) return
        if (tabs.length > 0) colNode.setAttribute('data-arxa-owns', '')
        else colNode.removeAttribute('data-arxa-owns')
      }, [colNode, tabs.length])

      // Persistence (per open org). Restored AFTER the key resolves so the
      // boot-time empty strip cannot clobber the saved one; saved on every
      // change once the restore attempt has run.
      const persistKeyRef = React.useRef(null)
      const restoredRef = React.useRef(false)
      React.useEffect(() => {
        let dead = false
        fetch(STATE_ROUTE).then((r) => r.json().catch(() => ({}))).then((st) => {
          if (dead) return
          const orgs = (st && st.orgs) || []
          const org = orgs.find((o) => o.open) || orgs[0]
          persistKeyRef.current = 'arxa-av-tabs:v1:' + ((org && org.id) || 'default')
          try {
            const saved = JSON.parse(localStorage.getItem(persistKeyRef.current) || 'null')
            if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
              // t0 is a previous page-life's performance.now — strip it.
              const restored = saved.tabs.map((p) => makeTab({ ...p, t0: null }))
              setTabs(restored)
              setActiveId(restored.some((x) => x.id === saved.activeId) ? saved.activeId : restored[0].id)
            }
          } catch { /* fresh strip */ }
        }).catch(() => {}).finally(() => { if (!dead) restoredRef.current = true })
        return () => { dead = true }
      }, [])
      React.useEffect(() => {
        if (!restoredRef.current || !persistKeyRef.current) return
        try {
          localStorage.setItem(persistKeyRef.current, JSON.stringify({ tabs: tabs.map((x) => x.payload), activeId }))
        } catch { /* quota or private mode */ }
      }, [tabs, activeId])

      const closeTab = (id) => {
        const idx = tabs.findIndex((x) => x.id === id)
        if (idx === -1) return
        const next = tabs.filter((x) => x.id !== id)
        setTabs(next)
        if (activeId === id) setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : null)
        setMetas((m) => { const n = { ...m }; delete n[id]; return n })
        if (next.length === 0) {
          // Last tab: release the column. On the dashboard nothing would fill
          // the open track (the empty-column look), so close it; inside a
          // conversation the stock surface returns and keeps the track.
          if (!(typeof document !== 'undefined' && document.querySelector('[data-conversation-scroll]'))) {
            layoutCall((L) => L.closeRightbar())
          }
        }
      }
      const reloadActive = () => {
        setTabs((cur) => cur.map((x) => (x.id === activeId
          ? { ...x, payload: { ...x.payload, t0: Math.round(performance.now()), tick: (x.payload.tick || 0) + 1 } }
          : x)))
      }
      const patchTab = (id, patch) => setTabs((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x)))

      const active = tabs.find((x) => x.id === activeId) || null
      const meta = (active && metas[active.id]) || null
      const chipTitle = (tab) => {
        const m = metas[tab.id]
        if (m) return m.isInsight ? t('insight.title.' + m.view) : (m.filename || t('title'))
        const p = tab.payload
        return p.kind === 'insight' ? t('insight.title.' + p.view) : String(p.relPath || '').split('/').pop() || t('title')
      }
      // Renderer candidates (stock openWith semantics): markdown files offer
      // MarkdownText (rendered, dsh's exact renderer) and the arxa editor;
      // media lanes label their single native lane; everything else is the
      // arxa editor.
      const candidates = !meta || meta.isInsight ? []
        : meta.lane === 'markdown'
          ? [{ id: 'markdown', label: t('renderer.markdown') }, { id: 'editor', label: t('renderer.editor') }]
          : (meta.phase === 'ready' && !meta.editableLane && meta.lane)
            ? [{ id: 'editor', label: t('lane.' + meta.lane) }]
            : [{ id: 'editor', label: t('renderer.editor') }]
      const anchorLabel = candidates.length > 0 && candidates.some((c) => c.id === active?.renderer)
        ? candidates.find((c) => c.id === active.renderer).label
        : (candidates[0] ? candidates[0].label : t('renderer.editor'))
      const [menuOpen, setMenuOpen] = React.useState(false)
      const showWrap = !!(meta && meta.editableLane && meta.phase === 'ready' && active && active.renderer === 'editor')

      if (!colNode || tabs.length === 0) return null

      const strip = h('div', { className: 'aXa_av_strip' },
        tabs.map((tab) => h('div', {
          key: tab.id, className: 'aXa_av_tab', 'data-active': tab.id === activeId ? '' : undefined,
          role: 'tab', 'aria-selected': tab.id === activeId, onClick: () => setActiveId(tab.id),
        },
          h(FileIcon, { name: chipTitle(tab) }),
          h('span', { className: 'aXa_av_tabTitle' }, chipTitle(tab)),
          metas[tab.id] && metas[tab.id].dotVisible && h(P.Tooltip, { label: metas[tab.id].dotLabel, delayMs: 500, side: 'bottom' },
            h('span', { style: { display: 'inline-flex', alignItems: 'center' } }, h(P.StateDot, { state: metas[tab.id].dotState }))),
          h('button', { className: 'aXa_av_tabClose', 'aria-label': t('close'), onClick: (e) => { e.stopPropagation(); closeTab(tab.id) } },
            h(P.IconCloseOutline16, { size: 12 })))),
        h('div', { className: 'aXa_av_stripEnd' },
          h(P.Tooltip, { label: frameState.fullscreen ? t('action.restore') : t('action.fullscreen'), delayMs: 500, side: 'bottom' },
            h('button', { className: 'aXa_av_iconBtn', 'aria-label': frameState.fullscreen ? t('action.restore') : t('action.fullscreen'),
              onClick: () => layoutCall((L) => L.openRightbar(true, !frameState.fullscreen)) },
              h(P.IconFullscreenOutline16, { size: 14 }))),
          h(P.Tooltip, { label: t('action.collapse'), delayMs: 500, side: 'bottom' },
            h('button', { className: 'aXa_av_iconBtn', 'aria-label': t('action.collapse'),
              onClick: () => layoutCall((L) => L.closeRightbar()) },
              h(P.IconChevronRightOutline14, { size: 14 })))))

      const docHead = h('div', { className: 'aXa_av_docHead' },
        h('span', { className: 'aXa_av_docPath', title: meta ? meta.pathText : '' },
          meta && (() => { const s = meta.pathText.lastIndexOf('/'); return h(React.Fragment, null,
            s > 0 ? h('span', { className: 'aXa_av_docDir' }, meta.pathText.slice(0, s + 1)) : null,
            h('span', { className: 'aXa_av_docName' }, s > 0 ? meta.pathText.slice(s + 1) : meta.pathText)) })()),
        candidates.length > 1
          ? h(P.Menu, {
              open: menuOpen,
              anchor: h('button', { type: 'button', className: 'aXa_av_tool', 'aria-label': t('action.openWith'),
                'data-arxa-renderer-menu': true, onClick: () => setMenuOpen((v) => !v) }, anchorLabel),
              items: candidates,
              selectedId: active ? active.renderer : undefined,
              onSelect: (id) => { if (active) patchTab(active.id, { renderer: id }); setMenuOpen(false) },
              onClose: () => setMenuOpen(false),
              align: 'end', portal: true, dense: true,
            })
          : h('span', { className: 'aXa_av_rendererName' }, anchorLabel),
        showWrap && h(P.Tooltip, { label: t(active && active.wrap ? 'wrap.off' : 'wrap.on'), delayMs: 500, side: 'bottom' },
          h('button', { type: 'button', className: 'aXa_av_iconBtn', 'aria-pressed': !!(active && active.wrap),
            'aria-label': t('wrap.on'), 'data-arxa-tool': 'wrap',
            onClick: () => { if (active) patchTab(active.id, { wrap: !active.wrap }) } },
            active && active.wrap ? h(IconNowrapFill16, {}) : h(IconWrapFill16, {}))),
        h(P.Tooltip, { label: t('action.reload'), delayMs: 500, side: 'bottom' },
          h('button', { className: 'aXa_av_iconBtn', 'aria-label': t('action.reload'), onClick: reloadActive },
            h(P.IconRefreshOutline16, { size: 14 }))))

      const body = h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
        tabs.length === 0 ? null : tabs.map((tab) => h('div', {
          key: tab.id,
          style: { flex: '1 1 auto', minHeight: 0, display: tab.id === activeId ? 'flex' : 'none', flexDirection: 'column' },
        },
          h(ArtifactPanel, {
            avStore: store, hostCtx, request: tab.payload, wrap: tab.wrap, renderer: tab.renderer, t,
            onMeta: (m) => setMetas((prev) => ({ ...prev, [tab.id]: m })),
          }))))

      // The way back in while collapsed: stock hosts its expand button in the
      // conversation header (session-bound); ours is a session-less edge chip.
      const edgeChip = frameState.collapsed && tabs.length > 0
        ? ReactDOM.createPortal(
          h('button', { type: 'button', className: 'aXa_av_edgeChip', 'aria-label': t('action.expand'), 'data-arxa-edge-chip': true,
            onClick: () => layoutCall((L) => L.openRightbar(true, false)) },
            h(P.IconPanelLeftOutline16, { size: 14 })),
          document.body)
        : null

      return ReactDOM.createPortal(
        h('div', { className: 'aXa_av_colHost', 'data-arxa-viewer': '' }, strip, docHead, body),
        colNode,
        edgeChip)
    }

    // ---- apply: registration + every side effect inside ctx.effect -----------
    function apply(ctx) {
      ensureCss()
      const store = createAvStore()
      const sessions = ctx.get('sessions')

      ctx.effect(() => ctx.locale.register(NS, { en, pl, fr }), 'arxa-av: dictionaries')

      // Mirror the current dsh session into the store (panel rebind rides it).
      // The 2026-09-01 "opening a session closes the viewer" directive now
      // rides the right sidebar's OWN session scoping: 0.1.5 tabs are
      // per-session, so a session switch swaps the tab tree natively. The
      // old layout-level closeViewer hack died with the retired column.
      ctx.effect(() => {
        if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return () => {}
        return sessions.list.subscribe(() => {
          let cur = null
          try { cur = (sessions.list.getSnapshot() || {}).current ?? null } catch { return }
          store.setSession(cur)
        })
      }, 'arxa-av: session mirror')

      // Warm the editor before the first click. Traced 2026-09-07: a cold first
      // open cost ~1s, of which the bundle import and VS Code's boot were
      // ~600ms; every later open was ~0.2s. Deferred so it never competes with
      // the shell's own startup; a click before it lands just waits on the same
      // promise. The container is a throwaway — the workbench mounts on
      // document.body and the editor part attaches to the real host at open.
      // The palette and font are read HERE, not defaulted inside start(): the
      // workbench boots once and paints body-level chrome (context menus,
      // toasts, scrollbars), so a dark default booted over a light shell as
      // mixed UI — the theme only ever caught up after a file open, and only
      // sometimes (measured 2026-09-15: body stuck vs-dark, editor vs).
      ctx.effect(() => {
        const id = setTimeout(() => {
          ensureMonaco().then((M) => M.start(document.createElement('div'), { dark: isDarkMode(), fontFamily: studioEditorFont(), colors: studioColors() })).catch(() => { /* the open path reports */ })
        }, 1500)
        return () => clearTimeout(id)
      }, 'arxa-av: warm editor')

      // Palette mirror for the workbench's LIFETIME, not an editor mount's:
      // the per-mount watcher was unwatched by every CodeView remount, so a
      // palette flip between mounts never reached Monaco at all (measured
      // 2026-09-15: body[data-ds-dark-theme] toggled, the theme did not move).
      // One sub, armed at apply; it only flips a workbench that loaded.
      ctx.effect(() => watchPalette((dark) => {
        if (monacoMod) monacoMod.then((M) => { M.setTheme(dark, studioColors()) }).catch(() => { /* the open path reports */ })
      }), 'arxa-av: palette mirror')

      // Column shell (0.6.0): the ViewerShell root outlives every panel — it
      // mounts once per page, portals into [data-rightbar-col] when the frame
      // renders it, and consumes the ingress store (the sheet host it
      // replaces died here).
      ctx.effect(() => {
        if (typeof document === 'undefined' || !document.body) return () => {}
        const host = document.createElement('div')
        document.body.appendChild(host)
        const root = ReactDOMClient.createRoot(host)
        root.render(h(ViewerShell, { avStore: store, hostCtx: ctx, t: ctx.locale.bind(NS) }))
        return () => { try { root.unmount() } catch { /* already gone */ } host.remove() }
      }, 'arxa-av: column shell')

      // Public ingress: ONE listener for 'arxa-av-open' (sidebar file rows,
      // gen-ui cards and the produced-file observer all dispatch it).
      // Routing (0.6.0): EVERY open lands in the strip — the shell occupies
      // the rightbar track session-less (the frame owns the track and its
      // drag handle; dsh's session-surface rule stopped mattering when we
      // stopped routing through openResource). No jumps: the operator never
      // leaves the dashboard to view a file.
      //
      // An explicit open suppresses the auto-open observer below for 10s
      // (2026-09-15): entering the conversation mounts the restored
      // produced-files row, and the observer would otherwise pop THAT file
      // over the one the operator clicked. A turn genuinely producing its
      // first file inside the window stays click-to-open (kimitail ceiling).
      let suppressAutoOpenUntil = 0
      ctx.effect(() => {
        const onOpen = (ev) => {
          const detail = (ev && ev.detail) || {}
          if (detail.kind === 'insight') {
            if (!detail.view) return
            store.request({ kind: 'insight', view: detail.view, sessionId: detail.sessionId || null, orgId: detail.orgId || null })
            return
          }
          if (!detail.relPath) return
          suppressAutoOpenUntil = Date.now() + 10000
          const live = sessions && sessions.list ? sessions.list.getSnapshot().current : null
          const sid = detail.rootId ? null : (detail.sessionId || live || store.getSnapshot().sessionId || null)
          store.request({ sessionId: sid, rootId: detail.rootId || null, relPath: detail.relPath, t0: Math.round(performance.now()) })
        }
        window.addEventListener('arxa-av-open', onOpen)
        return () => window.removeEventListener('arxa-av-open', onOpen)
      }, 'arxa-av-open ingress')

      // Produced-chip routing, SCOPED to ownership (0.6.0): a stock card chip
      // click calls openResource into the stock surface — while the strip
      // OWNS the column that surface is hidden, so the click would land
      // nowhere. Capture the chip and route it through our own ingress; when
      // we do not own, the stock preview stays native (the D91 retirement
      // holds on that lane).
      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {}
        const onChip = (ev) => {
          try {
            const col = document.querySelector('[data-rightbar-col]')
            if (!col || !col.hasAttribute('data-arxa-owns')) return
            const btn = ev.target && ev.target.closest ? ev.target.closest('[data-produced-files-row] button[title]') : null
            if (!btn) return
            const path = btn.getAttribute('title')
            if (!path || path === '.') return
            ev.stopPropagation(); ev.preventDefault()
            const snapNow = sessions && sessions.list ? sessions.list.getSnapshot() : null
            const sessionId = snapNow ? snapNow.current : null
            window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: sessionId ? { sessionId, relPath: path } : { relPath: path } }))
          } catch { /* best effort */ }
        }
        document.addEventListener('click', onChip, true)
        return () => document.removeEventListener('click', onChip, true)
      }, 'arxa-av: produced-chip routing while owning')

      // Claude-model auto-open: the FIRST produced file of a turn opens the
      // column by itself. Armed only when no produced-files row exists; fires
      // once per row appearance (a new turn's row re-arms it). Everything else
      // stays click-to-open. An explicit open suppresses it for 10s (see the
      // ingress): the clicked file, never the restored row, takes focus.
      ctx.effect(() => {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return () => {}
        let armed = false
        const obs = new MutationObserver((mutations) => {
          try {
            // Streaming token text never re-scans: only ELEMENT insertions can
            // carry a produced-files row.
            let elementAdded = false
            for (const m of mutations) {
              for (const n of m.addedNodes) { if (n.nodeType === 1) { elementAdded = true; break } }
              if (elementAdded) break
            }
            if (!elementAdded) return
            const rows = document.querySelectorAll('[data-produced-files-row]')
            if (rows.length === 0) { armed = true; return }
            if (!armed) return
            if (Date.now() < suppressAutoOpenUntil) { armed = false; return }
            const first = rows[0].querySelector('button[title]')
            const path = first && first.getAttribute('title')
            if (!path || path === '.') return
            armed = false
            const snapNow = sessions && sessions.list ? sessions.list.getSnapshot() : null
            const sessionId = snapNow ? snapNow.current : null
            window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: sessionId ? { sessionId, relPath: path } : { relPath: path } }))
          } catch { /* observer is best-effort */ }
        })
        obs.observe(document.body, { childList: true, subtree: true })
        return () => obs.disconnect()
      }, 'arxa-av first-produced-file auto-open')

      // THE GRAFT stays for the NOT-OWNING lane (0.6.0): while the strip owns
      // the column, stock opens never show; close the last tab and the stock
      // rightbar returns — text-family files there still open EDITABLE in the
      // stock document tab through this renderer (extension band beats the
      // builtin read-only code preview). The slot hands the body the file as
      // a resource address; DocumentBody decodes it into the panel's request
      // prop, so worktree-first resolution, guards and the save flow all
      // apply unchanged.
      ctx.effect(() => ctx.documentPreviews.register({
        id: 'arxa-artifact-viewer',
        // The code family the editor owns. NOT .md/.html/.pdf/images: the
        // stock builtin previews those (rendered markdown included), and
        // beating them would delete the preview the user asked for.
        extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.scss',
          '.py', '.rb', '.go', '.rs', '.sh', '.bash', '.zsh', '.sql', '.toml', '.ini', '.env',
          '.json', '.jsonc', '.yaml', '.yml', '.dart', '.txt', '.log', '.xml'],
        priority: 'extension',
        title: () => 'arxa editor',
        loading: 'text-pages',
      }), 'arxa-av: document preview renderer')
      ctx.slots.inject('sidebar.right.tab.document', () =>
        ctx.slots.register({ name: 'sidebar.right.tab.document', key: 'arxa-artifact-viewer', locale: NS },
          (props) => h(DocumentBody, { ...props, avStore: store, hostCtx: ctx })))
    }
    const inject = ['slots', 'connection', 'sessions', 'locale', 'documentPreviews', 'sidebarRight', 'layout']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
