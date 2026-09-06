#!/usr/bin/env node
// Runnable proof that the built bundle EXECUTES, not just that it bundles.
//
// The build exiting 0 is not the signal: an app-mode build tree-shook the
// entry's exports away and still exited 0, and a missing model-service
// override still exited 0. Both were only visible in a browser. This serves
// dist/ on a throwaway port and drives it with the arxa lens, whose
// console/page errors auto-fail.
//
//   node check.mjs            # assumes dist/ is built (npm run build first)
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(here, 'dist')
if (!fs.existsSync(path.join(dist, 'arxa-monaco.js'))) {
  console.error('check: dist/arxa-monaco.js missing — run `npm run build` first')
  process.exit(1)
}

// The vendor route the host will use serves ONE flat dir under this prefix,
// and vite.config pins `base` to it, so the harness must mirror that shape.
const PREFIX = '/__arxa/artifacts/vendor/'
const TYPES = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.html': 'text/html', '.json': 'application/json', '.map': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
}

// The harness page is served from MEMORY, and its screenshot goes to a temp
// dir: dist/ is the shipped bundle (pack-sidecar tars it into the payload and
// the vendor route serves every name in it), so a check artefact written there
// would become a shipped file.
// NOTE: the harness deliberately does NOT inject the bundle's stylesheet. It
// used to, and that hid a shipped bug: client.js never loaded the CSS either,
// so the real viewer painted its editor unstyled across the whole page while
// this check stayed green. The bundle must bring its own stylesheet.
const page = fs.readFileSync(path.join(here, 'src', 'spike.html'), 'utf8')
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-monaco-check-'))

const server = http.createServer((req, res) => {
  const rel = new URL(req.url, 'http://x').pathname.replace(PREFIX, '')
  const name = path.basename(rel || 'spike.html')
  if (name === 'spike.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    return res.end(page)
  }
  const file = path.join(dist, name)
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

// `node check.mjs --dump <out.png>` runs the same page with ?dump, which paints
// every probe value into the document, and captures it WITHOUT --expect. That is
// the only way to see WHICH assertion failed: --expect collapses the whole run
// to one boolean, so a red check names nothing.
const DUMP = process.argv.includes('--dump')
// --shot is --dump without the value overlay: the same full-page capture, but
// showing what the page actually LOOKS like. A webview is a cross-origin
// iframe, so its contents can only be verified by eye.
const SHOT = process.argv.includes('--shot')
const dumpPng = DUMP || SHOT ? process.argv[process.argv.indexOf(DUMP ? '--dump' : '--shot') + 1] : null

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}spike.html` + (DUMP ? '?dump' : '')
  const png = (DUMP || SHOT) && dumpPng ? dumpPng : path.join(outDir, 'spike.png')
  // execFile, NOT execFileSync: the sync form blocks this process's event
  // loop, so the server above can never answer the lens's requests and every
  // run dies on a Page.navigate timeout.
  const args = ['lens', 'check', url, png, '1400', '900', '30000']
  if (!DUMP && !SHOT) args.push('--selector=.monaco-editor')
  execFile('arxa', DUMP || SHOT ? args : [...args,
    // Every claim phase 1 rests on, asserted in the browser. The reopen and
    // worker rows exist because both were previously written on faith: the
    // overlay stacked per open (stale text on the second visit to a path), and
    // nothing had ever asked getWorker for a label.
    '--expect=' + [
      "window.__spike.step === 'done'",   // the page ran to the end
      'window.__spike.error === undefined',
      'window.__spike.editor === true',
      'window.__spike.lines === 13',
      "window.__spike.lang === 'rust'",
      'window.__spike.tokens > 20',
      "window.__spike.lang2 === 'dart'",          // a second extension's grammar
      // markdown was opening as `plaintext` — the grammar extension was missing
      // while the FEATURE extension was present, which looks like markdown is
      // handled and is not.
      "window.__spike.mdLang === 'markdown'",
      // 2c: every extension an LSP row claims must resolve to a real language
      // id. `plaintext` would be a row that starts a server and syncs nothing.
      "window.__spike.ids.ts === 'typescript'",
      "window.__spike.ids.tsx === 'typescriptreact'",
      "window.__spike.ids.mts === 'typescript'",
      "window.__spike.ids.cts === 'typescript'",
      "window.__spike.ids.js === 'javascript'",
      "window.__spike.ids.jsx === 'javascriptreact'",
      "window.__spike.ids.mjs === 'javascript'",
      "window.__spike.ids.cjs === 'javascript'",
      "window.__spike.ids.html === 'html'",
      "window.__spike.ids.css === 'css'",
      "window.__spike.ids.scss === 'scss'",
      "window.__spike.ids.less === 'less'",
      "window.__spike.ids.json === 'json'",
      "window.__spike.ids.jsonc === 'jsonc'",
      "window.__spike.reopenLang === 'rust'",
      'window.__spike.reopenFresh === true',      // reopen shows the NEW bytes
      'window.__spike.reopenNoStale === true',    // and not the old ones
      'window.__spike.edited === true',           // replaceRange (format action)
      'window.__spike.onChangeFired === true',    // onChange (dirty tracking)
      'window.__spike.diffChanges > 0',           // the editor worker answered
      // MEASURED labels, not guessed — the first map keyed a label monaco
      // never asks for, and only the ?? fallback hid it.
      "window.__spike.workerLabels.includes('editorWorkerService')",
      "window.__spike.workerLabels.includes('TextMateWorker')",
      'window.__spike.themeFlipped === true',     // live dark/light flip
      'window.__spike.styled === true',           // the bundle loaded its OWN css
      'window.__spike.contained === true',        // and the editor stayed in its box
      'window.__spike.resizeShrank === true',     // follows the container when it shrinks
      'window.__spike.resizeRestored === true',   // and when it grows back
      // Narrow-pane shape: the minimap and gutters get out of the way and long
      // lines wrap instead of running off the side.
      'window.__spike.wideMinimap === true',
      'window.__spike.wideNoWrap === true',
      'window.__spike.narrowMinimap === false',
      'window.__spike.narrowWraps === true',
      'window.__spike.tinyLineNumbers === 0',     // line numbers off when tiny
      'window.__spike.restoredMinimap === true',
      // Phase 3: the markdown open itself must not throw, and the webworker
      // extension host must actually be running — it is the thing that was
      // silently off while { url, options } was passed to an override that
      // destructures { enableWorkerExtensionHost, iframeAlternateDomain }.
      'window.__spike.mdErr === undefined',
      'window.__spike.extHostFrames >= 1',
      // Phase 7.1: VS Code's editor part, attached alone.
      'window.__spike.partErr === undefined',
      'window.__spike.partMounted === true',
      // attachPart takes ONE part. The plan once claimed adopting views meant
      // the whole workbench chrome in the docked pane; nothing else may paint.
      'window.__spike.partChrome.length === 0',
      // The file opens through IEditorService into VS Code's real file editor,
      // in the MAIN part's group — not the standalone group wrapOpenEditor
      // reuses when a monaco.editor.create editor already holds the uri.
      'window.__spike.vsOpened === true',
      "window.__spike.paneId === 'workbench.editors.files.textFileEditor'",
      "window.__spike.mainGroups === '0:1'",
      'window.__spike.vsTabs === 1',
      // A webview. This is the whole point of the part.
      'window.__spike.previewFrames === 1',
      // Cancellation is swallowed on purpose; nothing ELSE may be rejecting.
      "window.__spike.rejects.every((r) => r.endsWith('=Canceled'))"
    ].join(' && '),
  ], { encoding: 'utf8' }, (err, stdout, stderr) => {
    server.close()
    const out = (stdout ?? '') + (stderr ?? '')
    if (err || /FAILED/.test(out)) {
      console.error(out.trim())
      console.error('check: RED')
      process.exitCode = 1
      return
    }
    console.log(out.trim())
    console.log('check: GREEN — monaco boots, the rust grammar resolves, the theme paints, no console errors')
  })
})
