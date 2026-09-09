// Task9: root aliases, scoped reads/tokens, and global Freestyle sessions.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { readOpenRootAliases, readOpenRoots } from './lib/follow.js'
import { createTokenRoutes, createRootsRoute, rootIdsForPath } from './lib/index.js'
import { createTreeRoute, createWorktreeRoute } from './lib/wt-api.js'
import { createEventsRoute } from './lib/watcher.js'
import { resolveWorktree } from './lib/write-api.js'
import { issueToken } from './lib/tokens.js'
import { addRoot, closeRoot, openRoot } from '../arxa-freestyle/lib/roots.js'
import { createFreestyleSessions } from '../arxa-freestyle/lib/sessions.js'
import { initPlainRepo } from '../git-workspace/lib/repos.js'
import { annotateSession } from '../git-workspace/lib/sessions.js'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-root-open-'))
const env = { ...process.env, ARXA_HOME: path.join(sandbox, 'home') }
const secret = 'root-open-test-secret'

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}
function callToken(route, payload) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers }, end(text) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(text || '{}') }) } }
    route.handle(req, res).catch(reject)
    queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(payload))); req.emit('end') })
  })
}
function callGet(route, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const chunks = []
    const req = { method, url, headers: {} }
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() } })
    res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
    res.on('finish', () => {
      const raw = Buffer.concat(chunks)
      let body = raw.toString('utf8')
      if (String(res.headers?.['content-type'] || '').includes('json')) body = JSON.parse(body || '{}')
      resolve({ status: res.status, headers: res.headers, body })
    })
    Promise.resolve(route.handle(req, res)).catch(reject)
  })
}

try {
  const shared = path.join(sandbox, 'shared')
  fs.mkdirSync(shared)
  fs.writeFileSync(path.join(shared, 'notes.md'), '# alias root\n')
  fs.writeFileSync(path.join(shared, '.gitkeep'), '')
  const slug = path.basename(shared)
  writeJson(path.join(env.ARXA_HOME, 'organisation.json'), { orgs: [shared] })
  writeJson(path.join(shared, '.arxa', 'locks', slug + '.lock'), { pid: process.pid, orgPath: shared })
  writeJson(path.join(env.ARXA_HOME, 'freestyle.json'), { roots: [
    { id: 'fs-alias', name: 'Personal Notes', path: shared, open: true },
  ] })

  assert.deepEqual(readOpenRoots(env).map(row => row.id), [slug], 'physical roots remain deduped for servers/watchers')
  assert.deepEqual(readOpenRootAliases(env).map(row => row.id), [slug, 'fs-alias'], 'request aliases retain the Freestyle registry id')

  const rootsRoute = createRootsRoute({ env })
  const rootsRes = await callGet(rootsRoute, '/')
  assert.equal(rootsRes.status, 200)
  assert.deepEqual(rootsRes.body.roots, [
    { id: slug, name: slug, kind: 'org' },
    { id: 'fs-alias', name: 'Personal Notes', kind: 'freestyle' },
  ])
  assert.equal(JSON.stringify(rootsRes.body).includes(shared), false, 'root paths stay off the wire')

  let emit
  const chunks = []
  const events = createEventsRoute({
    watcher: { onChange(fn) { emit = fn; return () => {} } },
    rootIdForPath: () => [slug, 'fs-alias'],
  })
  await events.handle({ method: 'GET', url: '/', on() {} }, { writeHead() {}, write(chunk) { chunks.push(chunk) } })
  emit('notes.md', 123, shared)
  assert.deepEqual(chunks.filter(chunk => chunk.startsWith('data: ')).map(chunk => JSON.parse(chunk.slice(6)).rootId), [slug, 'fs-alias'],
    'unfiltered SSE fans one physical change out to every public root alias')

  const tokens = createTokenRoutes({ env, secret, getSettings: () => ({ tokenTtlSeconds: 30 }), getOrigin: () => 'http://org.invalid' })
  const read = await callToken(tokens, { relPath: 'notes.md', rootId: 'fs-alias' })
  assert.equal(read.status, 200, JSON.stringify(read.body))
  assert.equal(read.body.origin, undefined, 'root reads use the trusted wt route, not a per-root origin')
  assert.equal(read.body.absPath, path.join(shared, 'notes.md'))
  const readClaims = JSON.parse(Buffer.from(read.body.token.split('.')[0], 'base64url').toString('utf8'))
  assert.equal(readClaims.orgPath, shared)
  const write = await callToken(tokens, { scope: 'write', rootId: 'fs-alias' })
  assert.equal(write.status, 200)
  const writeClaims = JSON.parse(Buffer.from(write.body.token.split('.')[0], 'base64url').toString('utf8'))
  assert.equal(writeClaims.worktreeId, 'root:fs-alias')
  assert.equal(writeClaims.orgPath, shared)

  const wt = createWorktreeRoute({ env, secret })
  const open = await callGet(wt, '/?root=fs-alias&path=notes.md&avt=' + encodeURIComponent(read.body.token))
  assert.equal(open.status, 200)
  assert.equal(open.body, '# alias root\n')
  assert.equal(Number(open.headers['x-arxa-mtime-ms']), fs.statSync(path.join(shared, 'notes.md')).mtimeMs,
    'root reads carry the precise optimistic-concurrency mtime')
  const orgOnly = issueToken({ secret, scope: 'read', relPath: 'notes.md', orgPath: '/different', ttlSeconds: 30 })
  assert.equal((await callGet(wt, '/?root=fs-alias&path=notes.md&avt=' + encodeURIComponent(orgOnly))).status, 403)
  for (const relPath of ['.git/HEAD', '.arxa/state', 'nested/.git/HEAD', '../outside']) {
    const token = issueToken({ secret, scope: 'read', relPath, orgPath: shared, ttlSeconds: 30 })
    assert.equal((await callGet(wt, '/?root=fs-alias&path=' + encodeURIComponent(relPath) + '&avt=' + encodeURIComponent(token))).status, 403, relPath)
  }
  const outside = path.join(sandbox, 'outside.md')
  fs.writeFileSync(outside, 'outside')
  fs.symlinkSync(outside, path.join(shared, 'escape.md'))
  const escapeToken = issueToken({ secret, scope: 'read', relPath: 'escape.md', orgPath: shared, ttlSeconds: 30 })
  assert.equal((await callGet(wt, '/?root=fs-alias&path=escape.md&avt=' + encodeURIComponent(escapeToken))).status, 403)
  const treeToken = (await callToken(tokens, { scope: 'tree-read', rootId: 'fs-alias' })).body.token
  const tree = await callGet(createTreeRoute({ env, secret }), '/?root=fs-alias&avt=' + encodeURIComponent(treeToken))
  assert.equal(tree.status, 200)
  assert.equal(tree.body.files.includes('.gitkeep'), false, 'Freestyle placeholder stays hidden')
  console.log('PASS root aliases resolve token, metadata, tree and file reads without duplicating servers')

  const globalRootDir = path.join(sandbox, 'global-root')
  fs.mkdirSync(globalRootDir)
  const globalRoot = addRoot(globalRootDir, { env })
  let filteredEmit
  const filteredChunks = []
  const filteredEvents = createEventsRoute({
    watcher: { onChange(fn) { filteredEmit = fn; return () => {} } },
    rootIdForPath: (rootPath, requestedId) => rootIdsForPath(env, rootPath, requestedId),
  })
  await filteredEvents.handle({ method: 'GET', url: '/?root=fs-alias', on() {} }, { writeHead() {}, write(chunk) { filteredChunks.push(chunk) } })
  filteredEmit('other.md', 200, globalRoot.path)
  assert.equal(filteredChunks.some(chunk => chunk.startsWith('data: ')), false,
    'root-filtered SSE emits no frame for another physical root')
  filteredEmit('notes.md', 201, shared)
  assert.deepEqual(filteredChunks.filter(chunk => chunk.startsWith('data: ')).map(chunk => JSON.parse(chunk.slice(6)).rootId), ['fs-alias'],
    'root-filtered SSE emits only the requested same-path alias')
  const nested = path.join(globalRoot.path, 'nested', 'repo')
  fs.mkdirSync(nested, { recursive: true })
  initPlainRepo(nested, env)
  const sessions = createFreestyleSessions({ env, dshBridge: { spawn: async ({ id }) => ({ ok: true, id: 'dsh-' + id }) } })
  const row = await sessions.newSession(globalRoot, 'nested/repo', 'viewer')
  const foundByRegistry = await resolveWorktree({ env, orgPath: null, worktreeId: row.id })
  const foundByDsh = await resolveWorktree({ env, orgPath: null, worktreeId: row.dshSessionId })
  assert.equal(foundByRegistry?.repoPath, nested)
  assert.equal(foundByDsh?.worktreePath, row.worktree)
  closeRoot(globalRoot.id, { env })
  assert.equal(await resolveWorktree({ env, orgPath: null, worktreeId: row.id }), null,
    'closing a Freestyle root revokes its registry session id')
  assert.equal(await resolveWorktree({ env, orgPath: null, worktreeId: row.dshSessionId }), null,
    'closing a Freestyle root revokes its dsh session id')
  openRoot(globalRoot.id, { env })

  const secondDir = path.join(sandbox, 'second-root')
  fs.mkdirSync(secondDir)
  const secondRoot = addRoot(secondDir, { env })
  const second = await sessions.newSession(secondRoot, '', 'viewer')
  annotateSession(nested, row.id, { dshSessionId: 'ambiguous-dsh' }, env)
  annotateSession(secondRoot.path, second.id, { dshSessionId: 'ambiguous-dsh' }, env)
  assert.equal(await resolveWorktree({ env, orgPath: null, worktreeId: 'ambiguous-dsh' }), null, 'ambiguous global dsh id fails closed')
  console.log('PASS global Freestyle session lookup finds nested repos and fails closed on ambiguity')
  console.log('GREEN artifact-viewer root opens')
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true })
}
