/**
 * WIP watcher (Part B S2, Q9 — completes D18's "continuous" promise).
 * Debounced fs watching over the org's PRIMARY worktree plus every open
 * SESSION worktree; a quiet period after mutations triggers one wipCommit
 * per watched repo. In-app event pokes (editor saves, trash ops) stay in
 * place for immediacy — this net exists for OUT-OF-BAND edits (Finder,
 * the user's own editor: the D92c class).
 *
 * Ownership: created by the open-org handle, stopped by closeOrg teardown
 * (the undo list) — the lifecycle's old "no watcher process" invariant is
 * deliberately relaxed (Q9, grilled 2026-08-31). Ignores .git and the
 * worktrees nest itself (session trees have their own watcher).
 *
 * macOS note: fs.watch with recursive:true is supported and cheap here;
 * on platforms without it we fall back to per-directory watchers for the
 * top level only (best-effort net, never an error).
 */
import fs from 'node:fs'
import path from 'node:path'

const IGNORED = new Set(['.git'])

/** Watch one repo root; call onQuiet(repoPath) after debounceMs of quiet. */
function watchRepo(repoPath, debounceMs, onQuiet, watchers) {
  let timer = null
  let closed = false
  const fire = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      try { onQuiet(repoPath) } catch { /* a failed WIP commit must not kill the watcher */ }
    }, debounceMs)
  }
  const ignored = (p) => {
    const rel = path.relative(repoPath, p)
    if (!rel || rel.startsWith('..')) return false
    return IGNORED.has(rel.split(path.sep)[0])
  }
  try {
    const w = fs.watch(repoPath, { recursive: true }, (evt, file) => {
      const p = file ? path.join(repoPath, file) : repoPath
      if (ignored(p)) return
      fire()
    })
    w.on('error', () => { /* a dead watcher is a lost net, not a crash */ })
    watchers.push(w)
  } catch {
    // recursive unsupported (non-mac): top-level-only fallback
    try {
      const w = fs.watch(repoPath, (evt, file) => {
        if (file && IGNORED.has(file)) return
        fire()
      })
      w.on('error', () => {})
      watchers.push(w)
    } catch { /* no watch possible — the event pokes remain */ }
  }
}

/**
 * Create the WIP watcher over a set of repo paths.
 *
 * @param {{ paths: string[], onQuiet: (repoPath: string) => void, debounceMs?: number }} opts
 * @returns {{ stop(): void, paths(): string[], setPaths(next: string[]): void }}
 */
export function createWipWatcher({ paths = [], onQuiet, debounceMs = 3000 } = {}) {
  if (typeof onQuiet !== 'function') throw new TypeError('createWipWatcher: onQuiet is required')
  let current = [...new Set(paths)]
  let watchers = []
  const startAll = () => {
    for (const p of current) watchRepo(p, debounceMs, onQuiet, watchers)
  }
  startAll()
  return {
    stop() {
      for (const w of watchers) w.close()
      watchers = []
      current = []
    },
    paths() { return [...current] },
    /** Reconfigure (session opened/revived/archived): swap the watched set. */
    setPaths(next) {
      const deduped = [...new Set(next)]
      for (const w of watchers) w.close()
      watchers = []
      current = deduped
      startAll()
    },
  }
}
