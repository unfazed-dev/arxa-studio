#!/usr/bin/env node
// engine-boot-smoke — boot the REAL engine against a scratch home and prove
// the studio UI answers. The update-strategy amendment (2026-09-05) tiered
// gate's smoke rung: stronger than `--help` (which proves the entry parses),
// weaker than the WKWebView boot gate (which proves the desktop shell boots
// around it). This is the bump PR's live answer to "does the pinned wave
// actually boot".
//
// Live but fully local: a throwaway ARXA_HOME under os.tmpdir(), an
// out-of-the-way port, nothing written into the operator's ~/.arxa or
// ~/.dsh, no credentials, no model calls — the HTTP handshake is the proof.
// The engine spawns a process TREE (wrapper → dsh server); teardown walks
// the tree like the desktop shell does (pgrep -P, TERM, short grace, KILL).
//
//   node scripts/engine-boot-smoke.mjs            # npm run smoke
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.ARXA_SMOKE_PORT || 7919)
const HOST = 'arxa.studio.localhost'
const BOOT_BUDGET_MS = Number(process.env.ARXA_SMOKE_BUDGET_MS || 120_000)

const scratch = mkdtempSync(join(tmpdir(), 'arxa-boot-smoke-'))
const child = spawn(process.execPath, [join(root, 'bin', 'arxa-studio.mjs'), '--no-open'], {
  env: {
    ...process.env,
    // arxa owns its home outright (HOME DISCIPLINE, bin/arxa-studio.mjs):
    // point the whole thing at the scratch dir and strip any parent-session
    // DSH_* identity, exactly like the packed sidecar does.
    ARXA_HOME: scratch,
    ARXA_PORT: String(PORT),
    HOME: scratch,
    ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('DSH_')).map((k) => [k, undefined])),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (d) => { log += d })
child.stderr.on('data', (d) => { log += d })

const killTree = () => {
  const pid = child.pid
  if (!pid) return
  const tree = []
  let queue = [pid]
  while (queue.length) {
    const p = queue.pop()
    const out = spawnSync('pgrep', ['-P', String(p)], { encoding: 'utf8' })
    for (const line of (out.stdout || '').split('\n')) {
      const c = Number(line.trim())
      if (c > 0) { tree.push(c); queue.push(c) }
    }
  }
  for (const p of [pid, ...tree]) { try { process.kill(p, 'SIGTERM') } catch {} }
  setTimeout(() => { for (const p of [pid, ...tree]) { try { process.kill(p, 'SIGKILL') } catch {} } }, 1500).unref()
}

const fetchOnce = () => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/', headers: { host: `${HOST}:${PORT}` }, timeout: 3000 }, (res) => {
    let body = ''
    res.on('data', (d) => { body += d })
    res.on('end', () => resolve({ status: res.statusCode, body }))
  })
  req.on('timeout', () => { req.destroy(); resolve(null) })
  req.on('error', () => resolve(null))
  req.end()
})

// dsh 0.1.2-rc.1 serves the web UI behind BrowserAuth: a plain GET / answers
// 401, and the launcher prints a one-time token URL ("dsh web: …?token=…")
// that exchanges into a session cookie via 303. The probe therefore walks
// the real flow: capture the token URL from the child's stdout, exchange it,
// THEN expect 200 HTML with the cookie. The cookie is AUTHORITY-BOUND (its
// payload pins the exchange's host:port), so the content fetch reuses the
// token URL's own authority — switching to arxa.studio.localhost mid-flow
// reads as a different site and 401s.
const tokenUrlFromLog = () => {
  const m = log.match(/dsh web: (https?:\/\/\S+\?token=\S+)/)
  return m ? m[1] : null
}
const fetchTokenFlow = async (tokenUrl) => {
  const u = new URL(tokenUrl)
  const exchange = await new Promise((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port || PORT, path: u.pathname + u.search, headers: { host: u.host }, timeout: 5000 }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode, cookie: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') }))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
  if (!exchange || !exchange.cookie) return exchange ? exchange : null
  return await new Promise((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port || PORT, path: '/', headers: { host: u.host, cookie: exchange.cookie }, timeout: 5000 }, (res) => {
      let body = ''
      res.on('data', (d) => { body += d })
      res.on('end', () => resolve({ status: res.statusCode, body }))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

const deadline = Date.now() + BOOT_BUDGET_MS
let up = null
process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }) } catch {} })

console.log(`booting engine on :${PORT} (scratch home ${scratch}) …`)
while (Date.now() < deadline && !up) {
  if (child.exitCode !== null) break // died under us — report below
  const tokenUrl = tokenUrlFromLog()
  if (tokenUrl) {
    // The server is up enough to print its token URL — walk the exchange,
    // but tolerate the route-mount window (non-2xx/303-without-cookie yet).
    const walked = await fetchTokenFlow(tokenUrl)
    if (walked && walked.status === 200) up = walked
  } else {
    await fetchOnce() // keep the early loop alive without treating 401/404 as "up"
  }
  if (!up) await new Promise((r) => setTimeout(r, 1000))
}
killTree()

if (!up || up.status !== 200 || !/<html/i.test(up.body || '')) {
  console.error('engine-boot-smoke: FAILED — no HTML 200 from the studio UI')
  console.error(('' + log).split('\n').slice(-25).join('\n'))
  process.exit(1)
}
console.log(`engine-boot-smoke: OK — studio UI answered 200 HTML on :${PORT} (boot in ${Math.round((BOOT_BUDGET_MS - (deadline - Date.now())) / 1000)}s budget)`)
process.exit(0)
