#!/usr/bin/env node
/**
 * Task 13: real-engine, local-only Freestyle lifecycle.
 *
 * Boots the checkout launcher against a scratch ARXA_HOME, registers a
 * separate scratch folder, creates a dsh-backed session below a subfolder,
 * commits it through the Git card, then previews and performs Finish. There
 * is no GitHub link, remote, prompt, or model request.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const studio = join(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.ARXA_FREESTYLE_SMOKE_PORT || 7937)
const budgetMs = Number(process.env.ARXA_FREESTYLE_SMOKE_BUDGET_MS || 120_000)
const home = mkdtempSync(join(tmpdir(), 'arxa-freestyle-home-'))
// Keep fixtures outside ARXA_HOME: a Freestyle root is user content, never
// engine state, and nesting it would hide accidental home coupling.
const rootPath = mkdtempSync(join(tmpdir(), 'arxa-freestyle-root-'))

const child = spawn(process.execPath, [join(studio, 'bin', 'arxa-studio.mjs'), '--no-open'], {
  env: {
    ...process.env,
    ARXA_HOME: home,
    ARXA_PORT: String(port),
    HOME: home,
    ZAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    ...Object.fromEntries(Object.keys(process.env).filter((key) => key.startsWith('DSH_')).map((key) => [key, undefined])),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let log = ''
child.stdout.on('data', (chunk) => { log += chunk })
child.stderr.on('data', (chunk) => { log += chunk })

function processTree(pid) {
  const found = []
  const pending = pid ? [pid] : []
  while (pending.length) {
    const parent = pending.pop()
    const result = spawnSync('pgrep', ['-P', String(parent)], { encoding: 'utf8' })
    for (const line of (result.stdout || '').split('\n')) {
      const childPid = Number(line.trim())
      if (childPid > 0) { found.push(childPid); pending.push(childPid) }
    }
  }
  return found
}

function stopEngine() {
  const pid = child.pid
  if (!pid) return
  const pids = [pid, ...processTree(pid)]
  for (const candidate of pids) { try { process.kill(candidate, 'SIGTERM') } catch {} }
  setTimeout(() => {
    for (const candidate of pids) { try { process.kill(candidate, 'SIGKILL') } catch {} }
  }, 1500).unref()
}

function engineLog() {
  let text = log
  try { text += readFileSync(join(home, 'dsh', 'engine.log'), 'utf8') } catch {}
  return text
}

function desktopSession() {
  try {
    const value = JSON.parse(readFileSync(join(home, 'dsh', 'desktop-session.json'), 'utf8'))
    return typeof value.url === 'string' && typeof value.token === 'string' && value.token ? value : null
  } catch { return null }
}

function request(authorityUrl, { path = '/', method = 'GET', cookie = '', body } = {}) {
  const authority = new URL(authorityUrl)
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: authority.port || port,
      path,
      method,
      headers: {
        host: authority.host,
        ...(cookie ? { cookie } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
      },
      timeout: 5000,
    }, (res) => {
      let text = ''
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    if (payload) req.write(payload)
    req.end()
  })
}

async function authenticate(session) {
  const tokenUrl = new URL(session.url)
  const exchange = await request(session.url, { path: tokenUrl.pathname + tokenUrl.search })
  const cookie = (exchange?.headers?.['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ')
  if (!cookie) return null
  const page = await request(session.url, { cookie })
  return page?.status === 200 && /<html/i.test(page.text) ? { authority: session.url, cookie } : null
}

const ok = (label, condition, detail = '') => {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''))
  console.log('OK  ' + label)
}

const git = (args) => spawnSync('git', args, { cwd: rootPath, encoding: 'utf8' }).stdout?.trim() ?? ''

async function main() {
  console.log(`boot  real engine on :${port}; ARXA_HOME=${home}; root=${rootPath}`)
  const deadline = Date.now() + budgetMs
  let auth = null
  while (Date.now() < deadline && !auth) {
    if (child.exitCode !== null) throw new Error('engine exited ' + child.exitCode + ' before serving')
    const session = desktopSession()
    if (session) auth = await authenticate(session)
    if (!auth) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  ok('engine authenticated locally', Boolean(auth))

  const jsonCall = async (path, body, method = 'POST') => {
    const response = await request(auth.authority, { path, method, cookie: auth.cookie, body })
    if (!response) throw new Error(path + ' was unreachable')
    let value
    try { value = JSON.parse(response.text) } catch { throw new Error(path + ' returned non-JSON status ' + response.status) }
    return value
  }
  const freestyle = (action, arg) => jsonCall('/__arxa/freestyle/action', { action, arg })
  const card = (action, arg) => jsonCall('/__arxa/git-card/action', { action, arg })

  const added = await freestyle('root.add', { path: rootPath })
  ok('root.add', added.ok === true && typeof added.root?.id === 'string', JSON.stringify(added))
  const rootId = added.root.id

  const created = await freestyle('file.create', { rootId, relPath: 'notes/seed.md' })
  ok('file.create notes/seed.md', created.ok === true && created.rel === 'notes/seed.md', JSON.stringify(created))

  const opened = await freestyle('session.new', { rootId, relDir: 'notes', name: 'Freestyle smoke' })
  ok('session.new below notes', opened.ok === true && opened.workspace === 'notes' && existsSync(opened.worktree), JSON.stringify(opened))
  // dshLive is computed by the host from ctx.agents.get(dshSessionId), after
  // the production bridge returns. No prompt or model request is involved.
  ok('session.new created a dsh conversation with a live engine agent',
    opened.dshStatus === 'live' && opened.dshLive === true && typeof opened.dshSessionId === 'string',
    JSON.stringify(opened))

  writeFileSync(join(opened.cwd, 'engine-proof.md'), '# Real engine proof\n')
  ok('write file in the session cwd', existsSync(join(opened.cwd, 'engine-proof.md')))

  const committed = await card('card.commit', { sessionId: opened.dshSessionId, subject: 'feat: add the real engine proof' })
  ok('card.commit through the card route', committed.ok === true && committed.result?.merged === true, JSON.stringify(committed))
  ok('main contains the session file', git(['show', 'main:notes/engine-proof.md']).includes('Real engine proof'), git(['log', '--oneline', '-3', 'main']))

  const preview = await freestyle('session.finish', { rootId, id: opened.id, dryRun: true })
  ok('session.finish dry-run would finish', preview.ok === true && preview.dryRun === true && preview.wouldFinish === true, JSON.stringify(preview))
  ok('dry-run keeps the worktree', existsSync(opened.worktree))

  const finished = await freestyle('session.finish', { rootId, id: opened.id, dryRun: false })
  ok('session.finish real', finished.ok === true && finished.finished === true && finished.worktreeRemoved === true, JSON.stringify(finished))
  ok('worktree is gone', !existsSync(opened.worktree), opened.worktree)
  ok('main still contains the file after Finish', git(['show', 'main:notes/engine-proof.md']).includes('Real engine proof'))
}

try {
  await main()
  console.log('GREEN freestyle real-engine smoke')
} catch (err) {
  console.error('freestyle real-engine smoke: FAILED — ' + String(err?.message ?? err))
  console.error(engineLog().split('\n').slice(-35).join('\n'))
  process.exitCode = 1
} finally {
  stopEngine()
  await new Promise((resolve) => setTimeout(resolve, 1800))
  rmSync(home, { recursive: true, force: true })
  rmSync(rootPath, { recursive: true, force: true })
}
