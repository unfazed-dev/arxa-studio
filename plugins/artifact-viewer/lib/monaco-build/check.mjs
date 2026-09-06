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

const css = fs.readdirSync(dist).find((f) => f.endsWith('.css'))
fs.writeFileSync(path.join(dist, 'spike.html'),
  fs.readFileSync(path.join(here, 'src', 'spike.html'), 'utf8').replace('__CSS__', PREFIX + css))

const server = http.createServer((req, res) => {
  const rel = new URL(req.url, 'http://x').pathname.replace(PREFIX, '')
  const file = path.join(dist, path.basename(rel || 'spike.html'))
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}${PREFIX}spike.html`
  const png = path.join(dist, 'spike.png')
  // execFile, NOT execFileSync: the sync form blocks this process's event
  // loop, so the server above can never answer the lens's requests and every
  // run dies on a Page.navigate timeout.
  execFile('arxa', ['lens', 'check', url, png, '1400', '900', '15000',
    '--selector=.monaco-editor',
    "--expect=window.__spike.editor === true && window.__spike.lines === 12 && window.__spike.lang === 'rust' && window.__spike.tokens > 20",
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
