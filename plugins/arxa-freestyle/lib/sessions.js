// Freestyle sessions (F5): wires the git-workspace session engine onto a
// Freestyle root. A "root" (from lib/roots.js) is any folder the user added
// — this module composes the engine's session lifecycle on top of it, it
// does not reimplement any of it. See sessions.js / finish.js / routing.js
// in ../../git-workspace/lib for the functions this file calls.
import fs from 'node:fs'
import path from 'node:path'
import { resolveFreestyleRepo } from '../../git-workspace/lib/routing.js'
import * as GW from '../../git-workspace/lib/sessions.js'
import * as FIN from '../../git-workspace/lib/finish.js'

// Freestyle roots have no `projects/` layout, so a session can live in the
// root's own repo OR in any git repo nested somewhere under it (the user
// dropped a cloned repo inside their folder). Skip `.git`/`.arxa` (session
// worktrees carry their own `.git` FILE — walking into one would surface
// every open worktree as a bogus "nested repo") and `node_modules`.
function nestedRepos(rootPath) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '.git' || e.name === '.arxa' || e.name === 'node_modules') continue
      const p = path.join(dir, e.name)
      if (fs.existsSync(path.join(p, '.git'))) out.push(p)
      walk(p)
    }
  }
  walk(rootPath)
  return out
}

export function createFreestyleSessions({ env = process.env, dshBridge }) {
  // `list`/`repoOfSession` are the only two functions that need to search
  // beyond the root's own repo — every other verb already knows its repo
  // (newSession via resolveFreestyleRepo, the rest via repoOfSession).
  function reposOf(root) {
    return [root.path, ...nestedRepos(root.path)]
  }

  function repoOfSession(root, id) {
    for (const repoPath of reposOf(root)) {
      let rows
      try { rows = GW.listSessions(repoPath, env) } catch { continue }
      if (rows.some((s) => s.id === id)) return repoPath
    }
    throw new Error(`unknown-session: "${id}"`)
  }

  return {
    async newSession(root, relDir = '', name) {
      const route = resolveFreestyleRepo(root.path, relDir, { env })
      const id = GW.mintSessionPath({
        org: path.basename(root.path),
        workspace: (relDir || '').replace(/\/+$/, ''),
        name,
        sessions: GW.listSessions(route.repoPath, env),
        ghosts: [],
      })
      const session = GW.openSession(route.repoPath, {
        id, orgPath: root.path, name: name?.trim() || undefined, workspace: relDir || '', env,
      })
      const cwd = path.join(session.worktree, route.cwdRel)
      fs.mkdirSync(cwd, { recursive: true })
      const spawned = await dshBridge.spawn({ cwd, name: session.name, id: session.id })
      const annotated = GW.annotateSession(route.repoPath, session.id, {
        dshSessionId: spawned.ok ? spawned.id : null,
        dshStatus: spawned.ok ? 'live' : (spawned.reason || 'spawn-failed'),
      }, env)
      return { ...annotated, cwd, repoPath: route.repoPath }
    },

    // SESSION_STATES is exactly ['open', 'parked', 'archived'] (git-workspace
    // /lib/sessions.js:76) — a direct partition on `state`, not the two-way
    // `!==` slices lifecycle.js's parkedSessions/activeSessions use for its
    // dsh view (those overlap by design; this shape must not).
    list(root) {
      const active = [], parked = [], archived = []
      for (const repoPath of reposOf(root)) {
        let rows
        try { rows = GW.listSessions(repoPath, env) } catch { continue }
        for (const s of rows) {
          const row = { ...s, repoPath }
          if (s.state === 'archived') archived.push(row)
          else if (s.state === 'parked') parked.push(row)
          else active.push(row)
        }
      }
      return { active, parked, archived }
    },

    archive(root, id) { return GW.archiveSession(repoOfSession(root, id), id, env) },
    revive(root, id) { return GW.reviveSession(repoOfSession(root, id), id, env) },
    trashArchived(root, id) { return GW.removeSessionRow(repoOfSession(root, id), id, env) },
    finish(root, id, { dryRun = false } = {}) {
      return FIN.finishSession(repoOfSession(root, id), id, { env, dryRun })
    },
    // Root-only (not aggregated over nestedRepos): matches the brief's
    // sketch verbatim — a session living inside a nested repo won't be
    // swept by this call. See task-5-report.md for the tradeoff.
    sweep(root, { dryRun = true } = {}) {
      return FIN.sweepMerged(root.path, { env, dryRun })
    },
  }
}
