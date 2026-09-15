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
  assert.equal(saved.v, 2, 'cache format is v2 (list answers are snapshot-shaped since 0.1.5)')
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
    async list() { walks++; return this.listProjectDirs().then(async ps => (await Promise.all(ps.map(p => this.listSessionDirs(p)))).flat().map(d => ({ header: { id: d.split('/').slice(-1)[0], cwd: '/x' } }))) },
  })
  rmSync(idx.path, { force: true })
  const p1 = mkP()
  const i1 = armHeaderIndex(p1)
  const first = await p1.list()
  assert.equal(walks, 1)
  assert.deepEqual(first.map(x => x.header.id).sort(), ['a', 'b'])
  const again = await p1.list()
  assert.equal(walks, 1, 'unchanged set served from cache')
  assert.deepEqual(again, first)
  assert.notEqual(again, first, 'cached answer is cloned, not shared')
  writeFileSync(logA, 'A-bytes-333') // append: same set → still cached
  await p1.list(); assert.equal(walks, 1, 'an append does not invalidate the list')
  mkdirSync(join(root, 'p', 'c'), { recursive: true }); writeFileSync(join(root, 'p', 'c', 'session.jsonl.zstd'), 'C')
  const withC = await p1.list()
  assert.equal(walks, 2, 'a new log runs the real list')
  assert.deepEqual(withC.map(x => x.header.id).sort(), ['a', 'b', 'c'])
  rmSync(join(root, 'p', 'c'), { recursive: true })
  await p1.list(); assert.equal(walks, 3, 'a removed log runs the real list')
  assert.deepEqual(i1.stats().listHits, 2)
  i1.flush()
  const p2 = mkP()
  armHeaderIndex(p2)
  const cold = await p2.list()
  assert.equal(walks, 3, 'cold process served the list from the persisted cache')
  assert.deepEqual(cold.map(x => x.header.id).sort(), ['a', 'b'])


  // 0.1.5 regression (2026-09-15, live engine): a v1 cache written by the
  // 0.1.2 wave holds BARE headers. dsh 0.1.5's session-query maps
  // snapshot.header over the list answer, so a v1 list hit served
  // [undefined, ...] and EVERY listSessions threw "reading 'id'" — the
  // client session catalog stayed empty, no session ever became current,
  // and the right sidebar's session surface never mounted. v1 list caches
  // are never trusted again; a v2 cache that lost the wrapper misses too.
  i1.flush()
  const saved2 = JSON.parse(readFileSync(i1.path, 'utf8'))
  assert.equal(saved2.v, 2)
  assert.ok(saved2.list && saved2.list.headers.every((x) => x && x.header), 'the persisted list is snapshot-shaped')
  const forgedV1 = { v: 1, entries: saved2.entries, list: { fp: saved2.list.fp, headers: saved2.list.headers.map((x) => ({ ...x.header })) } }
  writeFileSync(i1.path, JSON.stringify(forgedV1))
  let walks3 = 0
  const p3 = mkP(); const realList3 = p3.list.bind(p3)
  p3.list = async (signal) => { walks3++; return realList3(signal) }
  armHeaderIndex(p3)
  const fromV1 = await p3.list()
  assert.ok(walks3 >= 1, 'a v1 list cache is never served — the real list runs')
  assert.ok(fromV1.every((x) => x && x.header), 'the answer is snapshot-shaped')
  const badV2 = { v: 2, entries: {}, list: { fp: saved2.list.fp, headers: [{ id: 'a' }] } }
  writeFileSync(i1.path, JSON.stringify(badV2))
  let walks4 = 0
  const p4 = mkP(); const realList4 = p4.list.bind(p4)
  p4.list = async (signal) => { walks4++; return realList4(signal) }
  armHeaderIndex(p4)
  await p4.list()
  assert.ok(walks4 >= 1, 'a non-snapshot v2 cache also misses (shape guard)')

  // 0.1.5 regression #2 (2026-09-15, live): dsh 0.1.5 hands persistence.list
  // an OPTIONS envelope ({ signal }) while listProjectDirs/listSessionDirs
  // still take a BARE signal. The fingerprint scan forwarded the envelope
  // into the walkers: ({ signal }).throwIfAborted() threw on every
  // gateway-driven list (the gateway always passes a real AbortSignal), the
  // RPC answered ok:false, and the client session catalog stayed empty — no
  // current session, no session scope, no right sidebar. The engine's own
  // no-signal diagnostic skipped the crash (undefined?.throwIfAborted() is
  // fine) and logged "50 items", masking it for a whole wave.
  {
    const ac = new AbortController()
    const p5 = mkP()
    p5.listProjectDirs = async (signal) => { signal?.throwIfAborted(); return p5.listProjectDirs2() }
    p5.listProjectDirs2 = async () => readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(root, e.name))
    p5.listSessionDirs = async (project, signal) => { signal?.throwIfAborted(); return readdirSync(project, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(project, e.name)) }
    armHeaderIndex(p5)
    const out = await p5.list({ signal: ac.signal })
    assert.ok(Array.isArray(out) && out.length >= 2, 'an options-envelope list call (0.1.5 gateway shape) survives the fingerprint scan')
  }

  // Not persistence-shaped → null, nothing wrapped.
  assert.equal(armHeaderIndex(null), null)
  assert.equal(armHeaderIndex({ root }), null)

  console.log('arxa-sidebar selftest.header-index: ALL GREEN')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
