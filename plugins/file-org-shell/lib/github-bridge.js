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

  /** Rename a repo (D80): { ok:true, repo } | { ok:false, reason }.
    * Canonical repo JSON lands in `repo` — callers adopt full_name. */
  async function renameRepo(owner, name, newName) {
    if (typeof f.renameRepo !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      const repo = normalizeRepo(await f.renameRepo(owner, name, newName))
      return repo ? { ok: true, repo } : { ok: false, reason: 'github-unavailable' }
    } catch (err) {
      return { ok: false, reason: 'rename-failed', error: String(err?.message ?? err) }
    }
  }

  /** Pre-flight (D80): { ok:true, taken:boolean } | { ok:false, reason }.
    * An unavailable face must BLOCK the rename, not wave it through:
    * ok:false means 'cannot rename now' — callers keep the local move
    * and let the pending ride finish it. */
  async function repoNameTaken(owner, name) {
    if (typeof f.repoNameTaken !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      return { ok: true, taken: Boolean(await f.repoNameTaken(owner, name)) }
    } catch (err) {
      return { ok: false, reason: 'name-check-failed', error: String(err?.message ?? err) }
    }
  }

  /** Permanently delete a repo (D80 trash purge): { ok:true } |
    * { ok:false, reason, error }. The error text carries the 403
    * re-link guidance verbatim for the UI. */
  /** Local runner teardown after a repo delete; missing face = nothing to do. */
  async function removeRunner(owner, name) {
    if (typeof f.removeRunner !== 'function') return { ok: true, existing: false, skipped: 'github-unavailable' }
    try {
      const r = await f.removeRunner(owner, name)
      return r && typeof r === 'object' ? r : { ok: false, reason: 'runner-remove-failed' }
    } catch (err) {
      return { ok: false, reason: 'runner-remove-failed', error: String(err?.message ?? err) }
    }
  }

  async function deleteRepo(owner, name) {
    if (typeof f.deleteRepo !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      await f.deleteRepo(owner, name)
      return { ok: true }
    } catch (err) {
      const msg = String(err?.message ?? err)
      // D82: 404 = the repo is ALREADY GONE — the purge's goal state
      // already holds, so it counts as done (alreadyGone lets callers
      // report it honestly). Only real failures (403, 5xx, network) keep
      // the trash entry.
      if (msg.includes('404') || msg.includes('already be gone')) return { ok: true, alreadyGone: true }
      return { ok: false, reason: 'delete-failed', error: msg }
    }
  }

  /** Delete ONE remote branch (archives trash purge): the parked session
   * branch's remote half. 422/already-gone counts as done — the purge's
   * goal state already holds. Same keep-the-entry-on-failure posture as
   * deleteRepo. */
  async function deleteBranch(owner, name, branch) {
    if (typeof f.deleteBranch !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      await f.deleteBranch(owner, name, branch)
      return { ok: true }
    } catch (err) {
      const msg = String(err?.message ?? err)
      if (msg.includes('422') || msg.includes('alreadyGone') || msg.includes('already gone')) {
        return { ok: true, alreadyGone: true }
      }
      return { ok: false, reason: 'delete-failed', error: msg }
    }
  }

  /** Wire the CI frame (Part B S1): squash-only settings + branch
    * protection on a published repo. protection:'plan-limited' is the
    * measured free-plan state (S0 V1) — recorded, never fatal. */
  async function wireFrame(owner, name, payloads) {
    if (typeof f.wireFrame !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      return await f.wireFrame(owner, name, payloads)
    } catch (err) {
      return { ok: false, reason: 'frame-wire-failed', error: String(err?.message ?? err) }
    }
  }

  /** Ensure a canon self-hosted runner exists on this machine for the
    * repo (Q5). Never throws. */
  async function ensureRunner(owner, name) {
    if (typeof f.ensureRunner !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      return await f.ensureRunner(owner, name)
    } catch (err) {
      return { ok: false, reason: 'runner-failed', error: String(err?.message ?? err) }
    }
  }

  /** PR faces (Part B): create / list-for-head / squash merge / checks.
     * Same throw-proof shape; checks classify queued as runner-asleep. */
  async function prCreate(owner, name, fields) {
    if (typeof f.prCreate !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, pr: await f.prCreate(owner, name, fields) } }
    catch (err) { return { ok: false, reason: 'pr-create-failed', error: String(err?.message ?? err) } }
  }
  async function prListForHead(owner, name, head) {
    if (typeof f.prListForHead !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, prs: await f.prListForHead(owner, name, head) } }
    catch (err) { return { ok: false, reason: 'pr-list-failed', error: String(err?.message ?? err) } }
  }
  /** DEPRECATED (D107): squash-merge breaks main's ancestry. Unwired —
    * `prMerge` is the face the card calls. */
  async function prSquashMerge(owner, name, number) {
    if (typeof f.prSquashMerge !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, merged: await f.prSquashMerge(owner, name, number) } }
    catch (err) { return { ok: false, reason: 'pr-merge-failed', error: String(err?.message ?? err) } }
  }
  /** D107 merge face — `sha` pins the merge to the reviewed commit; a
    * moved head comes back as pr-merge-failed rather than merging blind. */
  async function prMerge(owner, name, fields) {
    if (typeof f.prMerge !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, merged: await f.prMerge(owner, name, fields) } }
    catch (err) { return { ok: false, reason: 'pr-merge-failed', error: String(err?.message ?? err) } }
  }
  async function prState(owner, name, number) {
    if (typeof f.prState !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, pr: await f.prState(owner, name, number) } }
    catch (err) { return { ok: false, reason: 'pr-state-failed', error: String(err?.message ?? err) } }
  }
  async function prChecks(owner, name, ref) {
    if (typeof f.prChecks !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, checks: await f.prChecks(owner, name, ref) } }
    catch (err) { return { ok: false, reason: 'pr-checks-failed', error: String(err?.message ?? err) } }
  }
  /** Stage comment on a PR (2026-09-03) — the card's evidence trail. Same
    * degrade shape as the other PR faces: never throws. */
  async function prComment(owner, name, fields) {
    if (typeof f.prComment !== 'function') return { ok: false, reason: 'github-unavailable' }
    try { return { ok: true, comment: await f.prComment(owner, name, fields) } }
    catch (err) { return { ok: false, reason: 'pr-comment-failed', error: String(err?.message ?? err) } }
  }

  /** → { ok:true, login, token } | { ok:false, reason } — throw-proof
    * (D73): the push half needs HTTPS credentials; an unavailable face
    * degrades exactly like the others. The token is handed ONLY to the
    * lifecycle's push call, never logged, never persisted. */
  async function gitCredentials(force = false) {
    if (typeof f.gitCredentials !== 'function') return { ok: false, reason: 'github-unavailable' }
    try {
      const c = await f.gitCredentials(force === true)
      if (!c || typeof c !== 'object' || typeof c.login !== 'string' || typeof c.token !== 'string') {
        return { ok: false, reason: 'github-unavailable' }
      }
      return { ok: true, login: c.login, token: c.token }
    } catch (err) {
      return { ok: false, reason: 'github-unavailable', error: String(err?.message ?? err) }
    }
  }

  return { status, createPrivateRepo, renameRepo, repoNameTaken, deleteRepo, removeRunner, deleteBranch, wireFrame, ensureRunner, prCreate, prComment,prListForHead, prSquashMerge, prMerge, prState, prChecks, gitCredentials }
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
