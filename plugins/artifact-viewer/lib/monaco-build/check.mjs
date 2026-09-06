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

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}spike.html`
  const png = path.join(outDir, 'spike.png')
  // execFile, NOT execFileSync: the sync form blocks this process's event
  // loop, so the server above can never answer the lens's requests and every
  // run dies on a Page.navigate timeout.
  execFile('arxa', ['lens', 'check', url, png, '1400', '900', '30000',
    '--selector=.monaco-editor',
    // Every claim phase 1 rests on, asserted in the browser. The reopen and
    // worker rows exist because both were previously written on faith: the
    // overlay stacked per open (stale text on the second visit to a path), and
    // nothing had ever asked getWorker for a label.
    '--expect=' + [
      "window.__spike.step === 'done'",   // the page ran to the end
      'window.__spike.error === undefined',
      'window.__spike.editor === true',
      'window.__spike.lines === 12',
      "window.__spike.lang === 'rust'",
      'window.__spike.tokens > 20',
      "window.__spike.lang2 === 'dart'",          // a second extension's grammar
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
