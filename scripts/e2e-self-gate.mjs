#!/usr/bin/env node
// E2E: does arxa's own scaffold pass arxa's own gate?
//
// This is the check that should always have existed. Without it arxa shipped
// commit subjects its own frame gate rejects:
//   B17 — the project migration commit (`migrate: …`)
//   B18 — the org migration commit pair (`stage: …`)
//   B20 — the DETACHED snapshot worker (`stage: scaffold organisation`), whose
//         subject had silently diverged from the sync path the tests use, so
//         every real org's first commit failed the gate while the suite was green
// Each one reddened a user's repo on a commit the user never wrote and cannot
// amend, which is the least defensible kind of CI failure there is.
//
// Run: node scripts/e2e-self-gate.mjs      (exit 0 = arxa's output is gate-clean)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = new URL('..', import.meta.url).pathname
const ws = await import(ROOT + 'plugins/workspace/lib/index.js')
const gw = await import(ROOT + 'plugins/git-workspace/lib/index.js')
const { SUBJECT_RE } = await import(ROOT + 'plugins/git-workspace/lib/frame.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-selfgate-'))
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }))

const orgDir = path.join(root, 'ACME')
fs.mkdirSync(orgDir, { recursive: true })
const org = ws.scaffoldOrg(orgDir, 'Acme')
gw.initOrgRepo(org.path) // makes the initial commit itself

const proj = ws.scaffoldProject(org.path, 'Site', { targets: { application: ['ios'] } })
gw.initProjectRepo(proj.path)

// The frame, written and committed exactly as lifecycle does it.
for (const [d, kind] of [[org.path, 'org'], [proj.path, 'project']]) {
  gw.writeFrameFiles(d, kind, { includeCiYml: true })
  execFileSync('git', ['add', '-A'], { cwd: d })
  try {
    execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm',
      'chore(ci): wire the arxa frame (checks, workflow, PR template)'], { cwd: d, stdio: 'ignore' })
  } catch { /* nothing to commit is fine */ }
}

const run = (d) => {
  try {
    execFileSync('sh', ['./check.sh'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { rc: 0, out: '' }
  } catch (e) {
    return { rc: e.status ?? 1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }
  }
}

let bad = 0
console.log("=== does arxa's own scaffold pass arxa's own gate? ===")
for (const [label, d] of [['org', org.path], ['project', proj.path]]) {
  const r = run(d)
  if (r.rc !== 0) {
    bad++
    const why = r.out.split('\n').find((l) => l.includes('FAIL')) ?? r.out.slice(0, 100)
    console.log(`${label.padEnd(8)} exit=${r.rc}  <- ${why}`)
  } else {
    console.log(`${label.padEnd(8)} exit=0  OK`)
  }
}

console.log('\n=== every subject arxa wrote, against the gate\'s own regex ===')
for (const [label, d] of [['org', org.path], ['project', proj.path]]) {
  for (const s of execFileSync('git', ['log', '--format=%s'], { cwd: d, encoding: 'utf8' }).trim().split('\n')) {
    const okay = SUBJECT_RE.test(s)
    if (!okay) bad++
    console.log(`  ${okay ? 'ok  ' : 'BAD '} ${label.padEnd(8)} ${s}`)
  }
}

console.log(bad ? `\nFAIL: ${bad} problem(s)` : "\nPASS: arxa's own output is gate-clean")
process.exit(bad ? 1 : 0)
