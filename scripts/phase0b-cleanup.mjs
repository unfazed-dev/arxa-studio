#!/usr/bin/env node
// Phase 0b — destructive cleanup of the routing-bug residue (B2), with the
// plan's three preconditions enforced in code rather than remembered:
//   1. a recorded snapshot (`git branch -a` + `git worktree list` per org)
//      is written BEFORE anything is touched;
//   2. nothing is deleted unless `--apply` is passed AND no engine is
//      listening on the studio port AND no affected row is engine-open;
//   3. every candidate is re-verified live (0 commits ahead of main) at
//      apply time — the plan's "verified 0 commits" is not trusted from memory.
//
// Candidates (rewire.md:220-236): project-annotated rows living in an ORG
// registry (they belong to the project repo — B2's residue), ghost rows whose
// project directory no longer exists, and worktree directories git no longer
// lists. Default is a dry run that prints the exact plan.
//
// Usage: node scripts/phase0b-cleanup.mjs [--apply] [--org NAME]... [--port 7891]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const port = Number(args[args.indexOf('--port') + 1] || 7891)
const onlyOrgs = args.flatMap((a, i) => (a === '--org' ? [args[i + 1]] : []))

const git = (cwd, a) => {
  try { return execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
}
const orgRoots = () => {
  const f = path.join(os.homedir(), '.arxa', 'organisation.json')
  const j = JSON.parse(fs.readFileSync(f, 'utf8'))
  const list = Array.isArray(j) ? j : (j.organisations || j.orgs || Object.values(j))
  return list.map((o) => (typeof o === 'string' ? o : o.path)).filter((p) => p && fs.existsSync(p))
}
const engineListening = () => {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return out.trim().split('\n').length > 1
  } catch { return false }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const snapDir = path.join(process.cwd(), 'docs', 'plans', 'phase0b-snapshots')
fs.mkdirSync(snapDir, { recursive: true })
const snapFile = path.join(snapDir, `${stamp}.md`)
const snap = [`# Phase 0b snapshot — ${stamp}`, '', `mode: ${apply ? 'APPLY' : 'dry-run'}  port: ${port}  engine listening: ${engineListening()}`, '']

const plan = []
for (const root of orgRoots()) {
  const org = path.basename(root)
  if (onlyOrgs.length && !onlyOrgs.includes(org)) continue
  const common = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (!common) continue
  snap.push(`## ${org} (${root})`, '', '```', `$ git branch -a`, git(root, ['branch', '-a']) ?? '', '', `$ git worktree list --porcelain`, git(root, ['worktree', 'list', '--porcelain']) ?? '', '```', '')
  const regPath = path.join(common, 'arxa', 'sessions.json')
  const reg = fs.existsSync(regPath) ? JSON.parse(fs.readFileSync(regPath, 'utf8')) : { sessions: [] }
  const gitWts = new Set((git(root, ['worktree', 'list', '--porcelain']) ?? '').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9)))

  for (const row of reg.sessions || []) {
    const ws = row.workspace || ''
    if (!ws.startsWith('projects/')) continue
    const slug = ws.split('/')[1]
    const projectExists = fs.existsSync(path.join(root, 'projects', slug))
    const ahead = row.branch ? git(root, ['rev-list', '--count', `main..${row.branch}`]) : '0'
    const engineOpen = row.dshStatus && row.dshStatus !== 'closed' && row.state === 'open'
    plan.push({
      org, root, regPath, kind: projectExists ? 'project-row-in-org-registry' : 'ghost-row-missing-project',
      id: row.id, branch: row.branch, worktree: row.worktree, state: row.state, ahead: Number(ahead ?? 0), engineOpen: Boolean(engineOpen),
    })
  }
  const wtDir = path.join(root, '.arxa', 'worktrees')
  if (fs.existsSync(wtDir)) {
    for (const d of fs.readdirSync(wtDir)) {
      const abs = path.join(wtDir, d)
      if (!fs.statSync(abs).isDirectory()) continue // .gitkeep etc.
      if (!gitWts.has(abs)) plan.push({ org, root, kind: 'orphan-worktree-dir', id: d, worktree: abs, ahead: 0, engineOpen: false })
    }
  }
}

snap.push('## Plan', '', '| org | kind | id | branch | ahead | engine-open | action |', '|---|---|---|---|---|---|---|')
const blockers = []
for (const p of plan) {
  let action
  if (p.engineOpen) { action = 'SKIP (engine holds it open)'; blockers.push(p) }
  else if (p.ahead > 0) { action = `SKIP (${p.ahead} commit(s) ahead of main — not a husk)`; blockers.push(p) }
  else if (p.kind === 'orphan-worktree-dir') action = 'rm dir + worktree prune'
  else action = 'drop row + branch -D + worktree prune'
  p.action = action
  snap.push(`| ${p.org} | ${p.kind} | ${p.id} | ${p.branch ?? '-'} | ${p.ahead} | ${p.engineOpen} | ${action} |`)
}
fs.writeFileSync(snapFile, snap.join('\n') + '\n')
console.log(`snapshot: ${path.relative(process.cwd(), snapFile)}`)
console.log(`${plan.length} candidate(s): ${plan.filter((p) => !p.action.startsWith('SKIP')).length} actionable, ${blockers.length} skipped`)
for (const p of plan) console.log(`  ${p.org.padEnd(6)} ${p.kind.padEnd(28)} ${p.id.padEnd(20)} ahead=${p.ahead} -> ${p.action}`)

if (!apply) { console.log('\ndry-run — pass --apply to execute (refused while an engine is listening)'); process.exit(0) }
if (engineListening()) { console.error(`\nREFUSED: an engine is listening on ${port}; stop it first (precondition 2)`); process.exit(2) }

let done = 0
for (const p of plan) {
  if (p.action.startsWith('SKIP')) continue
  if (p.kind !== 'orphan-worktree-dir') {
    const reg = JSON.parse(fs.readFileSync(p.regPath, 'utf8'))
    reg.sessions = (reg.sessions || []).filter((r) => r.id !== p.id)
    fs.writeFileSync(p.regPath, JSON.stringify(reg, null, 2) + '\n')
    if (p.worktree && fs.existsSync(p.worktree)) git(p.root, ['worktree', 'remove', '--force', p.worktree])
    if (p.branch) git(p.root, ['branch', '-D', p.branch])
  } else if (fs.existsSync(p.worktree)) {
    fs.rmSync(p.worktree, { recursive: true, force: true })
  }
  git(p.root, ['worktree', 'prune'])
  done++
}
console.log(`\napplied ${done} action(s); snapshot kept at ${snapFile}`)
