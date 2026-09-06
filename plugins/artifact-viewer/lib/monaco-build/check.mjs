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
import { WebSocketServer } from 'ws'

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
  // The page POSTs its probe values here at the end of the run. --expect
  // collapses to one boolean and --dump paints a PNG; this is the text form,
  // so a red check can be read without opening an image.
  if (req.method === 'POST' && name === 'report') {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      fs.writeFileSync(path.join(outDir, 'report.json'), body)
      console.log('report: ' + body)
      res.writeHead(204); res.end()
    })
    return
  }
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
// --webkit runs the same page in a WKWebView (tools/wk.swift) instead of the
// lens's Chrome. The desktop studio IS a WebKit webview, and the markdown
// preview flash of 2026-09-07 never reproduced in Chrome.
const WEBKIT = process.argv.includes('--webkit')

// A STUB language server on the same origin.
//
// The LSP lane is the one thing the browser check could never see: the client
// attaches by documentSelector on language id, and files now open through VS
// Code's textFileEditor instead of a standalone editor. Nothing proved a
// language client still syncs a document in that lane — and connectLanguageServer
// was in fact deleted once by an editing mistake, caught only by a source pin.
//
// So: answer initialize, wait for the didOpen the client should send for the
// open file, and publish one diagnostic back. If a marker lands on the model,
// the whole path is real — client started, document synced, diagnostics applied.
const wss = new WebSocketServer({ noServer: true, handleProtocols: () => 'arxa-lsp' })
server.on('upgrade', (rq, socket, head) => {
  if (!new URL(rq.url, 'http://x').pathname.endsWith('/lsp-stub')) return socket.destroy()
  wss.handleUpgrade(rq, socket, head, (ws) => {
    // vscode-ws-jsonrpc frames one JSON message per websocket message — no
    // Content-Length headers, unlike the stdio transport the real host uses.
    ws.on('message', (data) => {
      let msg
      try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.method === 'initialize') {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { textDocumentSync: 1 } } }))
      } else if (msg.method === 'shutdown') {
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }))
      } else if (msg.method === 'textDocument/didOpen') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: {
            uri: msg.params.textDocument.uri,
            diagnostics: [{
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              severity: 1,
              source: 'arxa-stub',
              message: 'stub diagnostic',
            }],
          },
        }))
      }
    })
  })
})

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}spike.html` + (DUMP ? '?dump' : '')
  if (WEBKIT) {
    const src = path.join(here, 'tools', 'wk.swift')
    const bin = path.join(here, 'tools', 'wk')
    const stale = !fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs
    const run = () => execFile(bin, [url, '150'], { encoding: 'utf8' }, (err, stdout, stderr) => {
      server.close()
      const line = (stdout ?? '').split('\n').find((l) => l.startsWith('RESULT: ')) ?? ''
      let res = null
      try { res = JSON.parse(line.slice(8)) } catch { /* timeout or crash */ }
      if (err || !res || res.fail.length) {
        console.error(line || (stderr ?? '').trim() || String(err))
        console.error('check (webkit): RED')
        process.exitCode = 1
        return
      }
      console.log('check (webkit): GREEN — ' + res.ua)
    })
    if (!stale) return run()
    execFile('swiftc', ['-O', '-o', bin, src], { encoding: 'utf8' }, (err, _o, stderr) => {
      if (err) { console.error(stderr); console.error('check (webkit): swiftc failed'); process.exitCode = 1; server.close(); return }
      run()
    })
    return
  }
  const png = (DUMP || SHOT) && dumpPng ? dumpPng : path.join(outDir, 'spike.png')
  // execFile, NOT execFileSync: the sync form blocks this process's event
  // loop, so the server above can never answer the lens's requests and every
  // run dies on a Page.navigate timeout.
  const args = ['lens', 'check', url, png, '1400', '900', '75000']
  if (!DUMP && !SHOT) args.push('--selector=.monaco-editor')
  execFile('arxa', DUMP || SHOT ? args : [...args,
    // Every claim phase 1 rests on, asserted in the browser. The reopen and
    // worker rows exist because both were previously written on faith: the
    // overlay stacked per open (stale text on the second visit to a path), and
    // nothing had ever asked getWorker for a label.
    // ONE expression, because --expect collapses to a single boolean either
    // way. The assertions themselves live in src/spike.html, where the page can
    // evaluate them one at a time and NAME the ones that failed — `got false`
    // on a 60-term conjunction names nothing.
    // Array.isArray first: if the page has NOT reached its assertion loop yet,
    // `fail` is undefined and `.length` throws inside the lens rather than
    // failing the check. Unfinished must read as red, not as a crash.
    '--expect=Array.isArray(window.__spike.fail) && window.__spike.fail.length === 0',

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
