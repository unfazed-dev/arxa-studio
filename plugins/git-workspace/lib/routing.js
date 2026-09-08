// Session → repo routing (D98, D99).
//
// A session's workspace row names WHICH repo owns its branch and worktree.
// Before this module the answer was always the org repo, so a project-scoped
// session's commits landed in org history and the project repo never saw the
// work — bug B2. The fix is a table, not a heuristic:
//
//   projects/<slug>/**               -> <org>/projects/<slug>   (project repo)
//   notes|meetings|communications/** -> <org>                   (org repo)
//   account/**                       -> REFUSE (D37: billing artefacts never
//                                       enter git; account/ is gitignored on
//                                       purpose, so it gets no repo and no
//                                       sessions)
//   unknown dock                     -> REFUSE
//
// **The silent org fallback IS B2.** There is no default branch in this table:
// an unrecognised dock refuses loudly rather than quietly parking work in the
// org repo where nobody looks for it. Every refusal carries a machine-readable
// `reason` so callers can render the right human copy.

import fs from 'node:fs'
import path from 'node:path'

import { isRepo, hasHead } from './repos.js'

/**
 * The routing table itself, exported so tests and future docks read the same
 * source of truth the resolver does. `kind`:
 *   'project' — the dock's second segment is a project slug naming a nested repo
 *   'org'     — the dock lives directly in org history
 *   'refuse'  — the dock exists but deliberately has no repo
 */
export const DOCK_ROUTES = Object.freeze([
  Object.freeze({ dock: 'projects', kind: 'project' }),
  Object.freeze({ dock: 'notes', kind: 'org' }),
  Object.freeze({ dock: 'meetings', kind: 'org' }),
  Object.freeze({ dock: 'communications', kind: 'org' }),
  Object.freeze({ dock: 'account', kind: 'refuse', reason: 'account' }),
])

/** Refusal reasons, in the order the resolver can raise them. `outside-root`
 * and the freestyle-flavoured `no-head` are raised only by
 * resolveFreestyleRepo (F5), below. */
export const ROUTING_REASONS = Object.freeze(['account', 'unknown-dock', 'no-head', 'outside-root'])

/**
 * The no-HEAD refusal reuses lifecycle.js's session wording byte-for-byte
 * (`lifecycle.js:966/1025/1047`). The sidebar client keys on the PREFIX only
 * (`client.js:4048`: `indexOf("initial-snapshot-pending") === 0`), so keeping
 * one constant string keeps every existing assertion green while `git worktree
 * add` never gets to fail raw.
 */
export const INITIAL_SNAPSHOT_PENDING =
  'initial-snapshot-pending: the first git snapshot of this organisation is still running — sessions unlock the moment it completes'

/** Typed, loud routing refusal. `reason` is one of ROUTING_REASONS. */
export class RoutingRefusedError extends Error {
  constructor(reason, message, { workspace = null, repoPath = null } = {}) {
    super(message)
    this.name = 'RoutingRefusedError'
    this.reason = reason
    this.workspace = workspace
    this.repoPath = repoPath
  }
}

const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Pure table lookup: workspace string → { kind, slug, dock }. No filesystem,
 * no git — so the table is testable on its own.
 *
 * Throws RoutingRefusedError('account') / ('unknown-dock').
 *
 * @param {string} workspace e.g. 'notes', 'meetings/scheduler', 'projects/POLO/design'
 */
export function routeDock(workspace) {
  const ws = typeof workspace === 'string' ? workspace.trim() : ''
  if (ws === '') {
    throw new RoutingRefusedError(
      'unknown-dock',
      'unknown-dock: a session is born in a workspace row (a dock container or a project container) — an empty workspace routes nowhere',
      { workspace },
    )
  }
  const parts = ws.split('/').filter(Boolean)
  const dock = parts[0]
  const route = DOCK_ROUTES.find((r) => r.dock === dock)
  if (!route) {
    throw new RoutingRefusedError(
      'unknown-dock',
      `unknown-dock: "${ws}" names no known dock — sessions route by table (${DOCK_ROUTES.map((r) => r.dock).join(', ')}) and never fall back to the org repo (D99)`,
      { workspace: ws },
    )
  }
  if (route.kind === 'refuse') {
    throw new RoutingRefusedError(
      route.reason,
      `account: "${ws}" lives under account/, which is gitignored on purpose (D37 — billing artefacts must never enter org history). It gets no repo and no sessions.`,
      { workspace: ws },
    )
  }
  if (route.kind === 'org') return { kind: 'org', slug: null, dock }
  // project: the second segment is the slug and is mandatory.
  const slug = parts[1]
  if (!slug || !SEGMENT_RE.test(slug)) {
    throw new RoutingRefusedError(
      'unknown-dock',
      `unknown-dock: "${ws}" is under projects/ but names no project slug — a project session needs projects/<slug>/<container>`,
      { workspace: ws },
    )
  }
  return { kind: 'project', slug, dock }
}

/**
 * Resolve a workspace row to the repo that owns its sessions.
 *
 * @param {string} orgPath   the open org's directory
 * @param {string} workspace the workspace row key
 * @param {object} [opts]
 * @param {object} [opts.env]         env for git calls
 * @param {boolean} [opts.requireHead=true]  refuse when the target has no HEAD
 *   — `git worktree add` needs a commit to branch from, and a project created
 *   moments ago may not have one yet. Refuse with the human reason rather than
 *   letting worktree add fail raw.
 * @returns {{ repoPath: string, kind: 'org'|'project', slug?: string }}
 *   `repoPath` is a WORKING DIRECTORY (what runGit's cwd wants), not a .git path.
 */
export function resolveSessionRepo(orgPath, workspace, { env = process.env, requireHead = true } = {}) {
  if (typeof orgPath !== 'string' || orgPath === '') {
    throw new TypeError('resolveSessionRepo: orgPath must be a non-empty path string')
  }
  const route = routeDock(workspace)
  if (route.kind === 'org') {
    if (requireHead && !hasHead(orgPath, env)) {
      throw new RoutingRefusedError('no-head', INITIAL_SNAPSHOT_PENDING, { workspace, repoPath: orgPath })
    }
    return { repoPath: orgPath, kind: 'org' }
  }
  const repoPath = path.join(orgPath, 'projects', route.slug)
  if (!fs.existsSync(repoPath)) {
    throw new RoutingRefusedError(
      'unknown-dock',
      `unknown-dock: no project "${route.slug}" in this organisation — ${repoPath} does not exist`,
      { workspace, repoPath },
    )
  }
  // A project directory that is not yet its own repo is the same human
  // situation as a repo without HEAD: the first snapshot has not landed.
  if (requireHead && (!isRepo(repoPath, env) || !hasHead(repoPath, env))) {
    throw new RoutingRefusedError('no-head', INITIAL_SNAPSHOT_PENDING, { workspace, repoPath })
  }
  return { repoPath, kind: 'project', slug: route.slug }
}

/**
 * The deepest ancestor of `p` (inclusive) that exists on disk, realpathed.
 * `p` itself may not exist yet (Freestyle targets can be minted before their
 * folder is created) — walk up until something real is found, then resolve
 * THAT, so any symlink anywhere in the existing prefix is followed.
 */
function realpathDeepestExisting(p) {
  let dir = p
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir)
    if (parent === dir) break // hit the filesystem root without finding anything real
    dir = parent
  }
  return fs.realpathSync(dir)
}

/**
 * Physical containment, not just lexical: `p` (or its deepest existing
 * ancestor) must realpath to somewhere inside `rootReal`. The lexical check
 * in `resolveFreestyleRepo` (a `path.relative` against `path.resolve`d
 * strings) does not see through symlinks — a folder placed inside the root
 * that points elsewhere on disk would sail past it and bind a session to a
 * repo the root never actually contains.
 */
function assertPhysicallyInside(rootReal, p, relDir, rootPath) {
  const real = realpathDeepestExisting(p)
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new RoutingRefusedError(
      'outside-root',
      `outside-root: "${relDir}" escapes ${rootPath} through a symlink`,
      { repoPath: rootReal },
    )
  }
}

/**
 * Resolve a Freestyle target folder to the nearest enclosing git repo (F5).
 * A Freestyle root has no dock table — any folder under it is fair game — so
 * this is a pure path walk from `<rootPath>/<relDir>` up to `rootPath`
 * itself, stopping at the first directory that `isRepo`. No filesystem
 * writes happen here; adding the root as a repo is `initPlainRepo`'s job
 * (repos.js), run once when a folder is added through Freestyle.
 *
 * @param {string} rootPath   the Freestyle root's directory
 * @param {string} [relDir]   the target folder, relative to rootPath ('' = the root itself)
 * @param {object} [opts]
 * @param {object} [opts.env]                env for git calls
 * @param {boolean} [opts.requireHead=true]  refuse when the enclosing repo has no HEAD yet
 *   — same "first snapshot not done" contract as resolveSessionRepo.
 * @returns {{ repoPath: string, kind: 'freestyle', cwdRel: string }}
 *   `repoPath` is a WORKING DIRECTORY. `cwdRel` is `relDir` re-expressed
 *   relative to `repoPath` (POSIX separators, so it can sit in a branch/id).
 */
export function resolveFreestyleRepo(rootPath, relDir = '', { env = process.env, requireHead = true } = {}) {
  // path.resolve, not realpathSync, for the LEXICAL walk and the returned
  // repoPath: callers get back the path they typed, not a resolved alias
  // they never wrote (`isRepo` already realpaths both sides internally —
  // repos.js:47 — for the macOS /var → /private/var tmpdir case, so this
  // stays correct for THAT). Symlink escapes are a different threat and get
  // their own physical check, below, via assertPhysicallyInside.
  const rootAbs = path.resolve(rootPath)
  const target = path.resolve(rootAbs, relDir || '')
  const rel = path.relative(rootAbs, target)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new RoutingRefusedError(
      'outside-root',
      `outside-root: "${relDir}" is not inside ${rootPath}`,
      { repoPath: rootAbs },
    )
  }
  const rootReal = fs.realpathSync(rootAbs)
  assertPhysicallyInside(rootReal, target, relDir, rootPath)

  let dir = target
  while (true) {
    if (isRepo(dir, env)) {
      // The repo the walk lands on must ALSO be physically inside the root:
      // a symlinked intermediate directory could otherwise let `isRepo` find
      // — and bind a session to — a repo the root never actually contains.
      assertPhysicallyInside(rootReal, dir, relDir, rootPath)
      if (requireHead && !hasHead(dir, env)) {
        throw new RoutingRefusedError('no-head', `no-head: ${dir} is a repo with no commits yet`, { repoPath: dir })
      }
      return { repoPath: dir, kind: 'freestyle', cwdRel: path.relative(dir, target).split(path.sep).join('/') }
    }
    if (dir === rootAbs) break
    dir = path.dirname(dir)
  }
  // No repo anywhere between the target and the root, inclusive: the root
  // itself was never added through Freestyle (that step runs initPlainRepo).
  // Same reason as the no-commits-yet case above — a caller branches on
  // `reason`, not on which of the two produced it.
  throw new RoutingRefusedError(
    'no-head',
    `no-head: ${rootPath} is not a git repo — add it through Freestyle first`,
    { repoPath: rootAbs },
  )
}

/**
 * Every project directory under `<orgPath>/projects/` that is its own repo,
 * as `{ slug, repoPath }`. The scan shape follows workspace-index/lib/scan.js
 * (`<org>/projects/<slug>/`). Missing or unreadable projects dir → [].
 */
export function projectRepos(orgPath, env = process.env) {
  const dir = path.join(orgPath, 'projects')
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const repoPath = path.join(dir, e.name)
    if (!isRepo(repoPath, env)) continue
    out.push({ slug: e.name, repoPath })
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  return out
}
