/**
 * The shared card flow — ONE assertion table, run twice (Decision 5).
 *
 * Every step here is mode-independent: it holds for a local-only org and for a
 * GitHub-linked one, because all of it is plain local git driven through the
 * card's own route. The mode-specific halves stay in the callers —
 * `card-local-smoke.mjs` asserts the degradations (every GitHub action refuses
 * with a named reason), `card-cicd-smoke.mjs` asserts the push/PR/checks/merge
 * tail. What must NOT diverge is the flow itself, and it used to: the local
 * smoke grew an end-of-life section the linked one never had, which is exactly
 * how "it works locally" and "it works linked" stop being the same claim.
 *
 * Everything is taken from `ctx` rather than hardcoded, because the linked run
 * uses arxa's REAL publish and REAL slugs — a table that assumed 'storefront'
 * and 'hero.md' would fail there on names it never created.
 *
 * ctx = {
 *   act(action, arg) -> { ok, result, error }   the card/sidebar wire
 *   check(label, ok, extra)                      the caller's assertion sink
 *   section(title)                               the caller's heading sink
 *   git(args, cwd) -> string                     trimmed stdout
 *   gw                                           git-workspace module
 *   orgId, orgPath, projectSlug, projectPath, workspace, file
 * }
 */
import { existsSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

/** Start a session, dirty it, land it on main through the card. Returns the id. */
export async function landOneSession(ctx, { name = ctx.file } = {}) {
  const { act, check, git, gw } = ctx
  const made = await act('workspace.new-session', { orgId: ctx.orgId, workspace: ctx.workspace })
  check('a session binds to the workspace track', made.ok === true && typeof made.result?.id === 'string',
    JSON.stringify(made).slice(0, 200))
  const sid = made.result?.id
  if (!sid) return null

  const sess = gw.parkedSessions(ctx.orgPath).find((x) => x.id === sid)
  check('the session has a worktree on disk', Boolean(sess?.worktree), JSON.stringify(sess ?? null))
  if (!sess?.worktree) return sid
  writeFileSync(path.join(sess.worktree, name), '# ' + name + '\n\nwork\n')

  // Evidence only (Q6): the host never drafts a subject, it returns what the
  // session model writes one FROM.
  const draft = await act('card.commit.draft', { sessionId: sid })
  check('card.commit.draft returns evidence, not a subject',
    draft.ok === true && typeof draft.result?.rule === 'string' && draft.result?.subject === undefined,
    JSON.stringify(draft).slice(0, 200))

  const committed = await act('card.commit', { sessionId: sid, message: 'feat: add ' + name })
  check('card.commit MERGED to main rather than parking',
    committed.ok === true && committed.result?.merged === true, JSON.stringify(committed).slice(0, 300))
  check('main actually carries the work (read from git, not from a return value)',
    git(['ls-tree', '--name-only', 'main'], ctx.projectPath).includes(name),
    git(['ls-tree', '--name-only', 'main'], ctx.projectPath))
  return sid
}

/**
 * End of life (D113). finishSession and sweepMerged were fully implemented and
 * called by nothing but their own unit selftest until 2026-09-08 — a session
 * could be started, committed and landed, but never CLOSED.
 */
export async function endOfLife(ctx, { sid }) {
  const { act, check, section, git, gw } = ctx
  section('End of life — Finish one session, Sweep the rest (D113)')

  let r = await act('card.status', { sessionId: sid })
  check('card.status carries the finish gate for a session seat',
    r.result?.finish !== null && r.result?.finish !== undefined, JSON.stringify(r.result?.finish ?? null))
  check('a merged, clean session reports finishable',
    r.result?.finish?.can === true, JSON.stringify(r.result?.finish))

  // The refusal must be SEEN, not met as a dead button.
  const sess = gw.parkedSessions(ctx.orgPath).find((x) => x.id === sid)
  const scratch = path.join(sess.worktree, 'scratch.txt')
  writeFileSync(scratch, 'uncommitted\n')
  r = await act('card.status', { sessionId: sid })
  check('a dirty worktree turns the gate off and NAMES why',
    r.result?.finish?.can === false && r.result?.finish?.reason === 'worktree-dirty',
    JSON.stringify(r.result?.finish))
  r = await act('card.finish', { sessionId: sid })
  check('...and card.finish refuses it rather than half-acting',
    r.ok === false || r.result?.finished === false, JSON.stringify(r).slice(0, 200))
  check('the refused session still has its worktree', existsSync(sess.worktree), sess.worktree)

  rmSync(scratch)
  r = await act('card.finish', { sessionId: sid })
  check('card.finish removes the worktree and the branch',
    r.ok === true && r.result?.finished === true, JSON.stringify(r).slice(0, 300))
  check('the worktree is really gone from disk', !existsSync(sess.worktree), sess.worktree)
  check('the branch is really gone from git',
    git(['branch', '--list', sess.branch], ctx.projectPath) === '',
    git(['branch', '--list', sess.branch], ctx.projectPath))
  check('the work it landed is still on main (finish is cleanup, never a revert)',
    git(['ls-tree', '--name-only', 'main'], ctx.projectPath).includes(ctx.file),
    git(['ls-tree', '--name-only', 'main'], ctx.projectPath))
}

/** Sweep, on the project repo a project row's menu would target. */
export async function sweepFlow(ctx) {
  const { act, check, section, gw } = ctx
  section('Sweep — preview, ceiling, and scope')

  const preview = await act('org.sweep', { orgId: ctx.orgId, projectSlug: ctx.projectSlug, dryRun: true })
  check('org.sweep previews without touching anything',
    preview.ok === true && Array.isArray(preview.result?.finished), JSON.stringify(preview).slice(0, 300))
  const wouldGo = (preview.result?.finished ?? []).map((x) => x.id)
  const wouldStay = preview.result?.skipped ?? []
  check('the preview marks every row it lists as a dry run',
    (preview.result?.finished ?? []).every((x) => x.dryRun === true),
    JSON.stringify(preview.result?.finished))

  const candidates = gw.parkedSessions(ctx.orgPath).filter((x) => wouldGo.includes(x.id))
  // With one candidate `others` is empty and `.every()` on an empty array is
  // true — the ceiling assertion below would pass without proving anything.
  check('the sweep ceiling has something to prove — two or more candidates',
    candidates.length >= 2, JSON.stringify({ candidates: candidates.map((x) => x.id), wouldStay }))
  if (candidates.length >= 2) {
    const target = candidates[0]
    const others = candidates.slice(1)
    const r = await act('org.sweep', { orgId: ctx.orgId, projectSlug: ctx.projectSlug, dryRun: false, only: [target.id] })
    check('org.sweep acts on the ids it was given',
      r.ok === true && (r.result?.finished ?? []).some((x) => x.id === target.id && x.finished === true),
      JSON.stringify(r).slice(0, 300))
    check('...and on nothing else, even when the others were equally sweepable',
      others.every((o) => existsSync(o.worktree)),
      JSON.stringify(others.map((o) => ({ id: o.id, gone: !existsSync(o.worktree) }))))
  }

  // The menu copy promises ONE repo. An empty result would also satisfy a bare
  // "excludes the project" test, and an empty result is what a broken route
  // returns — so the org repo needs a session of its own before this can
  // discriminate. Every session above lives in the PROJECT repo, so without
  // this the org sweep is legitimately empty and the check proves nothing.
  const orgSession = await act('workspace.new-session', { orgId: ctx.orgId, workspace: ctx.orgWorkspace })
  check('an org-level session exists, so the scope check below can discriminate',
    orgSession.ok === true && typeof orgSession.result?.id === 'string',
    JSON.stringify(orgSession).slice(0, 200))
  const orgSweep = await act('org.sweep', { orgId: ctx.orgId, dryRun: true })
  const orgRows = (orgSweep.result?.finished ?? []).concat(orgSweep.result?.skipped ?? [])
  check('an org-row sweep sees the org repo\'s own sessions',
    orgSweep.ok === true && orgRows.length >= 1, JSON.stringify(orgSweep.result).slice(0, 300))
  check('...and never reaches into the projects beneath it',
    orgRows.every((x) => !String(x.id).includes(ctx.projectSlug)),
    JSON.stringify(orgRows).slice(0, 300))
}
