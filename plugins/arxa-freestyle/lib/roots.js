// arxa-freestyle roots registry — ~/.arxa/freestyle.json (F1), one row per
// user-picked folder, each backed by its own plain git repo (F4) with the
// generic day-zero frame (F8, docs/plans/freestyle-section.md).
import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto'
import { registryPath, manifestPath } from './paths.js'
import { initPlainRepo } from '../../git-workspace/lib/repos.js'
import { writeFrameFiles } from '../../git-workspace/lib/frame.js'
import { wipCommit } from '../../git-workspace/lib/commits.js'

const EMPTY = () => ({ roots: [], ui: { activeTab: 'org' } })

/** { roots, ui } from disk, or the empty shape when unreadable/absent. */
export function readRegistry(env = process.env) {
  try { const j = JSON.parse(fs.readFileSync(registryPath(env), 'utf8')); return { roots: j.roots || [], ui: { activeTab: 'org', ...(j.ui || {}) } } } catch { return EMPTY() }
}

/** Atomic write (tmp + rename) so a crash mid-write never corrupts the registry. */
export function writeRegistry(reg, env = process.env) {
  const p = registryPath(env); fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n'); fs.renameSync(tmp, p)
}

export function listRoots(env = process.env) { return readRegistry(env).roots }
export function rootById(id, env = process.env) { return listRoots(env).find((r) => r.id === id) || null }

/** <root>/.arxa/freestyle.json, or null when absent/unreadable. */
export function readManifest(root) { try { return JSON.parse(fs.readFileSync(manifestPath(root.path), 'utf8')) } catch { return null } }

/** Merge `patch` into the manifest (creating defaults on first write). */
export function writeManifest(root, patch) {
  const p = manifestPath(root.path); fs.mkdirSync(path.dirname(p), { recursive: true })
  const cur = readManifest(root) || { id: root.id, kind: 'freestyle', name: root.name, createdAt: new Date().toISOString(), localOnly: true, repoOwner: null, repoName: null, repoUrl: null }
  const next = { ...cur, ...patch }; fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n'); return next
}

/** Read-modify-write helper: reads the registry, lets `fn` mutate it in place, writes it back. */
function mutate(env, fn) { const reg = readRegistry(env); const out = fn(reg); writeRegistry(reg, env); return out }

/**
 * F1+F4+F8: register a folder as a Freestyle root, adopt or init its repo,
 * write the manifest and the day-zero frame. Idempotent on path — adding
 * the same folder twice returns the existing row.
 * @returns {object} the root row
 */
export function addRoot(absPath, { env = process.env, name } = {}) {
  // path.resolve, NOT fs.realpathSync: a stored row.path must stay the path
  // the caller (and, later, the UI) actually gave — realpath-ing it would
  // silently rewrite it to the OS's canonical form (e.g. macOS's tmp dirs:
  // /var/... -> /private/var/...), breaking identity for every later lookup
  // by path. git/fs calls below resolve any intermediate symlink themselves;
  // callers that need canonicalization (resolveInside's escape checks) do
  // their own realpath at the point they need it.
  const real = path.resolve(absPath)
  if (!fs.statSync(real).isDirectory()) throw new Error('not-a-directory: ' + absPath)
  const row = mutate(env, (reg) => {
    let r = reg.roots.find((x) => x.path === real)
    if (!r) {
      r = { id: randomUUID(), name: name || path.basename(real), path: real, addedAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), open: true }
      reg.roots.push(r)
    }
    initPlainRepo(real, env)
    const existing = readManifest(r); if (existing?.id) r.id = existing.id
    writeManifest(r, { name: r.name })
    writeFrameFiles(real, 'freestyle')
    return r
  })
  // writeFrameFiles writes check.sh into the working tree AFTER
  // initPlainRepo's first commit, so it lands untracked — this WIP commit
  // is what makes a freshly added root come back clean.
  wipCommit(real, { message: 'chore: arxa freestyle frame', env })
  return row
}

/** mkdir then addRoot; refuses an existing target so callers never adopt by accident. */
export function newRoot(parentAbs, name, { env = process.env } = {}) {
  const target = path.join(parentAbs, name)
  if (fs.existsSync(target)) throw new Error('exists: ' + target)
  fs.mkdirSync(target, { recursive: true })
  return addRoot(target, { env, name })
}

export function openRoot(id, env = process.env) {
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = true; r.lastOpenedAt = new Date().toISOString(); return r })
}

export function closeRoot(id, env = process.env) {
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = false; return r })
}

/** Registry only — never deletes anything on disk. */
export function forgetRoot(id, env = process.env) {
  return mutate(env, (reg) => { const i = reg.roots.findIndex((x) => x.id === id); if (i < 0) throw new Error('unknown-root'); const [r] = reg.roots.splice(i, 1); return r })
}

/** Display-only: the folder on disk never moves. */
export function renameRoot(id, name, env = process.env) {
  const clean = String(name || '').trim(); if (!clean) throw new Error('name-required')
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.name = clean; writeManifest(r, { name: clean }); return r })
}

export function setActiveTab(tab, env = process.env) {
  if (tab !== 'org' && tab !== 'freestyle') throw new Error('bad-tab')
  return mutate(env, (reg) => { reg.ui.activeTab = tab; return reg.ui })
}
