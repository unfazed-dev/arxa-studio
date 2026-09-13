// arxa-filesystem — the in-process read/write fence (S1 + §20,
// docs/plans/arxa-isolation-levels.md).
//
// WHY THIS EXISTS
// ---------------
// §20 measured that dsh's `SandboxedFileSystem` fences ONLY the two mutations
// (`writeText`/`editText` → `checkedTarget`); there is no read override at
// all, and the engine itself was never launched under a Seatbelt profile, so
// the agent's own file tools could read a sibling project straight through in
// EVERY mode. Blocking `cat` while leaving the in-process Read tool open is
// not cross-project read isolation — this provider is the cheap fix §20
// recommended: same seam as the S1 SandboxProvider (a cordis row swap), same
// model (subclass, extend, never rebuild).
//
// WHAT IT ADDS, AND NOTHING MORE
// ------------------------------
// * A READ fence on `readText`/`streamText`/`readBytes`/`stat`/`listDir`,
//   mirroring the A2 Seatbelt read-deny exactly: paths under the ORG root are
//   readable only inside the session worktree or the org's own `.git` (git
//   plumbing — `status`/`diff`/`log` read through a worktree's pointer);
//   everything OUTSIDE the org root stays readable, matching the profile's
//   org-scoped deny. Sibling projects, the `.arxa` registry and symlink
//   escapes into them are denied with the stock `FS_SANDBOX_DENIED`.
// * A reserved-path rejection on MUTATION: no in-process write or edit may
//   target a `.git` or `.arxa` path segment (§11's protected list — a hook
//   the host later executes must be the host's to author). Subprocess git
//   (host-side auto-commit) is unaffected: it never goes through ctx.fs.
// * A session-root annotation: `resolve()` stamps the caller's `opts.cwd`
//   onto the target (`arxaRoot`), which is how a read learns the session
//   root — the stock read path passes no policy, so the root rides the
//   target. Agentless resolves carry no stamp and fall back to the
//   deployment policy root.
//
// Everything else — atomic writes, the read-match-write edit critical
// section, the write containment fence, escalation advertising — is the
// inherited local/sandboxed implementation, verbatim.

import { FsError } from '@deepseek-ai/dsh-fs'
import { canonicalPath } from '@deepseek-ai/dsh-sandbox'
import { join, sep } from 'node:path'

import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import { arxaOrgRootOf } from './index.js'

/** The mutation-reserved path segments: git control state and the arxa registry. */
export const RESERVED_SEGMENTS = ['.git', '.arxa']

/** Lexical containment, the fence's own spelling (both sides canonical). */
function isUnder (path, root) {
  if (path === root) return true
  return path.startsWith(root.endsWith(sep) ? root : root + sep)
}

/** Whether any path SEGMENT is a reserved control directory (.gitignore is not .git). */
export function hasReservedSegment (path) {
  const segments = String(path).split(/[\\/]/)
  return RESERVED_SEGMENTS.some((seg) => segments.includes(seg))
}

/**
 * The arxa FileSystem provider: `SandboxedFileSystem` plus the read fence and
 * the reserved-path write rejection. Registers as `ctx.fs` — the swap at the
 * `id: fs-sandbox` cordis row is the whole mount; the model-facing tools are
 * untouched.
 */
export default class ArxaFileSystem extends SandboxedFileSystem {
  /**
   * Fill the stock config defaults the schema normally applies, so direct
   * construction (tests, probes) works with a bare partial config.
   * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
   * @param {object} [config] - the row config (cwd, diffBasisMaxBytes).
   */
  constructor (ctx, config = {}) {
    super(ctx, {
      cwd: process.cwd(),
      diffBasisMaxBytes: 10 * 1024 * 1024,
      ...config
    })
  }

  /**
   * `super.resolve` plus the session-root stamp. dsh-tool-fs resolves every
   * model-facing path with `sessionResolveOptions` (cwd = the session's
   * workspace root); reads get no policy argument, so the root rides the
   * target descriptor to the fence.
   * @param {string} path - absolute or relative path.
   * @param {{ cwd?: string, signal?: AbortSignal }} [opts] - resolution options.
   * @returns {Promise<{ targetKey: string, displayPath: string, arxaRoot?: string }>}
   *   the resolved target, carrying `arxaRoot` when a session cwd resolved it.
   */
  async resolve (path, opts) {
    const target = await super.resolve(path, opts)
    if (opts?.cwd !== undefined) target.arxaRoot = canonicalPath(opts.cwd)
    return target
  }

  /**
   * The read fence (the §20 half dsh does not ship). Denials throw the stock
   * structured `FS_SANDBOX_DENIED` so tooling treats them like every other
   * sandbox refusal.
   * @param {{ targetKey: string, displayPath: string, arxaRoot?: string }} target - the resolved target.
   * @returns {Promise<object>} the same target when the read is permitted.
   */
  async checkedRead (target) {
    if (target?.targetKey === undefined) {
      // A caller that hands us a Promise (an unawaited resolve) would
      // otherwise fall through the fence as "outside the org" — refuse the
      // shape loudly instead of reading unfenced.
      throw new FsError('cannot read: the target was not resolved (pass an awaited resolve() result)', 'FS_SANDBOX_DENIED')
    }
    const policy = this.ctx.sandboxPolicy.resolve()
    if (policy.mode === 'danger-full-access') return target
    const root = target.arxaRoot ?? policy.workspaceRoot
    const key = String(target.targetKey)
    const ws = canonicalPath(root)
    // `targetKey` is realpath-derived (deepest existing ancestor), so a
    // symlink escape is judged at its REAL destination — the fence cannot be
    // routed around by a link planted inside the workspace.
    if (isUnder(key, ws)) return target
    const orgRoot = arxaOrgRootOf(ws)
    // A session rooted outside the arxa worktree layout (a freestyle folder)
    // has no org root to scope a deny around — on the Seatbelt side OR here.
    // Reads stay open and that is pinned as behaviour, not left ambiguous.
    if (orgRoot === undefined) return target
    if (isUnder(key, join(orgRoot, '.git'))) return target
    if (!isUnder(key, orgRoot)) return target
    throw new FsError(
      `cannot read "${target.displayPath}": file access denied outside the session root`,
      'FS_SANDBOX_DENIED'
    )
  }

  /** Fence the read, then delegate to the inherited whole-file read. */
  async readText (target, signal) {
    return super.readText(await this.checkedRead(target), signal)
  }

  /** Fence the read, then delegate to the inherited stream. */
  streamText (target, signal) {
    return this.checkedRead(target).then((t) => super.streamText(t, signal))
  }

  /** Fence the read, then delegate to the inherited byte read. */
  async readBytes (target, signal, maxBytes) {
    return super.readBytes(await this.checkedRead(target), signal, maxBytes)
  }

  /** Fence the stat: existence of a sibling path is cross-project information too. */
  async stat (target, signal) {
    return super.stat(await this.checkedRead(target), signal)
  }

  /** Fence the listing: sibling filenames are cross-project information too. */
  async listDir (target, signal) {
    return super.listDir(await this.checkedRead(target), signal)
  }

  /**
   * The inherited mutation fence PLUS the reserved-path rejection. The stock
   * containment (re-resolve now, require a writable root, return the fresh
   * target) runs first; whatever survives may not be git control state or
   * registry state. Unconditional in mode: the protected list is an integrity
   * invariant (§11), not a confinement tier an operator can switch off.
   *
   * Inside the session root only the part BELOW the root is judged — the
   * worktree itself lives under `<org>/.arxa/worktrees/<id>`, so the prefix
   * cannot count against the write. Outside it (a temp-root write), the whole
   * path is judged.
   * @param {object} target - the resolved target to mutate.
   * @param {object} [sandboxPolicy] - the per-call mode and workspace root.
   * @returns {Promise<object>} the fresh, checked target to mutate.
   */
  async checkedTarget (target, sandboxPolicy) {
    const fresh = await super.checkedTarget(target, sandboxPolicy)
    const key = String(fresh.targetKey)
    const ws = canonicalPath((sandboxPolicy ?? this.ctx.sandboxPolicy.resolve()).workspaceRoot)
    const judged = isUnder(key, ws) ? key.slice(ws.length) : key
    if (hasReservedSegment(judged)) {
      throw new FsError(
        `cannot write "${target.displayPath}": ${RESERVED_SEGMENTS.join('/')} control paths are reserved — git and arxa state is authored by the host, not the session`,
        'FS_SANDBOX_DENIED'
      )
    }
    return fresh
  }
}
