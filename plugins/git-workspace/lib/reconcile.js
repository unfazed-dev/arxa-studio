// B7 — worktree ↔ registry ↔ git reconciliation
// (docs/plans/git-card-sessions-worktree-rewire.md B7, §9 items 4–6).
//
// Three sources of truth about a repo's session worktrees can drift apart:
//   - registry: sessions.json rows (`session.worktree`, `session.branch`)
//   - git:      what `git worktree list --porcelain` actually knows
//   - dirs:     directories physically present under `.arxa/worktrees`
//
// `reconcileWorktrees` is read-only: it produces a report and mutates
// nothing. `repairWorktrees` applies only the SAFE subset of that report —
// `git worktree prune` for entries git itself already flags prunable, and
// marking an orphaned-but-still-open registry row `state: 'detached'`
// (never deleting a row — D40's "parked branches are never auto-deleted"
// extends here: an orphaned row is evidence, not garbage). Everything else
// (a stray directory, a git worktree with no row, a branch mismatch, a
// row pointing at a missing directory) is reported only — a human decides.
//
// `git worktree remove --force` is deliberately never used here (per the
// plan's §9 item 5: only `Finish`/`Sweep`, both out of scope for B7, call
// `worktree remove`; reconciliation never removes a worktree a session
// might still want revived from).
//
// Porcelain parsing (§9 item 4): read `git worktree list --porcelain`
// rather than hand-rolling disk-vs-registry diffing — this exact bug class
// is filed against other tools' worktree features, so it is a known trap.
// The format (`git help worktree`, "Porcelain Format"): one block per
// worktree, separated by a blank line, each line a `<label>[ <value>]`
// pair. `branch`/`bare`/`detached` are mutually exclusive; `locked` and
// `prunable` are optional booleans that may carry a trailing reason.
//
// `SESSION_STATES` (sessions.js) does not currently include 'detached' and
// nothing in this repo validates a row's `state` against that frozen list
// (checked: only index.js re-exports it, and selftest.mjs reads it — no
// call site enforces membership). `annotateSession` merges fields with no
// validation, so writing `state: 'detached'` is safe today. If validation
// is ever added to sessions.js, 'detached' must be added to SESSION_STATES
// then — sessions.js is intentionally not touched by this module.

import fs from 'node:fs'
import path from 'node:path'
import { runGit } from './run.js'
import { listSessions, annotateSession, SESSIONS_DIR } from './sessions.js'

/**
 * Parse `git worktree list --porcelain` output into structured rows.
 *
 * @param {string} text
 * @returns {Array<{ path: string, head: string|null, branch: string|null,
 *   bare: boolean, detached: boolean, locked: string|true|null,
 *   prunable: string|true|null }>}
 */
export function parseWorktreePorcelain(text) {
  const out = []
  let cur = null
  const flush = () => { if (cur) out.push(cur) }
  for (const line of String(text || '').split('\n')) {
    if (line === '') { flush(); cur = null; continue }
    const sp = line.indexOf(' ')
    const key = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : line.slice(sp + 1)
    if (key === 'worktree') {
      flush()
      cur = { path: value, head: null, branch: null, bare: false, detached: false, locked: null, prunable: null }
      continue
    }
    if (!cur) continue // stray/unexpected line outside a block — ignore, never throw
    switch (key) {
      case 'HEAD': cur.head = value; break
      case 'branch': cur.branch = value; break
      case 'bare': cur.bare = true; break
      case 'detached': cur.detached = true; break
      case 'locked': cur.locked = value || true; break
      case 'prunable': cur.prunable = value || true; break
      default: break // forward-compatible: unknown attributes are ignored
    }
  }
  flush()
  return out
}

/**
 * Resolve a path the way git itself does for worktree comparison (realpath
 * on the nearest existing ancestor) so a symlinked tmp root (macOS
 * `/tmp` → `/private/tmp`) or a moved directory does not read as drift
 * that isn't there. Never throws — falls back to plain `path.resolve`.
 */
function resolvePath(p) {
  const abs = path.resolve(String(p))
  const parts = []
  let cur = abs
  for (;;) {
    try {
      const real = fs.realpathSync(cur)
      return parts.length ? path.join(real, ...parts.slice().reverse()) : real
    } catch {
      const parent = path.dirname(cur)
      if (parent === cur) return abs
      parts.push(path.basename(cur))
      cur = parent
    }
  }
}

function listGitWorktrees(repoPath, env) {
  const out = runGit(['worktree', 'list', '--porcelain'], { cwd: repoPath, env, allowFail: true })
  return parseWorktreePorcelain(out || '')
}

function listDirEntries(worktreesDir) {
  if (!fs.existsSync(worktreesDir)) return []
  return fs.readdirSync(worktreesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

function branchName(ref) {
  return ref ? ref.replace(/^refs\/heads\//, '') : null
}

/**
 * Report-only reconciliation of registry ↔ git ↔ disk for a repo's session
 * worktrees. Mutates nothing.
 *
 * @param {string} repoPath
 * @param {{ env?: object, worktreesDir?: string }} [opts]
 * @returns {{ registry: number, git: number, dirs: number, drift: Array<{
 *   kind: 'registry-without-git'|'git-without-registry'|'dir-without-git'|
 *         'git-prunable'|'branch-mismatch'|'registry-without-dir',
 *   id?: string, path: string, detail: string }> }}
 */
export function reconcileWorktrees(repoPath, { env = process.env, worktreesDir } = {}) {
  const dir = worktreesDir || path.join(repoPath, SESSIONS_DIR)
  const sessions = listSessions(repoPath, env)
  const gitWorktrees = listGitWorktrees(repoPath, env)
  const dirNames = listDirEntries(dir)

  const gitByPath = new Map()
  for (const w of gitWorktrees) gitByPath.set(resolvePath(w.path), w)

  const drift = []
  const registryPaths = new Set()

  for (const s of sessions) {
    const resolved = resolvePath(s.worktree)
    registryPaths.add(resolved)
    const gw = gitByPath.get(resolved)

    if (!gw) {
      drift.push({
        kind: 'registry-without-git',
        id: s.id,
        path: s.worktree,
        detail: `registry row "${s.id}" (state: ${s.state}) has no matching entry in \`git worktree list\``,
      })
    } else {
      if (gw.prunable) {
        drift.push({
          kind: 'git-prunable',
          id: s.id,
          path: s.worktree,
          detail: typeof gw.prunable === 'string' ? gw.prunable : 'git reports this worktree as prunable',
        })
      }
      const gitBranch = branchName(gw.branch)
      const rowBranch = branchName(s.branch)
      if (!gw.bare && !gw.detached && rowBranch && gitBranch && rowBranch !== gitBranch) {
        drift.push({
          kind: 'branch-mismatch',
          id: s.id,
          path: s.worktree,
          detail: `registry branch "${rowBranch}" != git branch "${gitBranch}"`,
        })
      }
    }

    if (!fs.existsSync(s.worktree)) {
      drift.push({
        kind: 'registry-without-dir',
        id: s.id,
        path: s.worktree,
        detail: `registry row "${s.id}" points at a directory that no longer exists`,
      })
    }
  }

  const repoResolved = resolvePath(repoPath)
  for (const w of gitWorktrees) {
    const resolved = resolvePath(w.path)
    if (resolved === repoResolved) continue // the primary worktree is never a session row
    if (!registryPaths.has(resolved)) {
      drift.push({
        kind: 'git-without-registry',
        path: w.path,
        detail: `git knows a worktree at "${w.path}" with no registry row` + (w.prunable ? ' (also prunable)' : ''),
      })
    }
  }

  const gitPaths = new Set(gitByPath.keys())
  for (const name of dirNames) {
    const dirPath = path.join(dir, name)
    if (!gitPaths.has(resolvePath(dirPath))) {
      drift.push({
        kind: 'dir-without-git',
        path: dirPath,
        detail: `directory "${name}" under ${dir} is not a worktree \`git worktree list\` knows about`,
      })
    }
  }

  return { registry: sessions.length, git: gitWorktrees.length, dirs: dirNames.length, drift }
}

/**
 * Apply only the SAFE repairs from a `reconcileWorktrees` report:
 *   - `git-prunable`         → `git worktree prune` (once, covers all of them)
 *   - `registry-without-git` → mark an `open` row `state: 'detached'`
 *   - everything else        → report only, never touched
 *
 * `git worktree remove --force` is never called. Default is dry-run: no
 * git command and no registry write happens unless `dryRun: false`.
 *
 * @param {string} repoPath
 * @param {{ drift: Array }} report
 * @param {{ env?: object, dryRun?: boolean }} [opts]
 * @returns {{ applied: Array, skipped: Array }}
 */
export function repairWorktrees(repoPath, report, { env = process.env, dryRun = true } = {}) {
  const applied = []
  const skipped = []
  const sessions = dryRun ? null : listSessions(repoPath, env)
  let pruned = false

  for (const d of report.drift) {
    if (d.kind === 'git-prunable') {
      if (dryRun) {
        applied.push({ ...d, action: 'would-prune' })
      } else {
        if (!pruned) {
          runGit(['worktree', 'prune'], { cwd: repoPath, env, allowFail: true })
          pruned = true
        }
        applied.push({ ...d, action: 'pruned' })
      }
      continue
    }

    if (d.kind === 'registry-without-git') {
      if (dryRun) {
        applied.push({ ...d, action: 'would-mark-detached' })
        continue
      }
      const session = sessions.find((s) => s.id === d.id)
      if (session && session.state === 'open') {
        annotateSession(repoPath, d.id, { state: 'detached' }, env)
        applied.push({ ...d, action: 'marked-detached' })
      } else {
        skipped.push({ ...d, reason: session ? `state is "${session.state}", not "open"` : 'registry row not found' })
      }
      continue
    }

    skipped.push({ ...d, reason: 'report-only drift kind' })
  }

  return { applied, skipped }
}
