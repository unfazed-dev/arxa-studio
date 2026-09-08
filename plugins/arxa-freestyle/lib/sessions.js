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
// dropped a cloned repo inside their folder). Skip `.git` (never itself a
// nested repo root) and `node_modules`; skip `.arxa` too — that's where
// session worktrees live (`.arxa/worktrees/<id>`, each with its own `.git`
// FILE), so walking into it would surface every open worktree as a bogus
// "nested repo".
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

// A session id is also a git ref component (REF_SEGMENT_RE, git-workspace
// /lib/sessions.js), but Freestyle roots use folder names verbatim — a
// folder named "My Notes" would make every mint throw inside
// `assertSessionIdShape`. Slug the basename with the engine's own
// `slugSegment` (not reimplemented here) and use this SAME key everywhere
// an id is minted (`newSession`) or matched (`ownRows`), so the two can
// never disagree. An all-punctuation or emoji-only basename slugs to "" —
// fall back to the root's own stable id rather than throwing. Renaming a
// root (`roots.js` renameRoot) only changes its display name, never its
// `path`, so this key is stable across renames.
function sessionKey(root) {
  return GW.slugSegment(path.basename(root.path)) || `root-${String(root.id).slice(0, 8)}`
}

export function createFreestyleSessions({ env = process.env, dshBridge }) {
  // `list`/`repoOfSession` are the only two functions that need to search
  // beyond the root's own repo — every other verb already knows its repo
  // (newSession via resolveFreestyleRepo, the rest via repoOfSession).
  function reposOf(root) {
    return [root.path, ...nestedRepos(root.path)]
  }

  // mintSessionPath always sets `org` to sessionKey(root), so every id this
  // module ever mints starts with "<key>/". A nested repo (the user dropped
  // an existing git-workspace-managed clone into their folder) can carry
  // registry rows from a *different* org — filter those out so a foreign
  // repo's unrelated sessions don't leak into this root's view.
  function ownRows(root, repoPath) {
    const prefix = sessionKey(root) + '/'
    let rows
    try { rows = GW.listSessions(repoPath, env) } catch { return [] }
    return rows.filter((s) => s.id.startsWith(prefix))
  }

  function repoOfSession(root, id) {
    for (const repoPath of reposOf(root)) {
      if (ownRows(root, repoPath).some((s) => s.id === id)) return repoPath
    }
    throw new Error(`unknown-session: "${id}"`)
  }

  return {
    async newSession(root, relDir = '', name) {
      const route = resolveFreestyleRepo(root.path, relDir, { env })
      const id = GW.mintSessionPath({
        org: sessionKey(root),
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
        for (const s of ownRows(root, repoPath)) {
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
    // Aggregated over reposOf(root), like list/archive/revive/finish — a
    // session merged inside a nested repo is swept too, not just ones in the
    // root's own repo. sweepMerged has no ownership concept of its own, so
    // this never calls it with dryRun:false — that would finish (delete the
    // branch + worktree of) ANY merged session in a shared nested repo,
    // including one belonging to a different org. Instead it always probes
    // read-only first (dryRun:true costs nothing: just `git branch --merged`
    // / `git branch` plus a registry read, regardless of ownership), filters
    // the candidates against ownRows — the SAME function `list` uses, not a
    // second inlined copy of its prefix rule, so the two cannot disagree —
    // and only then, for a real sweep, finishes the OWNED candidates itself
    // via FIN.finishSession. A foreign merged session is never reported on
    // and never touched.
    sweep(root, { dryRun = true } = {}) {
      const finished = [], skipped = []
      for (const repoPath of reposOf(root)) {
        let candidates
        try { candidates = FIN.sweepMerged(repoPath, { env, dryRun: true }) } catch { continue }
        const owned = new Set(ownRows(root, repoPath).map((s) => s.id))
        for (const r of candidates.skipped) {
          if (owned.has(r.id)) skipped.push({ ...r, repoPath })
        }
        for (const r of candidates.finished) {
          if (!owned.has(r.id)) continue
          if (dryRun) { finished.push({ ...r, repoPath }); continue }
          try {
            finished.push({ ...FIN.finishSession(repoPath, r.id, { env, dryRun: false }), repoPath })
          } catch (err) {
            skipped.push({ id: r.id, branch: r.branch, reason: err.reason || err.message, repoPath })
          }
        }
      }
      return { finished, skipped }
    },
  }
}
