// Vendor bundle builder — DEV-TIME ONLY (node lib/vendor.js). Bundles the
// pinned viewing libraries into IIFE files under lib/vendor/ that the HOST
// serves on the studio origin (/__arxa/artifacts/vendor/<name>) and the
// CLIENT loads as plain <script> tags setting
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
// The VS Code 2026 theme port that used to live here is GONE with CodeMirror:
// it compiled tokenColors into CM6 HighlightStyle specs because CM6 has no
// TextMate engine. VS Code's own build has one, and paints its own themes.

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
const PINNED = ['esbuild', 'pdfjs-dist', 'prettier', 'material-icon-theme',
  '@fontsource-variable/fira-code']
const VERSIONS = {}
for (const p of PINNED) {
  VERSIONS[p] = JSON.parse(fs.readFileSync(join(buildDir, 'node_modules', p, 'package.json'), 'utf8')).version
}

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
  + ' * Rebuild: node plugins/artifact-viewer/lib/vendor.js */\n'

for (const [name, entry, globalName] of [
  ['prettier', PRETTIER_ENTRY, 'ArxaPrettier'],
  ['icons', buildIconsEntry(), 'ArxaIcons'],
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
