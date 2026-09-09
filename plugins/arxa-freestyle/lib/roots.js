// arxa-freestyle roots registry — ~/.arxa/freestyle.json (F1), one row per
// user-picked folder, each backed by its own plain git repo (F4) with the
// generic day-zero frame (F8, docs/plans/freestyle-section.md).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { randomUUID } from 'node:crypto'
import { arxaHome, registryPath, manifestPath } from './paths.js'
import { slugify } from '../../workspace/lib/slug.js'
import { initPlainRepo, pushRepoAsync, setOrigin } from '../../git-workspace/lib/repos.js'
import { protectionPayload, settingsPayload, writeFrameFiles } from '../../git-workspace/lib/frame.js'
import { wipCommit } from '../../git-workspace/lib/commits.js'

const EMPTY = () => ({ roots: [], rootTrash: [], ui: { activeTab: 'org' } })

/**
 * Every exported function below takes options `{ env }`, never `env`
 * positionally. This guard makes the other shape loud instead of silent: a
 * raw env object (e.g. `{ ...process.env, ARXA_HOME: tmp }`) passed where
 * `opts` goes has no `env` key, so a naive `{ env = process.env } = opts`
 * destructure falls through to the REAL process.env with no error — writing
 * to the user's actual `~/.arxa/freestyle.json` from what looked like a
 * scoped test/call. PATH/HOME/ARXA_HOME are presence-checked because any
 * real env object carries at least one; a genuine `{ env }` bag never does.
 */
function resolveEnv(opts) {
  const o = opts || {}
  if (typeof o === 'object' && !('env' in o) && ('PATH' in o || 'HOME' in o || 'ARXA_HOME' in o)) {
    throw new Error('roots.js takes { env }')
  }
  return o.env || process.env
}

/** { roots, rootTrash, ui } from disk, or the empty shape when unreadable/absent.
 *  Every key the registry keeps must be listed here: this is the only reader,
 *  and `mutate` writes back what it returns, so an omitted key is erased on
 *  the next write rather than preserved. */
export function readRegistry(opts = {}) {
  const env = resolveEnv(opts)
  try { const j = JSON.parse(fs.readFileSync(registryPath(env), 'utf8')); return { roots: j.roots || [], rootTrash: j.rootTrash || [], ui: { activeTab: 'org', ...(j.ui || {}) } } } catch { return EMPTY() }
}

/** Atomic write (tmp + rename) so a crash mid-write never corrupts the registry. */
export function writeRegistry(reg, opts = {}) {
  const env = resolveEnv(opts)
  const p = registryPath(env); fs.mkdirSync(path.dirname(p), { recursive: true })
  const tmp = p + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n'); fs.renameSync(tmp, p)
}

export function listRoots(opts = {}) { return readRegistry(opts).roots }
export function rootById(id, opts = {}) { return listRoots(opts).find((r) => r.id === id) || null }
export function listRootTrash(opts = {}) { return readRegistry(opts).rootTrash }

/** <root>/.arxa/freestyle.json, or null when absent/unreadable. */
export function readManifest(root) { try { return JSON.parse(fs.readFileSync(manifestPath(root.path), 'utf8')) } catch { return null } }

/** Merge `patch` into the manifest (creating defaults on first write). */
export function writeManifest(root, patch) {
  const p = manifestPath(root.path); fs.mkdirSync(path.dirname(p), { recursive: true })
  const cur = readManifest(root) || { id: root.id, kind: 'freestyle', name: root.name, createdAt: new Date().toISOString(), localOnly: true, repoOwner: null, repoName: null, repoUrl: null }
  const next = { ...cur, ...patch }; fs.writeFileSync(p, JSON.stringify(next, null, 2) + '\n'); return next
}

/** Read-modify-write helper: reads the registry, lets `fn` mutate it in place, writes it back. */
function mutate(env, fn) { const reg = readRegistry({ env }); const out = fn(reg); writeRegistry(reg, { env }); return out }

/**
 * F1+F4+F8: register a folder as a Freestyle root, adopt or init its repo,
 * write the manifest and the day-zero frame. Idempotent on path — adding
 * the same folder twice returns the existing row.
 * @returns {object} the root row
 */
export function addRoot(absPath, opts = {}) {
  const env = resolveEnv(opts)
  const name = opts.name
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

/**
 * The org create contract, mirrored (parity ruling 2026-09-09,
 * docs/plans/freestyle-org-parity.md; org side: arxa-sidebar `org.create-at`):
 * `path` is ALWAYS the parent, the folder is ALWAYS parent + slug(name), a
 * non-empty target is a hard refusal (never merge, never version foreign files
 * unasked), the parent is remembered for the next modal, and `link` publishes
 * at once. Only the scaffold differs — addRoot writes the generic frame, never
 * the org tree — which is the whole reason Freestyle exists.
 * @returns {Promise<object>} the root row
 */
export async function createRoot({ name, path: parent, link = true } = {}, opts = {}) {
  const env = resolveEnv(opts)
  const nm = String(name || '').trim(); if (!nm) throw new Error('folder name required')
  const requested = String(parent || '').trim(); if (!requested) throw new Error('folder path required')
  const expanded = requested.startsWith('~') ? path.join(os.homedir(), requested.slice(1)) : path.resolve(requested)
  const slug = slugify(nm)
  if (slug === 'untitled') throw new Error('folder name has no slug: ' + nm)
  const target = path.join(expanded, slug)
  let entries = 0; try { entries = fs.readdirSync(target).length } catch { entries = 0 }
  if (entries > 0) throw new Error('folder-exists: ' + target + ' already exists and is not empty')
  fs.mkdirSync(target, { recursive: true })
  const root = addRoot(target, { env, name: nm })
  // ponytail: the org host writes the same file under os.homedir()/.arxa —
  // identical in production, ARXA_HOME-scoped here so selftests stay contained.
  try { fs.mkdirSync(arxaHome(env), { recursive: true }); fs.writeFileSync(path.join(arxaHome(env), 'create-root.json'), JSON.stringify({ root: requested }, null, 2)) } catch { /* best-effort memory */ }
  if (link) {
    // The folder exists and is registered whatever happens next: a refused
    // publish surfaces in the modal, and the row menu can publish later.
    const pub = await publishRoot(root, { github: opts.github, env })
    if (!pub.ok) throw new Error(pub.reason === 'github-unlinked' ? 'linked-required' : 'publish failed: ' + pub.reason)
  }
  return root
}

/** mkdir then addRoot; refuses an existing target so callers never adopt by accident. */
export function newRoot(parentAbs, name, opts = {}) {
  const env = resolveEnv(opts)
  const target = path.join(parentAbs, name)
  if (fs.existsSync(target)) throw new Error('exists: ' + target)
  fs.mkdirSync(target, { recursive: true })
  return addRoot(target, { env, name })
}

export function openRoot(id, opts = {}) {
  const env = resolveEnv(opts)
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = true; r.lastOpenedAt = new Date().toISOString(); return r })
}

export function closeRoot(id, opts = {}) {
  const env = resolveEnv(opts)
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.open = false; return r })
}

/** Deleting a Freestyle folder moves its ROW to the trash — registry only, the
 *  directory on disk never moves, in or out. arxa did not create the folder, so
 *  arxa never deletes it: `purgeRoot` drops the row and leaves the directory
 *  exactly where the user put it. That is the one place Freestyle diverges from
 *  an organisation, whose trash owns the folder it made and whose purge really
 *  deletes it. A trashed root keeps its own `.arxa/trash` untouched, so
 *  restoring it brings its trashed files back with it. */
export function trashRoot(id, opts = {}) {
  const env = resolveEnv(opts)
  return mutate(env, (reg) => {
    const i = reg.roots.findIndex((x) => x.id === id); if (i < 0) throw new Error('unknown-root')
    const [r] = reg.roots.splice(i, 1)
    const row = { ...r, open: false, trashedAt: new Date().toISOString() }
    reg.rootTrash.unshift(row)
    return row
  })
}

export function restoreRoot(id, opts = {}) {
  const env = resolveEnv(opts)
  return mutate(env, (reg) => {
    const i = reg.rootTrash.findIndex((x) => x.id === id); if (i < 0) throw new Error('unknown-trashed-root')
    const [r] = reg.rootTrash.splice(i, 1)
    const { trashedAt, ...row } = r
    reg.roots.push(row)
    return row
  })
}

/** Drops the trashed row. The folder stays on disk — see trashRoot. */
export function purgeRoot(id, opts = {}) {
  const env = resolveEnv(opts)
  return mutate(env, (reg) => {
    const i = reg.rootTrash.findIndex((x) => x.id === id); if (i < 0) throw new Error('unknown-trashed-root')
    const [r] = reg.rootTrash.splice(i, 1)
    return r
  })
}

/** Display-only: the folder on disk never moves. */
export function renameRoot(id, name, opts = {}) {
  const env = resolveEnv(opts)
  const clean = String(name || '').trim(); if (!clean) throw new Error('name-required')
  return mutate(env, (reg) => { const r = reg.roots.find((x) => x.id === id); if (!r) throw new Error('unknown-root'); r.name = clean; writeManifest(r, { name: clean }); return r })
}

/** Put a local-only Freestyle root on GitHub as a private repository. */
export async function publishRoot(root, opts = {}) {
  const env = resolveEnv(opts)
  const github = opts.github
  if (!github || typeof github.status !== 'function') return { ok: false, reason: 'github-unavailable' }

  const status = await github.status()
  if (!status?.ok) return { ok: false, reason: status?.reason || 'github-unavailable' }
  if (!status.linked) return { ok: false, reason: 'github-unlinked' }

  const manifest = readManifest(root)
  if (manifest?.localOnly === false && manifest.repoUrl) return { ok: true, repoUrl: manifest.repoUrl }
  let repo = manifest?.pendingPublish
  if (!repo) {
    const made = await github.createPrivateRepo(root.name)
    if (!made?.ok) return { ok: false, reason: made?.reason || 'github-unavailable' }
    repo = made.repo
  }
  if (!repo?.repoOwner || !repo?.repoName || !repo?.repoUrl) {
    return { ok: false, reason: 'github-unavailable' }
  }

  try {
    // Creating a remote is irreversible. Keep its non-secret identity so
    // a credential/network failure can resume without a name-taken error.
    // The root remains local-only until its first push succeeds.
    writeManifest(root, { pendingPublish: {
      repoOwner: repo.repoOwner, repoName: repo.repoName, repoUrl: repo.repoUrl,
    } })
    // Keep origin free of credentials. A token is scoped to this one push,
    // matching file-org-shell's publish path; local test remotes pass through.
    setOrigin(root.path, repo.repoUrl, env)
    writeFrameFiles(root.path, 'freestyle', { includeCiYml: true })
    wipCommit(root.path, { message: 'publish freestyle root', env })

    const credentials = await github.gitCredentials()
    if (!credentials?.ok) return { ok: false, reason: credentials?.reason || 'github-unavailable' }
    const pushUrl = repo.repoUrl.startsWith('https://github.com/')
      ? 'https://' + encodeURIComponent(credentials.login) + ':' + encodeURIComponent(credentials.token)
        + '@' + repo.repoUrl.slice('https://'.length)
      : repo.repoUrl
    await pushRepoAsync(root.path, pushUrl, env)

    writeManifest(root, {
      localOnly: false,
      repoOwner: repo.repoOwner,
      repoName: repo.repoName,
      repoUrl: repo.repoUrl,
      pendingPublish: null,
    })
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) }
  }

  // Repository settings/protection are repairable remote decoration. A
  // failure here never reverses a completed publish or harms the local root.
  try {
    await github.wireFrame(repo.repoOwner, repo.repoName, {
      settings: settingsPayload(),
      protection: protectionPayload(),
    })
  } catch { /* best effort */ }
  return { ok: true, repoUrl: repo.repoUrl }
}

export function setActiveTab(tab, opts = {}) {
  const env = resolveEnv(opts)
  if (tab !== 'org' && tab !== 'freestyle') throw new Error('bad-tab')
  return mutate(env, (reg) => { reg.ui.activeTab = tab; return reg.ui })
}
