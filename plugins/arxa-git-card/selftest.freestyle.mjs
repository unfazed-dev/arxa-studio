#!/usr/bin/env node
// Task 13 regression: a Freestyle session lives outside the open org, but its
// dsh conversation still seats the shared Git card on that root's repository.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-git-card-freestyle-'))
process.env.ARXA_HOME = path.join(sandbox, 'home')
const env = { ...process.env }
let n = 0
const ok = (condition, message) => {
  assert.ok(condition, message)
  n++
  console.log('  ok', n, '-', message)
}

try {
  const gw = await import('../git-workspace/lib/index.js')
  const { addRoot } = await import('../arxa-freestyle/lib/roots.js')
  const { createFreestyleSessions } = await import('../arxa-freestyle/lib/sessions.js')
  const card = await import('./lib/index.js')

  const decoyPath = path.join(sandbox, 'decoy-root')
  fs.mkdirSync(decoyPath, { recursive: true })
  const decoy = addRoot(decoyPath, { env, name: 'Decoy Root' })
  fs.writeFileSync(path.join(decoyPath, '.arxa', 'freestyle.json'), JSON.stringify({
    id: decoy.id, kind: 'freestyle', name: 'Decoy Root', localOnly: false,
    repoOwner: 'wrong-owner', repoName: 'wrong-root', repoUrl: 'https://github.com/wrong-owner/wrong-root',
  }))
  gw.wipCommit(decoyPath, { message: 'decoy fixture', env })
  const decoyBefore = gw.runGit(['rev-parse', 'HEAD'], { cwd: decoyPath, env })

  const rootPath = path.join(sandbox, 'freestyle-root')
  fs.mkdirSync(path.join(rootPath, 'docs'), { recursive: true })
  const root = addRoot(rootPath, { env, name: 'Freestyle Root' })
  const dshId = 'arxa-freestyle-conversation'
  const sessions = createFreestyleSessions({
    env,
    dshBridge: { spawn: async () => ({ ok: true, id: dshId }) },
  })
  const session = await sessions.newSession(root, 'docs', 'Write notes')
  fs.writeFileSync(path.join(session.cwd, 'note.md'), '# Freestyle note\n')

  const fakeGithub = {
    status: async () => ({ linked: true, login: 'octocat' }),
    prChecks: async () => ({ state: 'unknown', asleep: false, runs: [] }),
  }
  globalThis[Symbol.for('arxa.sidebar.host')] = {
    ready: true,
    seam: true,
    orgContext: async () => null,
    getGithub: async () => fakeGithub,
    mainChecksFor: async () => null,
    importGitWorkspace: async () => gw,
  }

  const routes = {}
  card.apply({ webServer: { register(route) { routes[route.path] = route.handler } } })
  const act = (action, arg) => new Promise((resolve) => {
    const req = { _h: {}, on(event, fn) { this._h[event] = fn } }
    routes['/__arxa/git-card/action'](req, {
      writeHead() {},
      end(body) { resolve(JSON.parse(body)) },
    })
    queueMicrotask(() => {
      req._h.data(JSON.stringify({ action, arg }))
      req._h.end()
    })
  })

  let result = await act('card.status', { sessionId: dshId })
  ok(result.ok === true, 'card.status finds a Freestyle session outside the open org: ' + JSON.stringify(result))
  ok(result.result?.kind === 'freestyle' && result.result?.localOnly === true, 'card.status reads the Freestyle manifest instead of the open org manifest')
  ok(result.result?.seat?.sessionId === session.id && result.result?.seat?.branch === session.branch, 'dsh conversation id resolves to the Freestyle registry session')

  result = await act('card.integrate', { sessionId: dshId })
  ok(result.ok === true && result.result?.integrated === false, 'session-only actions do not require an open organisation: ' + JSON.stringify(result))

  result = await act('card.commit', { sessionId: dshId, subject: 'feat: add a Freestyle note' })
  ok(result.ok === true && result.result?.merged === true, 'card.commit merges the Freestyle session locally')
  ok(gw.runGit(['show', 'main:docs/note.md'], { cwd: rootPath, env }).includes('Freestyle note'), 'Freestyle main contains the committed session file')
  ok(gw.runGit(['rev-parse', 'HEAD'], { cwd: decoyPath, env }) === decoyBefore, 'another Freestyle root is never used as a fallback')

  console.log('GREEN arxa-git-card Freestyle (' + n + ')')
} finally {
  delete globalThis[Symbol.for('arxa.sidebar.host')]
  fs.rmSync(sandbox, { recursive: true, force: true })
}
