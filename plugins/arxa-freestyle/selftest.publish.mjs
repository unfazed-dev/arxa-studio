#!/usr/bin/env node
// Task 14: publish a Freestyle root through the real local git engine and a
// stubbed GitHub bridge. The bare repo is the remote; no account is touched.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runGit } from '../git-workspace/lib/run.js'
import { addRoot, readManifest } from './lib/roots.js'
import * as roots from './lib/roots.js'
import { apply } from './lib/index.js'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-freestyle-publish-'))
const env = { ...process.env, ARXA_HOME: path.join(sandbox, 'home') }
let n = 0
const ok = (condition, message) => {
  assert.ok(condition, message)
  n++
  console.log('  ok', n, '-', message)
}

try {
  // A missing publishRoot export is the deliberate RED for this task.
  ok(typeof roots.publishRoot === 'function', 'roots exports publishRoot')

  const folder = path.join(sandbox, 'notes')
  const remote = path.join(sandbox, 'notes.git')
  fs.mkdirSync(folder, { recursive: true })
  runGit(['init', '--bare', remote], { cwd: sandbox, env })
  const root = addRoot(folder, { env, name: 'notes' })
  ok(!fs.existsSync(path.join(folder, '.github', 'workflows', 'ci.yml')), 'CI workflow is absent before publish')

  const calls = []
  const github = {
    async status() {
      calls.push('status')
      return { ok: true, linked: true, login: 'octocat' }
    },
    async createPrivateRepo(name) {
      calls.push('create')
      return {
        ok: true,
        repo: {
          repoOwner: 'octocat',
          repoName: name,
          repoPrivate: true,
          repoUrl: remote,
        },
      }
    },
    async gitCredentials() {
      calls.push('credentials')
      return { ok: true, login: 'octocat', token: 'stub-token' }
    },
    async wireFrame(owner, name, payloads) {
      const remoteCi = runGit(['show', 'refs/heads/main:.github/workflows/ci.yml'], {
        cwd: remote,
        env,
        allowFail: true,
      })
      if (remoteCi !== null) calls.push('push')
      calls.push('wireFrame')
      ok(owner === 'octocat' && name === 'notes', 'wireFrame receives the created repository identity')
      ok(payloads?.settings && payloads?.protection, 'wireFrame receives the shared frame payloads')
      return { ok: false, reason: 'frame-wire-failed' }
    },
  }

  const published = await roots.publishRoot(root, { github, env })
  ok(published.ok === true && published.repoUrl === remote, 'publishRoot returns the repository URL despite best-effort wire failure')
  ok(calls.filter((x) => x === 'create' || x === 'push' || x === 'wireFrame').join(' > ') === 'create > push > wireFrame', 'publish order is create, push, wireFrame')
  ok(fs.existsSync(path.join(folder, '.github', 'workflows', 'ci.yml')), 'publish writes the CI workflow')
  ok(runGit(['remote', 'get-url', 'origin'], { cwd: folder, env }) === remote, 'origin stores the clean repository URL')

  const manifest = readManifest(root)
  ok(manifest.localOnly === false, 'publish clears manifest localOnly')
  ok(manifest.repoOwner === 'octocat' && manifest.repoName === 'notes' && manifest.repoUrl === remote, 'publish writes manifest repository fields')
  ok(runGit(['show', 'refs/heads/main:.github/workflows/ci.yml'], { cwd: remote, env, allowFail: true }) !== null, 'the remote main branch contains the CI workflow')

  const localOnlyFolder = path.join(sandbox, 'local-only')
  fs.mkdirSync(localOnlyFolder, { recursive: true })
  const localOnlyRoot = addRoot(localOnlyFolder, { env, name: 'local-only' })
  let unexpectedCall = false
  const refused = await roots.publishRoot(localOnlyRoot, {
    env,
    github: {
      status: async () => ({ ok: true, linked: false, login: null }),
      createPrivateRepo: async () => { unexpectedCall = true },
      gitCredentials: async () => { unexpectedCall = true },
      wireFrame: async () => { unexpectedCall = true },
    },
  })
  ok(refused.ok === false && refused.reason === 'github-unlinked', 'an unlinked account is refused with github-unlinked')
  ok(unexpectedCall === false, 'unlinked refusal performs no create, push credential, or frame call')
  ok(!fs.existsSync(path.join(localOnlyFolder, '.github')), 'unlinked refusal leaves GitHub frame files absent')
  ok(readManifest(localOnlyRoot).localOnly === true, 'unlinked refusal preserves the local-only manifest')

  // A remote can be created before credentials/push fail. Retrying must
  // finish that publication without attempting to create the same name.
  let creates = 0
  let credentialsAvailable = false
  const retryRemote = path.join(sandbox, 'retry.git')
  const retryGithub = {
    status: async () => ({ ok: true, linked: true, login: 'octocat' }),
    createPrivateRepo: async () => {
      if (++creates > 1) return { ok: false, reason: 'name-taken' }
      runGit(['init', '--bare', retryRemote], { cwd: sandbox, env })
      return { ok: true, repo: { repoOwner: 'octocat', repoName: 'local-only', repoUrl: retryRemote } }
    },
    gitCredentials: async () => credentialsAvailable
      ? { ok: true, login: 'octocat', token: 'stub-token' }
      : { ok: false, reason: 'token-unavailable' },
    wireFrame: async () => ({ ok: true }),
  }
  const failed = await roots.publishRoot(localOnlyRoot, { github: retryGithub, env })
  ok(!failed.ok && readManifest(localOnlyRoot).localOnly, 'failed push setup leaves root local-only')
  credentialsAvailable = true
  const retried = await roots.publishRoot(localOnlyRoot, { github: retryGithub, env })
  ok(retried.ok && creates === 1, 'retry finishes the existing private repository')
  ok(runGit(['rev-parse', 'main'], { cwd: retryRemote, env }) === runGit(['rev-parse', 'HEAD'], { cwd: localOnlyFolder, env }), 'retry pushes the local HEAD')

  // The host action wraps the raw github-link face in the established
  // throw-proof bridge before handing it to publishRoot.
  const routes = {}
  apply({ webServer: { register: (route) => { routes[route.path] = route.handler } } }, {
    env,
    github: { status: async () => ({ linked: false }) },
  })
  const response = await new Promise((resolve) => {
    const req = { _h: {}, on(event, fn) { this._h[event] = fn } }
    routes['/__arxa/freestyle/action'](req, {
      writeHead() {},
      end(body) { resolve(JSON.parse(body)) },
    })
    queueMicrotask(() => {
      req._h.data(JSON.stringify({ action: 'root.publish', arg: { rootId: localOnlyRoot.id, visibility: 'private' } }))
      req._h.end()
    })
  })
  ok(response.ok === false && response.reason === 'github-unlinked', 'root.publish action exposes the unlinked refusal')

  console.log('GREEN arxa-freestyle publish (' + n + ')')
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true })
}
