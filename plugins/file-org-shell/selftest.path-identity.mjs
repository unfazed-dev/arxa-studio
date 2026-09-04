#!/usr/bin/env node
// Selftest: the two app-layer guards that make path identity safe
// (grilled 2026-09-03 Q6/Q7 — docs/plans/session-path-identity-and-cicd-smoke.md).
//
//  Q6 org folder names are unique case-insensitively — a session identity
//     STARTS with the org folder name and the desktop keeps ONE dsh
//     conversation store for every org, so two `RESTO`s would mint colliding
//     identities. Git refs are case-sensitive, macOS folders are not, so
//     `resto` vs `RESTO` must be refused too.
//  Q7 identity is pinned at birth and never re-derived. Rename the org folder
//     on disk and the org opens `path-moved`: rows visible, resume refused,
//     restoring the name clears it. (Renaming the branch to catch up would
//     CLOSE any open PR — GitHub closes a PR whose head branch is renamed.)
//
// Also asserts the identity a real newSession actually mints, end to end.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOrgLifecycle } from './lib/lifecycle.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-path-id-'))
const other = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-path-id-other-'))
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-path-id-home-'))
const env = { ...process.env, ARXA_HOME: fakeHome }
let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok', n, '-', msg) }

try {
  const svc = createOrgLifecycle({ workspaceRoot: root, env })
  const orgA = svc.createOrg('RESTO')
  const orgName = path.basename(orgA.path)

  // ---- identity end to end -------------------------------------------------
  const h = await svc.openOrg(orgA.path)
  const s = await h.newSession(undefined, 'notes')
  assert.match(s.id, new RegExp(`^${orgName}/notes/note-wt-\\d{6}-001$`))
  ok(true, `newSession mints the full path identity (${s.id})`)
  assert.equal(s.branch, 'arxa/' + s.id)
  ok(true, 'the branch is `arxa/` + that identity — one string, not a second vocabulary')
  assert.equal(s.worktree, path.join(orgA.path, '.arxa/worktrees', s.id))
  ok(true, 'the worktree directory is the same path under the org worktrees root')
  assert.equal(s.name, s.id.split('/').pop())
  ok(true, 'the row label is the LEAF — the breadcrumb carries the folders')
  svc.closeOrg()

  // ---- Q6: duplicate org folder name --------------------------------------
  const svcOther = createOrgLifecycle({ workspaceRoot: other, env })
  assert.throws(() => svcOther.createOrg('RESTO'), /org-name-taken/)
  ok(true, 'creating a second org whose folder name is taken is refused before it registers')

  const stray = path.join(other, orgName)
  ok(fs.existsSync(stray), 'the refused scaffold is left on disk untouched — rename and add is the recovery')

  await assert.rejects(() => svcOther.openOrg(stray), /org-name-taken/)
  ok(true, 'opening it is refused too — open is the universal chokepoint before any mint')

  // Flip the case the OTHER way from whatever the org folder already uses, so
  // this never degenerates into comparing a name with itself.
  const flipped = orgName === orgName.toLowerCase() ? orgName.toUpperCase() : orgName.toLowerCase()
  assert.notEqual(flipped, orgName, 'fixture: the case-flipped name must actually differ')
  const cased = path.join(other, flipped)
  fs.renameSync(stray, cased)
  await assert.rejects(() => svcOther.openOrg(cased), /org-name-taken/)
  ok(true, `a case-only difference is refused ("${flipped}" vs "${orgName}" — git refs are case-sensitive, macOS folders are not)`)

  const reopened = await svc.openOrg(orgA.path)
  ok(reopened.path === orgA.path, 'the guard never blocks re-opening the SAME org')
  svc.closeOrg()

  // ---- Q7: folder renamed under pinned identities --------------------------
  const renamed = path.join(root, orgName + '-Renamed')
  fs.renameSync(orgA.path, renamed)
  const moved = await svc.openOrg(renamed)
  ok(moved.pathMoved !== null && moved.pathMoved !== undefined,
    'after a folder rename the org opens in path-moved rather than pretending')
  assert.equal(moved.pathMoved.actual, path.basename(renamed))
  assert.ok(moved.pathMoved.expected.includes(orgName))
  ok(true, `path-moved names both sides (expected "${orgName}", found "${path.basename(renamed)}")`)
  await assert.rejects(() => moved.resumeSession(s.id), /path-moved/)
  ok(true, 'resume REFUSES while drifted — never builds under a name that no longer describes reality')
  svc.closeOrg()

  // ---- Q7: restoring the folder name clears it ----------------------------
  fs.renameSync(renamed, orgA.path)
  const healed = await svc.openOrg(orgA.path)
  ok(!healed.pathMoved, 'restoring the folder name clears path-moved with no migration step')
  const revived = await healed.resumeSession(s.id)
  ok(revived.state === 'open', 'and the session resumes again')
  svc.closeOrg()

  console.log(`selftest.path-identity: ${n} checks passed`)
} finally {
  for (const d of [root, other, fakeHome]) fs.rmSync(d, { recursive: true, force: true })
}
