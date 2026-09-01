// Vendor bundle builder — DEV-TIME ONLY (node lib/vendor.js). Bundles the
// pinned viewing libraries into IIFE files under lib/vendor/ that the HOST
// serves on the studio origin (/__arxa/artifacts/vendor/<name>) and the
// CLIENT loads as plain <script> tags setting window.ArxaCM / window.ArxaMD /
// window.ArxaPDF / window.ArxaTheme / window.ArxaPrettier / window.ArxaIcons.
// The dsh client module graph only resolves declared inject packages, so
// vendored prebuilt bundles are the ADR-0009 "categorized vendored libraries"
// form. Outputs are COMMITTED (same discipline as gen-workspace's spliced
// bundles); rerun after bumping the pinned versions below, and bump the
// plugin version (D77).
//
// Pinned sources resolve from the ISOLATED build dir (lib/vendor-build) — see
// vendor-build/package.json for why (root --no-save installs are not
// cumulative and get wiped by the next root npm install). Versions stamped
// into each bundle banner are read from the INSTALLED packages, so the
// provenance line can never drift from what was actually bundled.
//
// VS Code 2026 themes are vendored verbatim under lib/vendor-build/themes/
// (sha256 pinned, MIT, microsoft/vscode). The generator compiles their
// tokenColors into static CM6 HighlightStyle specs — no TextMate engine at
// runtime; scope selectors are resolved at build time by the curated
// FRAGMENT_TAG table below (2026 themes are GitHub-palette-flavored; unknown
// fragments degrade to a warned no-op, never a crash).

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = join(here, 'vendor-build')
const require2 = createRequire(join(buildDir, 'package.json'))
const esbuild = require2('esbuild')
const outDir = join(here, 'vendor')
fs.mkdirSync(outDir, { recursive: true })

// ---- provenance -----------------------------------------------------------
const PINNED = ['esbuild', 'codemirror', '@codemirror/view', '@codemirror/state',
  '@codemirror/commands', '@codemirror/language', '@codemirror/search',
  '@codemirror/merge', '@codemirror/autocomplete', '@codemirror/lint',
  '@codemirror/lang-markdown', '@codemirror/lang-javascript', '@codemirror/lang-css',
  '@codemirror/lang-html', '@codemirror/lang-json', '@codemirror/lang-yaml',
  '@codemirror/lang-python', '@codemirror/lang-go', '@codemirror/lang-rust',
  '@codemirror/lang-sql', '@codemirror/lang-sass', '@codemirror/legacy-modes',
  'markdown-it', 'dompurify', 'pdfjs-dist', 'prettier', 'material-icon-theme',
  '@fontsource-variable/fira-code']
const VERSIONS = {}
for (const p of PINNED) {
  VERSIONS[p] = JSON.parse(fs.readFileSync(join(buildDir, 'node_modules', p, 'package.json'), 'utf8')).version
}

// ---- JSONC (VS Code theme files carry comments) ---------------------------
function stripJSONC(src) {
  let out = '', i = 0, str = false, esc = false
  while (i < src.length) {
    const ch = src[i]
    if (str) {
      out += ch
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') str = false
      i++; continue
    }
    if (ch === '"') { str = true; out += ch; i++; continue }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (ch === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += ch; i++
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

// ---- VS Code 2026 -> CM6 theme compilation -------------------------------
// TextMate scope selector (last fragment of a chain) -> CM6 tag expression.
// 'null' means "no Lezer equivalent / extension-only scope" — skipped with a
// build-time note, never mapped to a wrong color.
const FRAGMENT_TAG = {
  // comments
  'comment': 'comment', 'punctuation.definition.comment': 'comment', 'string.comment': 'comment',
  // constants + support (GitHub blue #79c0ff family)
  'constant': 'constant', 'support.constant': 'constant', 'entity.name.constant': 'constant',
  'variable.other.constant': 'constant', 'variable.other.enummember': 'constant', 'entity': 'constant',
  'constant.character': 'character', 'constant.character.escape': 'escape',
  'constant.other.placeholder': 'special(string)', 'constant.other.reference.link': 'url',
  'variable.language': 'self', 'support.variable': 'standard(variableName)', 'support': 'standard(variableName)',
  // names (GitHub orange/purple/green family)
  'entity.name': 'typeName', 'entity.name.function': 'function(variableName)',
  'entity.name.tag': 'tagName', 'support.class.component': 'className',
  // meta.* restorers in the VS Code theme tame TextMate over-matching; Lezer
  // grammars are already precise, so these are intentional no-ops except the
  // ones carrying real colors.
  'meta.export.default': null, 'meta.definition.variable': null, 'meta.block': null,
  'meta.jsx.children': null, 'meta.tag.attributes': null, 'meta.object.member': null,
  'meta.embedded.expression': null, 'meta.module-reference': null, 'meta.output': null,
  'meta.property-name': 'propertyName', 'meta.separator': 'separator',
  'support.type.property-name.json': 'propertyName',
  // invalid + diagnostics
  'invalid.broken': 'invalid', 'invalid.deprecated': 'invalid', 'invalid.illegal': 'invalid',
  'invalid.unimplemented': 'invalid', 'message.error': 'invalid', 'token.error-token': 'invalid',
  'token.debug-token': null, 'token.info-token': null, 'token.warn-token': null,
  // keywords + storage (GitHub red family)
  'keyword': 'keyword', 'storage': 'definitionKeyword', 'storage.type': 'definitionKeyword',
  'storage.modifier.import': 'moduleKeyword', 'storage.modifier.package': 'moduleKeyword',
  'storage.type.java': 'typeName',
  // strings + regexp (GitHub blue family)
  'string': 'string', 'string.other.link': 'url',
  'source.regexp': 'regexp', 'string.regexp': 'regexp',
  'string.regexp.character-class': 'regexp', 'string.regexp.arbitrary-repitition': 'regexp',
  'source.ruby.embedded': 'meta', 'punctuation.section.embedded': 'meta',
  // diff
  'meta.diff.header': 'meta', 'meta.diff.header.from-file': 'deleted',
  'meta.diff.header.to-file': 'inserted', 'meta.diff.range': 'meta',
  'punctuation.definition.inserted': 'inserted', 'punctuation.definition.deleted': 'deleted',
  'punctuation.definition.changed': 'changed',
  // markdown markup
  'markup.heading': 'heading', 'markup.bold': 'strong', 'markup.italic': 'emphasis',
  'markup.strikethrough': 'strikethrough', 'markup.quote': 'quote', 'markup.underline': 'link',
  'markup.inline.raw': 'monospace', 'markup.inserted': 'inserted', 'markup.deleted': 'deleted',
  'markup.changed': 'changed', 'punctuation.definition.list.begin.markdown': 'list',
  'markup.untracked': null, 'markup.ignored': null,
  // variables (GitHub default-fg family)
  'variable': 'variableName', 'variable.other': 'variableName',
  'variable.parameter.function': 'variableName', 'source': null,
  // BracketHighlighter extension scopes + stray control scopes
  'brackethighlighter.angle': null, 'brackethighlighter.curly': null,
  'brackethighlighter.quote': null, 'brackethighlighter.round': null,
  'brackethighlighter.square': null, 'brackethighlighter.tag': null,
  'brackethighlighter.unmatched': null, 'carriage-return': null,
}

const FONT_STYLE_CSS = { italic: { fontStyle: 'italic' }, bold: { fontWeight: 'bold' }, underline: { textDecoration: 'underline' } }

function readTheme(file) {
  const t = JSON.parse(stripJSONC(fs.readFileSync(join(buildDir, 'themes', file), 'utf8')))
  const unknown = new Set()
  const specs = []
  // TextMate semantics: later rules win; iterate in file order, last write wins.
  const byTag = new Map()
  for (const rule of t.tokenColors || []) {
    for (const sel of [].concat(rule.scope || [''])) {
      if (typeof sel !== 'string') continue
      for (const part of sel.split(',')) {
        const chain = part.trim().split(/\s+/).filter(Boolean)
        if (chain.length === 0) continue
        const frag = chain[chain.length - 1]
        if (!(frag in FRAGMENT_TAG)) { unknown.add(frag); continue }
        const expr = FRAGMENT_TAG[frag]
        if (!expr) continue
        const style = { color: (rule.settings || {}).foreground }
        const fontStyle = (rule.settings || {}).fontStyle
        if (fontStyle && FONT_STYLE_CSS[fontStyle]) Object.assign(style, FONT_STYLE_CSS[fontStyle])
        if (!style.color && Object.keys(style).length === 1) continue
        byTag.set(expr, style)
      }
    }
  }
  for (const [expr, style] of byTag) specs.push({ t: expr, ...style })
  return { name: t.name, dark: t.type === 'dark', colors: t.colors || {}, specs, unknown: [...unknown] }
}

function compileChrome(colors) {
  const bg = colors['editor.background']
  const fg = colors['editor.foreground']
  const c = {}
  const has = (k) => colors[k] !== undefined
  c['&'] = { color: fg, backgroundColor: bg }
  if (has('editor.selectionBackground')) c['.cm-selectionBackground'] = { backgroundColor: colors['editor.selectionBackground'] }
  if (has('editor.inactiveSelectionBackground')) c['&:not(.cm-focused) .cm-selectionBackground'] = { backgroundColor: colors['editor.inactiveSelectionBackground'] }
  if (has('editor.lineHighlightBackground')) c['.cm-activeLine'] = { backgroundColor: colors['editor.lineHighlightBackground'] }
  c['.cm-gutters'] = {
    backgroundColor: colors['editorGutter.background'] || bg,
    color: colors['editorLineNumber.foreground'] || fg,
    border: 'none',
  }
  if (has('editorLineNumber.activeForeground')) c['.cm-activeLineGutter'] = { color: colors['editorLineNumber.activeForeground'] }
  if (has('editorCursor.foreground')) {
    c['.cm-cursor, .cm-dropCursor'] = { borderLeftColor: colors['editorCursor.foreground'] }
    c['.cm-content'] = { caretColor: colors['editorCursor.foreground'] }
  }
  if (has('editor.findMatchHighlightBackground')) c['.cm-searchMatch'] = { backgroundColor: colors['editor.findMatchHighlightBackground'] }
  if (has('editor.findMatchBackground')) c['.cm-searchMatch.cm-searchMatch-selected'] = { backgroundColor: colors['editor.findMatchBackground'] }
  if (has('editorBracketMatch.background') || has('editorBracketMatch.border')) {
    c['.cm-matchingBracket, .cm-nonmatchingBracket'] = {}
    if (has('editorBracketMatch.background')) c['.cm-matchingBracket, .cm-nonmatchingBracket'].backgroundColor = colors['editorBracketMatch.background']
    if (has('editorBracketMatch.border')) c['.cm-matchingBracket, .cm-nonmatchingBracket'].border = '1px solid ' + colors['editorBracketMatch.border']
  }
  if (has('editorWidget.background')) {
    const widget = { backgroundColor: colors['editorWidget.background'], color: colors['editorWidget.foreground'] || fg }
    if (has('editorWidget.border')) {
      widget.border = '1px solid ' + colors['editorWidget.border']
    }
    c['.cm-panels'] = { ...widget, borderTop: widget.border || ('1px solid ' + colors['editorWidget.border']) }
    c['.cm-tooltip'] = widget
  }
  if (has('editorSuggestWidget.selectedBackground')) c['.cm-tooltip-autocomplete ul li[aria-selected]'] = { backgroundColor: colors['editorSuggestWidget.selectedBackground'] }
  return c
}

function buildThemesEntry() {
  const dark = readTheme('2026-dark.json')
  const light = readTheme('2026-light.json')
  const unknown = [...new Set([...dark.unknown, ...light.unknown])]
  if (unknown.length) console.log('theme fragments with no CM6 mapping (skipped): ' + unknown.join(', '))
  const data = [dark, light].map((t) => ({
    name: t.name, dark: t.dark, bg: t.colors['editor.background'], fg: t.colors['editor.foreground'],
    // Markdown-preview code block surface, same GitHub family the 2026
    // palettes derive from (VS Code ships no token for it).
    codeBg: t.dark ? '#161b22' : '#f6f8fa',
    specs: t.specs, chrome: compileChrome(t.colors),
  }))
  console.log(`themes: dark ${data[0].specs.length} token specs / light ${data[1].specs.length} token specs`)
  // IMPORTANT: these live INSIDE the codemirror bundle (appended to CM_ENTRY
  // by buildCmEntry) — a separate themes.js IIFE would carry a second
  // @codemirror/state instance and every Compartment/extension would fail
  // the EditorView instanceof check ("Unrecognized extension value",
  // measured live 2026-09-03).
  return [
    'function resolveTag(expr) {',
    "  const m = expr.match(/^(?:([a-zA-Z]+)\\()?([a-zA-Z]+)\\)?$/)",
    '  if (!m) throw new Error("bad tag expr: " + expr)',
    '  if (m[1]) return tags[m[1]](tags[m[2]])',
    '  return tags[m[2]]',
    '}',
    'function buildTheme(d) {',
    '  const highlight = HighlightStyle.define(d.specs.map((s) => {',
    '    const spec = { tag: resolveTag(s.t) }',
    '    if (s.color) spec.color = s.color',
    '    if (s.fontStyle) spec.fontStyle = s.fontStyle',
    '    if (s.fontWeight) spec.fontWeight = s.fontWeight',
    '    if (s.textDecoration) spec.textDecoration = s.textDecoration',
    '    return spec',
    '  }))',
    '  const theme = EditorView.theme(d.chrome, { dark: d.dark })',
    '  return { theme, highlight, bg: d.bg, fg: d.fg, codeBg: d.codeBg, dark: d.dark, name: d.name, specs: d.specs }',
    '}',
    'window.ArxaCM.ArxaTheme = {',
    '  dark: buildTheme(' + JSON.stringify(data[0]) + '),',
    '  light: buildTheme(' + JSON.stringify(data[1]) + '),',
    '}',
  ].join('\n')
}

// ---- CodeMirror + 2026 themes entry (ONE bundle, ONE @codemirror inst) ----
const CM_LINES = [
  "import { basicSetup, EditorView } from 'codemirror'",
  "import { EditorState, Compartment } from '@codemirror/state'",
  "import { indentUnit, StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'",
  "import { highlightTree, tags } from '@lezer/highlight'",
  "import { markdown, markdownLanguage } from '@codemirror/lang-markdown'",
  "import { javascript, javascriptLanguage, jsxLanguage, typescriptLanguage, tsxLanguage } from '@codemirror/lang-javascript'",
  "import { css, cssLanguage } from '@codemirror/lang-css'",
  "import { html, htmlLanguage } from '@codemirror/lang-html'",
  "import { json, jsonLanguage } from '@codemirror/lang-json'",
  "import { yaml, yamlLanguage } from '@codemirror/lang-yaml'",
  "import { python, pythonLanguage } from '@codemirror/lang-python'",
  "import { go, goLanguage } from '@codemirror/lang-go'",
  "import { rust, rustLanguage } from '@codemirror/lang-rust'",
  "import { sql } from '@codemirror/lang-sql'",
  "import { sass, sassLanguage } from '@codemirror/lang-sass'",
  "import { toml } from '@codemirror/legacy-modes/mode/toml'",
  "import { shell } from '@codemirror/legacy-modes/mode/shell'",
  "import { dart as clikeDart } from '@codemirror/legacy-modes/mode/clike'",
  "import { keymap } from '@codemirror/view'",
  "import { indentWithTab } from '@codemirror/commands'",
  "import { unifiedMergeView } from '@codemirror/merge'",
  'const dartLegacy = StreamLanguage.define(clikeDart)',
  'const sqlParser = sql().language.parser',
  'window.ArxaCM = {',
  '  basicSetup: [basicSetup, keymap.of([indentWithTab])],',
  '  EditorView, EditorState, Compartment, indentUnit, syntaxHighlighting, keymap, unifiedMergeView,',
  '  highlightTree, resolveTag,',
  '  langs: { markdown, javascript, css, html, json, yaml, python, go, rust, sql, sass },',
  '  legacy: {',
  '    toml: () => StreamLanguage.define(toml),',
  '    shell: () => StreamLanguage.define(shell),',
  '    dart: () => dartLegacy,',
  '  },',
  '  // Parsers for the markdown-preview highlighter (ArxaMD.setParsers) —',
  '  // same module instances; no second @codemirror anywhere.',
  '  parsers: {',
  '    js: javascriptLanguage.parser, mjs: javascriptLanguage.parser, cjs: javascriptLanguage.parser,',
  '    jsx: jsxLanguage.parser, ts: typescriptLanguage.parser, tsx: tsxLanguage.parser,',
  '    json: jsonLanguage.parser, css: cssLanguage.parser, scss: sassLanguage.parser,',
  '    yaml: yamlLanguage.parser, yml: yamlLanguage.parser,',
  '    py: pythonLanguage.parser, python: pythonLanguage.parser,',
  '    go: goLanguage.parser, rs: rustLanguage.parser, rust: rustLanguage.parser,',
  '    sql: sqlParser, html: htmlLanguage.parser, dart: dartLegacy.parser,',
  '  },',
  '  langForExt(ext) {',
  "    const e = String(ext || '').replace('.', '').toLowerCase()",
  '    switch (e) {',
  "      case 'md': case 'markdown': return window.ArxaCM.langs.markdown()",
  "      case 'js': case 'mjs': case 'cjs': return window.ArxaCM.langs.javascript()",
  "      case 'jsx': return window.ArxaCM.langs.javascript({ jsx: true })",
  "      case 'ts': return window.ArxaCM.langs.javascript({ typescript: true })",
  "      case 'tsx': return window.ArxaCM.langs.javascript({ typescript: true, jsx: true })",
  "      case 'json': return window.ArxaCM.langs.json()",
  "      case 'css': return window.ArxaCM.langs.css()",
  "      case 'scss': return window.ArxaCM.langs.sass()",
  "      case 'html': case 'htm': return window.ArxaCM.langs.html()",
  "      case 'yaml': case 'yml': return window.ArxaCM.langs.yaml()",
  "      case 'py': return window.ArxaCM.langs.python()",
  "      case 'go': return window.ArxaCM.langs.go()",
  "      case 'rs': return window.ArxaCM.langs.rust()",
  "      case 'sql': return window.ArxaCM.langs.sql()",
  "      case 'toml': return window.ArxaCM.legacy.toml()",
  "      case 'sh': case 'bash': case 'zsh': return window.ArxaCM.legacy.shell()",
  "      case 'dart': return window.ArxaCM.legacy.dart()",
  '      default: return null',
  '    }',
  '  },',
  '}']
const CM_ENTRY = [...CM_LINES, buildThemesEntry()].join('\n')

// ---- Prettier entry (lazy-loaded only when the user formats) --------------
const PRETTIER_ENTRY = [
  "import * as prettier from 'prettier/standalone'",
  "import * as pluginBabel from 'prettier/plugins/babel'",
  "import * as pluginEstree from 'prettier/plugins/estree'",
  "import * as pluginTypescript from 'prettier/plugins/typescript'",
  "import * as pluginPostcss from 'prettier/plugins/postcss'",
  "import * as pluginMarkdown from 'prettier/plugins/markdown'",
  "import * as pluginYaml from 'prettier/plugins/yaml'",
  'const PLUGINS = [pluginBabel, pluginEstree, pluginTypescript, pluginPostcss, pluginMarkdown, pluginYaml]',
  '// ext -> prettier parser (client hides the Format action for null exts).',
  'const PARSER = {',
  "  js: 'babel', mjs: 'babel', cjs: 'babel', jsx: 'babel',",
  "  ts: 'typescript', tsx: 'typescript',",
  "  json: 'json', jsonc: 'json5',",
  "  css: 'css', scss: 'scss',",
  "  md: 'markdown', yaml: 'yaml', yml: 'yaml',",
  '}',
  'window.ArxaPrettier = {',
  '  parserForExt(ext) {',
  "    return PARSER[String(ext || '').replace('.', '').toLowerCase()] || null",
  '  },',
  '  async format(code, ext, opts) {',
  "    const parser = PARSER[String(ext || '').replace('.', '').toLowerCase()]",
  '    if (!parser) throw new Error("no prettier parser for ." + ext)',
  '    return prettier.format(code, { parser, plugins: PLUGINS, ...opts })',
  '  },',
  '}',
].join('\n')

// ---- PDF / markdown entries (unchanged) -----------------------------------
const PDF_ENTRY = [
  "import * as pdfjsLib from 'pdfjs-dist'",
  "pdfjsLib.GlobalWorkerOptions.workerSrc = '/__arxa/artifacts/vendor/pdf.worker.js'",
  'window.ArxaPDF = {',
  '  // Hardened for untrusted documents: no eval path (PDF.js hardening).',
  '  getDocument: (opts) => pdfjsLib.getDocument({ isEvalSupported: false, ...opts }),',
  '}',
].join('\n')

const PDF_WORKER_ENTRY = [
  "import 'pdfjs-dist/build/pdf.worker.mjs'",
].join('\n')

const MD_ENTRY = [
  "import MarkdownIt from 'markdown-it'",
  "import DOMPurify from 'dompurify'",
  'window.ArxaMD = {',
  '  _md: null,',
  '  _parsers: null,',
  '  _theme: null,',
  '  // Called by the client once ArxaCM is up; stable per-index class names',
  '  // (aXaTokN) mean a theme swap only swaps the stylesheet, never the HTML.',
  '  // Receives window.ArxaCM itself: parsers + lezer tag machinery all come',
  '  // from that ONE instance — a second @lezer/highlight would break tag',
  '  // identity and every fence would silently render uncolored.',
  '  setParsers(CM) {',
  '    this._cm = CM || null',
  '    this._parsers = CM ? CM.parsers : null',
  '    this._tags = null',
  '    this._md = null',
  '  },',
  '  setTheme(theme) {',
  '    this._theme = theme',
  '    if (!theme || !theme.specs) return',
  '    let css = ""',
  '    theme.specs.forEach((s, i) => {',
  '      if (s.color) css += ".aXaTok" + i + "{color:" + s.color + "}"',
  '      if (s.fontStyle) css += ".aXaTok" + i + "{font-style:" + s.fontStyle + "}"',
  '      if (s.fontWeight) css += ".aXaTok" + i + "{font-weight:" + s.fontWeight + "}"',
  '      if (s.textDecoration) css += ".aXaTok" + i + "{text-decoration:" + s.textDecoration + "}"',
  '    })',
  '    let tag = document.querySelector("style[data-arxa-md-tokens]")',
  '    if (!tag) {',
  '      tag = document.createElement("style")',
  '      tag.dataset.arxaMdTokens = "1"',
  '      document.head.appendChild(tag)',
  '    }',
  '    tag.textContent = css',
  '  },',
  '  _tags: null,',
  '  // highlighter for @lezer/highlight: last-wins spec order, first match returns',
  '  _highlighter() {',
  '    const specs = this._theme && this._theme.specs ? this._theme.specs : []',
  '    if (!this._tags || this._tags.length !== specs.length) {',
  '      this._tags = specs.map((s) => this._cm.resolveTag(s.t))',
  '    }',
  '    const built = this._tags',
  '    return {',
  '      style(tags2) {',
  '        for (let i = specs.length - 1; i >= 0; i--) {',
  '          const spec = built[i]',
  '          for (let j = 0; j < tags2.length; j++) {',
  '            const chain = tags2[j] && tags2[j].set',
  '            if (chain && chain.indexOf(spec) > -1) return "aXaTok" + i',
  '          }',
  '        }',
  '        return null',
  '      },',
  '    }',
  '  },',
  '  _highlight(code, lang) {',
  '    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")',
  '    const parser = this._parsers && this._parsers[String(lang || "").toLowerCase()]',
  '    if (!parser || !this._theme || !this._cm) return null',
  '    try {',
  '      const tree = parser.parse(code)',
  '      let out = ""',
  '      let pos = 0',
  '      let open = null',
  '      const flush = (to) => { if (to > pos) { if (open !== null) { out += "</span>"; open = null } out += esc(code.slice(pos, to)); pos = to } }',
  '      this._cm.highlightTree(tree, [this._highlighter()], (from, to, classes) => {',
  '        if (from > pos) { flush(from) }',
  '        if (open !== null && open !== classes) { out += "</span>"; open = null }',
  '        if (open === null) { out += \'<span class="\' + classes + \'">\'; open = classes }',
  '        out += esc(code.slice(pos, Math.max(pos, to))); pos = Math.max(pos, to)',
  '      })',
  '      flush(code.length)',
  '      if (open !== null) out += "</span>"',
  '      return \'<pre class="aXa_av_mdCode"><code>\' + out + "</code></pre>"',
  '    } catch { return null }',
  '  },',
  '  render(mdText) {',
  '    if (!this._md) {',
  '      const self = this',
  '      this._md = new MarkdownIt({',
  '        html: false,',
  '        linkify: true,',
  '        breaks: false,',
  '        highlight(code, lang) { return self._highlight(code, lang) },',
  '      })',
  '    }',
  '    return DOMPurify.sanitize(this._md.render(String(mdText)))',
  '  },',
  '}',
].join('\n')

// ---- Material Icon Theme curation ----------------------------------------
// The pack ships ~1250 definitions (~1.7MB); we inline ONLY the SVGs the
// curated universe references and fall back to the pack defaults for
// everything else. Same vendored-subset discipline as the language packs.
const ICON_EXTS = ['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'jsonc', 'yaml', 'yml',
  'toml', 'py', 'rb', 'go', 'rs', 'sql', 'sh', 'bash', 'zsh', 'ini', 'env', 'md', 'css',
  'scss', 'html', 'htm', 'dart', 'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif',
  'svg', 'ico', 'bmp', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'mp4', 'webm', 'mov', 'lock',
  'log', 'xml', 'kt', 'java', 'c', 'cpp', 'h', 'hpp', 'swift', 'lua', 'php', 'graphql',
  'gql', 'vue', 'svelte', 'gradle', 'gitignore']
const ICON_FILENAMES = ['gitignore', 'gitattributes', 'editorconfig', 'dockerfile', 'license',
  'licence', 'readme', 'makefile', 'cmakelists.txt', 'agents.md', 'pnpm-lock.yaml',
  'package-lock.json', 'yarn.lock', 'cargo.lock', '.env', '.npmrc', 'gemfile', 'pubspec.yaml',
  'analysis_options.yaml', 'organisation.json']
const ICON_FOLDERS = ['lib', 'bin', 'docs', 'test', 'tests', 'tool', 'tools', 'src', 'dist',
  'build', 'assets', 'static', 'scripts', 'config', 'public', 'app', 'apps', 'packages',
  'plugins', 'examples', 'benchmarks', 'ci', '.github', '.arxa', '.vscode', 'node_modules',
  'target', 'coverage', 'stories', 'spec', 'styles', 'layouts', 'components', 'pages',
  'services', 'models', 'utils', 'helpers', 'types', 'integration', 'fixtures', 'migrations',
  'seeds', 'android', 'ios', 'macos', 'web', 'windows', 'linux']

function buildIconsEntry() {
  const pkgDir = join(buildDir, 'node_modules', 'material-icon-theme')
  const manifest = JSON.parse(fs.readFileSync(join(pkgDir, 'dist', 'material-icons.json'), 'utf8'))
  const defs = manifest.iconDefinitions || {}
  const svgOf = (defName) => {
    const def = defs[defName]
    if (!def || !def.iconPath) return null
    const p = join(pkgDir, 'icons', def.iconPath.split('/').pop())
    if (!fs.existsSync(p)) return null
    // Material SVGs carry only a viewBox — pin explicit 16px so the icon
    // renders at slot size with no container CSS dependency.
    return fs.readFileSync(p, 'utf8')
      .replace(/<svg /, '<svg width="16" height="16" ')
      .replace(/>\s+</g, '><')
      .trim()
  }
  const needed = new Set(['file', 'folder', 'folder-open'])
  const FILES = {}, EXTS = {}, FOLDERS = {}, FOLDERS_OPEN = {}
  for (const f of ICON_FILENAMES) {
    const d = (manifest.fileNames || {})[f]
    if (d && defs[d]) { FILES[f] = d; needed.add(d) }
  }
  for (const e of ICON_EXTS) {
    const d = (manifest.fileExtensions || {})[e]
    if (d && defs[d]) { EXTS[e] = d; needed.add(d) }
  }
  for (const f of ICON_FOLDERS) {
    const d = (manifest.folderNames || {})[f]
    if (d && defs[d]) { FOLDERS[f] = d; needed.add(d) }
    const dOpen = (manifest.folderNamesExpanded || {})[f]
    if (dOpen && defs[dOpen]) { FOLDERS_OPEN[f] = dOpen; needed.add(dOpen) }
  }
  const svgs = {}
  for (const d of needed) {
    const s = svgOf(d)
    if (s) svgs[d] = s
  }
  const missing = [...needed].filter((d) => !svgs[d])
  if (missing.length) console.log('icon definitions with no SVG file (skipped): ' + missing.join(', '))
  console.log(`icons: ${Object.keys(svgs).length} SVGs inlined (exts ${Object.keys(EXTS).length}, names ${Object.keys(FILES).length}, folders ${Object.keys(FOLDERS).length}+open)`)
  return [
    '// Curated subset of Material Icon Theme (MIT) — GENERATED by lib/vendor.js, do not edit.',
    'window.ArxaIcons = (function () {',
    '  const svgs = ' + JSON.stringify(svgs) + '',
    '  const FILES = ' + JSON.stringify(FILES) + '',
    '  const EXTS = ' + JSON.stringify(EXTS) + '',
    '  const FOLDERS = ' + JSON.stringify(FOLDERS) + '',
    '  const FOLDERS_OPEN = ' + JSON.stringify(FOLDERS_OPEN) + '',
    '  const DEFAULTS = { file: "file", folder: "folder", folderOpen: "folder-open" }',
    '  function baseName(name) {',
    '    return String(name || "").split("/").pop().toLowerCase()',
    '  }',
    '  function defFor(name) {',
    '    const s = baseName(name)',
    '    if (FILES[s]) return svgs[FILES[s]] || svgs[DEFAULTS.file]',
    '    const m = s.match(/\\.([a-z0-9]+)$/) || ["", s]',
    '    if (EXTS[m[1]]) return svgs[EXTS[m[1]]] || svgs[DEFAULTS.file]',
    '    return svgs[DEFAULTS.file]',
    '  }',
    '  return {',
    '    file: defFor,',
    '    folder(name, open) {',
    '      const s = baseName(name)',
    '      if (open) return svgs[FOLDERS_OPEN[s]] || svgs[DEFAULTS.folderOpen]',
    '      return svgs[FOLDERS[s]] || svgs[DEFAULTS.folder]',
    '    },',
    '  }',
    '})()',
  ].join('\n')
}

// ---- build ----------------------------------------------------------------
const banner = (name) => '/* arxa-artifact-viewer vendored bundle — GENERATED by lib/vendor.js, do not edit.\n'
  + ' * Pinned sources: ' + JSON.stringify(VERSIONS) + '\n'
  + ' * VS Code 2026 themes: microsoft/vscode (MIT) sha256-16 2026-dark 909deb25576302ca / 2026-light ee779361c6dc45d3\n'
  + ' * Rebuild: node plugins/artifact-viewer/lib/vendor.js */\n'

for (const [name, entry, globalName] of [
  ['codemirror', CM_ENTRY, 'ArxaCM'],
  ['prettier', PRETTIER_ENTRY, 'ArxaPrettier'],
  ['icons', buildIconsEntry(), 'ArxaIcons'],
  ['markdown', MD_ENTRY, 'ArxaMD'],
  ['pdf', PDF_ENTRY, 'ArxaPDF'],
  ['pdf.worker', PDF_WORKER_ENTRY, null],
]) {
  const out = join(outDir, name + '.js')
  await esbuild.build({
    absWorkingDir: buildDir,
    nodePaths: [join(buildDir, 'node_modules')],
    stdin: { contents: entry, resolveDir: buildDir, sourcefile: name + '-entry.js' },
    bundle: true, minify: true, format: 'iife', target: ['es2020'],
    outfile: out, banner: { js: banner(name) }, logLevel: 'silent',
  })
  const size = fs.statSync(out).size
  console.log('vendored ' + name + '.js -> ' + out + ' (' + size + ' bytes, sets window.' + globalName + ')')
}

// ---- Fira Code (variable, OFL) copied verbatim for the font selector ------
for (const subset of ['latin', 'latin-ext']) {
  const src = join(buildDir, 'node_modules', '@fontsource-variable', 'fira-code', 'files', `fira-code-${subset}-wght-normal.woff2`)
  const dst = join(outDir, `fira-code-${subset}.woff2`)
  fs.copyFileSync(src, dst)
  console.log('vendored fira-code-' + subset + '.woff2 -> ' + dst + ' (' + fs.statSync(dst).size + ' bytes)')
}
