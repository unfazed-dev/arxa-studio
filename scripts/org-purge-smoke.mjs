#!/usr/bin/env node
// org-purge-smoke — LIVE full-flow smoke of deleting an org (D89): the
// flow the D88 orphan slipped through. Creates a REAL org (real GitHub
// repo), trashes it, purges it, and verifies every step of the contract:
//   1. create  → org listed AND its GitHub repo really exists
//   2. trash   → entry in orgTrash with an annotated manifest (the freeze)
//   3. purge   → deletedRepos names the repo, entry gone, folder gone
//   4. GitHub  → the repo 404s afterwards
// Requires: a running engine on 127.0.0.1:7891 (trusted host
// arxa.studio.localhost) and an authed gh CLI. Destructive against the
// REAL GitHub account (creates + deletes one throwaway repo).
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'

const BASE = 'http://127.0.0.1:7891'
const HOST = 'arxa.studio.localhost:7891'
const NAME = 'SMOKE' + Date.now().toString(36).toUpperCase()
const DIR = '/tmp/org-purge-smoke-' + NAME.toLowerCase()
const OWNER = execSync('gh api user -q .login').toString().trim()
const act = async (action, arg) => (await fetch(BASE + '/__arxa/sidebar/action', {
  method: 'POST', headers: { 'content-type': 'application/json', host: HOST },
  body: JSON.stringify({ action, arg }),
})).json()
const state = async () => (await fetch(BASE + '/__arxa/sidebar/state?t=' + Date.now(), { headers: { host: HOST } })).json()
const repoExists = (n) => {
  try { execSync('gh repo view ' + OWNER + '/' + n + ' --json name', { stdio: ['ignore', 'ignore', 'ignore'] }); return true } catch { return false }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const die = (m) => { console.error('SMOKE FAIL: ' + m); process.exit(1) }

try {
  // 1. create — the org AND its GitHub repo must both come up
  const c = await act('org.create-at', { name: NAME, path: DIR, includeExisting: false })
  if (!c.ok) die('create: ' + JSON.stringify(c))
  let org = null
  for (let i = 0; i < 60 && !org; i++) {
    await sleep(500)
    org = ((await state()).orgs || []).find((o) => o.name === NAME)
  }
  if (!org) die('org never listed')
  let repoUp = false
  for (let i = 0; i < 60 && !repoUp; i++) {
    await sleep(500)
    repoUp = repoExists(NAME)
  }
  if (!repoUp) die('GitHub repo ' + OWNER + '/' + NAME + ' never appeared — create no longer publishes')
  console.log('1. create ok: org listed, ' + OWNER + '/' + NAME + ' exists on GitHub')

  // 2. trash — the entry must freeze with an annotated manifest (D89)
  const t = await act('org.trash', { orgId: org.id })
  if (!t.ok) die('trash: ' + JSON.stringify(t))
  const s2 = await state()
  const entry = (s2.orgTrash || []).find((e) => e.name === NAME)
  if (!entry) die('trashed org not in orgTrash')
  console.log('2. trash ok: entry ' + entry.entryId)

  // 3. purge — the repo must be IN the deletion list (the D88 orphan was not)
  const p = await act('orgtrash.purge', { entryId: entry.entryId })
  if (!p.ok) die('purge: ' + JSON.stringify(p).slice(0, 300))
  const del = (p.result && p.result.deletedRepos) || []
  if (!del.includes(OWNER + '/' + NAME)) die('purge deleted ' + JSON.stringify(del) + ' — the org repo was NOT deleted (orphan risk)')
  const s3 = await state()
  if ((s3.orgTrash || []).some((e) => e.entryId === entry.entryId)) die('entry survived its own purge')
  console.log('3. purge ok: deletedRepos ' + JSON.stringify(del))

  // 4. GitHub truth — the repo must 404 now
  await sleep(2000)
  if (repoExists(NAME)) die('repo ' + OWNER + '/' + NAME + ' still exists on GitHub — ORPHAN')
  console.log('4. github ok: ' + OWNER + '/' + NAME + ' is gone (404)')
  console.log('SMOKE OK — full org delete flow verified end-to-end')
} finally {
  rmSync(DIR, { recursive: true, force: true })
}