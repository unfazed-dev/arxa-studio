#!/usr/bin/env node
/**
 * arxa-git-card selftest (static) — docs/plans/git-card-stock-dock-rebuild.md.
 * Source-shape checks over the host half (the card.* engine rules that moved
 * out of arxa-sidebar on 2026-09-02) and over the seam it depends on: the
 * sidebar must publish its org shell (sidebarHost + orgContext) and must no
 * longer own any card.* / insight.* action. Behaviour lives in
 * selftest.actions.mjs. Run: node plugins/arxa-git-card/selftest.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const hostSrc = () => readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const sidebarSrc = readFileSync(join(here, '..', 'arxa-sidebar', 'lib', 'index.js'), 'utf8')
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// ---- seam: the sidebar publishes, the card consumes ----------------------
check('seam: sidebar exports sidebarHost + publishes it under Symbol.for(\'arxa.sidebar.host\')',
  sidebarSrc.includes('export const sidebarHost = { ready: false }') && sidebarSrc.includes("Symbol.for('arxa.sidebar.host')") && sidebarSrc.includes('globalThis[SIDEBAR_HOST_KEY] = sidebarHost'))
check('seam: sidebar host object carries orgContext + getGithub + mainChecksFor + importGitWorkspace',
  ['orgContext: async () =>', 'getGithub,', 'mainChecksFor,', 'importGitWorkspace,'].every((s) => sidebarSrc.includes(s)))
check('seam: sidebar no longer owns any card.* / insight.* / version.mint action',
  !/'(card|insight)\.[a-z.]+': async/.test(sidebarSrc) && !sidebarSrc.includes("'version.mint'"))
check('seam: card host reads the published object first, imports as fallback',
  hostSrc().includes("Symbol.for('arxa.sidebar.host')") && hostSrc().includes("import('arxa-sidebar')") && hostSrc().includes('../../arxa-sidebar/lib/index.js'))
check('seam: card host serves POST /__arxa/git-card/action and dispatches the twelve actions',
  hostSrc().includes("path: '/__arxa/git-card/action'") && ['card.status', 'card.commit.draft', 'card.commit', 'card.push', 'card.pr.create', 'card.pr.status', 'card.pr.merge', 'version.mint', 'card.runner.wake', 'insight.streak', 'insight.ci', 'insight.sessions'].every((a) => hostSrc().includes("'" + a + "': async")))

// ---- engine rules (moved verbatim from arxa-sidebar/selftest.mjs) ---------
check('card: engine exposes the six card actions (S3)', ['card.status', 'card.commit.draft', 'card.commit', 'card.push', 'card.pr.create', 'card.pr.status'].every((a) => hostSrc().includes("'" + a + "'")))
check('card: commit validates the conventional-subject law (Q7)', hostSrc().includes('subject-not-conventional') && hostSrc().includes('SUBJECT_RE.test(subject)'))
check('card: draft returns evidence only — the engine never drafts (Q6)', hostSrc().includes('card.commit.draft') && hostSrc().includes('EVIDENCE ONLY'))
check('card: PR title validated (becomes the squash subject, Q7/Q8)', hostSrc().includes('title-not-conventional'))
check('card: PR create dedupes before opening (file-pr rule 1)', hostSrc().includes('prListForHead') && hostSrc().includes('existing: true'))
check('card: session-branch push is PR-purpose only (D73 relaxation)', hostSrc().includes('card.push serves session seats'))

console.log(failures === 0 ? '\narxa-git-card selftest: ALL GREEN' : `\narxa-git-card selftest: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
