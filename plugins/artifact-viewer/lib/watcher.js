// External-change watcher (D86): fs.watch on every open root, debounced and
// pushed to browser clients over SSE (/__arxa/artifacts/events). Runtime state
// (.arxa/, .git/) never pushes — the tree is the only signal.
import fs from 'node:fs'
import path from 'node:path'

// One fs.watch per open root, keyed by root path. Paths remain internal to this
// watcher; createEventsRoute maps them to registry ids at the wire boundary.
// setRoot(root) remains one-root sugar for the per-connection worktree lane.
export function createOrgWatcher({ intervalMs = 250 } = {}) {
  const watchers = new Map() // root -> fs.FSWatcher
  const listeners = new Set()
  const pending = new Map() // root -> Map<relPath, mtime> (latest wins)
  let flushTimer = null

  function flush() {
    flushTimer = null
    for (const [root, byPath] of pending) {
      for (const [rel, mtime] of byPath) {
        for (const fn of listeners) { try { fn(rel, mtime, root) } catch {} }
      }
    }
    pending.clear()
  }
  function schedule(root, rel, mtime) {
    let byPath = pending.get(root)
    if (!byPath) { byPath = new Map(); pending.set(root, byPath) }
    byPath.set(rel, mtime)
    if (!flushTimer) flushTimer = setTimeout(flush, intervalMs)
  }
  function unwatchOne(root) {
    const w = watchers.get(root)
    if (w) { try { w.close() } catch {} }
    watchers.delete(root)
    pending.delete(root)
  }
  function watchOne(root) {
    try {
      const w = fs.watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        const rel = String(filename)
        if (rel.split(/[\\/]+/).some((part) => part === '.arxa' || part === '.git')) return
        let mtime = null
        try {
          const st = fs.statSync(path.join(root, rel))
          mtime = st.mtimeMs
        } catch { /* deletion: null is the tree invalidation signal */ }
        schedule(root, rel, mtime)
      })
      // fs.watch can also fail asynchronously (for example EMFILE).
      w.on('error', () => unwatchOne(root))
      watchers.set(root, w)
    } catch { /* root unwatchable (e.g. gone already) — just leave it out */ }
  }
  function setRoots(roots) {
    const want = new Set((roots || []).filter(Boolean))
    for (const root of [...watchers.keys()]) if (!want.has(root)) unwatchOne(root)
    for (const root of want) if (!watchers.has(root)) watchOne(root)
  }
  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    setRoot(root) { setRoots(root ? [root] : []) },
    setRoots,
    stop() {
      for (const root of [...watchers.keys()]) unwatchOne(root)
      pending.clear()
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    },
  }
}

export function createEventsRoute({ watcher, resolveSessionRoot, rootIdForPath = () => null }) {
  return {
    async handle(req, res) {
      if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'text/plain' }); return res.end('GET only') }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'connection': 'keep-alive',
      })
      res.write('retry: 2000\n\n')
      let requestedRootId = null
      try { requestedRootId = new URL(req.url, 'http://x').searchParams.get('root') } catch {}
      const push = (relPath, mtimeMs, rootPath = null) => {
        const resolved = rootPath === null ? null : rootIdForPath(rootPath, requestedRootId)
        if (requestedRootId && rootPath !== null && resolved == null) return
        // One physical path may have both the org id and a Freestyle registry
        // id. Unfiltered subscribers need one frame per public alias while a
        // root-filtered viewer connection receives only its requested id.
        const rootIds = Array.isArray(resolved) ? resolved : [resolved]
        for (const rootId of rootIds) {
          try { res.write('data: ' + JSON.stringify({ relPath, mtimeMs, rootId }) + '\n\n') } catch {}
        }
      }
      // Worktree lane: ?session=<id> resolves one dedicated watcher for this
      // connection. Its rootId is null because the session already identifies it.
      let wtWatcher = null
      let sessionId = null
      try { sessionId = new URL(req.url, 'http://x').searchParams.get('session') } catch { sessionId = null }
      let off = null
      if (sessionId && resolveSessionRoot) {
        let root = null
        try { root = await resolveSessionRoot(sessionId) } catch { root = null }
        if (root) {
          wtWatcher = createOrgWatcher({ intervalMs: 250 })
          wtWatcher.setRoot(root)
          off = wtWatcher.onChange((relPath, mtimeMs) => push(relPath, mtimeMs, null))
        }
      }
      if (!off) off = watcher.onChange(push)
      req.on('close', () => {
        try { off() } catch {}
        if (wtWatcher) wtWatcher.stop()
      })
    },
  }
}
