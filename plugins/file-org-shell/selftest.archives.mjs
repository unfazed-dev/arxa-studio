/**
 * file-org-shell archives selftest (2026-09-05 grill) — the open handle's
 * archives-tier verbs against a real git fixture:
 *   reviveSessionOnly (bare revival, no dsh), trashArchivedSession
 *   (archived-only guard, entry-first ordering, branch parked), the
 *   session-entry restore (branch verification, repo-gone refusal),
 *   precheckSessionEntry (github picture), purgeSessionEntry (local-only
 *   AND remote-first with a failing/succeeding fake bridge — the
 *   keep-the-entry-on-remote-failure posture), and the folder-path guards
 *   (purgeTrash / restore-all routing).
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createOrgLifecycle, listSessionsAcrossRepos } from './lib/index.js'
import { runGit, hasHead } from '../git-workspace/lib/index.js'
import { writeManifest, projectManifestPath } from '../workspace/lib/index.js'

let passed = 0
function ok(cond, label) {
  assert.ok(cond, label)
  passed++
  console.log(`  ✓ ${label}`)
}
async function throwsAsync(fn, re, label) {
  try {
    await fn()
  } catch (err) {
    if (!re.test(String(err?.message ?? err))) throw new Error(`${label}: wrong error: ${err?.message ?? err}`)
    passed++
    console.log(`  ✓ ${label}`)
    return
  }
  assert.fail(`${label}: expected a throw`)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fos-archives-'))
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-fos-archives-home-'))
const env = { ...process.env, ARXA_HOME: fakeHome, GIT_AUTHOR_NAME: 'selftest', GIT_AUTHOR_EMAIL: 'selftest@arxa', GIT_COMMITTER_NAME: 'selftest', GIT_COMMITTER_EMAIL: 'selftest@arxa' }

try {
  // A fake github bridge face set: recorded calls + switchable failure.
  const ghCalls = []
  const gh = {
    linked: true,
    deleteBranch: async (owner, name, branch) => {
      ghCalls.push(['deleteBranch', owner, name, branch])
      if (gh.refuse) throw new Error(gh.refuse)
      return { deleted: true }
    },
    prListForHead: async (owner, name, head) => {
      ghCalls.push(['prListForHead', owner, name, head])
      // Real-service shape: an ARRAY of GitHub PR json (empty when none).
      return gh.openPr ? [{ number: 12, title: 'Do the thing', html_url: 'https://github.com/x/y/pull/12' }] : []
    },
    refuse: null,
    openPr: false,
  }
  const svc = createOrgLifecycle({ workspaceRoot: root, env, dsh: {}, github: gh })
  const org = svc.createOrg('Archive Corp')
  await svc.openOrg(org.path)
  const cur = svc.current
  if (!hasHead(org.path, env)) runGit(['commit', '-m', 'init', '--allow-empty'], { cwd: org.path, env })

  // A project with a published manifest (remote-first purge path).
  const projPath = path.join(org.path, 'projects', 'rocket')
  fs.mkdirSync(projPath, { recursive: true })
  runGit(['init', '-q', '-b', 'main', '.'], { cwd: projPath, env })
  runGit(['commit', '-q', '-m', 'proj init', '--allow-empty'], { cwd: projPath, env })
  writeManifest(projectManifestPath(projPath), { version: 1, id: 'prj-1', name: 'rocket', slug: 'rocket', repoOwner: 'acme-owner', repoName: 'rocket', repoUrl: 'https://github.com/acme-owner/rocket' })
  // Publish the manifest so the repo exists remotely-shaped: give it an origin.
  runGit(['remote', 'add', 'origin', 'https://github.com/acme-owner/rocket.git'], { cwd: projPath, env })

  // Org-level archived session.
  const s1 = await cur.newSession(undefined, 'notes')
  const s2 = await cur.newSession(undefined, 'projects/rocket/notes')
  ok(s1.state === 'open' && s2.state === 'open', 'fixture: org + project sessions born')

  await throwsAsync(() => cur.trashArchivedSession(s1.id), /not-archived/, 'trashArchivedSession refuses an OPEN session (D47: the door opens only from archives)')
  await cur.archiveSession(s1.id)
  await cur.archiveSession(s2.id)
  ok(listSessionsAcrossRepos(org.path, env).every((x) => x.state === 'archived'), 'fixture: both sessions archived')

  // Trash the org-level one; the branch parks.
  const tr1 = await cur.trashArchivedSession(s1.id)
  ok(/^2\d{7}T.+Z-session-/.test(tr1.entryId) && tr1.branch === s1.branch, 'session trash entry minted with the parked branch recorded')
  ok(!listSessionsAcrossRepos(org.path, env).some((x) => x.id === s1.id), 'registry row gone after Move-to-Trash')
  ok(runGit(['rev-parse', '--verify', s1.branch], { cwd: org.path, env, allowFail: true }) !== null, 'branch PARKED in the repo (never auto-deleted)')

  // A newborn session skips the parked identity (ghosts at the mint).
  const s3 = await cur.newSession(undefined, 'notes')
  ok(s3.id !== s1.id && Number(s3.id.slice(-3)) > Number(s1.id.slice(-3)), 'new session mints PAST the trashed identity (ghost counter)')
  await cur.archiveSession(s3.id)
  await cur.trashArchivedSession(s3.id)

  // Restore: the row returns verbatim (state archived → Archives row).
  const rs1 = cur.restoreSessionEntry(tr1.entryId)
  ok(rs1.sessionId === s1.id && rs1.state === 'archived', 'restore returns the row to the archives tier (not open)')
  const row1 = listSessionsAcrossRepos(org.path, env).find((x) => x.id === s1.id)
  ok(row1.state === 'archived', 'restored row sits in the registry as archived')

  // Revive (the Archives row's Restore): bare git revival.
  const rv = await cur.reviveSessionOnly(s1.id)
  ok(rv.state === 'open' && fs.existsSync(rv.worktree), 'reviveSessionOnly recreates the worktree and opens the row')
  ok(listSessionsAcrossRepos(org.path, env).find((x) => x.id === s1.id).state === 'open', 'revived row is open in the registry')
  await cur.archiveSession(s1.id)
  const tr1b = await cur.trashArchivedSession(s1.id)

  // Branch-gone refusal: delete the parked branch by hand, restore refuses.
  const s4 = await cur.newSession(undefined, 'notes')
  await cur.archiveSession(s4.id)
  const tr4 = await cur.trashArchivedSession(s4.id)
  runGit(['branch', '-D', s4.branch], { cwd: org.path, env, allowFail: true })
  await throwsAsync(() => cur.restoreSessionEntry(tr4.entryId), /branch-gone/, 'restore refuses loudly when the parked branch is gone')

  // Purge the s4 entry anyway (local-only — branch already gone).
  const p4 = await cur.purgeSessionEntry(tr4.entryId)
  ok(p4.refs.branchDropped === false && p4.deleted != null, 'purge of a branch-gone entry still removes the marker (honest false, no throw)')

  // Precheck on the PROJECT session (published repo): github picture.
  const trp = await cur.trashArchivedSession(s2.id)
  const pre = await cur.precheckSessionEntry(trp.entryId)
  ok(pre.repo && pre.repo.owner === 'acme-owner' && pre.repo.name === 'rocket', 'precheck resolves the owning repo\'s GitHub coordinates')
  ok(pre.openPr === null && pre.branch === s2.branch, 'precheck: no open PR in the base case')

  gh.openPr = true
  const prePr = await cur.precheckSessionEntry(trp.entryId)
  ok(prePr.openPr && prePr.openPr.number === 12 && prePr.openPr.title === 'Do the thing', 'precheck surfaces the open PR riding the branch (the modal\'s warning line)')

  // Remote-first purge: a failing delete keeps the entry (idempotent retry).
  gh.refuse = 'boom (403)'
  await throwsAsync(() => cur.purgeSessionEntry(trp.entryId), /purge incomplete: remote branch deletion failed/, 'remote failure throws and keeps the trash entry')
  ok(runGit(['rev-parse', '--verify', s2.branch], { cwd: projPath, env, allowFail: true }) !== null, 'local branch untouched by the failed remote-first purge')

  gh.refuse = null
  const pp = await cur.purgeSessionEntry(trp.entryId)
  ok(pp.remoteBranch === 'deleted' && pp.refs.branchDropped === true && pp.deleted != null, 'remote-first purge: remote branch deleted, then local refs + entry')
  ok(ghCalls.some((c) => c[0] === 'deleteBranch' && c[3] === s2.branch), 'the remote delete targeted the session branch')
  ok(runGit(['rev-parse', '--verify', s2.branch], { cwd: projPath, env, allowFail: true }) === null, 'project branch gone after purge')

  // Folder-path guards: purgeTrash and restore-all route session entries.
  await throwsAsync(() => cur.purgeTrash(tr1b.entryId), /session-entry/, 'projecttrash.purge refuses a session entry (use sessiontrash.purge)')
  const all = cur.restoreTrash(null)
  const restoredEntries = all.restored.filter((r) => String(r.restoredPath).startsWith('session:'))
  ok(restoredEntries.length >= 1, 'restore-all routes session entries through the session verb (no payload move)')

  await svc.closeOrg()
  console.log(`file-org-shell archives selftest: ${passed} checks green`)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(fakeHome, { recursive: true, force: true })
}
