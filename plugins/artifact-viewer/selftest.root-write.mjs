// Task9: real Git roots, scoped route tokens, atomic editor saves.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createWriteApi } from './lib/write-api.js'
import { issueToken } from './lib/tokens.js'
import { addRoot } from '../arxa-freestyle/lib/roots.js'
import { initPlainRepo } from '../git-workspace/lib/repos.js'
import { runGit } from '../git-workspace/lib/run.js'

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-root-write-'))
const env = { ...process.env, ARXA_HOME: path.join(sandbox, 'home') }
const secret = 'root-write-test-secret'
const roots = []
try {
  for (const name of ['one', 'two']) {
    const folder = path.join(sandbox, name)
    fs.mkdirSync(folder)
    roots.push(addRoot(folder, { env }))
  }
  const [root, other] = roots
  const api = createWriteApi({ env, secret, getRoot: id => roots.find(row => row.id === id), getSettings: () => ({ maxEditBytes: 1024 }) })
  const token = (row, extra = {}) => issueToken({ secret, scope: 'write', orgPath: row.path, worktreeId: 'root:' + row.id, ...extra })
  const write = (body, auth = token(root)) => new Promise((resolve, reject) => {
    const req = new EventEmitter()
    req.method = 'POST'; req.headers = { 'x-arxa-write-token': auth }
    const res = { writeHead(status) { this.status = status }, end(text) { resolve({ status: this.status, ...JSON.parse(text) }) } }
    api.handle(req, res).catch(reject)
    queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
  })
  const body = { rootId: root.id, relPath: 'notes/a.md', content: 'first save\n' }
  const head = folder => runGit(['rev-parse', 'HEAD'], { cwd: folder, env })
  const before = head(root.path)
  let result = await write(body)
  assert.equal(result.status, 200, JSON.stringify(result))
  assert.equal(result.committed, true)
  assert.equal(fs.readFileSync(path.join(root.path, body.relPath), 'utf8'), body.content)
  assert.notEqual(head(root.path), before)
  assert.equal(runGit(['status', '--porcelain'], { cwd: root.path, env }), '')
  console.log('PASS root save creates file and WIP commit with no open org')
  const mtime = result.mtimeMs
  result = await write({ ...body, content: 'stale', expectedMtimeMs: mtime - 1000 })
  assert.equal(result.status, 409)
  assert.equal(fs.readFileSync(path.join(root.path, body.relPath), 'utf8'), body.content)
  assert.equal((await write({ ...body, content: 'second save', expectedMtimeMs: mtime })).status, 200)
  console.log('PASS stale editor cannot overwrite external content')
  assert.equal((await write(body, token(other))).status, 403)
  assert.equal((await write({ ...body, rootId: other.id })).status, 403)
  assert.equal((await write(body, token(root, { scope: 'read' }))).status, 403)
  for (const relPath of ['.arxa/x', '.git/HEAD', 'nested/.git/HEAD', '../escape', '/absolute']) {
    assert.equal((await write({ ...body, relPath })).status, 403, relPath)
  }
  fs.symlinkSync(other.path, path.join(root.path, 'outside'))
  assert.equal((await write({ ...body, relPath: 'outside/escape.md' })).status, 403)
  assert.equal((await write({ ...body, content: 'é'.repeat(600) })).status, 413, 'cap measures UTF-8 bytes')
  console.log('PASS token, reserved path, symlink and byte-cap boundaries')
  const nested = path.join(root.path, 'nested')
  fs.mkdirSync(nested); initPlainRepo(nested, env)
  const rootHead = head(root.path)
  const nestedHead = head(nested)
  result = await write({ ...body, relPath: 'nested/file.md' })
  assert.equal(result.status, 200)
  assert.equal(result.committed, true)
  assert.notEqual(head(nested), nestedHead)
  assert.equal(head(root.path), rootHead, 'save commits only the nearest repository')
  assert.equal(runGit(['status', '--porcelain'], { cwd: nested, env }), '')
  console.log('PASS nested repository owns the save commit')
  fs.chmodSync(path.join(root.path, body.relPath), 0o755)
  assert.equal((await write(body)).status, 200)
  assert.equal(fs.statSync(path.join(root.path, body.relPath)).mode & 0o777, 0o755, 'atomic save preserves executable permissions')
  console.log('PASS atomic save preserves existing file permissions')
  console.log('GREEN artifact-viewer root writes')
} finally { fs.rmSync(sandbox, { recursive: true, force: true }) }
