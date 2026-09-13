// Session lifecycle (D38–D40): branch-per-session worktrees.
//
// A session (see CONTEXT.md) is one work context — chat/agent thread or
// interactive editing surface. Every session owns a git branch + a
// worktree; main is NEVER edited directly (D38). Sessions never end —
// they are archived (D39).
//
// Mechanics:
// - Session branch:   `arxa/<org>/<workspace>/<leaf>` off main — the identity
//                     IS the relative disk path (2026-09-03).
// - Session worktree: `<repo>/.arxa/worktrees/<id>`, hidden from the
//   repo (and from every other worktree, since excludes live in the
//   common git dir) via `.git/info/exclude` — so the D18 `add -A` WIP
//   wall can never swallow a nested worktree.
// - Session registry: `<git-common-dir>/arxa/sessions.json` — repo-local
//   state that travels nowhere, like `refs/arxa/stage-base` (phase 3).
// - Per-session squash base: `refs/arxa/session-base/<id>`. The shared
//   `refs/arxa/stage-base` cannot serve concurrent sessions (refs are
//   common across worktrees — two sessions would corrupt each other's
//   base), so each session squashes against its own base ref via the
//   `baseRef` extension of commits.js.
//
// Stage boundary (D38): the default gate + merge moment. The session's
// WIP run is squashed to one clean stage commit (D18 mechanics reused
// verbatim), the gate runs (arxa-cicd `check.sh` when present = code
// repo; light checks otherwise = content repo — an ABSENT check.sh is a
// configuration state, not an error), and green merges to main. Red
// parks the branch. Parked branches (red gate / held / archived
// unmerged) are NEVER auto-deleted (D40) — this module exposes no
// branch-deletion API at all.
//
// Archive (D39/D40): prunes the worktree (after a final WIP commit so
// nothing is ever lost) but keeps the branch; revival recreates the
// worktree from the parked branch and continues from parked state.
//
// dsh integration point (`archivedSessionIds`): dsh is not reachable
// from this repo. The plugin-side contract is `archivedSessionIds
// (repoPath)` below — dsh's session list must treat every id it returns
// as archived-out-of-active-views (transcripts persist on dsh's side;
// the branch parks here). Wire-up lands with the dsh sync rail.
//
// Concurrency: two sessions hitting a stage boundary race on main. The
// merge runs inside the primary worktree (where main is checked out) so
// git's own index/ref locks serialize the racers; the loser fails
// loudly via SessionMergeError with all commits intact on its parked
// branch — recover by reviving/retrying, never by deleting anything.
//
// Platform note (M8): worktrees are desktop-only in v1 — mobile is
// online-only and edits travel the cairn rail as edit-log entries
// materialized by a desktop, so NO mobile code path ever requires a
// worktree (or git at all) on the device.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ensureGit } from './probe.js'
import { runGit, runGitProbe, STAGE_IDENTITY } from './run.js'
import { wipCommit, stageBoundarySquash, STAGE_BASE_REF } from './commits.js'
import { getOrigin, excludeArxaDir } from './repos.js'
import { projectRepos } from './routing.js'
// Task 10 (A4): the container-work teardown guard. Cross-plugin like
// project-secrets' keyring reuse; no cycle — devcontainer.js reaches only
// frame.js on this side (never sessions.js).
import { unrecoveredContainerCommits } from '../../sandbox/lib/devcontainer.js'
import { unrecoveredSandboxCommits } from '../../sandbox/lib/sbx.js'

/**
 * Branch namespace. Grilled 2026-09-03 (Q2/Q3): a session's identity IS its
 * relative disk path — `<org folder>/<workspace key>/<leaf>` — so the branch is
 * that path under `arxa/`, the worktree directory is that path under the ORG's
 * `.arxa/worktrees/`, and the dsh conversation key is that path with `/` → `-`.
 * One string, three surfaces. SUPERSEDES `arxa/session/<opaque-id>`.
 */
export const SESSION_BRANCH_PREFIX = 'arxa/'
export const SESSION_BASE_PREFIX = 'refs/arxa/session-base/'
export const SESSIONS_DIR = '.arxa/worktrees'
export const SESSIONS_FILE = 'sessions.json'
export const GATE_CHECK_SCRIPT = 'check.sh'

/** Session lifecycle states (CONTEXT.md: sessions never end — they are archived). */
export const SESSION_STATES = Object.freeze(['open', 'parked', 'archived'])

/** Loud, recoverable merge failure: the session branch keeps every commit. */
export class SessionMergeError extends Error {
  constructor(id, detail) {
    super(
      `session "${id}" could not merge to main — ${detail}. ` +
      'The session branch is parked with all commits intact; resolve and retry (D40: never deleted).',
    )
    this.name = 'SessionMergeError'
    this.sessionId = id
  }
}

// ---- registry (repo-local state, travels nowhere) --------------------------

// The common dir for a given working directory never changes while that
// directory exists, but D98 aggregation reads N+1 registries per sidebar
// handler — one `git rev-parse` spawn each, five handlers deep. Memoise, and
// invalidate by existence so a deleted/recreated repo recomputes.
const commonDirCache = new Map()

function gitCommonDir(repoPath, env) {
  const hit = commonDirCache.get(repoPath)
  if (hit && fs.existsSync(hit)) return hit
  const out = runGit(['rev-parse', '--git-common-dir'], { cwd: repoPath, env })
  const resolved = path.resolve(repoPath, out)
  commonDirCache.set(repoPath, resolved)
  return resolved
}

function registryPath(repoPath, env) {
  return path.join(gitCommonDir(repoPath, env), 'arxa', SESSIONS_FILE)
}

function readRegistry(repoPath, env) {
  const p = registryPath(repoPath, env)
  if (!fs.existsSync(p)) return { sessions: [] }
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!Array.isArray(parsed.sessions)) throw new TypeError(`${p} is not a session registry`)
  return parsed
}

function writeRegistry(repoPath, registry, env) {
  const p = registryPath(repoPath, env)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(registry, null, 2) + '\n')
}

function getSession(registry, id) {
  const s = registry.sessions.find((s) => s.id === id)
  if (!s) throw new Error(`unknown session "${id}"`)
  return s
}

// ---- repo discovery (D98) --------------------------------------------------
//
// Once sessions live in the repo their workspace routes to, an id alone no
// longer says WHICH registry holds it. Every id-keyed face gains this
// preamble: try the repo it was handed, then the project repos nested under
// it, then give up and let the caller's own `unknown session` error stand.
//
// A project repo has no `projects/` subdirectory, so calling this with a
// project path falls through after the first read — the preamble is free
// there and correct at the org.

function registryHasId(repoPath, id, env) {
  try {
    return readRegistry(repoPath, env).sessions.some((s) => s.id === id)
  } catch {
    return false
  }
}

/**
 * The repo whose registry holds `id`. Falls back to `repoPath` unchanged when
 * nothing matches, so the caller raises its usual `unknown session "<id>"`.
 */
export function sessionRepoFor(repoPath, id, env = process.env) {
  if (registryHasId(repoPath, id, env)) return repoPath
  for (const { repoPath: p } of projectRepos(repoPath, env)) {
    if (registryHasId(p, id, env)) return p
  }
  return repoPath
}

/**
 * Every session across the org registry and all project registries, each row
 * tagged with the repo it came from (D98 / project-sessions-physical.md).
 *
 * Rows carry `repoPath` (the owning working directory), `origin` ('org' |
 * 'project') and `projectSlug`. Session ids are minted as
 * `s-<base36 time>-<random>` so they stay unique across registries without
 * coordination — aggregation never has to reconcile a collision.
 *
 * Registry order within a repo is preserved; org rows come first, then
 * projects in slug order.
 */
export function parkedSessions(orgPath, env = process.env) {
  const out = []
  const take = (repoPath, origin, projectSlug) => {
    let rows
    try {
      rows = readRegistry(repoPath, env).sessions
    } catch {
      return // not a repo, or no registry yet — nothing to aggregate
    }
    for (const s of rows) out.push({ ...s, repoPath, origin, projectSlug: s.project ?? projectSlug ?? null })
  }
  take(orgPath, 'org', null)
  for (const { slug, repoPath } of projectRepos(orgPath, env)) take(repoPath, 'project', slug)
  return out
}

/** All sessions for a repo (registry order). */
export function listSessions(repoPath, env = process.env) {
  return readRegistry(repoPath, env).sessions
}

/**
 * dsh contract (D39): ids of archived sessions. dsh flags these out of
 * active views (`archivedSessionIds`); transcripts persist on dsh's
 * side, branches park here. See header for the integration point.
 */
export function archivedSessionIds(repoPath, env = process.env) {
  return listSessions(repoPath, env)
    .filter((s) => s.state === 'archived')
    .map((s) => s.id)
}

/**
 * Additive registry-row annotation (Phase D dsh bridge, D71): merge `fields`
 * onto one session row — e.g. `{ dshSessionId }` after a dsh spawn. The
 * registry stays the storage of record; the field is optional and old rows
 * simply lack it (consumers read it as null). Unknown id throws like the
 * rest of the module.
 */
export function annotateSession(repoPath, id, fields, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  Object.assign(session, fields)
  // Any annotation is session activity: keep the rendered age honest
  // (the 56y bug was fake timestamps rendered as ages-from-epoch).
  session.updatedAt = Date.now()
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Auto-name (grilled 2026-08-30): singular(folder) + per-folder counter,
 * zero-padded to 3 — note-001, email-001, design-001. No ids in names:
 * the worktree dir + branch keep the unique session id as the stable key,
 * so display duplicates across different parents are safe (rows sit under
 * their parent). Counter scans the SAME workspace folder only.
 */
export function nextSessionName(sessions, workspace) {
  const folder = String(workspace || '').split('/').filter(Boolean).pop() || 'session'
  const prefix = folder.length > 3 && folder.endsWith('s') ? folder.slice(0, -1) : folder
  let max = 0
  for (const s of sessions) {
    if (s.workspace !== workspace || typeof s.name !== 'string') continue
    const m = /^([A-Za-z][A-Za-z0-9._-]*)-(\d+)$/.exec(s.name)
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]))
  }
  return prefix + '-' + String(max + 1).padStart(3, '0')
}

/** The workspace folder, de-pluralised — the shared prefix rule behind both
 * nextSessionName and nextSessionId. */
function workspacePrefix(workspace) {
  const folder = String(workspace || '').split('/').filter(Boolean).pop() || 'session'
  return folder.length > 3 && folder.endsWith('s') ? folder.slice(0, -1) : folder
}

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A path- and ref-safe segment: lowercase kebab, everything else dropped. */
export function slugSegment(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/** The leaf of a session identity — what the sidebar row and the dsh header
 * show, since the breadcrumb already carries the folders (Q9). */
export function sessionLeaf(id) {
  return String(id ?? '').split('/').filter(Boolean).pop() ?? ''
}

/**
 * dsh conversation key for a session identity (Q3). dsh stores a conversation
 * as a DIRECTORY named by its id, so `/` cannot survive the trip; the org
 * segment leads, which is what makes the key unique across orgs (org folder
 * names are unique by the create/add guard).
 */
export function dshSessionKey(id) {
  return 'arxa-' + String(id ?? '').split('/').filter(Boolean).join('-')
}

const REF_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Every segment of a session identity becomes BOTH a git ref component and a
 * directory name, so both rule sets apply: no leading dot, no `.`/`..`, no
 * `.lock` suffix, no space or ref metacharacter. Folder names reach here
 * verbatim (Q5), so a folder git cannot express is refused loudly at mint
 * time rather than producing an unusable branch three steps later.
 */
export function assertSessionIdShape(id) {
  const segments = String(id ?? '').split('/')
  if (segments.some((s) => s === '')) {
    throw new TypeError(`session id "${id}" must be a relative path with no empty segments`)
  }
  for (const s of segments) {
    if (s === '.' || s === '..' || s.endsWith('.lock') || !REF_SEGMENT_RE.test(s)) {
      throw new TypeError(
        `session id "${id}": segment "${s}" cannot be a git branch component — ` +
        'rename the folder using letters, digits, dot, dash or underscore (no spaces)',
      )
    }
  }
  return id
}

/**
 * Mint a session identity (grilled 2026-09-03, Q2/Q4/Q5). SUPERSEDES
 * `nextSessionId`, which minted a bare leaf.
 *
 *   `<org folder>/<workspace key>/<word>-wt-<YYMMDD>-<NNN>`
 *   RESTO/notes/note-wt-260903-001
 *   RESTO/projects/kitchen-project/06-build/backoffice-wt-260903-001
 *
 * The path mirrors disk EXACTLY — `projects/` kept, numeric container
 * prefixes kept, folder names verbatim — so the branch, the worktree
 * directory and the folder a human sees are the same string, with no second
 * vocabulary to learn.
 *
 * `word` is the slugged name the human typed at creation, else the
 * de-pluralised workspace folder. It is baked in for life: a rename later
 * moves the LABEL only (Q1). Identity must never chase a name — GitHub
 * CLOSES an open PR whose head branch is renamed, and Docker Compose /
 * Nx both had to abandon directory-derived identity for the same class of
 * breakage (see docs/plans/session-path-identity-and-cicd-smoke.md §1).
 *
 * NNN counts per path per day, across words: two sessions born the same day
 * in `RESTO/notes` are -001 and -002 whatever they are called. A number freed
 * by a drop is skipped, never reused — the registry is the authority.
 *
 * A Freestyle root session (F5) has no workspace row to sit under — the
 * caller passes `workspace: ''` EXPLICITLY, and the identity collapses to
 * `<org>/<word>-wt-<YYMMDD>-<NNN>` (two segments, not three). Omitting
 * `workspace` entirely still throws below: only the explicit empty string
 * means "this is a root session", never a missing argument.
 */
export function mintSessionPath({ org, workspace, name, sessions, ghosts, now = new Date() } = {}) {
  const orgSegment = String(org ?? '').trim()
  const ws = String(workspace ?? '').split('/').filter(Boolean).join('/')
  if (orgSegment === '') throw new TypeError('mintSessionPath: the org folder name is required')
  if (ws === '' && workspace !== '') throw new TypeError('mintSessionPath: the workspace key is required')
  const word = slugSegment(name) || slugSegment(workspacePrefix(ws)) || 'session'
  const stamp =
    String(now.getFullYear() % 100).padStart(2, '0') +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0')
  const dir = ws === '' ? orgSegment : `${orgSegment}/${ws}`
  const base = `${dir}/${word}-wt-${stamp}`
  const counter = new RegExp('^' + reEscape(dir) + '/[A-Za-z0-9._-]+-wt-' + stamp + '-(\\d+)$')
  const taken = new Set()
  let max = 0
  // `ghosts` (2026-09-05 trash flow): registry-row snapshots of sessions
  // parked in the org trash — their rows are gone but their BRANCHES still
  // occupy the id namespace, so both counters must see them. A minted id
  // that collides with a parked branch kills `worktree add` at birth.
  for (const s of [...(Array.isArray(sessions) ? sessions : []), ...(Array.isArray(ghosts) ? ghosts : [])]) {
    if (!s || typeof s.id !== 'string') continue
    taken.add(s.id)
    const m = counter.exec(s.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  while (taken.has(base + '-' + String(n).padStart(3, '0'))) n++
  return assertSessionIdShape(base + '-' + String(n).padStart(3, '0'))
}

/**
 * Rekey the project scope of every session row (D72 proper rename): after a
 * project's folder+slug move, registry rows carrying `project: oldSlug`
 * are stamped with the new slug. The registry stores slugs, not paths
 * (stable across renames) — this keeps that promise true after a rename.
 * Returns the number of rekeyed rows.
 */
export function rekeySessionsProject(repoPath, oldSlug, newSlug, env = process.env) {
  if (!oldSlug || !newSlug) throw new TypeError('rekeySessionsProject: both slugs are required')
  const registry = readRegistry(repoPath, env)
  let n = 0
  for (const s of registry.sessions) {
    if (s.project === oldSlug) {
      s.project = newSlug
      n++
    }
  }
  if (n > 0) writeRegistry(repoPath, registry, env)
  return n
}

// ---- open ------------------------------------------------------------------

/** Ensure `.arxa/` never enters any worktree's `add -A` (exclude lives in the common dir). */
function ensureExcluded(repoPath, env) {
  // Same rule, one implementation (repos.js). initRepo applies it at `git
  // init` so nothing under .arxa/ is ever added in the first place; this call
  // heals repos that predate that, and covers a worktree's common dir.
  excludeArxaDir(gitCommonDir(repoPath, env))
}

/**
 * Worktree directory for an identity. The root is the ORG, not the owning
 * repo: a project session's branch lives in the project repo but its checkout
 * sits under the org's single `.arxa/worktrees/` (git places a worktree
 * anywhere), so one root holds every session and the directory is the branch
 * minus its `arxa/` prefix. Keeps the org-move handling that already carries
 * `.arxa/worktrees` with the folder.
 */
function sessionWorktreePath(orgPath, id) {
  return path.join(orgPath, ...SESSIONS_DIR.split('/'), ...String(id).split('/'))
}

/**
 * Remove identity directories left empty under `.arxa/worktrees` once their
 * last session goes (`RESTO/notes/` after the final note session). Walks up,
 * stops at the worktrees root, and stops at the first non-empty directory.
 */
function pruneEmptyWorktreeParents(worktree) {
  const marker = path.sep + SESSIONS_DIR.split('/').join(path.sep) + path.sep
  const at = worktree.lastIndexOf(marker)
  if (at < 0) return
  const root = worktree.slice(0, at + marker.length - 1)
  let dir = path.dirname(worktree)
  while (dir.startsWith(root + path.sep)) {
    try { fs.rmdirSync(dir) } catch { return } // non-empty or already gone
    dir = path.dirname(dir)
  }
}

/**
 * Open a session (D38): branch + worktree off main. Main itself is
 * never edited directly — all edits happen in the session worktree.
 *
 * `project` scopes the session (annotation only — the branch/worktree
 * still live on the repo given here): a project slug for project
 * sessions, null/undefined for org-level sessions. Registry is the
 * storage of record; consumers (file-org-shell, sidebar) interpret it.
 *
 * @returns {{ id, name, branch, worktree, state, project: string|null }}
 */
export function openSession(repoPath, { id, orgPath = repoPath, name, project, workspace, env = process.env } = {}) {
  if (project !== undefined && project !== null && (typeof project !== 'string' || project === '')) {
    throw new TypeError(`session project must be a slug string, null, or undefined; got ${JSON.stringify(project)}`)
  }
  // '' is allowed: it is the Freestyle root session's workspace (F5) — the
  // session sits directly under the org/root, not under a dock row. Every
  // other non-string is still refused.
  if (workspace !== undefined && workspace !== null && typeof workspace !== 'string') {
    throw new TypeError(`session workspace must be a path string, the empty string (root session), null, or undefined; got ${JSON.stringify(workspace)}`)
  }
  ensureGit(env)
  // Q8 (2026-09-03): the library never invents an identity. Minting needs the
  // org folder, the workspace key and the CROSS-registry aggregate — context
  // only the app layer has — and the old fallback (`s-<base36>-<rand>`) is how
  // opaque ids reached the sidebar from a script that bypassed the product.
  if (!id) {
    throw new TypeError(
      'openSession: id-required — a session identity is minted by the app layer ' +
      '(mintSessionPath), never by this library',
    )
  }
  assertSessionIdShape(id)
  const registry = readRegistry(repoPath, env)
  if (registry.sessions.some((s) => s.id === id)) {
    throw new Error(`session "${id}" already exists — revive it instead of reopening`)
  }
  const mainSha = runGit(['rev-parse', '-q', '--verify', 'refs/heads/main'], {
    cwd: repoPath, env, allowFail: true,
  })
  if (!mainSha) throw new Error(`no main branch in ${repoPath} — init the repo first (initOrgRepo/initProjectRepo)`)
  ensureExcluded(repoPath, env)
  // A project session's checkout lands under the ORG's `.arxa/`, so the org
  // repo needs the exclude too — its own sessions may not have created it yet.
  if (path.resolve(orgPath) !== path.resolve(repoPath)) ensureExcluded(orgPath, env)
  const branch = `${SESSION_BRANCH_PREFIX}${id}`
  const worktree = sessionWorktreePath(orgPath, id)
  fs.mkdirSync(path.dirname(worktree), { recursive: true })
  runGit(['worktree', 'add', '-b', branch, worktree, 'main'], { cwd: repoPath, env })
  // Per-session squash base (see header): starts at the branch point.
  runGit(['update-ref', `${SESSION_BASE_PREFIX}${id}`, mainSha], { cwd: repoPath, env })
  const now = Date.now()
  const session = {
    id,
    // Q9: the label defaults to the LEAF, not the whole path — the breadcrumb
    // already carries the folders, so the row would otherwise read them twice.
    name: name || sessionLeaf(id),
    branch,
    worktree,
    state: 'open',
    parkedReason: null,
    project: project ?? null,
    // Workspace scope (grilled 2026-08-30): the org-relative folder this
    // session belongs to — 'notes', 'meetings/scheduler',
    // 'projects/<slug>/design'. Creation paths never produce org-level
    // (null) sessions any more; null is a pre-v2 relic on old rows.
    workspace: workspace ?? null,
    createdAt: now,
    updatedAt: now,
  }
  registry.sessions.push(session)
  writeRegistry(repoPath, registry, env)
  return session
}

// ---- gate ------------------------------------------------------------------

/**
 * The gate (D38): run arxa-cicd `check.sh` at the worktree root when
 * present (code repo); light checks otherwise (content repo). An absent
 * check.sh is a configuration state, NOT an error — `configured` says
 * which kind ran.
 *
 * @returns {{ green: boolean, kind: 'check.sh'|'light', configured: boolean, output: string }}
 */
/**
 * Whether a session worktree is still usable.
 *
 * A worktree directory can be deleted out from under the registry — git keeps
 * its administrative entry and flags it `prunable`. Callers that ask git for
 * `status --porcelain` with `allowFail` get `null` back, and a `?? ''` turns
 * that into "no output", which every counter in the codebase reads as CLEAN.
 * That is B1: the card reported a worktree that no longer exists as having
 * nothing to commit. Ask this first and branch on it, rather than coalescing.
 *
 * - `ok`         — present and git answers
 * - `missing`    — the directory is gone
 * - `unreadable` — present, but git cannot use it (broken gitdir link, locked)
 */
export function worktreeHealth(worktree, env = process.env) {
  if (typeof worktree !== 'string' || worktree === '' || !fs.existsSync(worktree)) return 'missing'
  return runGit(['status', '--porcelain'], { cwd: worktree, env, allowFail: true }) === null
    ? 'unreadable'
    : 'ok'
}

export function runGate(worktree, env = process.env) {
  const script = path.join(worktree, GATE_CHECK_SCRIPT)
  if (fs.existsSync(script)) {
    try {
      const out = execFileSync('sh', [script], {
        cwd: worktree,
        env: { ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      })
      return { green: true, kind: 'check.sh', configured: true, output: out.trim() }
    } catch (err) {
      const output = [err.stdout, err.stderr].filter(Boolean).map(String).join('\n').trim()
      return { green: false, kind: 'check.sh', configured: true, output: output || err.message }
    }
  }
  // Content repo: light checks — the worktree must be a healthy checkout
  // with nothing uncommitted (the squash just ran) and a resolvable HEAD.
  const status = runGit(['status', '--porcelain'], { cwd: worktree, env, allowFail: true })
  const headSha = runGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: worktree, env, allowFail: true })
  const green = status === '' && Boolean(headSha)
  return { green, kind: 'light', configured: false, output: green ? '' : (status ?? 'unresolvable HEAD') }
}

// ---- stage boundary --------------------------------------------------------

/** Park a session (D40: parked, never deleted). Exported for the prflow
 * path in arxa-git-card, where a red gate must park exactly as the local
 * boundary does. */
export function parkSession(repoPath, id, reason, env = process.env) {
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  session.state = 'parked'
  session.parkedReason = reason
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Stage boundary for a session (D38): squash the session's WIP run into
 * one clean stage commit (D18 mechanics, per-session base ref), run the
 * gate, and on green merge to main. Red parks the branch (D40: parked,
 * never deleted). A merge conflict or a lost ref race parks the branch
 * and throws SessionMergeError — loud, recoverable, zero commits lost.
 *
 * The merge itself runs in the primary worktree; that is a ref/index
 * operation on main, not a direct edit — D38's "main never edited
 * directly" holds: every commit reaching main is a stage commit or a
 * stage merge commit.
 *
 * @returns {{ squashed, sha, gate, merged, parked, session }}
 */
export function sessionStageBoundary(repoPath, id, { message, env = process.env, pushUrl = null } = {}) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98: merge into the OWNING repo's main
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state !== 'open') {
    throw new Error(`session "${id}" is ${session.state} — revive it before hitting a stage boundary`)
  }
  const baseRef = `${SESSION_BASE_PREFIX}${id}`
  const squash = stageBoundarySquash(session.worktree, {
    message: message || `chore(session): ${session.name} checkpoint`,
    trailer: `Arxa-Stage: session ${id}`,
    env,
    baseRef,
  })
  const gate = runGate(session.worktree, env)
  if (!gate.green) {
    const parked = parkSession(repoPath, id, 'gate-red', env)
    return { ...squash, gate, merged: false, parked: true, session: parked }
  }
  // Green → merge moment. --ff-only covers the common single-session
  // case; a diverged main gets a true stage merge commit. Conflicts
  // abort cleanly and park — the session branch keeps everything.
  const ff = runGit(['merge', '--ff-only', session.branch], { cwd: repoPath, env, allowFail: true })
  if (ff === null) {
    // A no-ff merge that fails WITHOUT leaving a conflict behind is a LAND
    // RACE — another process is merging into main right now — and its own
    // dying merge leaves residue in main's index: its result staged, the
    // other lander's files knocked out of the index with untracked twins on
    // disk. Measured in the S4 barrier run (cicd-stress.mjs, 2026-09-13):
    // `A <loser file>`, `D <winner file>` + `?? <winner file>`, after which
    // every later land refused with "Your local changes would be
    // overwritten" while the loser was misreported as a merge conflict. So
    // a non-conflicting failure heals the index and retries: `reset -q`
    // restores the index from HEAD only (no worktree file is touched), and
    // the raced merge's untracked twins — bytes IDENTICAL to the incoming
    // branch's blob, because that merge wrote them — are removed so the
    // retry merge can write them again. Unknown bytes are never deleted;
    // the merge fails and parks loudly instead.
    const midMerge = () =>
      runGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: repoPath, env, allowFail: true }) !== null
    const healRacedIndex = () => {
      runGit(['reset', '-q'], { cwd: repoPath, env, allowFail: true })
      const rows = (runGit(['status', '--porcelain'], { cwd: repoPath, env, allowFail: true }) ?? '')
        .split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3))
      for (const rel of rows) {
        if (rel.startsWith('"')) continue // quoted paths are not worth guessing at
        const blob = runGitProbe(['show', `${session.branch}:${rel}`], { cwd: repoPath, env })
        if (blob.status !== 0) continue
        let disk = null
        try { disk = fs.readFileSync(path.join(repoPath, rel), 'utf8') } catch { continue }
        if (disk === blob.stdout) fs.rmSync(path.join(repoPath, rel))
      }
    }
    let merged = null
    for (let attempt = 0; merged === null && attempt < 6 && !midMerge(); attempt++) {
      if (attempt > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
      if (attempt > 0) healRacedIndex()
      merged = runGit(
        ['merge', '--no-ff', '-m', `chore(session): merge ${session.name} into main`, '-m', `Arxa-Stage: session ${id}`, session.branch],
        { cwd: repoPath, env, identity: STAGE_IDENTITY, allowFail: true },
      )
    }
    if (merged === null) {
      const conflicted = midMerge()
      runGit(['merge', '--abort'], { cwd: repoPath, env, allowFail: true })
      parkSession(repoPath, id, 'merge-conflict', env)
      throw new SessionMergeError(id, conflicted
        ? 'merge conflict with main'
        : 'main moved mid-merge (lost a land race) — the branch is intact, retry the land')
    }
  }
  // Keep the repo-level stage base (phase 3) on the new main tip so
  // main-side tooling still sees the last boundary.
  runGit(['update-ref', STAGE_BASE_REF, 'refs/heads/main'], { cwd: repoPath, env })

  // Boundary push (D18 via D69): the FIRST push happens only here — after
  // the green merge to main. Best-effort and never session-fatal (D23:
  // pushes fail loud in the RESULT, the local merge stands; nothing parks
  // for a push failure). No origin = a normal local-only state.
  // Non-interactive and bounded (2026-09-03, RESTO smoke): a bare `origin`
  // carries no credentials, so git fell back to a password prompt on the
  // launcher's TTY and the synchronous push froze the engine. Callers that
  // hold credentials (git-card via github-link) pass `pushUrl` — the
  // token-bearing origin URL — and the push goes by explicit refspec (`-u`
  // needs a remote NAME, not a URL; tracking was set at publish time).
  let push = { pushed: false, reason: 'no-origin' }
  const origin = getOrigin(repoPath, env)
  if (origin !== null) {
    const pushEnv = { ...env, GIT_TERMINAL_PROMPT: '0' }
    const args = typeof pushUrl === 'string' && pushUrl !== ''
      ? ['push', pushUrl, 'refs/heads/main:refs/heads/main']
      : ['push', '-u', 'origin', 'main']
    const pushed = runGit(args, { cwd: repoPath, env: pushEnv, allowFail: true, timeout: 90_000 })
    push = pushed !== null ? { pushed: true, origin } : { pushed: false, reason: 'push-failed' }
  }

  return { ...squash, gate, merged: true, parked: false, session, push }
}

/** User holds a session's work back from main (parks it; D40: never deleted). */
export function holdSession(repoPath, id, env = process.env) {
  return parkSession(sessionRepoFor(repoPath, id, env), id, 'held', env) // D98 preamble
}

// ---- archive / revive ------------------------------------------------------

/**
 * Archive (D39/D40): flag the session out of active views (see
 * `archivedSessionIds`), take a final WIP commit so nothing uncommitted
 * is lost, prune the worktree — and KEEP the branch. Unmerged work
 * stays parked on it forever until revived; nothing is auto-deleted.
 *
 * @returns {{ id, state, branch }}
 */
export function archiveSession(repoPath, id, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state === 'archived') return session
  if (fs.existsSync(session.worktree)) {
    wipCommit(session.worktree, { message: 'archive snapshot', env })
    runGit(['worktree', 'remove', session.worktree], { cwd: repoPath, env })
  } else {
    runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
  }
  pruneEmptyWorktreeParents(session.worktree)
  session.state = 'archived'
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Revive (D39/D40): recreate the worktree from the parked branch and
 * continue from parked state. The branch was never deleted, so the full
 * session history (including any unmerged work) is exactly where the
 * archive left it.
 *
 * @returns {{ id, state, worktree }}
 */
export function reviveSession(repoPath, id, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = getSession(registry, id)
  if (session.state === 'open') return session
  if (!fs.existsSync(session.worktree)) {
    fs.mkdirSync(path.dirname(session.worktree), { recursive: true })
    runGit(['worktree', 'add', session.worktree, session.branch], { cwd: repoPath, env })
  }
  session.state = 'open'
  session.parkedReason = null
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Drop (grilled 2026-09-02, Q3): a session that was opened but never used —
 * no user message ever landed in its conversation — is not resumed on
 * relaunch; it is removed outright so no orphan row survives. Worktree
 * (force: a never-typed-in session has no work worth a WIP snapshot),
 * branch, squash-base ref and registry row all go. Idempotent: an unknown
 * id is a `dropped:false` result, never a throw — boot cleanup must never
 * fail the boot.
 *
 * @returns {{ id, dropped: boolean, worktree?: string, branch?: string }}
 */
export function dropSession(repoPath, id, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = registry.sessions.find((s) => s.id === id)
  if (!session) return { id, dropped: false }
  // Task 10 (A4): the forced drop deletes the branch — the only other
  // handle on container-only commits besides the recovery ref. Same gate as
  // finishSession: refuse while container work is unrecovered.
  const container = unrecoveredContainerCommits(repoPath, id)
  if (container.unrecovered > 0) {
    throw new Error(`session "${id}" (${session.branch}) cannot be dropped — container-work-unrecovered: bring the container commits back to ${container.recoveryRef} first`)
  }

  // Task 11 (A5): the microVM twin of the guard above.
  const sandbox = unrecoveredSandboxCommits(repoPath, id)
  if (sandbox.unrecovered > 0) {
    throw new Error(`session "${id}" (${session.branch}) cannot be dropped — sandbox-work-unrecovered: bring the sandbox commits back to ${sandbox.recoveryRef} first`)
  }
  if (session.worktree && fs.existsSync(session.worktree)) {
    runGit(['worktree', 'remove', '--force', session.worktree], { cwd: repoPath, env, allowFail: true })
  }
  runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
  if (session.branch) runGit(['branch', '-D', session.branch], { cwd: repoPath, env, allowFail: true })
  runGit(['update-ref', '-d', `${SESSION_BASE_PREFIX}${id}`], { cwd: repoPath, env, allowFail: true })
  registry.sessions = registry.sessions.filter((s) => s.id !== id)
  writeRegistry(repoPath, registry, env)
  return { id, dropped: true, worktree: session.worktree, branch: session.branch }
}

// ---- archives → trash tier (D39/D40 + D47, 2026-09-05 grill) ---------------

/**
 * Remove ONLY the registry row — the archives row's Move-to-Trash half. The
 * branch, the squash-base ref and (already pruned at archive time) the
 * worktree stay untouched so the trash entry can restore the row or purge
 * the refs later; D40's "never auto-deleted" holds until the trash's own
 * purge door. The caller snapshots the returned row into the trash manifest
 * FIRST (crash-safe: an entry without a row is restorable; a row without an
 * entry is an orphan the archives row no longer lists).
 *
 * @returns the removed row (the trash manifest's payload).
 */
export function removeSessionRow(repoPath, id, env = process.env) {
  repoPath = sessionRepoFor(repoPath, id, env) // D98 repo-discovery preamble
  const registry = readRegistry(repoPath, env)
  const session = registry.sessions.find((s) => s.id === id)
  if (!session) throw new Error(`unknown session "${id}"`)
  registry.sessions = registry.sessions.filter((s) => s.id !== id)
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Re-add a registry row verbatim — the trash's session-restore half. The
 * branch never moved (only the row did), so restore is row bookkeeping, not
 * git surgery; the caller verifies the branch first and refuses loudly when
 * it is gone. A row with the same id (restored twice, hand-edited registry)
 * is REPLACED, never duplicated.
 *
 * @returns the row as written.
 */
export function restoreSessionRow(repoPath, session, env = process.env) {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || session.id === '') {
    throw new Error('restoreSessionRow: a session row with an id is required')
  }
  // sessionRepoFor cannot route a row that is not in any registry — the
  // caller passes the OWNING repo path (recorded in the trash manifest).
  const registry = readRegistry(repoPath, env)
  registry.sessions = registry.sessions.filter((s) => s.id !== session.id)
  registry.sessions.push(session)
  writeRegistry(repoPath, registry, env)
  return session
}

/**
 * Drop a session's git refs when NO registry row exists anymore — the trash
 * purge door. `dropSession` needs the row; by purge time the row lives only
 * in the trash manifest. An optional `worktree` (the manifest snapshot's
 * path) is force-removed first: an archived session's worktree is normally
 * already pruned, but a crash between archive steps (or a hand-restored
 * checkout) can leave one holding the branch checked out — and `branch -D`
 * refuses a checked-out branch (seen in the 2026-09-05 selftest). Branch
 * `-D` plus the squash-base ref delete, each reported honestly (false =
 * already gone, never a throw — purge must not fail because a ref it was
 * asked to remove is missing).
 *
 * @returns {{ id, branch, branchDropped, baseRefDropped }}
 */
export function dropSessionRefs(repoPath, { id, branch, worktree }, env = process.env) {
  const out = { id, branch: branch ?? null, branchDropped: false, baseRefDropped: false }
  if (worktree && fs.existsSync(worktree)) {
    runGit(['worktree', 'remove', '--force', worktree], { cwd: repoPath, env, allowFail: true })
    runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
  }
  if (typeof branch === 'string' && branch !== '') {
    out.branchDropped = runGit(['branch', '-D', branch], { cwd: repoPath, env, allowFail: true }) !== null
  }
  if (typeof id === 'string' && id !== '') {
    out.baseRefDropped = runGit(['update-ref', '-d', `${SESSION_BASE_PREFIX}${id}`], { cwd: repoPath, env, allowFail: true }) !== null
  }
  return out
}
