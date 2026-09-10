#!/usr/bin/env node
/**
 * arxa-dashboard selftest — tier-1 git/file figures (docs/plans/org-row-dashboard.md §4 step 3).
 * Drives lib/repo.js over a throwaway org repo with one nested project repo,
 * through git-workspace's runGit (allowFail) — the same runner the host injects.
 * Run: node plugins/arxa-dashboard/selftest.repo.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '../git-workspace/lib/run.js'
import { activityOf, dayCounts, reposFor, repositoryOf, sinceFor, streaks, timesOf, weekly } from './lib/repo.js'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const run = (args, cwd) => runGit(args, { cwd, env: process.env, allowFail: true })
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const today = ymd(new Date())
const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d) }

// ---- fixture: org repo with notes/ + projects/peter (own repo) ----
const org = mkdtempSync(join(tmpdir(), 'arxa-dash-org-'))
const commit = (cwd, file, msg, daysAgo) => {
  mkdirSync(join(cwd, file.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
  writeFileSync(join(cwd, file), msg + '\n')
  const date = back(daysAgo) + 'T12:00:00'
  runGit(['add', '-A'], { cwd })
  runGit(['commit', '-q', '-m', msg], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'Tester', GIT_AUTHOR_EMAIL: 't@x' } })
}
runGit(['init', '-q', '-b', 'main'], { cwd: org })
commit(org, 'org.json', 'init', 3)
commit(org, 'notes/a.md', 'notes a', 2)
commit(org, 'notes/b.md', 'notes b', 1)
commit(org, 'meetings/m.md', 'meeting', 0)
const proj = join(org, 'projects', 'peter')
mkdirSync(proj, { recursive: true })
runGit(['init', '-q', '-b', 'main'], { cwd: proj })
commit(proj, 'src/index.js', 'peter init', 10)
commit(proj, 'src/util.js', 'peter util', 0)
runGit(['branch', 'feature/x'], { cwd: proj })
writeFileSync(join(proj, 'src/index.js'), 'changed\n')          // modified
writeFileSync(join(proj, 'README.md'), 'new\n')                 // untracked
mkdirSync(join(org, 'projects', 'plain'))                       // no .git → not a repo

const orgRow = { kind: 'org', name: 'ORG', path: org, orgPath: org }
const notesRow = { kind: 'category', name: 'notes', path: join(org, 'notes'), orgPath: org }
const projRow = { kind: 'project', name: 'peter', path: proj, orgPath: org }

check('sinceFor: 30/90/365 → days, all → null, junk → 90 days',
  sinceFor(30) === '30 days' && sinceFor('365') === '365 days' && sinceFor('all') === null && sinceFor(undefined) === '90 days' && sinceFor('../x') === '90 days')
const orgRepos = reposFor(orgRow)
check('reposFor: org = org repo + every projects/<x> WITH .git (plain folder skipped)',
  orgRepos.length === 2 && orgRepos[0].path === org && orgRepos[1].path === proj && orgRepos[1].name === 'peter', JSON.stringify(orgRepos))
check('reposFor: category = org repo restricted by pathspec; project = its own repo',
  JSON.stringify(reposFor(notesRow)) === JSON.stringify([{ path: org, pathspec: 'notes', name: 'notes' }]) && reposFor(projRow)[0].path === proj && reposFor(projRow)[0].pathspec === null)

const notesCounts = dayCounts(run, reposFor(notesRow), '90 days')
check('dayCounts: pathspec keeps only the folder\'s commits', notesCounts.size === 2 && notesCounts.get(back(2)) === 1 && notesCounts.get(back(1)) === 1, JSON.stringify([...notesCounts]))
const orgCounts = dayCounts(run, orgRepos, '90 days')
check('dayCounts: org rolls projects up (6 commits, 5 days)', [...orgCounts.values()].reduce((a, b) => a + b, 0) === 6 && orgCounts.size === 5, JSON.stringify([...orgCounts]))

check('streaks: today counts, run ending today = 4', JSON.stringify(streaks(orgCounts, today)) === JSON.stringify({ current: 4, longest: 4 }), JSON.stringify(streaks(orgCounts, today)))
check('streaks: no commit today → run ending yesterday still counts (in-progress day)',
  streaks(new Map([[back(1), 1], [back(2), 1]]), today).current === 2 && streaks(new Map(), today).current === 0)
const w = weekly(orgCounts, 13, today)
check('weekly: 13 buckets, this week holds today..6 days back, older commits land earlier', w.length === 13 && w[12] === 5 && w[11] === 1 && w.slice(0, 11).every((n) => n === 0), JSON.stringify(w))

const act = activityOf(run, orgRepos, { since: '90 days', today })
check('activityOf: days ascending, commits, streaks, weeks', act.commits === 6 && act.days.length === 5 && act.days[0].day < act.days[4].day && act.current === 4 && act.weeks.length === 13, JSON.stringify(act))
check('activityOf: 30-day window drops the 10-day-old? no — keeps it; all-time = null since', activityOf(run, orgRepos, { since: '5 days', today }).commits === 5 && activityOf(run, orgRepos, { since: null, today }).commits === 6)

const rp = repositoryOf(run, reposFor(projRow))
check('repositoryOf(project): tracked+untracked files, folders, branches, contributors, last commit, dirty',
  rp.files === 3 && rp.folders === 1 && rp.branches === 2 && rp.contributors === 1 && rp.lastCommit && rp.lastCommit.subject === 'peter util' && typeof rp.lastCommit.author === 'string' && rp.lastCommit.author !== '' && rp.dirty.modified === 1 && rp.dirty.untracked === 1 && rp.dirty.added === 0 && rp.repos === 1, JSON.stringify(rp))
const rn = repositoryOf(run, reposFor(notesRow))
check('repositoryOf(category): only the folder (2 files, 1 folder), branches not counted, clean', rn.files === 2 && rn.folders === 1 && rn.branches === 0 && rn.lastCommit.subject === 'notes b' && Object.values(rn.dirty).every((n) => n === 0), JSON.stringify(rn))
const ro = repositoryOf(run, orgRepos)
check('repositoryOf(org): roll-up — files 4+3, folders 2+1 (the nested repo dir is NOT listed as an untracked entry), repos 2, newest commit wins',
  ro.files === 7 && ro.folders === 3 && ro.dirty.untracked === 1 && ro.repos === 2 && ro.branches === 3 && ['meeting', 'peter util'].includes(ro.lastCommit.subject), JSON.stringify(ro))

const empty = mkdtempSync(join(tmpdir(), 'arxa-dash-empty-'))
runGit(['init', '-q', '-b', 'main'], { cwd: empty })
const eRow = { kind: 'project', name: 'e', path: empty, orgPath: empty }
const ea = activityOf(run, reposFor(eRow)); const er = repositoryOf(run, reposFor(eRow))
check('empty repo: zeros and null, never a throw', ea.commits === 0 && ea.current === 0 && ea.days.length === 0 && er.files === 0 && er.lastCommit === null && er.branches === 0, JSON.stringify({ ea, er }))
const na = activityOf(run, [{ path: join(empty, 'nope'), pathspec: null, name: 'x' }])
check('missing path: zeros, never a throw', na.commits === 0)

const tm = timesOf(org, rp.lastCommit.at)
check('timesOf: ISO created + updated (newest of mtime / last commit); missing path → nulls',
  typeof tm.createdAt === 'string' && !Number.isNaN(Date.parse(tm.createdAt)) && Date.parse(tm.updatedAt) >= Date.parse(rp.lastCommit.at) && timesOf('/nope/x', null).createdAt === null && timesOf('/nope/x', null).updatedAt === null, JSON.stringify(tm))

console.log(failures === 0 ? '\nOK arxa-dashboard repo selftest' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
