// External-change watcher (D86): fs.watch on the OPEN org root, debounced,
// pushed to browser clients over SSE (/__arxa/artifacts/events). Runtime
// state (.arxa/, .git/) never pushes — the tree is the only signal.
import fs from 'node:fs'
import path from 'node:path'

export function createOrgWatcher({ intervalMs = 250 } = {}) {
  let watcher = null
  let currentRoot = null
  const listeners = new Set()
  const pending = new Map() // relPath -> mtimeMs (coalesced: latest wins)
  let flushTimer = null

  function flush() {
    flushTimer = null
    for (const [rel, mtime] of pending) {
      for (const fn of listeners) { try { fn(rel, mtime) } catch {} }
    }
    pending.clear()
  }
  function schedule(rel, mtime) {
    pending.set(rel, mtime)
    if (!flushTimer) flushTimer = setTimeout(flush, intervalMs)
  }
  function unwatch() {
    if (watcher) { try { watcher.close() } catch {} }
    watcher = null
    currentRoot = null
    pending.clear()
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  }
  function watch(root) {
    unwatch()
    currentRoot = root
    try {
      watcher = fs.watch(root, { recursive: true }, (event, filename) => {
        if (!filename) return
        const rel = String(filename)
        if (rel === '.arxa' || rel === '.git' || rel.startsWith('.arxa/') || rel.startsWith('.git/') || rel.includes('/.arxa/') || rel.includes('/.git/')) return
        let mtime = null
        try {
          const st = fs.statSync(path.join(root, rel))
          if (!st.isFile()) return
          mtime = st.mtimeMs
        } catch { return }
        schedule(rel, mtime)
      })
    } catch { watcher = null }
  }
  return {
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    setRoot(root) { if (root && root !== currentRoot) watch(root); if (!root && currentRoot) unwatch() },
    stop() { unwatch() },
  }
}

export function createEventsRoute({ watcher, resolveSessionRoot }) {
  return {
    async handle(req, res) {
      if (req.method !== 'GET') { res.writeHead(405, { 'content-type': 'text/plain' }); return res.end('GET only') }
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        'connection': 'keep-alive',
      })
      res.write('retry: 2000\n\n')
      const push = (relPath, mtimeMs) => {
        try { res.write('data: ' + JSON.stringify({ relPath, mtimeMs }) + '\n\n') } catch {}
      }
      // Worktree lane (Phase 1, Claude-model live reload): ?session=<id>
      // resolves the session worktree of the OPEN org and binds a dedicated
      // watcher for THIS connection's life — the viewer's wt lane updates in
      // place when the agent re-writes the open artifact. Org lane otherwise.
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
          off = wtWatcher.onChange(push)
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
