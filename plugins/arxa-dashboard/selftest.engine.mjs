#!/usr/bin/env node
/**
 * arxa-dashboard engine selftest — docs/plans/org-row-dashboard.md §4 step 6 (D5).
 * The reader is RUN over a fake filesystem. The point of almost every check is
 * the same one: a project that never ran the engine must report NULL, not a
 * default phase and not a zero.
 * Run: node plugins/arxa-dashboard/selftest.engine.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PHASES, engineFor, engineOf } from './lib/engine.js'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const fs = (files) => (p) => (p in files ? files[p] : null)

// ---- the phase list is the engine's own -------------------------------------
check('the phase order matches arxa/lib/phases.dart',
  PHASES.join(',') === 'intake,prototype,design,scaffold,review,build,deploy')

// ---- a project that never ran the engine ------------------------------------
check('no pipeline/ and no structure.json ⇒ null, so the row can say "not set up"',
  engineOf(fs({}), '/p', 'p') === null)
check('engineFor over projects that never ran ⇒ not-set-up, and it SAYS how many it scanned',
  (() => {
    const e = engineFor({ readJson: fs({}), row: { kind: 'org' }, repos: [{ path: '/a', name: 'a' }, { path: '/b', name: 'b' }] })
    return e.reason === 'not-set-up' && e.scanned === 2 && e.projects.length === 0
  })())
check('a category row has no engine data by construction and states it (the card never vanishes — a hole in the bento)',
  engineFor({ readJson: fs({}), row: { kind: 'category' }, repos: [] }).reason === 'not-applicable')

// ---- StateReader precedence --------------------------------------------------
{
  const files = {
    '/p/pipeline/state/run.state.json': { phase: 'build' },
    '/p/pipeline/state/default.state.json': { phase: 'intake' },
  }
  check('run.state.json wins over default.state.json (gates.dart StateReader precedence)',
    engineOf(fs(files), '/p', 'p').phase === 'build')
  delete files['/p/pipeline/state/run.state.json']
  check('default.state.json is the fallback when there is no live run',
    engineOf(fs(files), '/p', 'p').phase === 'intake')
}

// ---- the honest shape --------------------------------------------------------
{
  const e = engineOf(fs({
    '/p/pipeline/state/default.state.json': {
      phase: 'scaffold', dirty: false, targets: ['ios', 'android'], updatedAt: '2026-09-01T00:00:00Z',
      phaseStatus: { scaffold: { status: 'failed', attempts: 2 } }, review: { approved: false, rejections: 0 },
    },
    '/p/design/structure.json': { screens: [1, 2, 3], shellRoots: {}, flows: [1] },
    '/p/pipeline/state/deploy-ledger.json': { attempts: [{ status: 'shipped' }, { status: 'halted' }, { status: 'shipped' }] },
  }), '/p', 'p')
  check('phase, its position in the run, gate status and attempts all come off the state file',
    e.phase === 'scaffold' && e.step === 4 && e.steps === 7 && e.status === 'failed' && e.attempts === 2, JSON.stringify(e))
  check('rejections: 0 written by initPipeline IS a real zero and is reported as one', e.rejections === 0 && e.approved === false)
  check('structure.json supplies screens and flows', e.screens === 3 && e.flows === 1)
  check('the deploy ledger is counted by status, shipped and halted separately', e.shipped === 2 && e.halted === 1)
  check('targets and updatedAt ride along', e.targets.join(',') === 'ios,android' && e.updatedAt === '2026-09-01T00:00:00Z')
}

// ---- absent ⇒ null, never zero ----------------------------------------------
{
  const e = engineOf(fs({ '/p/design/structure.json': { screens: [], shellRoots: {} } }), '/p', 'p')
  check('structure.json alone ⇒ the project is known but its phase is null, NOT "intake"', e !== null && e.phase === null && e.step === null)
  check('an empty screens array is a real 0 (the file states it); flows absent is null, not 0', e.screens === 0 && e.flows === null)
  check('no deploy ledger ⇒ shipped/halted null, never 0 — nobody said no deploy ever happened', e.shipped === null && e.halted === null)
  check('no state file ⇒ dirty, rejections, attempts, targets, updatedAt all null',
    e.dirty === null && e.rejections === null && e.attempts === null && e.targets === null && e.updatedAt === null, JSON.stringify(e))
}
check('a phase the engine does not know is refused, not passed through',
  engineOf(fs({ '/p/pipeline/state/run.state.json': { phase: 'sideways' } }), '/p', 'p').phase === null)
check('malformed phaseStatus does not throw and yields null status',
  engineOf(fs({ '/p/pipeline/state/run.state.json': { phase: 'build', phaseStatus: 'nope' } }), '/p', 'p').status === null)

// ---- roll-up -----------------------------------------------------------------
{
  const files = {
    '/a/pipeline/state/run.state.json': { phase: 'deploy' },
    '/b/pipeline/state/run.state.json': { phase: 'design' },
    '/a/pipeline/state/deploy-ledger.json': { attempts: [{ status: 'shipped' }] },
  }
  const e = engineFor({ readJson: fs(files), row: { kind: 'org' }, repos: [{ path: '/a', name: 'a' }, { path: '/b', name: 'b' }, { path: '/c', name: 'c' }] })
  check('the org roll-up reports the LEAST advanced project as the phase', e.phase === 'design', e.phase)
  check('the roll-up counts only projects that actually ran, and keeps the scanned total', e.withEngine === 2 && e.scanned === 3)
  check('shipped sums the projects that HAVE a ledger; a project without one does not add a zero', e.shipped === 1)
}
{
  const e = engineFor({ readJson: fs({ '/a/design/structure.json': { screens: [] } }), row: { kind: 'org' }, repos: [{ path: '/a', name: 'a' }] })
  check('no project has a deploy ledger ⇒ the roll-up shipped is null, never 0', e.shipped === null)
}

// ---- evidence/ is never walked -----------------------------------------------
const engineSrc = readFileSync(join(here, 'lib', 'engine.js'), 'utf8')
// The whole point of the file contract is that it stays cheap: an org roll-up
// reads a handful of KB per project, never the 1.5 MB evidence/ tree and never
// the event log that rotates at 50 MB.
check('the reader lists no directory and reads no log — only named JSON files',
  !/readdirSync|readdir\(|glob|events\.jsonl|\/evidence/.test(engineSrc))
check('the reader never shells out — D5 chose files over the arxa binary (PATH fragility)',
  !/spawn|exec|child_process/.test(engineSrc))

// ---- wiring ------------------------------------------------------------------
const host = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
check('host: the row.engine verb is registered and reads through the shared JSON reader',
  host.includes("'row.engine': async () =>") && host.includes('engineFor({ readJson, row, repos: reposFor(row) })'))
check('client: the Engine card renders EngineBody, not the "soon" placeholder',
  client.includes("hook: 'engine'") && client.includes('h(EngineBody, { e: engine })') && !/hook: 'engine'[^\n]*group\.soon/.test(client))
check('client: engine is its own request, so a big project tree cannot block the sessions card',
  /postAction\(ROUTE, 'row\.engine'/.test(client))
check('client: an unknown engine figure prints an em dash, never a zero',
  client.includes("e.shipped === null || e.shipped === undefined ? '\\u2014'") && client.includes("p.screens === null ? '\\u2014'"))
const dictKeys = ['engine.not-set-up', 'engine.not-applicable', 'engine.phaseKey', 'engine.phaseNote', 'engine.withEngine', 'engine.shipped', 'engine.step', 'engine.screens', 'engine.screensNote', 'engine.someMissing', 'engine.phase.unknown', ...PHASES.map((p) => 'engine.phase.' + p)]
check('client: every engine key exists in all three dictionaries',
  dictKeys.every((k) => (client.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length === 3),
  dictKeys.filter((k) => (client.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length !== 3).join(', '))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
