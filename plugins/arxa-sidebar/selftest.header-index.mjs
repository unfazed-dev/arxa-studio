// Selftest: session header index — cache hit on unchanged file, miss on
// change, persisted across arms, and pass-through on missing file / undefined.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { armHeaderIndex } from './lib/session-header-index.js'

const dir = mkdtempSync(join(tmpdir(), 'arxa-header-index-'))
const root = join(dir, 'sessions')
const logA = join(root, 'p', 'a', 'session.jsonl.zstd')
const logB = join(root, 'p', 'b', 'session.jsonl.zstd')
try {
  for (const p of [logA, logB]) mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
  writeFileSync(logA, 'A-bytes-1')
  writeFileSync(logB, 'B-bytes-1')

  let reads = 0
  const fake = {
    root,
    async readFirstZstdLine(path) {
      reads++
      if (path.endsWith('/p/b/session.jsonl.zstd')) return undefined // empty log
      return '{"meta":{"id":"' + path + '"}}'
    },
  }
  const idx = armHeaderIndex(fake)
  assert.ok(idx, 'arms on a persistence-shaped object')
  assert.equal(idx.path, join(dir, 'storages', 'arxa-session-header-index.json'))

  // First read: miss, cached. Second: hit, no decode.
  assert.equal(await fake.readFirstZstdLine(logA), '{"meta":{"id":"' + logA + '"}}')
  assert.equal(await fake.readFirstZstdLine(logA), '{"meta":{"id":"' + logA + '"}}')
  assert.equal(reads, 1, 'unchanged file served from cache')
  assert.deepEqual(idx.stats(), { hits: 1, misses: 1, size: 1, listHits: 0, listMisses: 0 })

  // Undefined (empty log) is never cached.
  assert.equal(await fake.readFirstZstdLine(logB), undefined)
  assert.equal(await fake.readFirstZstdLine(logB), undefined)
  assert.equal(reads, 3, 'undefined results pass through every time')

  // Change the file: size differs → miss.
  writeFileSync(logA, 'A-bytes-22')
  await fake.readFirstZstdLine(logA)
  assert.equal(reads, 4, 'size change invalidates')
  // Same size, new mtime → miss.
  utimesSync(logA, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
  await fake.readFirstZstdLine(logA)
  assert.equal(reads, 5, 'mtime change invalidates')

  // Missing file: pass-through to the original, which decides.
  const missing = join(root, 'p', 'zz', 'session.jsonl.zstd')
  await fake.readFirstZstdLine(missing)
  assert.equal(reads, 6, 'missing file goes to the original reader')

  // Persisted across arms: a fresh wrapper over a fresh fake hits immediately.
  idx.flush()
  const saved = JSON.parse(readFileSync(idx.path, 'utf8'))
  assert.equal(saved.v, 1)
  assert.ok(saved.entries[logA], 'entry persisted')
  let reads2 = 0
  const fake2 = { root, async readFirstZstdLine() { reads2++; return 'fresh' } }
  const idx2 = armHeaderIndex(fake2)
  assert.equal(await fake2.readFirstZstdLine(logA), '{"meta":{"id":"' + logA + '"}}')
  assert.equal(reads2, 0, 'cold process served the header from the persisted index')
  assert.equal(idx2.stats().hits, 1)

  // Layer 2 — list cache: same set of logs → cached answer, no dsh walk;
  // a new log → dsh's list runs and the cache refreshes; persisted across arms.
  let walks = 0
  const mkP = () => ({
    root, compression: 'zstd',
    async readFirstZstdLine() { return '{"type":"session"}' },
    async listProjectDirs() { return readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(root, e.name)) },
    async listSessionDirs(project) { return readdirSync(project, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(project, e.name)) },
    async list() { walks++; return this.listProjectDirs().then(async ps => (await Promise.all(ps.map(p => this.listSessionDirs(p)))).flat().map(d => ({ id: d.split('/').slice(-1)[0], cwd: '/x' }))) },
  })
  rmSync(idx.path, { force: true })
  const p1 = mkP()
  const i1 = armHeaderIndex(p1)
  const first = await p1.list()
  assert.equal(walks, 1)
  assert.deepEqual(first.map(h => h.id).sort(), ['a', 'b'])
  const again = await p1.list()
  assert.equal(walks, 1, 'unchanged set served from cache')
  assert.deepEqual(again, first)
  assert.notEqual(again, first, 'cached answer is cloned, not shared')
  writeFileSync(logA, 'A-bytes-333') // append: same set → still cached
  await p1.list(); assert.equal(walks, 1, 'an append does not invalidate the list')
  mkdirSync(join(root, 'p', 'c'), { recursive: true }); writeFileSync(join(root, 'p', 'c', 'session.jsonl.zstd'), 'C')
  const withC = await p1.list()
  assert.equal(walks, 2, 'a new log runs the real list')
  assert.deepEqual(withC.map(h => h.id).sort(), ['a', 'b', 'c'])
  rmSync(join(root, 'p', 'c'), { recursive: true })
  await p1.list(); assert.equal(walks, 3, 'a removed log runs the real list')
  assert.deepEqual(i1.stats().listHits, 2)
  i1.flush()
  const p2 = mkP()
  armHeaderIndex(p2)
  const cold = await p2.list()
  assert.equal(walks, 3, 'cold process served the list from the persisted cache')
  assert.deepEqual(cold.map(h => h.id).sort(), ['a', 'b'])

  // Not persistence-shaped → null, nothing wrapped.
  assert.equal(armHeaderIndex(null), null)
  assert.equal(armHeaderIndex({ root }), null)

  console.log('arxa-sidebar selftest.header-index: ALL GREEN')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
