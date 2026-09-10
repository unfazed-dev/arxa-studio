/**
 * arxa-dashboard — tier-1 local git/file figures for a row (plan §4 step 3).
 *
 * Pure over a `run(args, cwd) → string | null` git runner (git-workspace's
 * runGit with allowFail, injected so the selftest can drive a temp repo and
 * the host never spawns git itself). Every reader degrades to zeros / null
 * on an empty or unreadable repo — a dashboard never throws for a row.
 *
 * Scope (plan §3): an org row rolls up the org repo plus every projects/<x>
 * with its own .git; a category row is the org repo restricted to that
 * folder (git pathspec); a project row is its own repo.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const RANGES = Object.freeze({ 30: '30 days', 90: '90 days', 365: '365 days', all: null })

/** `range` from the browser (30 | 90 | 365 | 'all', default 90) → git --since expression or null. */
export function sinceFor(range) {
  const key = range === 'all' ? 'all' : Number(range)
  return key in RANGES ? RANGES[key] : RANGES[90]
}

/** The repos (path + optional pathspec) a resolveRow() result reads. */
export function reposFor(row) {
  if (row.kind === 'project') return [{ path: row.path, pathspec: null, name: row.name }]
  if (row.kind === 'category') return [{ path: row.orgPath, pathspec: row.name, name: row.name }]
  const out = [{ path: row.path, pathspec: null, name: row.name }]
  const projects = join(row.path, 'projects')
  let names = []
  try { names = readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { names = [] }
  for (const n of names.sort()) if (existsSync(join(projects, n, '.git'))) out.push({ path: join(projects, n), pathspec: null, name: n })
  return out
}

const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const addDays = (day, n) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d) }
const spec = (r) => (r.pathspec ? ['--', r.pathspec] : [])

/** Commit count per local day across `repos` (merged), within `since`. */
export function dayCounts(run, repos, since) {
  const counts = new Map()
  for (const r of repos) {
    const out = run(['log', '--date=short', '--pretty=%ad', ...(since ? ['--since=' + since] : []), ...spec(r)], r.path)
    if (!out) continue
    for (const day of out.split('\n')) if (day) counts.set(day, (counts.get(day) || 0) + 1)
  }
  return counts
}

/** Same streak rule as git-workspace commitDays: today, else the run ending yesterday. */
export function streaks(counts, today = ymd(new Date())) {
  let current = 0
  let cursor = counts.has(today) ? today : addDays(today, -1)
  while (counts.has(cursor)) { current++; cursor = addDays(cursor, -1) }
  let longest = 0; let run = 0; let prev = null
  for (const day of [...counts.keys()].sort()) { run = prev !== null && addDays(prev, 1) === day ? run + 1 : 1; longest = Math.max(longest, run); prev = day }
  return { current, longest }
}

/** `n` seven-day buckets ending today (oldest first) — the bars under the heatmap. */
export function weekly(counts, n = 13, today = ymd(new Date())) {
  const out = new Array(n).fill(0)
  for (const [day, c] of counts) {
    const diff = Math.round((new Date(today + 'T00:00:00') - new Date(day + 'T00:00:00')) / 86400000)
    if (diff < 0) continue
    const idx = n - 1 - Math.floor(diff / 7)
    if (idx >= 0) out[idx] += c
  }
  return out
}

/** Commits in the window BEFORE this one, of the same length — the delta
  * chip's baseline (§14 Q9). `all` has no previous window, and a range we
  * cannot parse has none either: null, never 0. Zero would claim we looked
  * and found nothing. */
export function previousWindow(run, repos, since) {
  const n = parseInt(since, 10)
  if (!since || !Number.isFinite(n) || n <= 0) return null
  let commits = 0
  for (const r of repos) {
    const out = run(['log', '--date=short', '--pretty=%ad', '--since=' + (n * 2) + ' days', '--until=' + n + ' days ago', ...spec(r)], r.path)
    if (!out) continue
    for (const day of out.split('\n')) if (day) commits += 1
  }
  return commits
}

export function activityOf(run, repos, { since = RANGES[90], today } = {}) {
  const counts = dayCounts(run, repos, since)
  const days = [...counts.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => (a.day < b.day ? -1 : 1))
  let commits = 0
  for (const c of counts.values()) commits += c
  return { since, days, commits, prevCommits: previousWindow(run, repos, since), ...streaks(counts, today), weeks: weekly(counts, 13, today) }
}

const uniq = (s) => (s ? s.split('\n').filter(Boolean) : [])
/** A nested repo (projects/<x>/.git) shows up in the org repo as an untracked "dir/" line — it is counted as its own repo, not here. */
const nestedRepo = (root, entry) => entry.endsWith('/') && existsSync(join(root, entry, '.git'))

export function repositoryOf(run, repos, { since = RANGES[90] } = {}) {
  let files = 0; let branches = 0
  const folders = new Set(); const authors = new Set()
  const dirty = { modified: 0, added: 0, deleted: 0, untracked: 0 }
  let last = null
  for (const r of repos) {
    for (const f of uniq(run(['ls-files', '--cached', '--others', '--exclude-standard', ...spec(r)], r.path))) {
      if (nestedRepo(r.path, f)) continue
      files++
      const i = f.lastIndexOf('/')
      if (i > 0) folders.add(r.name + ':' + f.slice(0, i))
    }
    if (!r.pathspec) branches += uniq(run(['branch', '--list', '--format=%(refname:short)'], r.path)).length
    for (const a of uniq(run(['log', '--pretty=%an', ...(since ? ['--since=' + since] : []), ...spec(r)], r.path))) authors.add(a)
    for (const line of uniq(run(['status', '--porcelain', '--untracked-files=all', ...spec(r)], r.path))) {
      const x = line.slice(0, 2)
      if (x === '??' && nestedRepo(r.path, line.slice(3))) continue
      if (x === '??') dirty.untracked++
      else if (x.includes('D')) dirty.deleted++
      else if (x.includes('A')) dirty.added++
      else dirty.modified++
    }
    const head = run(['log', '-1', '--pretty=%h%x1f%an%x1f%aI%x1f%s', ...spec(r)], r.path)
    if (head) {
      const [sha, author, at, subject] = head.split('\x1f')
      if (!last || Date.parse(at) > Date.parse(last.at)) last = { sha, author, at, subject, repo: r.name }
    }
  }
  return { files, folders: folders.size, branches, contributors: authors.size, lastCommit: last, dirty, repos: repos.length }
}

/** created = folder birth time, updated = newest of last commit / folder mtime. ISO strings or null. */
export function timesOf(path, lastCommitAt) {
  let st = null
  try { st = statSync(path) } catch { st = null }
  const created = st ? new Date(st.birthtimeMs || st.ctimeMs).toISOString() : null
  const cands = [st ? st.mtimeMs : 0, lastCommitAt ? Date.parse(lastCommitAt) : 0].filter((n) => Number.isFinite(n) && n > 0)
  return { createdAt: created, updatedAt: cands.length ? new Date(Math.max(...cands)).toISOString() : null }
}
