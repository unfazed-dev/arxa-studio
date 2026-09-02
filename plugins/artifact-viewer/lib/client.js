// Browser half of arxa-artifact-viewer — DSH plugin-UI conformance rebuild
// (docs/plans/dsh-plugin-ui-conformance.md, Phase 1, grilled 2026-09-02).
// Hand-written __ModuleLoader__ bundle (the documented no-build style —
// dsh-cordis-client-runner), fully on the contract: primitives, --dsw-*
// tokens, locale NS (en/pl/fr), every side effect inside ctx.effect.
//
// Claude-window model (support.claude.com article 9487310):
//   * auto-open: user gestures (produced-file chips, sidebar file rows,
//     gen-ui cards) + the FIRST produced file of a turn; the open artifact
//     live-reloads on re-writes ("updates in place").
//   * automatic edit: markdown is rendered-primary with a corner source
//     toggle; code/text open directly editable; the session ensure runs at
//     OPEN time (D80 transparent ensure); guards (no org, >cap, binary)
//     make a lane view-only with the reason shown.
//   * auto-save: debounced ~1.5 s through POST /__arxa/artifacts/write; no
//     edit/save buttons; one StateDot carries clean/dirty/saving/conflict;
//     the 409/D86 external-change flow offers reload-theirs / overwrite.
//
// Runtime: store-based ingress — apply() owns ONE ctx.effect listener for
// the public 'arxa-av-open' window event, parks the payload in a store the
// mounted panel consumes (the 0px-column race dies by design: no retry
// ladder, no __ARXA_AV_PENDING__, no 4 s session poll — session tracking
// subscribes the dsh sessions service snapshot store).
window.__ModuleLoader__.load({
  id: 'arxa-artifact-viewer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const P = require('@deepseek-ai/dsh-client-ui-primitives')

    const TOKEN_ROUTE = '/__arxa/artifacts/token'
    const WRITE_ROUTE = '/__arxa/artifacts/write'
    const STATE_ROUTE = '/__arxa/sidebar/state'
    const ACTION_ROUTE = '/__arxa/sidebar/action'
    // insight.* live in the arxa-git-card host (docs/plans/git-card-stock-dock-rebuild.md A2)
    const CARD_ROUTE = '/__arxa/git-card/action'
    const SIDEBAR_ROUTE = '/__arxa/sidebar/action'
    const EVENTS_ROUTE = '/__arxa/artifacts/events'
    const VENDOR = (n) => '/__arxa/artifacts/vendor/' + n
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
      + '.aXa_av_head{flex:none;display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);min-width:0}'
      + '.aXa_av_titleWrap{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden}'
      + '.aXa_av_filename{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_lane{flex:none;font-size:11px;line-height:16px;padding:1px 8px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_chip{flex:none;font-size:11px;line-height:16px;padding:1px 8px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit}'
      + '.aXa_av_chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_chip:disabled{cursor:default;opacity:.6}'
      + '.aXa_av_chip:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_actions{flex:none;display:flex;align-items:center;gap:2px}'
      + '.aXa_av_iconBtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}'
      + '.aXa_av_iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_iconBtn:disabled{cursor:default;opacity:.5}'
      + '.aXa_av_iconBtn:disabled:hover{background:transparent;color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_iconBtn[data-on=true]{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active)}'
      + '.aXa_av_prettierMark{width:14px;height:14px;border-radius:4px;display:block;pointer-events:none}'
      + '.aXa_av_prettierMark[data-off=true]{filter:grayscale(1);opacity:.45}'
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
      + '.aXa_av_editorWrap{flex:1;min-height:0;overflow:auto;border-top:1px solid var(--dsw-alias-border-l2);background:var(--aXa_av_pal-bg,var(--dsw-alias-bg-base))}'
      + '.aXa_av_editorWrap .cm-editor{height:100%;background:var(--aXa_av_pal-bg,var(--dsw-alias-bg-base))}'
      + '.aXa_av_editorWrap .cm-editor.cm-focused{outline:none}'
      // Editor font (2026-09-01): the fallback is an explicit Fira-free
      // default stack, NOT --ds-font-family-code — that token lists
      // "Fira Code" third, and with "SF Mono" unresolvable in WKWebView +
      // JetBrains Mono absent it resolved to system Fira Code, making the
      // Default pill render Fira (toggle = visual no-op; width-probed).
      + '.aXa_av_editorWrap .cm-content{font-family:var(--arxa-editor-font,"SF Mono",ui-monospace,"JetBrains Mono",Consolas,"Liberation Mono",Menlo,monospace)}'
      + '.aXa_av_fileIcon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center}'
      + '.aXa_av_fileIcon svg{width:16px;height:16px;display:block}'
      // Markdown preview adopts the 2026 chrome too (grilled 2026-09-03):
      // palette vars arrive inline on the root; fallbacks keep dsh tokens.
      + '.aXa_av_palMd{background:var(--aXa_av_pal-bg,var(--dsw-alias-bg-base))}'
      + '.aXa_av_palMd .aXa_av_md{color:var(--aXa_av_pal-fg,var(--dsw-alias-label-primary))}'
      + '.aXa_av_palMd .aXa_av_md pre{background:var(--aXa_av_pal-code,var(--dsw-alias-markdown-code-block))}'
      + '.aXa_av_md{padding:12px 16px;line-height:1.6;font-size:14px;color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_md h1,.aXa_av_md h2,.aXa_av_md h3,.aXa_av_md h4{line-height:1.3;margin:1.1em 0 .5em;color:var(--dsw-alias-label-primary)}'
      + '.aXa_av_md h1:first-child,.aXa_av_md h2:first-child,.aXa_av_md h3:first-child{margin-top:0}'
      + '.aXa_av_md p{margin:.5em 0}'
      + '.aXa_av_md a{color:var(--dsw-alias-brand-primary)}'
      + '.aXa_av_md code{font-family:var(--ds-font-family-code);font-size:12.5px;background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 5px}'
      + '.aXa_av_md pre{background:var(--dsw-alias-markdown-code-block);border-radius:8px;padding:10px 12px;overflow:auto;margin:.6em 0}'
      + '.aXa_av_md pre code{background:transparent;padding:0}'
      + '.aXa_av_md blockquote{margin:.6em 0;padding:2px 12px;border-left:3px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}'
      + '.aXa_av_md ul,.aXa_av_md ol{padding-left:22px;margin:.5em 0}'
      + '.aXa_av_md table{border-collapse:collapse;margin:.6em 0}'
      + '.aXa_av_md th,.aXa_av_md td{border:1px solid var(--dsw-alias-border-l2);padding:4px 10px}'
      + '.aXa_av_md hr{border:none;border-top:1px solid var(--dsw-alias-border-l2);margin:1em 0}'
      + '.aXa_av_md img{max-width:100%}'
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
    // ToolRow.module.css + ToolDetails.module.css (dsh 0.1.1-rc.2), 2 stock hashed prefixes rewritten → aXa_ins_ (the raw prefixes are deliberately not named here — selftest asserts none leak).
    // Do not hand-edit — `--check` is the selftest drift gate.
    const INSIGHT_CSS = ".aXa_ins_root{flex-direction:column;display:flex}.aXa_ins_row{position:relative;overflow:hidden}.aXa_ins_root[data-state=running] .aXa_ins_row:after{content:\"\";background:linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);pointer-events:none;width:300px;animation:2.6s ease-out infinite aXa_ins_dsh-tool-row-sweep;position:absolute;top:0;bottom:0;left:0}@keyframes aXa_ins_dsh-tool-row-sweep{0%{left:-300px}90%,to{left:100%}}.aXa_ins_leading{flex-shrink:0}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_leading,.aXa_ins_root[data-tool^=cordis_] .aXa_ins_title{color:var(--dsw-alias-state-business-primary)}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_title{font-weight:500}.aXa_ins_root[data-tool^=cordis_] .aXa_ins_sep{background:var(--dsw-alias-state-business-primary)}.aXa_ins_chevron{color:var(--dsw-alias-label-secondary)}.aXa_ins_title{font-weight:400}.aXa_ins_sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}.aXa_ins_summary{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;font-size:14px;line-height:24px;overflow:hidden}.aXa_ins_summarySuffix{white-space:nowrap;color:var(--dsw-alias-label-tertiary);flex:none;margin-left:4px;font-size:14px;line-height:24px}.aXa_ins_fileLink{text-overflow:ellipsis;white-space:nowrap;min-width:0;font:inherit;text-align:left;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-decoration-color:var(--dsw-alias-label-quaternary);text-underline-offset:3px;cursor:pointer;background:0 0;border:none;flex:auto;margin:0;padding:0;font-size:14px;line-height:24px;overflow:hidden}.aXa_ins_fileLink:hover{color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}.aXa_ins_errorSummary{color:var(--dsw-alias-state-error-primary)}.aXa_ins_bodyWrap{flex-direction:column;display:flex}.aXa_ins_inspectButton{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0;border-radius:999px;align-self:flex-start;align-items:center;gap:4px;margin:4px 0 2px 4px;padding:2px 8px;font-size:11px;line-height:16px;transition:opacity .1s;display:inline-flex}.aXa_ins_root:hover .aXa_ins_inspectButton,.aXa_ins_inspectButton:focus-visible{opacity:1}.aXa_ins_inspectButton:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}.aXa_ins_bodyScroll{max-height:260px;overflow-y:auto}.aXa_ins_ioCard{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small);border-radius:12px;flex-direction:column;margin:4px 0 4px 4px;display:flex}.aXa_ins_ioSection{grid-template-columns:max-content 1fr;align-items:baseline;column-gap:14px;max-height:150px;padding:12px 16px;display:grid;overflow-y:auto}.aXa_ins_ioSection::-webkit-scrollbar-thumb{background-clip:padding-box;border:2px solid #0000;border-radius:6px}.aXa_ins_ioSection::-webkit-scrollbar-track{margin:6px 0}.aXa_ins_ioLabel{color:var(--dsw-alias-label-caption);align-self:start;position:sticky;top:0}.aXa_ins_ioDivider{background:var(--dsw-alias-border-l2);flex:none;height:1px}.aXa_ins_ioText{white-space:pre-wrap;word-break:break-word;min-width:0;color:var(--dsw-alias-label-secondary)}.aXa_ins_ioText[data-error]{color:var(--dsw-alias-state-error-primary)}.aXa_ins_codeBody,.aXa_ins_terminalBody,.aXa_ins_diffBody,.aXa_ins_readBody,.aXa_ins_searchBody,.aXa_ins_webBody{margin:4px 0 4px 4px}.aXa_ins_searchRecovery{white-space:pre-wrap;overflow-wrap:anywhere;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary);margin:4px 0 4px 4px}.aXa_ins_codeBody{--dsl-code-block-content-font:var(--dsw-font-markdown-code-block-small)}.aXa_ins_terminalBody{--dsl-terminal-font:var(--dsw-font-markdown-code-block-small);--dsl-terminal-line-height:18px;--dsl-terminal-output-max-height:224px;border:1px solid var(--dsw-alias-border-l1)}.aXa_ins_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.aXa_ins_description{color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);margin:0 0 6px}.aXa_ins_cardBody{margin:0}.aXa_ins_recovery{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);margin:6px 0 0}.aXa_ins_code{background:var(--dsw-alias-markdown-code-block);font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;border-radius:12px;margin:0;padding:16px;font-size:13px;line-height:22px}.aXa_ins_code[data-error]{color:var(--dsw-alias-state-error-primary)}.aXa_ins_read,.aXa_ins_web{margin:0}.aXa_ins_empty{color:var(--dsw-alias-label-tertiary);padding:8px 0;font-size:13px;line-height:20px}"
    const I = {
      "bodyScroll": "aXa_ins_bodyScroll",
      "bodyWrap": "aXa_ins_bodyWrap",
      "chevron": "aXa_ins_chevron",
      "codeBody": "aXa_ins_codeBody",
      "diffBody": "aXa_ins_diffBody",
      "dsh-tool-row-sweep": "aXa_ins_dsh-tool-row-sweep",
      "errorSummary": "aXa_ins_errorSummary",
      "fileLink": "aXa_ins_fileLink",
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
      "webBody": "aXa_ins_webBody",
      "cardBody": "aXa_ins_cardBody",
      "code": "aXa_ins_code",
      "description": "aXa_ins_description",
      "empty": "aXa_ins_empty",
      "read": "aXa_ins_read",
      "recovery": "aXa_ins_recovery",
      "web": "aXa_ins_web"
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
      'action.source': 'Source',
      'action.preview': 'Preview',
      'action.diff': 'Diff vs main',
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
      'insight.title.ci': 'CI runs',
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
      'action.source': 'Źródło',
      'action.preview': 'Podgląd',
      'action.diff': 'Diff względem main',
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
      'insight.title.ci': 'Przebiegi CI',
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
      'action.source': 'Source',
      'action.preview': 'Aperçu',
      'action.diff': 'Diff vs main',
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
      'insight.title.ci': 'Exécutions CI',
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
    }

    // ---- ingress store (the 0px-column race dies here) ----------------------
    // apply() requests; the mounted panel consumes. The store holds a pending
    // open until the panel exists — no retries, no parked window global.
    function createAvStore() {
      let state = { pending: null, tick: 0, sessionId: null }
      const subs = new Set()
      const emit = () => { for (const fn of [...subs]) { try { fn() } catch {} } }
      return {
        getSnapshot: () => state,
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
        request(payload) { state = { ...state, pending: payload, tick: state.tick + 1 }; emit() },
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

    // ---- VS Code 2026 palette + formatting plumbing (grilled 2026-09-03) -----
    // The editor surfaces adopt the vendored 2026 Dark/Light port (themes.js)
    // following the dsh shell's dark flag (body[data-ds-dark-theme]); every
    // other surface keeps the --dsw-* vocabulary. Prettier is a lazy 2MB
    // bundle: only its EXTENTIONS are known up front, the parser map itself
    // lives inside the bundle (single source of truth).
    const FORMAT_EXTS = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'json', 'jsonc', 'css', 'scss', 'md', 'yaml', 'yml'])

    function detectIndent(text) {
      // VS Code editor.detectIndentation: majority vote over leading
      // whitespace of the first ~400 lines; fallback 2 spaces.
      let two = 0, four = 0, tab = 0
      for (const line of String(text || '').split('\n').slice(0, 400)) {
        const ws = (line.match(/^[\t ]+/) || [''])[0]
        if (!ws) continue
        if (ws[0] === '\t') tab++
        else if (ws.length >= 4 && ws.length % 4 === 0) four++
        else if (ws.length >= 2) two++
      }
      if (tab > two && tab > four) return { unit: '\t', size: 4 }
      if (four > two) return { unit: '    ', size: 4 }
      return { unit: '  ', size: 2 }
    }

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

    // One panel at a time owns the Shift-Alt-F action; CodeView's keymap
    // routes through this ref so the handler stays in the Panel (which owns
    // save state and notes).
    const formatActionRef = { current: null }

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

    async function fetchTokenRaw(payload) {
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
    }

    async function fetchToken(relPath, writeFor) {
      const payload = writeFor ? { scope: 'write', worktreeId: writeFor } : { relPath }
      const res = await fetch(TOKEN_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || ('token route ' + res.status))
      return body
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
    function CodeView({ relPath, text, editable, docRef, onDirty }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        let dead = false
        let view = null
        let unwatch = null
        ;(async () => {
          // ONE bundle: ArxaTheme rides the codemirror IIFE — a separate
          // themes.js would carry a second @codemirror/state and every
          // extension would fail EditorView's instanceof check (measured
          // live 2026-09-03).
          const CM = await ensureVendor('codemirror.js', 'ArxaCM')
          const TH = CM.ArxaTheme
          if (dead || !ref.current) return
          const ext = (relPath.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase()
          // Theme + indentation sit in compartments: the dark/light flip
          // reconfigures live without rebuilding the editor.
          const themeComp = new CM.Compartment()
          const indentComp = new CM.Compartment()
          const pal = (dark) => {
            const t = TH[dark ? 'dark' : 'light']
            return [t.theme, CM.syntaxHighlighting(t.highlight)]
          }
          const indent = detectIndent(text)
          const extensions = [
            ...CM.basicSetup,
            themeComp.of(pal(isDarkMode())),
            indentComp.of([CM.indentUnit.of(indent.unit), CM.EditorState.tabSize.of(indent.size)]),
            CM.keymap.of([{
              key: 'Shift-Alt-F',
              run: () => { if (formatActionRef.current) { void formatActionRef.current(); return true } return false },
            }]),
            CM.EditorView.editable.of(!!editable),
            CM.EditorState.readOnly.of(!editable),
            CM.EditorView.updateListener.of((u) => { if (u.docChanged && onDirty) onDirty() }),
          ]
          const lang = CM.langForExt(ext)
          if (lang) extensions.push(lang)
          view = new CM.EditorView({ state: CM.EditorState.create({ doc: text, extensions }), parent: ref.current })
          if (docRef) docRef.current = view
          unwatch = watchPalette((dark) => {
            if (view) view.dispatch({ effects: themeComp.reconfigure(pal(dark)) })
          })
        })().catch((e) => { if (ref.current) ref.current.textContent = String(e) })
        return () => { dead = true; if (unwatch) unwatch(); if (view) view.destroy(); if (docRef) docRef.current = null }
      }, [relPath, text, editable])
      return h('div', { className: 'aXa_av_editorWrap', ref })
    }

    function DiffView({ relPath, original, text }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        let dead = false
        let view = null
        let unwatch = null
        ;(async () => {
          // ONE bundle: ArxaTheme rides the codemirror IIFE — a separate
          // themes.js would carry a second @codemirror/state and every
          // extension would fail EditorView's instanceof check (measured
          // live 2026-09-03).
          const CM = await ensureVendor('codemirror.js', 'ArxaCM')
          const TH = CM.ArxaTheme
          if (dead || !ref.current) return
          const themeComp = new CM.Compartment()
          const langComp = new CM.Compartment()
          const pal = (dark) => {
            const t = TH[dark ? 'dark' : 'light']
            return [t.theme, CM.syntaxHighlighting(t.highlight)]
          }
          const extensions = [
            ...CM.basicSetup,
            themeComp.of(pal(isDarkMode())),
            langComp.of(CM.langForExt(relPath) || []),
            CM.EditorView.editable.of(false),
            CM.unifiedMergeView({ original, highlightChanges: true }),
          ]
          view = new CM.EditorView({
            state: CM.EditorState.create({ doc: text, extensions }),
            parent: ref.current,
          })
          unwatch = watchPalette((dark) => {
            if (view) view.dispatch({ effects: themeComp.reconfigure(pal(dark)) })
          })
        })().catch(() => {})
        return () => { dead = true; if (unwatch) unwatch(); if (view) view.destroy() }
      }, [relPath, original, text])
      return h('div', { className: 'aXa_av_editorWrap', ref })
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
    // The docked column is not only a file surface: the git card's three
    // "Insights" links open it on a REPORT instead — commit streak, CI runs,
    // sessions across the org. Same ingress event, same column, same sheet
    // behaviour below 744px; only the payload differs (`kind: 'insight'`).
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
      const load = React.useCallback(() => {
        let live = true
        setPhase('loading')
        // Jobs never round-trip: JobView is push-only, so the rows arrive
        // from the sidebar's store through the open event. Nothing on the host
        // can enumerate or stop them (no job.* RPC, no jobs on the ApiProxy).
        if (view === 'jobs') { setData({ jobs: given || [] }); setPhase('ready'); return () => {} }
        const action = view === 'subagents' ? 'agent.list' : 'insight.' + view
        const arg = view === 'sessions' ? { orgId } : { sessionId }
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
      if (view === 'ci') {
        const runs = d.runs || []
        if (runs.length === 0) return empty(t('insight.ci.empty'))
        // Q8: the card's run control, mirrored per row. Every run here is
        // individually addressable, where the card only reaches the newest —
        // that is the whole reason the panel carries the buttons too. Re-run
        // waits for the run to finish, cancel waits for it to be live, so the
        // pair is never both-enabled on one row.
        return root(h('div', { className: 'aXa_av_scroll' },
          note && h('div', { className: 'aXa_av_note', 'data-tone': 'error' }, note),
          runs.map((run) => {
            const live = run.status !== 'completed'
            return row(run.id,
              h(P.StateDot, { state: ciState(run) }),
              run.name || String(run.id),
              String(run.conclusion || run.status || '') + (run.headSha ? ' · ' + String(run.headSha).slice(0, 7) : ''),
              h(React.Fragment, null,
                trailing(t('insight.ci.rerun'), () => act('ci-rerun', 'card.ci.rerun', { sessionId, runId: run.id }), live),
                trailing(t('insight.ci.cancel'), () => act('ci-cancel', 'card.ci.cancel', { sessionId, runId: run.id }), !live),
                run.url ? h('a', { className: I.summarySuffix, href: run.url, target: '_blank', rel: 'noreferrer' }, t('insight.ci.open')) : null))
          })))
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
      const [showSource, setShowSource] = React.useState(false)
      const [showDiff, setShowDiff] = React.useState(false)
      const [mainText, setMainText] = React.useState('')
      const [chip, setChip] = React.useState(null)
      const [timeline, setTimeline] = React.useState([])
      const [versionOpen, setVersionOpen] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      // Prettier is a viewer-level toggle: ON by default, persisted per
      // browser (same storage class as the editor font choice).
      const [prettierOn, setPrettierOn] = React.useState(() => {
        try { return localStorage.getItem('arxa.av.prettier') !== 'off' } catch { return true }
      })
      const togglePrettier = () => setPrettierOn((v) => {
        const next = !v
        try { localStorage.setItem('arxa.av.prettier', next ? 'on' : 'off') } catch { /* storage optional */ }
        return next
      })
      // Active 2026 palette (null until themes.js resolves) — feeds the
      // palette CSS vars on the root and the preview surface classes.
      const [pal, setPal] = React.useState(null)
      const [changes, setChanges] = React.useState([])
      const [mdReady, setMdReady] = React.useState(false)
      const [previewHtml, setPreviewHtml] = React.useState('')
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
      React.useEffect(() => { dirtyRef.current = dirty }, [dirty])

      const lane = state.kind ? state.kind.lane : null
      const editableLane = EDITABLE_LANES.has(lane)
      const canEdit = editableLane && !state.readOnly && !!session

      // Preview reflects the EDITED doc: refreshed from the CM buffer every
      // time the source view closes (and once the markdown bundle lands).
      // `pal` is a dependency because the palette effect also delivers the
      // parsers — without it, a fast first render freezes token-less fences.
      React.useEffect(() => {
        if (lane !== 'markdown' || showSource || !window.ArxaMD) return
        try {
          const text = docRef.current ? docRef.current.state.doc.toString() : state.text
          if (text != null) setPreviewHtml(window.ArxaMD.render(text))
        } catch { /* preview is best-effort */ }
      }, [lane, showSource, mdReady, state.text, pal])

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

      // Store ingress: a pending open arrives from apply()'s listener (chips,
      // file rows, gen-ui, the produced-file observer). Consumed HERE, when
      // the panel demonstrably exists — the cold-open race is structural now.
      React.useEffect(() => {
        const p = store.consume()
        if (!p) return
        if (p.kind === 'insight') {
          setOpen(true)
          setState({ phase: 'insight', view: p.view, sessionId: p.sessionId || null, orgId: p.orgId || null, rows: p.rows || null })
          return
        }
        if (p.sessionId && p.relPath) {
          void Promise.resolve(openWorktreeRef.current && openWorktreeRef.current(p.sessionId, p.relPath)).then((ok) => {
            if (ok) return
            void (openArtifactRef.current && openArtifactRef.current(p.relPath))
          })
        } else if (p.relPath) {
          void (openArtifactRef.current && openArtifactRef.current(p.relPath))
        }
      }, [snap.tick, store])

      // D93 session switch: the dsh sessions service is the event source
      // (the 4 s ensureSession poll is gone). A current-session change resets
      // the panel to idle and re-binds the changes list.
      const refreshChanges = React.useCallback(async () => {
        try {
          const s = await ensureSession()
          const { token } = await fetchTokenRaw({ scope: 'changes-read', worktreeId: s.id })
          const r = await fetch('/__arxa/artifacts/session-changes?session=' + encodeURIComponent(s.id) + '&avt=' + encodeURIComponent(token))
          const body = await r.json().catch(() => ({}))
          if (r.ok) setChanges(body.files || [])
        } catch { setChanges([]) }
      }, [])
      React.useEffect(() => {
        const id = snap.sessionId || null
        const prev = seenSessionRef.current
        if (prev === id) return
        seenSessionRef.current = id
        void refreshChanges()
        // 2026-09-01 user directive: opening a session must not leave a stale
        // artifact on screen. The old guard (prev && id && prev !== id) only
        // fired on session->session transitions and skipped the most common
        // case — browse an org file with no session current, THEN open a
        // session (null->X) — so the viewer kept the orphaned file. The shown
        // file survives only when it IS the new current session's worktree
        // file; the org lane (bound to no session) closes too.
        if (!open) return
        // An insight report is not a stale artifact: re-point it at the new
        // current session so it re-fetches, rather than closing the column the
        // user just opened. The sessions view is org-keyed and ignores this.
        if (state.phase === 'insight') { setState((st) => ({ ...st, sessionId: id })); return }
        if (id && wtRef.current && wtRef.current.sessionId === id) return
        // Close the LAYOUT column (the frame face), not just the panel state:
        // the old reset only flipped internal state while the frame kept the
        // column on screen with the stale filename in its header.
        if (frameProps.close) frameProps.close()
        setOpen(false); setState({ phase: 'idle' }); setSession(null)
        setDirty(false); setSavePhase('idle'); setSaveNote('')
        setShowSource(false); setShowDiff(false); setChip(null); setTimeline([])
        wtRef.current = null
        // state.phase is a dep on purpose: the insight guard above reads it,
        // and without it a panel that BECAME an insight after the last session
        // change would be judged by a stale closure and closed.
      }, [snap.sessionId, open, refreshChanges, state.phase])
      React.useEffect(() => { void refreshChanges() }, [refreshChanges])

      // Markdown lane: kick the vendored markdown-it+DOMPurify bundle.
      React.useEffect(() => {
        if (mdReady || lane !== 'markdown' || state.phase !== 'ready') return
        if (window.ArxaMD) { setMdReady(true); return }
        let live = true
        ensureVendor('markdown.js', 'ArxaMD').then(() => {
          if (!live) return
          // Preview token coloring rides the SAME lezer instance as the
          // editor — a second @lezer/highlight would break tag identity.
          if (window.ArxaMD && window.ArxaCM && typeof window.ArxaMD.setParsers === 'function') {
            window.ArxaMD.setParsers(window.ArxaCM)
            if (typeof window.ArxaMD.setTheme === 'function' && window.ArxaCM.ArxaTheme) {
              window.ArxaMD.setTheme(window.ArxaCM.ArxaTheme[isDarkMode() ? 'dark' : 'light'])
            }
          }
          setMdReady(true)
        }).catch(() => {})
        return () => { live = false }
      }, [mdReady, lane, state.phase])

      // D86 external-change push. Org lane: the org watcher. Worktree lane:
      // the same route with ?session= (host watches the worktree for this
      // connection). Clean buffer auto-reloads; dirty buffer conflicts.
      React.useEffect(() => {
        if (!open || !state.relPath || state.phase !== 'ready') return
        const url = EVENTS_ROUTE + (wtRef.current ? '?session=' + encodeURIComponent(wtRef.current.sessionId) : '')
        const es = new EventSource(url)
        es.onmessage = (m) => {
          try {
            const ev = JSON.parse(m.data)
            if (!ev || ev.relPath !== state.relPath) return
            if (dirtyRef.current) {
              externalRef.current = ev.mtimeMs
              setSavePhase('conflict')
              setSaveNote('')
            } else {
              void (async () => {
                try {
                  let text
                  if (wtRef.current) {
                    const { token } = await fetchTokenRaw({ scope: 'wt-read', worktreeId: wtRef.current.sessionId, relPath: state.relPath })
                    const r = await fetch('/__arxa/artifacts/wt?session=' + encodeURIComponent(wtRef.current.sessionId) + '&path=' + encodeURIComponent(state.relPath) + '&avt=' + encodeURIComponent(token))
                    if (!r.ok) return
                    text = await r.text()
                  } else {
                    const { token, origin } = await fetchToken(state.relPath)
                    const r = await fetch(origin + '/' + encodeURI(state.relPath) + '?avt=' + encodeURIComponent(token))
                    if (!r.ok) return
                    text = await r.text()
                  }
                  mtimeRef.current = ev.mtimeMs
                  setState((s) => ({ ...s, text }))
                } catch { /* transient */ }
              })()
            }
          } catch {}
        }
        return () => es.close()
      }, [open, state.relPath, state.phase])

      const resetForOpen = () => {
        setDirty(false); setSavePhase('idle'); setSaveNote(''); mtimeRef.current = null
        setShowSource(false); setShowDiff(false); setMainText(''); setChip(null); setTimeline([]); setVersionOpen(false)
        setCopied(false); setPreviewHtml('')
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
      }

      /** Editable lanes ensure the session AT OPEN (D80 transparent ensure,
       * moved off the old edit toggle): the lane lands already-editable, or
       * view-only with the reason when the ensure/guards refuse. */
      const applyEditability = async (kind, relPath, text, len, prebound) => {
        const cap = maxBytesRef.current
        if (len > cap) {
          return { readOnly: true, guardNote: t('guard.tooLarge', { size: Math.round(len / 1048576 * 10) / 10, cap: Math.round(cap / 1048576 * 10) / 10 }), session: prebound || null }
        }
        if (text.slice(0, 8192).includes('\u0000')) {
          return { readOnly: true, guardNote: t('guard.binary'), session: prebound || null }
        }
        if (prebound) return { readOnly: false, guardNote: '', session: prebound }
        try {
          const s = await ensureSession()
          return { readOnly: false, guardNote: '', session: s }
        } catch (e) {
          const reason = String(e && e.message || e)
          return { readOnly: true, guardNote: reason === 'no org open' ? t('guard.noOrg') : t('error.session', { reason }), session: null }
        }
      }

      const openArtifact = async (relPathArg) => {
        const relPath = String(relPathArg || '').trim().replace(/^\/+/, '')
        if (!relPath) return
        resetForOpen()
        setSession(null)
        setOpen(true)
        wtRef.current = null
        setState({ phase: 'loading', relPath })
        try {
          const { token, origin } = await fetchToken(relPath)
          const url = origin + '/' + encodeURI(relPath) + '?avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          void (async () => {
            try {
              const tk = await fetchToken(relPath)
              const r = await fetch('/__arxa/artifacts/version?relPath=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(tk.token))
              const body = await r.json().catch(() => ({}))
              if (r.ok) { setChip(body.chip || null); setTimeline(body.timeline || []) }
            } catch { /* chip stays hidden — never blocks the artifact */ }
          })()
          if (EDITABLE_LANES.has(kind.lane)) {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            const len = Number(r.headers.get('content-length') || '0')
            const text = await r.text()
            const edit = await applyEditability(kind, relPath, text, len, null)
            setSession(edit.session)
            setState({ phase: 'ready', kind, relPath, url, text, readOnly: edit.readOnly, guardNote: edit.guardNote })
          } else {
            setState({ phase: 'ready', kind, relPath, url })
          }
        } catch (e) {
          setState({ phase: 'error', relPath, note: t('error.load', { path: relPath, reason: String(e && e.message || e) }) })
        }
      }

      const openWorktree = async (sessionId, relPath) => {
        if (!sessionId || !relPath) return false
        resetForOpen()
        setOpen(true)
        setState({ phase: 'loading', relPath })
        wtRef.current = { sessionId }
        try {
          const prebound = { id: sessionId, name: sessionId }
          setSession(prebound)
          const { token } = await fetchTokenRaw({ scope: 'wt-read', worktreeId: sessionId, relPath })
          const url = '/__arxa/artifacts/wt?session=' + encodeURIComponent(sessionId) + '&path=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token)
          const kind = kindFor(relPath)
          if (EDITABLE_LANES.has(kind.lane)) {
            const r = await fetch(url)
            if (!r.ok) throw new Error('fetch ' + r.status)
            const len = Number(r.headers.get('content-length') || '0')
            const text = await r.text()
            const edit = await applyEditability(kind, relPath, text, len, prebound)
            setSession(edit.session)
            setState({ phase: 'ready', kind, relPath, url, text, readOnly: edit.readOnly, guardNote: edit.guardNote, wt: sessionId })
            return true
          }
          setState({ phase: 'ready', kind, relPath, url, wt: sessionId })
          return true
        } catch (e) {
          setState({ phase: 'error', relPath, note: t('error.load', { path: relPath, reason: String(e && e.message || e) }) })
          return false
        }
      }
      openArtifactRef.current = openArtifact
      openWorktreeRef.current = openWorktree

      const save = async (force = false) => {
        if (!session || !state.relPath || !docRef.current) return
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
        setSavePhase('saving'); setSaveNote('')
        try {
          const { token } = await fetchToken(null, session.id)
          const res = await fetch(WRITE_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-arxa-write-token': token },
            body: JSON.stringify({
              worktreeId: session.id,
              relPath: state.relPath,
              content: docRef.current.state.doc.toString(),
              ...(!force && mtimeRef.current != null ? { expectedMtimeMs: mtimeRef.current } : {}),
            }),
          })
          const body = await res.json().catch(() => ({}))
          if (res.status === 409) {
            setSavePhase('conflict'); setSaveNote('')
            if (body.mtimeMs) mtimeRef.current = body.mtimeMs
            return
          }
          if (!res.ok) throw new Error(body.error || ('write ' + res.status))
          mtimeRef.current = body.mtimeMs
          setDirty(false)
          setSavePhase('saved')
          setSaveNote(body.committed ? t('saved.committed', { session: session.name }) : t('saved.wipPending', { warning: body.warning || '?' }))
        } catch (e) {
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
        else await openArtifact(rel)
      }

      const toggleDiff = () => {
        if (showDiff) { setShowDiff(false); return }
        void (async () => {
          try {
            const { token } = await fetchToken(state.relPath)
            const r = await fetch('/__arxa/artifacts/main-version?relPath=' + encodeURIComponent(state.relPath) + '&avt=' + encodeURIComponent(token))
            const body = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(body.error || ('main-version ' + r.status))
            setMainText(body.content || '')
            setShowDiff(true)
          } catch (e) { setSavePhase('error'); setSaveNote(String(e && e.message || e)) }
        })()
      }

      // ---- 2026 palette + format action ---------------------------------------
      React.useEffect(() => {
        let dead = false
        let unwatchPal = null
        ensureVendor('codemirror.js', 'ArxaCM').then((CM) => {
          if (dead) return
          const TH = CM.ArxaTheme
          if (!TH) return
          setPal(TH[isDarkMode() ? 'dark' : 'light'])
          // The seat REMOUNTS this panel on every session transition — each
          // mount must unsubscribe, or the module-level subscriber set grows
          // one stale closure per transition (leak + setState-on-unmounted).
          unwatchPal = watchPalette((dark) => {
            const t = TH[dark ? 'dark' : 'light']
            setPal(t)
            // Theme swap = stylesheet swap only (span classes are stable).
            if (window.ArxaMD && typeof window.ArxaMD.setTheme === 'function') window.ArxaMD.setTheme(t)
          })
          // md preview may have loaded first — feed it the engine either way.
          if (window.ArxaMD && typeof window.ArxaMD.setParsers === 'function') {
            window.ArxaMD.setParsers(CM)
            window.ArxaMD.setTheme(TH[isDarkMode() ? 'dark' : 'light'])
          }
        }).catch(() => { /* palette is progressive enhancement */ })
        return () => { dead = true; if (unwatchPal) unwatchPal() }
      }, [])

      const filename = state.relPath ? state.relPath.split('/').pop() : null
      const formatExt = filename && editableLane ? filename.split('.').pop().toLowerCase() : null
      const canFormat = !!(state.phase === 'ready' && canEdit && formatExt && FORMAT_EXTS.has(formatExt) && prettierOn)

      const doFormat = async () => {
        const view = docRef.current
        if (!view || !formatExt) return
        try {
          const PT = await ensureVendor('prettier.js', 'ArxaPrettier')
          const before = view.state.doc.toString()
          const indent = detectIndent(before)
          const out = await PT.format(before, formatExt, { tabWidth: indent.size, useTabs: indent.unit === '\t' })
          if (out === before) return
          // Minimal single-change diff (common prefix/suffix) so the cursor
          // and undo history survive the reformat.
          const minLen = Math.min(before.length, out.length)
          let p = 0
          while (p < minLen && before[p] === out[p]) p++
          let s = 0
          while (s < minLen - p && before[before.length - 1 - s] === out[out.length - 1 - s]) s++
          view.dispatch({ changes: { from: p, to: before.length - s, insert: out.slice(p, out.length - s) } })
        } catch (e) {
          setSaveNote(t('format.failed') + ' ' + String((e && e.message) || e))
          setSavePhase('error')
        }
      }
      React.useEffect(() => {
        formatActionRef.current = canFormat ? doFormat : null
        return () => { if (formatActionRef.current === doFormat) formatActionRef.current = null }
      })

      const doCopy = () => {
        const text = docRef.current ? docRef.current.state.doc.toString() : state.text
        if (text == null) return
        void P.writeClipboard(text).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600) } })
      }

      const dotState = dotStateOf(savePhase, dirty)
      const dotVisible = editableLane && state.phase === 'ready' && (dirty || savePhase !== 'idle' || canEdit)
      const dotLabel = savePhase === 'conflict' ? t('state.conflict')
        : savePhase === 'saving' ? t('state.saving')
        : dirty ? t('state.dirty')
        : savePhase === 'saved' ? (saveNote || t('state.saved'))
        : session ? t('session.badge', { name: session.name }) : t('state.saved')

      // ---- header --------------------------------------------------------------
      const iconBtn = (key, label, onClick, Icon, opts = {}) =>
        h(P.Tooltip, { key, label, delayMs: 500, side: 'bottom' },
          h('button', {
            className: 'aXa_av_iconBtn', onClick, 'aria-label': label,
            disabled: !!opts.disabled, 'data-on': opts.on ? 'true' : undefined,
          }, h(Icon, { size: 14 })))

      const header = h('div', { className: 'aXa_av_head' },
        h('div', { className: 'aXa_av_titleWrap' },
          filename && h(FileIcon, { name: filename }),
          h('span', { className: 'aXa_av_filename' },
            state.phase === 'insight' ? t('insight.title.' + state.view) : (filename || t('title'))),
          state.phase === 'ready' && lane && h('span', { className: 'aXa_av_lane' }, t('lane.' + lane) !== 'lane.' + lane ? t('lane.' + lane) : lane),
          dotVisible && h(P.Tooltip, { label: dotLabel, delayMs: 500, side: 'bottom' },
            h('span', { style: { display: 'inline-flex', alignItems: 'center' } },
              h(P.StateDot, { state: dotState }))),
          chip && h(P.Menu, {
            open: versionOpen,
            onClose: () => setVersionOpen(false),
            items: (timeline.length === 0 ? [{ id: '_none', label: t('version.none') }] : timeline.map((v) => ({ id: v.version, label: v.version + ' · ' + v.state }))),
            selectedId: chip.version,
            onSelect: () => setVersionOpen(false),
            align: 'start',
            portal: true,
            anchor: h('button', {
              className: 'aXa_av_chip', title: chip.name || chip.label,
              onClick: () => setVersionOpen((v) => !v),
              'aria-haspopup': 'menu', 'aria-expanded': versionOpen,
            }, chip.label),
          })),
        h('div', { className: 'aXa_av_actions' },
          state.phase === 'ready' && editableLane && iconBtn('copy', copied ? t('copied') : t('copy'), doCopy, copied ? P.IconCheckOutline16 : P.IconCopyOutline16),
          state.phase === 'ready' && state.url && h(P.Tooltip, { label: t('action.download'), delayMs: 500, side: 'bottom' },
            h('a', { className: 'aXa_av_iconBtn', href: state.url, download: filename || true, target: '_blank', rel: 'noreferrer', 'aria-label': t('action.download') },
              h(P.IconDownloadOutline16, { size: 14 }))),
          state.phase === 'ready' && lane === 'markdown' && iconBtn('source', showSource ? t('action.preview') : t('action.source'), () => setShowSource((v) => !v), P.IconCodeOutline16, { on: showSource }),
          state.phase === 'ready' && editableLane && h(P.Tooltip, { key: 'prettier', label: prettierOn ? t('action.prettier.on') : t('action.prettier.off'), delayMs: 500, side: 'bottom' },
            h('button', {
              className: 'aXa_av_iconBtn', onClick: togglePrettier,
              'aria-label': prettierOn ? t('action.prettier.on') : t('action.prettier.off'),
              'aria-pressed': prettierOn ? 'true' : 'false', 'data-on': prettierOn ? 'true' : undefined,
            }, h('img', { className: 'aXa_av_prettierMark', 'data-off': prettierOn ? undefined : 'true', src: VENDOR('prettier.png'), alt: '', draggable: false }))),
          canFormat && iconBtn('format', t('action.format'), () => void doFormat(), P.IconEnhanceOutline16),
          state.phase === 'ready' && editableLane && iconBtn('diff', t('action.diff'), toggleDiff, P.IconInspectOutline12, { on: showDiff }),
          frameProps.maximize && iconBtn('max', t('action.maximize'), () => frameProps.maximize(), P.IconFullscreenOutline16),
          frameProps.close && !frameProps.sheet && iconBtn('close', t('close'), () => frameProps.close(), P.IconCloseOutline16)))

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
        if (savePhase === 'conflict') {
          notes.push(h('div', { key: 'conflict', className: 'aXa_av_conflict' },
            h('span', { className: 'aXa_av_conflictText' }, t('conflict.note')),
            h(P.Button, { variant: 'outline', onClick: () => { void reloadTheirs() } }, t('conflict.reload')),
            h(P.Button, { variant: 'primary', onClick: () => { void save(true) } }, t('conflict.overwrite'))))
        } else if ((savePhase === 'error' || savePhase === 'saved') && saveNote) {
          notes.push(h('div', { key: 'note', className: 'aXa_av_note', 'data-tone': savePhase === 'error' ? 'error' : undefined }, saveNote))
        }

        let surface = null
        if (showDiff && editableLane) {
          surface = h(DiffView, { relPath: state.relPath, original: mainText, text: (docRef.current && canEdit) ? docRef.current.state.doc.toString() : state.text })
        } else if (lane === 'markdown' && !showSource) {
          surface = h('div', { className: 'aXa_av_scroll' + (pal ? ' aXa_av_palMd' : '') },
            h('div', { className: 'aXa_av_md', dangerouslySetInnerHTML: { __html: previewHtml || (window.ArxaMD ? window.ArxaMD.render(state.text) : '<em>' + t('loading') + '</em>') } }))
        } else if (editableLane) {
          surface = h(CodeView, { relPath: state.relPath, text: state.text, editable: canEdit, docRef, onDirty })
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

      const palVars = pal ? {
        '--aXa_av_pal-bg': pal.bg,
        '--aXa_av_pal-fg': pal.fg,
        '--aXa_av_pal-code': pal.codeBg,
      } : undefined
      return h('div', { className: 'aXa_av_root', style: palVars }, header, h('div', { className: 'aXa_av_body' }, body))
    }

    // ---- apply: registration + every side effect inside ctx.effect -----------
    function apply(ctx) {
      ensureCss()
      const store = createAvStore()
      const sessions = ctx.get('sessions')

      ctx.effect(() => ctx.locale.register(NS, { en, pl, fr }), 'arxa-av: dictionaries')

      // Mirror the current dsh session into the store (panel rebind rides it).
      ctx.effect(() => {
        if (!sessions || !sessions.list || typeof sessions.list.subscribe !== 'function') return () => {}
        let last = null
        try { last = (sessions.list.getSnapshot() || {}).current ?? null } catch {}
        return sessions.list.subscribe(() => {
          let cur = null
          try { cur = (sessions.list.getSnapshot() || {}).current ?? null } catch { return }
          store.setSession(cur)
          if (cur === last) return
          last = cur
          // 2026-09-01 user directive: opening a session must CLOSE the viewer
          // column — any artifact on screen belongs to another session or to
          // none (org lane). Enforced at the LAYOUT level from here (outside
          // React): the seat's session gate remounts the panel on every
          // transition, so a close called from inside the dying panel raced
          // the remount and lost (measured live). Deferred one tick so the
          // remount settles first; a file genuinely opened for the new
          // session re-opens the column after this with fresh content.
          setTimeout(() => {
            try { const l = ctx.layout; if (l && typeof l.closeViewer === 'function') l.closeViewer() } catch { /* face not wired */ }
          }, 0)
        })
      }, 'arxa-av: session mirror')

      // Public ingress: ONE listener for 'arxa-av-open' (sidebar file rows,
      // gen-ui cards, the chip interceptor and the produced-file observer all
      // dispatch it). Parks the payload in the store and opens the column —
      // the mounted panel consumes; no retry ladder, no parked window global.
      ctx.effect(() => {
        const onOpen = (ev) => {
          const detail = (ev && ev.detail) || {}
          // Two payload shapes ride ONE event: a file open (relPath) and an
          // insight report (kind:'insight' + view). The column, the sheet
          // behaviour below 744px and the store are shared; only the panel
          // body differs, so there is no second ingress to keep in step.
          if (detail.kind === 'insight') {
            if (!detail.view) return
            store.request({ kind: 'insight', view: detail.view, sessionId: detail.sessionId || null, orgId: detail.orgId || null })
          } else {
            if (!detail.relPath) return
            store.request({ sessionId: detail.sessionId || null, relPath: detail.relPath })
          }
          try { if (ctx.layout && typeof ctx.layout.openViewer === 'function') ctx.layout.openViewer() } catch { /* face not wired yet */ }
        }
        window.addEventListener('arxa-av-open', onOpen)
        return () => window.removeEventListener('arxa-av-open', onOpen)
      }, 'arxa-av-open ingress')

      // D91 card routing, capture phase: produced-file chips open the docked
      // viewer column. The stock deliverables chips stay untouched; the chip's
      // title carries the full path; "show in folder" (".") stays stock.
      ctx.effect(() => {
        const onChip = (e) => {
          try {
            const target = e.target
            const btn = target && target.closest ? target.closest('[data-produced-files-row] button[title]') : null
            if (!btn) return
            const path = btn.getAttribute('title')
            if (!path || path === '.') return
            e.preventDefault()
            e.stopPropagation()
            const snapNow = sessions && sessions.list ? sessions.list.getSnapshot() : null
            const sessionId = snapNow ? snapNow.current : null
            window.dispatchEvent(new CustomEvent('arxa-av-open', { detail: sessionId ? { sessionId, relPath: path } : { relPath: path } }))
          } catch { /* interception is best-effort — stock opener still applies */ }
        }
        document.addEventListener('click', onChip, true)
        return () => document.removeEventListener('click', onChip, true)
      }, 'arxa-av chip interception')

      // Claude-model auto-open: the FIRST produced file of a turn opens the
      // column by itself. Armed while no produced-files row exists; fires once
      // per row appearance (a new turn's row re-arms it). Everything else
      // stays click-to-open.
      ctx.effect(() => {
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return () => {}
        let armed = true
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

      ctx.slots.inject('viewer', () =>
        ctx.slots.register({ name: 'viewer', id: 'arxa-artifact-viewer', locale: NS },
          (props) => h(ArtifactPanel, { ...props, avStore: store, hostCtx: ctx })))
    }
    const inject = ['slots', 'connection', 'layout', 'sessions', 'locale']
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
