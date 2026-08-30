/**
 * GitHub bridge (W3b, D69 publish half) — the seam between project creation
 * and github-link. Mirrors the Phase D dsh-bridge pattern exactly: faces
 * injected through createOrgLifecycle({ github: faces }) — status(),
 * createPrivateRepo(name) — with a DEFAULT UNAVAILABLE STUB so the
 * lifecycle never fails for GitHub's sake (CLAUDE.md boundary: local-first,
 * no cloud dependency for core function; the local project always exists).
 *
 * Every method is throw-proof: callers never need try/catch around github.
 */
import { readManifest, writeManifest, projectManifestPath, orgManifestPath } from '../../workspace/lib/index.js'

/** Normalize a createPrivateRepo payload (GitHub REST shape) → the fields the manifest stores. */
function normalizeRepo(r) {
  if (!r || typeof r !== 'object') return null
  const owner = typeof r.owner === 'string' ? r.owner : (r.owner?.login ?? null)
  const name = r.name ?? null
  const url = r.html_url ?? r.url ?? null
  if (!owner || !name || !url) return null
  return { repoOwner: owner, repoName: name, repoPrivate: r.private !== false, repoUrl: url }
}

/**
 * Create the throw-proof bridge over injected faces (or the unavailable stub).
 *
 * @param {{ status?: Function, createPrivateRepo?: Function, gitCredentials?: Function }} faces
 */
export function createGithubBridge(faces = {}) {
  const f = faces && typeof faces === 'object' ? faces : {}

  /** → { ok:true, linked:boolean, ...state } | { ok:false, reason } */
  async function status() {
    if (typeof f.status !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      const st = await f.status()
      if (!st || typeof st !== 'object') return { ok: false, reason: 'github-unavailable' }
      return { ok: true, linked: Boolean(st.linked), login: st.login ?? null }
    } catch (err) {
      return { ok: false, reason: 'github-unavailable', error: String(err?.message ?? err) }
    }
  }

  /** → { ok:true, repo } | { ok:false, reason } */
  async function createPrivateRepo(name) {
    if (typeof f.createPrivateRepo !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      const repo = normalizeRepo(await f.createPrivateRepo(name))
      return repo ? { ok: true, repo } : { ok: false, reason: 'github-unavailable' }
    } catch (err) {
      return { ok: false, reason: 'github-unavailable', error: String(err?.message ?? err) }
    }
  }

  /** → { ok:true, login, token } | { ok:false, reason } — throw-proof
    * (D73): the push half needs HTTPS credentials; an unavailable face
    * degrades exactly like the others. The token is handed ONLY to the
    * lifecycle's push call, never logged, never persisted. */
  async function gitCredentials() {
    if (typeof f.gitCredentials !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      const c = await f.gitCredentials()
      if (!c || typeof c !== 'object' || typeof c.login !== 'string' || typeof c.token !== 'string') {
        return { ok: false, reason: 'github-unavailable' }
      }
      return { ok: true, login: c.login, token: c.token }
    } catch (err) {
      return { ok: false, reason: 'github-unavailable', error: String(err?.message ?? err) }
    }
  }

  return { status, createPrivateRepo, gitCredentials }
}

/**
 * Annotate a project manifest with the publish fields (W3b). Merge-only and
 * throw-proof: a manifest that cannot be read or written is reported, never
 * thrown — the local project must survive any GitHub-shaped failure.
 *
 * @returns {object} the annotated manifest (or a tombstone object on read failure)
 */
/**
 * Annotate the ORG manifest (org.json) with publish fields (D73). Same
 * merge-only, throw-proof contract as the project twin: a manifest that
 * cannot be read or written is reported, never thrown — the local org is
 * the source of truth and must survive any GitHub-shaped failure.
 *
 * @returns {object} the annotated manifest (or a tombstone object on read failure)
 */
export function annotateOrgManifest(orgPath, fields) {
  let manifest
  try {
    manifest = readManifest(orgManifestPath(orgPath))
  } catch (err) {
    return { annotateError: String(err?.message ?? err) }
  }
  Object.assign(manifest, fields)
  try {
    writeManifest(orgManifestPath(orgPath), manifest)
  } catch (err) {
    return { ...manifest, annotateError: String(err?.message ?? err) }
  }
  return manifest
}

export function annotateProjectManifest(projectPath, fields) {
  let manifest
  try {
    manifest = readManifest(projectManifestPath(projectPath))
  } catch (err) {
    return { annotateError: String(err?.message ?? err) }
  }
  Object.assign(manifest, fields)
  try {
    writeManifest(projectManifestPath(projectPath), manifest)
  } catch (err) {
    return { ...manifest, annotateError: String(err?.message ?? err) }
  }
  return manifest
}
