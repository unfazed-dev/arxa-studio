// Open-org follow loop: watches the ON-DISK open-org truth and keeps exactly
// one per-org server alive for it (D7: "spawned on org mount, killed on org
// switch").
//
// Why on-disk: the lifecycle instance (and its open-org handle) lives inside
// the arxa-sidebar host half — instance memory no other plugin can read. The
// durable truth is the shell-lock holder the lifecycle itself writes on open:
// <org>/.arxa/locks/<slug>.lock = { pid, orgPath, startedAt } (same-pid
// reentrant, released on close). An org counts as open iff its lock exists
// AND the holder pid is alive (shell-lock staleness rule mirrors this).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Inline (was a relative import of workspace/lib/root.js): pnpm's virtual
// store copies file: deps, so cross-package RELATIVE imports break at boot
// in installed profiles (measured 2026-08-31). arxaHome is one line.
function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** The open org from disk, or null. Pure fs — no locks taken, no git. */
export function readOpenOrg(env = process.env) {
  let orgs = []
  try {
    orgs = JSON.parse(fs.readFileSync(path.join(arxaHome(env), 'organisation.json'), 'utf8')).orgs ?? []
  } catch { return null }
  for (const org of orgs) {
    if (typeof org !== 'string' || org === '') continue
    const slug = path.basename(org)
    let holder = null
    try {
      holder = JSON.parse(fs.readFileSync(path.join(org, '.arxa', 'locks', slug + '.lock'), 'utf8'))
    } catch { continue }
    if (Number.isInteger(holder?.pid) && pidAlive(holder.pid)) {
      return { orgPath: typeof holder.orgPath === 'string' ? holder.orgPath : org, slug }
    }
  }
  return null
}

/** Every Freestyle root with open:true, from ~/.arxa/freestyle.json. Defensive:
 * a missing or unparseable registry means "no Freestyle roots", never throws
 * (registry shape/identity convention: plugins/arxa-freestyle/lib/roots.js). */
function readOpenFreestyleRoots(env) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(arxaHome(env), 'freestyle.json'), 'utf8'))
    const rows = Array.isArray(j.roots) ? j.roots : []
    return rows.filter((r) => r && r.open === true && typeof r.id === 'string' && typeof r.path === 'string')
  } catch { return [] }
}

/** Every open request identity, including aliases that share one physical
 * path. Server/watcher lifecycle uses readOpenRoots() below to dedupe paths;
 * request authorization must retain the registry id the UI put on the wire. */
export function readOpenRootAliases(env = process.env) {
  const roots = []
  const org = readOpenOrg(env)
  if (org) roots.push({ id: org.slug, path: org.orgPath, slug: org.slug, kind: 'org', name: org.slug })
  for (const r of readOpenFreestyleRoots(env)) {
    roots.push({ id: r.id, path: r.path, slug: path.basename(r.path), kind: 'freestyle', name: typeof r.name === 'string' && r.name ? r.name : path.basename(r.path) })
  }
  return roots
}

/** Resolve an explicit open root id. Duplicate ids are ambiguous and fail
 * closed; an omitted id retains the legacy open-org default. */
export function readOpenRoot(env = process.env, rootId = null) {
  const aliases = readOpenRootAliases(env)
  if (typeof rootId !== 'string' || rootId === '') return aliases.find((r) => r.kind === 'org') ?? null
  const matches = aliases.filter((r) => r.id === rootId)
  return matches.length === 1 ? matches[0] : null
}

/**
 * Freestyle-section Task 8: every root the viewer should follow — the open
 * org first (if any), then every open Freestyle root. Pure fs, no locks, no
 * git; never throws (a broken freestyle.json degrades to "no Freestyle
 * roots", the org path keeps working).
 * @returns {{ id: string, path: string, slug: string, kind: 'org'|'freestyle', name: string }[]}
 */
export function readOpenRoots(env = process.env) {
  const roots = []
  const seen = new Set()
  for (const r of readOpenRootAliases(env)) {
    // A Freestyle root can point at the same folder as the open org (a
    // project nested in a Freestyle root, or a stray duplicate registry
    // row). First-wins keeps the org's identity — two servers on one path
    // would orphan a socket in startRootFollow and, worse, current() would
    // stop reporting kind:'org', so getOrigin() would go null forever and
    // the org read lane would 503 permanently. Org was pushed first above.
    const key = path.resolve(r.path)
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(r)
  }
  return roots
}

/**
 * Poll open-root truth (readOpenRoots) and reconcile one server per open
 * root — org and every open Freestyle root alike.
 * createServer is injectable for tests ({ orgRoot, orgSlug } -> { origin, close() }).
 * Returns { stop(), current() }; current() is the array of roots being
 * served, each with its handle's origin attached. Never throws into the poll
 * loop; a single root's open() failing does not stop the others from
 * reconciling (a deliberate divergence from the old single-org wrapper,
 * which had only one root to lose).
 */
export function startRootFollow({ env = process.env, intervalMs = 2000, createServer, log = () => {}, onServing = null }) {
  const serving = new Map() // path -> { root, handle }
  let switching = false
  let stopped = false

  function current() {
    return [...serving.values()].map((e) => ({ ...e.root, origin: e.handle.origin }))
  }

  async function reconcile() {
    if (stopped || switching) return
    const want = readOpenRoots(env)
    const wantByPath = new Map(want.map((r) => [r.path, r]))
    const toClose = [...serving.keys()].filter((p) => !wantByPath.has(p))
    const toOpen = want.filter((r) => !serving.has(r.path))
    if (toClose.length === 0 && toOpen.length === 0) return
    switching = true
    try {
      for (const p of toClose) {
        const entry = serving.get(p)
        serving.delete(p)
        await entry.handle.close().catch((err) => log('close failed for ' + p + ': ' + err.message))
        log('root server closed: ' + p)
      }
      for (const r of toOpen) {
        try {
          const handle = await createServer({ orgRoot: r.path, orgSlug: r.slug })
          serving.set(r.path, { root: r, handle })
          log('root server serving ' + r.path + ' at ' + handle.origin)
        } catch (err) {
          log('reconcile failed to open ' + r.path + ': ' + (err && err.message))
        }
      }
    } finally {
      switching = false
      if (onServing) { try { onServing(current()) } catch {} }
    }
  }

  const timer = setInterval(() => { void reconcile() }, intervalMs)
  void reconcile()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
      return Promise.all([...serving.values()].map((e) => e.handle.close()))
    },
    current,
  }
}

/**
 * Backward-compat wrapper over startRootFollow: the pre-Task-8 single-org
 * contract, unchanged for existing callers — current() returns
 * { orgPath, origin } | null, onServing(orgPath | null).
 * Returns { stop(), current() }; never throws into the poll loop.
 */
export function startOrgFollow({ env = process.env, intervalMs = 2000, createServer, log = () => {}, onServing = null }) {
  const rf = startRootFollow({
    env, intervalMs, log, createServer,
    onServing: onServing ? (roots) => {
      const org = roots.find((r) => r.kind === 'org')
      onServing(org ? org.path : null)
    } : null,
  })
  return {
    stop: () => rf.stop(),
    current() {
      const org = rf.current().find((r) => r.kind === 'org')
      return org ? { orgPath: org.path, origin: org.origin } : null
    },
  }
}
