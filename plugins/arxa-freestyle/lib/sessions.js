// Freestyle sessions (F5): wires the git-workspace session engine onto a
// Freestyle root. A "root" (from lib/roots.js) is any folder the user added
// — this module composes the engine's session lifecycle on top of it, it
// does not reimplement any of it. See sessions.js / finish.js / routing.js
// in ../../git-workspace/lib for the functions this file calls.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { ensureTrashDir, listTrash, purgeEntry, readTrashEntry } from './files.js'
import { resolveFreestyleRepo } from '../../git-workspace/lib/routing.js'
import { getOrigin, isRepo } from '../../git-workspace/lib/repos.js'
import { seatManifest } from '../../git-workspace/lib/manifest-seat.js'
import { runGit } from '../../git-workspace/lib/run.js'
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

// Git-workspace identities normally mirror workspace paths verbatim, but a
// Freestyle folder may contain spaces, Unicode, a leading dot, or enough deep
// components that an escaped mirror exceeds filesystem limits. Keep every
// ordinary Git-safe workspace unchanged. Otherwise one fixed-size hash segment
// represents the whole normalized workspace; the raw `session.workspace`
// remains the human/routing authority. Hash-looking literal folders are hashed
// too, so they cannot collide with this reserved namespace.
const FREESTYLE_ID_ESCAPE = 'arxa-fs--'
const FREESTYLE_ID_WORD_MAX = 120

function freestyleIdentityWorkspace(workspace) {
  const rawParts = String(workspace ?? '').split('/').filter(Boolean)
  const rawWorkspace = rawParts.join('/')
  let safe = true
  for (const raw of rawParts) {
    try { GW.assertSessionIdShape(raw) } catch { safe = false }
    if (raw.startsWith(FREESTYLE_ID_ESCAPE)) safe = false
  }
  if (safe) return { workspace: rawWorkspace, rawLeaf: rawParts.at(-1) ?? '' }
  const digest = createHash('sha256').update(rawWorkspace, 'utf8').digest('base64url')
  return { workspace: FREESTYLE_ID_ESCAPE + digest, rawLeaf: rawParts.at(-1) ?? '' }
}

function freestyleIdentityWord(name, rawLeaf) {
  let word = GW.slugSegment(name)
  if (!word) {
    const folder = rawLeaf.length > 3 && rawLeaf.endsWith('s') ? rawLeaf.slice(0, -1) : rawLeaf
    word = GW.slugSegment(folder) || 'session'
  }
  return word.slice(0, FREESTYLE_ID_WORD_MAX)
}

export function createFreestyleSessions({ env = process.env, dshBridge, githubBridge }) {
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
    return rows.filter((s) => {
      if (typeof s.freestyleRootId === 'string' && s.freestyleRootId !== '') return s.freestyleRootId === root.id
      if (!s.id.startsWith(prefix)) return false
      // Legacy rows predate explicit UUID ownership. Their path-shaped id,
      // workspace and worktree must still resolve under this exact root;
      // basename prefix alone aliases nested same-name roots.
      try {
        const identity = sessionIdentity(root, s)
        assertSessionRepo(root, repoPath, identity)
        sessionWorktree(root, repoPath, s, { legacy: true })
        return true
      } catch { return false }
    })
  }

  function repoOfSession(root, id) {
    for (const repoPath of reposOf(root)) {
      if (ownRows(root, repoPath).some((s) => s.id === id)) return repoPath
    }
    throw new Error(`unknown-session: "${id}"`)
  }

  function relativeRepo(root, repoPath) {
    const rootPath = path.resolve(root.path)
    const repo = path.resolve(repoPath)
    const rel = path.relative(rootPath, repo)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('repo-outside-root')
    return rel || '.'
  }

  function repoFromEntry(root, entry) {
    if (typeof entry.repoPath !== 'string' || entry.repoPath === '' || path.isAbsolute(entry.repoPath)) throw new Error('unknown-entry')
    const rootPath = fs.realpathSync(root.path)
    const candidate = path.resolve(rootPath, entry.repoPath)
    const rel = path.relative(rootPath, candidate)
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('unknown-entry')
    if (!fs.existsSync(candidate)) return candidate
    const real = fs.realpathSync(candidate)
    const realRel = path.relative(rootPath, real)
    if (realRel === '..' || realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) throw new Error('unknown-entry')
    return real
  }

  function sessionIdentity(root, session) {
    if (!session || typeof session.id !== 'string' || typeof session.workspace !== 'string') throw new Error('invalid-session')
    GW.assertSessionIdShape(session.id)
    const workspace = session.workspace.split('/').filter(Boolean).join('/')
    const identity = freestyleIdentityWorkspace(workspace)
    const expectedParent = [sessionKey(root), ...(identity.workspace ? identity.workspace.split('/') : [])].join('/')
    const idParts = session.id.split('/')
    const actualParent = idParts.slice(0, -1).join('/')
    if (actualParent !== expectedParent) throw new Error('invalid-session')
    const expectedBranch = GW.SESSION_BRANCH_PREFIX + session.id
    if (session.branch !== expectedBranch) throw new Error('invalid-session')
    return { workspace, expectedBranch }
  }

  function sameRepo(a, b) {
    try { return fs.realpathSync(a) === fs.realpathSync(b) } catch { return false }
  }

  function assertSessionRepo(root, repoPath, identity) {
    const routed = resolveFreestyleRepo(root.path, identity.workspace, { env, requireHead: false }).repoPath
    if (!sameRepo(routed, repoPath)) throw new Error('repo-mismatch')
  }

  function worktreeAt(base, id) {
    return path.resolve(base, GW.SESSIONS_DIR, ...id.split('/'))
  }

  function physicalPath(location) {
    let existing = path.resolve(location)
    const tail = []
    while (!fs.existsSync(existing)) {
      const parent = path.dirname(existing)
      if (parent === existing) break
      tail.unshift(path.basename(existing))
      existing = parent
    }
    return path.join(fs.realpathSync(existing), ...tail)
  }

  function sessionWorktree(root, repoPath, session, { legacy = false } = {}) {
    const actual = path.resolve(session.worktree || '')
    const rootLocal = worktreeAt(root.path, session.id)
    const repoLocal = worktreeAt(repoPath, session.id)
    // Rows predating explicit root UUIDs were created at the Freestyle root.
    // Keep that narrow fallback so overlapping same-basename roots cannot
    // claim an unannotated row through a nested repository.
    const actualPhysical = physicalPath(actual)
    if (actualPhysical !== physicalPath(rootLocal) && (legacy || actualPhysical !== physicalPath(repoLocal))) {
      throw new Error('invalid-session')
    }
    return actual
  }

  function sessionEntry(root, entryId) {
    const found = readTrashEntry(root, entryId)
    const e = found.entry
    let identity
    try {
      if (
        e.kind !== 'session' || e.freestyleRootId !== root.id ||
        typeof e.sessionId !== 'string' || !e.session || e.session.id !== e.sessionId ||
        e.session.freestyleRootId !== root.id || e.session.state !== 'archived'
      ) throw new Error('invalid-session')
      identity = sessionIdentity(root, e.session)
    } catch { throw new Error('unknown-entry') }
    if (e.branch !== identity.expectedBranch) throw new Error('unknown-entry')
    const repoPath = repoFromEntry(root, e)
    if (isRepo(repoPath, env)) {
      try { assertSessionRepo(root, repoPath, identity) } catch { throw new Error('repo-mismatch') }
    }
    let expectedWorktree
    try { expectedWorktree = sessionWorktree(root, repoPath, e.session) } catch { throw new Error('unknown-entry') }
    return { ...found, repoPath, ...identity, expectedWorktree }
  }

  function ghostsFor(root, repoPath) {
    const rel = relativeRepo(root, repoPath)
    return listTrash(root)
      .filter((e) => e.kind === 'session' && e.freestyleRootId === root.id && e.repoPath === rel && e.session?.id === e.sessionId)
      .map((e) => e.session)
  }

  return {
    async newSession(root, relDir = '', name) {
      const route = resolveFreestyleRepo(root.path, relDir, { env })
      const identity = freestyleIdentityWorkspace((relDir || '').replace(/\/+$/, ''))
      const id = GW.mintSessionPath({
        org: sessionKey(root),
        workspace: identity.workspace,
        name: freestyleIdentityWord(name, identity.rawLeaf),
        sessions: GW.listSessions(route.repoPath, env),
        ghosts: ghostsFor(root, route.repoPath),
      })
      const session = GW.openSession(route.repoPath, {
        id, orgPath: route.repoPath, name: name?.trim() || undefined, workspace: relDir || '', env,
      })
      const cwd = path.join(session.worktree, route.cwdRel)
      fs.mkdirSync(cwd, { recursive: true })
      const spawned = await dshBridge.spawn({ cwd, name: session.name, id: session.id, rootId: root.id })
      const annotated = GW.annotateSession(route.repoPath, session.id, {
        freestyleRootId: root.id,
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
    trashArchived(root, id) {
      const repoPath = repoOfSession(root, id)
      const row = ownRows(root, repoPath).find((s) => s.id === id)
      if (!row) throw new Error(`unknown-session: "${id}"`)
      if (row.state !== 'archived') {
        throw new Error(`not-archived: session "${id}" is ${row.state} — archive it first`)
      }
      let identity
      try {
        identity = sessionIdentity(root, row)
        assertSessionRepo(root, repoPath, identity)
        sessionWorktree(root, repoPath, row, { legacy: !row.freestyleRootId })
      } catch {
        if (!row.freestyleRootId) throw new Error(`legacy-ownership: session "${id}" does not belong unambiguously to this root`)
        throw new Error(`invalid-session-ownership: session "${id}" does not match its root and repository`)
      }

      // Marker first, registry removal second. If the process stops between
      // these writes the session is duplicated in Archives and Trash, which
      // remains visible and recoverable; the inverse ordering can orphan it.
      const entryId = randomUUID()
      const dir = path.join(ensureTrashDir(root), entryId)
      fs.mkdirSync(dir)
      const saved = { ...row, freestyleRootId: root.id }
      const entry = {
        id: entryId,
        kind: 'session',
        trashedAt: new Date().toISOString(),
        freestyleRootId: root.id,
        repoPath: relativeRepo(root, repoPath),
        sessionId: saved.id,
        name: typeof saved.name === 'string' && saved.name !== '' ? saved.name : saved.id,
        branch: typeof saved.branch === 'string' ? saved.branch : null,
        session: saved,
      }
      fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(entry, null, 2) + '\n')
      GW.removeSessionRow(repoPath, id, env)
      return { entryId, session: saved, branch: entry.branch }
    },
    restoreTrash(root, entryId) {
      const { entry, repoPath, expectedBranch, expectedWorktree } = sessionEntry(root, entryId)
      if (!isRepo(repoPath, env)) {
        throw new Error(`repo-gone: ${entry.repoPath} no longer exists — restore the owning folder first`)
      }
      if (entry.branch && runGit(['rev-parse', '--verify', entry.branch], { cwd: repoPath, env, allowFail: true }) === null) {
        throw new Error(`branch-gone: parked branch "${entry.branch}" no longer exists`)
      }
      const existing = GW.listSessions(repoPath, env).find((row) => row.id === entry.sessionId)
      if (existing) {
        const safelyDuplicated = existing.state === 'archived'
          && existing.branch === expectedBranch
          && path.resolve(existing.worktree || '') === expectedWorktree
          && (!existing.freestyleRootId || existing.freestyleRootId === root.id)
        if (!safelyDuplicated) throw new Error(`session-conflict: session "${entry.sessionId}" already exists outside Archives`)
        purgeEntry(root, entryId)
        return { sessionId: existing.id, state: existing.state, deleted: entryId }
      }
      const row = GW.restoreSessionRow(repoPath, entry.session, env)
      purgeEntry(root, entryId)
      return { sessionId: row.id, state: row.state ?? 'archived', deleted: entryId }
    },
    async purgeTrash(root, entryId) {
      const { entry, repoPath, expectedBranch, expectedWorktree } = sessionEntry(root, entryId)
      const out = { entryId, sessionId: entry.sessionId, remoteBranch: 'no-origin', refs: null, deleted: null }
      if (!isRepo(repoPath, env)) {
        throw new Error(`repo-gone: ${entry.repoPath} is unavailable — the trash entry was kept for retry`)
      } else {
        const registryRowExists = () => GW.listSessions(repoPath, env).some((row) => row.id === entry.sessionId)
        if (registryRowExists()) {
          throw new Error(`session-conflict: session "${entry.sessionId}" still has a registry row — restore the duplicate trash entry before purging`)
        }
        const { manifest } = seatManifest(repoPath)
        if (entry.branch && getOrigin(repoPath, env) !== null && manifest?.repoOwner && manifest?.repoName) {
          if (!githubBridge || typeof githubBridge.deleteBranch !== 'function') {
            throw new Error('purge incomplete: remote branch deletion failed (github-unavailable) — the trash entry was kept')
          }
          const made = await githubBridge.deleteBranch(manifest.repoOwner, manifest.repoName, entry.branch)
          if (!made?.ok) {
            throw new Error('purge incomplete: remote branch deletion failed (' + (made?.error || made?.reason || 'unknown') + ') — the trash entry was kept')
          }
          out.remoteBranch = made.alreadyGone ? 'already-gone' : 'deleted'
        }
        // Remote deletion awaits I/O. Restore can race that await, so guard
        // again before the first local destructive operation.
        if (registryRowExists()) {
          throw new Error(`session-conflict: session "${entry.sessionId}" was restored while purge was running — local session data was kept`)
        }
        out.refs = GW.dropSessionRefs(repoPath, {
          id: entry.sessionId,
          branch: entry.branch,
          worktree: entry.session.worktree ?? null,
        }, env)
        const branchRemains = runGit(['show-ref', '--verify', '--hash', 'refs/heads/' + expectedBranch], { cwd: repoPath, env, allowFail: true }) !== null
        const baseRefRemains = runGit(['show-ref', '--verify', '--hash', GW.SESSION_BASE_PREFIX + entry.sessionId], { cwd: repoPath, env, allowFail: true }) !== null
        if (branchRemains || baseRefRemains || fs.existsSync(expectedWorktree)) {
          throw new Error('purge incomplete: local session refs or worktree remain — the trash entry was kept')
        }
      }
      purgeEntry(root, entryId)
      out.deleted = entryId
      return out
    },
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
