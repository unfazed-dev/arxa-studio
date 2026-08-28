// The mirror engine (D45). refreshAccountMirror() is the single
// explicit entry point: fetch artifacts through the provider seam,
// then materialise them under <org>/account/ as plain read-only files
// (0444). Refresh is idempotent, atomic per file (write temp + rename
// — rename replaces a read-only target because replacement is a
// directory operation), and prunes stale artifacts from a previous
// refresh that the provider no longer returns. Pruning only ever
// touches files the mirror itself wrote (recorded in .mirror.json), so
// anything else living under account/ (D28 secrets, user files) is
// never deleted.
//
// Git (D37): mirror content is derivable and never committed. The org
// repo's committed .gitignore already carries `/account/` (ORG_GITIGNORE,
// arxa-git-workspace); refresh additionally writes `/account/` into the
// repo's `.git/info/exclude` choke point so the exclusion holds even if
// a user edits the committed ignore file. With git absent or the org
// not a repo, refresh works identically and skips the exclusion.

import fs from 'node:fs'
import path from 'node:path'
import { runGit } from '../../git-workspace/lib/index.js'
import { InvalidArtifactError } from './errors.js'
import { createLocalProvider } from './providers.js'

/** Category dir the mirror fills — already scaffolded by the org template. */
export const ACCOUNT_DIR = 'account'

/**
 * Mirror bookkeeping file inside account/: records which files the
 * mirror wrote, so the next refresh prunes exactly its own stale files
 * and nothing else. Deterministic content (no timestamps) so refresh
 * is byte-for-byte idempotent.
 */
export const MIRROR_MANIFEST = '.mirror.json'

const FILE_MODE = 0o444

/**
 * Add `/account/` to the org repo's `.git/info/exclude` (the same
 * choke point sessions.js uses for `/.arxa/`). Belt-and-braces on top
 * of the committed D37 .gitignore. Returns true when the exclusion is
 * in place, false when the org is not a git repo or git is absent.
 */
export function ensureAccountExcluded(orgPath, env = process.env) {
  if (!fs.existsSync(path.join(orgPath, '.git'))) return false
  let commonDir
  try {
    commonDir = runGit(['rev-parse', '--git-common-dir'], { cwd: orgPath, env, allowFail: true })
  } catch {
    return false // git binary absent — the committed .gitignore still covers clones
  }
  if (!commonDir) return false
  const resolved = path.isAbsolute(commonDir) ? commonDir : path.join(orgPath, commonDir)
  const infoDir = path.join(resolved, 'info')
  const excludeFile = path.join(infoDir, 'exclude')
  const line = '/account/'
  const current = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, 'utf8') : ''
  if (current.split('\n').includes(line)) return true
  fs.mkdirSync(infoDir, { recursive: true })
  const sep = current === '' || current.endsWith('\n') ? '' : '\n'
  fs.writeFileSync(excludeFile, `${current}${sep}${line}\n`)
  return true
}

/** Validate and normalise one provider artifact. Throws InvalidArtifactError. */
function normaliseArtifact(artifact) {
  if (artifact === null || typeof artifact !== 'object') {
    throw new InvalidArtifactError(`artifact must be an object, got ${JSON.stringify(artifact)}`)
  }
  const { path: rel, content } = artifact
  if (typeof rel !== 'string' || rel === '') {
    throw new InvalidArtifactError(`artifact path must be a non-empty string, got ${JSON.stringify(rel)}`)
  }
  if (path.isAbsolute(rel) || rel.includes('\\') || rel.includes('\0')) {
    throw new InvalidArtifactError(`artifact path must be relative with forward slashes: ${JSON.stringify(rel)}`)
  }
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new InvalidArtifactError(`artifact path must not contain empty, "." or ".." segments: ${JSON.stringify(rel)}`)
  }
  if (rel === MIRROR_MANIFEST) {
    throw new InvalidArtifactError(`${MIRROR_MANIFEST} is reserved for mirror bookkeeping`)
  }
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
    throw new InvalidArtifactError(`artifact content must be a string or Uint8Array: ${JSON.stringify(rel)}`)
  }
  return { path: segments.join('/'), content }
}

let tmpCounter = 0

/** Atomic read-only write: temp file, chmod 0444, rename over target. */
function writeArtifact(accountPath, rel, content) {
  const target = path.join(accountPath, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  tmpCounter += 1
  const tmp = path.join(path.dirname(target), `.mirror-tmp-${process.pid}-${tmpCounter}`)
  fs.writeFileSync(tmp, content)
  fs.chmodSync(tmp, FILE_MODE)
  fs.renameSync(tmp, target)
}

/** Read the previous refresh's file list; [] when absent or unreadable. */
function readPreviousFiles(accountPath) {
  const manifestPath = path.join(accountPath, MIRROR_MANIFEST)
  if (!fs.existsSync(manifestPath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return Array.isArray(parsed.files) ? parsed.files.filter((f) => typeof f === 'string') : []
  } catch {
    return [] // corrupt bookkeeping: prune nothing rather than guess
  }
}

/** Remove now-empty parent dirs of a pruned file, up to account/ itself. */
function pruneEmptyDirs(accountPath, rel) {
  let dir = path.dirname(path.join(accountPath, rel))
  const stop = path.resolve(accountPath)
  while (path.resolve(dir) !== stop) {
    try {
      if (fs.readdirSync(dir).length > 0) return
      fs.rmdirSync(dir)
    } catch {
      return
    }
    dir = path.dirname(dir)
  }
}

/**
 * Explicitly refresh the read-only account mirror of an organisation.
 * Defaults to the offline empty-state provider — no account, no network.
 * Fetches BEFORE touching disk, so a failing provider leaves the
 * existing mirror intact.
 *
 * @param {string} orgPath  organisation root (contains account/)
 * @param {{ fetchArtifacts: () => any }} [provider]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ accountPath: string, written: string[], removed: string[], excluded: boolean }>}
 */
export async function refreshAccountMirror(orgPath, provider = createLocalProvider(), env = process.env) {
  if (typeof orgPath !== 'string' || !fs.existsSync(orgPath)) {
    throw new TypeError(`orgPath must be an existing directory, got ${JSON.stringify(orgPath)}`)
  }
  if (provider === null || typeof provider !== 'object' || typeof provider.fetchArtifacts !== 'function') {
    throw new TypeError('provider must expose fetchArtifacts()')
  }

  const fetched = await provider.fetchArtifacts()
  if (!Array.isArray(fetched)) {
    throw new InvalidArtifactError(`fetchArtifacts() must return an array, got ${JSON.stringify(fetched)}`)
  }
  const artifacts = fetched.map(normaliseArtifact)
  const seen = new Set()
  for (const { path: rel } of artifacts) {
    if (seen.has(rel)) throw new InvalidArtifactError(`duplicate artifact path: ${JSON.stringify(rel)}`)
    seen.add(rel)
  }

  const accountPath = path.join(orgPath, ACCOUNT_DIR)
  fs.mkdirSync(accountPath, { recursive: true })
  const excluded = ensureAccountExcluded(orgPath, env)

  const previous = readPreviousFiles(accountPath)
  const written = []
  for (const { path: rel, content } of artifacts) {
    writeArtifact(accountPath, rel, content)
    written.push(rel)
  }

  const current = new Set(written)
  const removed = []
  for (const rel of previous) {
    if (current.has(rel)) continue
    const stale = path.join(accountPath, rel)
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true })
      pruneEmptyDirs(accountPath, rel)
    }
    removed.push(rel)
  }

  written.sort()
  removed.sort()
  writeArtifact(accountPath, MIRROR_MANIFEST, `${JSON.stringify({ version: 1, files: written }, null, 2)}\n`)
  return { accountPath, written, removed, excluded }
}
