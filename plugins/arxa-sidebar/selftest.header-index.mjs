// Selftest: session header index — cache hit on unchanged file, miss on
// change, persisted across arms, and pass-through on missing file / undefined.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { armHeaderIndex } from './lib/session-header-index.js'

const dir = mkdtempSync(join(tmpdir(), 'arxa-header-index-'))
const root = join(dir, 'sessions')
const logA = join(root, 'a', 'session.jsonl.zstd')
const logB = join(root, 'b', 'session.jsonl.zstd')
try {
  for (const p of [logA, logB]) mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true })
  writeFileSync(logA, 'A-bytes-1')
  writeFileSync(logB, 'B-bytes-1')

  let reads = 0
  const fake = {
    root,
    async readFirstZstdLine(path) {
      reads++
      if (path.endsWith('/b/session.jsonl.zstd')) return undefined // empty log
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
  assert.deepEqual(idx.stats(), { hits: 1, misses: 1, size: 1 })

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
  const missing = join(root, 'zz', 'session.jsonl.zstd')
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

  // Not persistence-shaped → null, nothing wrapped.
  assert.equal(armHeaderIndex(null), null)
  assert.equal(armHeaderIndex({ root }), null)

  console.log('arxa-sidebar selftest.header-index: ALL GREEN')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
