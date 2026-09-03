#!/usr/bin/env node
// Q14 follow-up records: trailers, the stage ledger, and its PR-body fence.
// The ledger's whole promise is that the RECORD survives without GitHub, so
// everything here runs against a real registry and never touches the network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initOrgRepo, openSession, wipCommit,
  sessionTrailers, agentCoAuthor, readLedger, recordStage, renderLedger, withLedger, STAGES,
} from './lib/index.js'

let passed = 0
const ok = (label, fn) => { fn(); passed++; console.log(`ok ${passed} - ${label}`) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-ledger-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

ok('trailers: identity and attribution, each optional but the session always present', () => {
  const t = sessionTrailers({ id: 'RESTO/notes/note-wt-260903-001', container: 'notes', actor: 'Evan', coAuthor: 'M <m@x.invalid>' })
  assert.equal(t.split('\n')[0], 'Arxa-Session: RESTO/notes/note-wt-260903-001')
  assert.ok(t.includes('Arxa-Container: notes'))
  assert.ok(t.includes('Arxa-Actor: Evan'))
  assert.ok(t.includes('Co-authored-by: M <m@x.invalid>'))
  // Every line is a real trailer key — `git interpret-trailers` needs `Key: value`.
  for (const line of t.split('\n')) assert.match(line, /^[A-Za-z-]+: .+$/)
  assert.equal(sessionTrailers({ id: 'x' }), 'Arxa-Session: x')
})

ok('trailers: a bare model name becomes a Co-authored-by GitHub will accept', () => {
  // GitHub silently drops a co-author without an address, so a bare name has
  // to grow a stable one rather than be passed through and quietly ignored.
  assert.equal(agentCoAuthor('Claude Opus 5'), 'Claude Opus 5 <claude-opus-5@arxa.invalid>')
  assert.equal(agentCoAuthor('Al <al@real.com>'), 'Al <al@real.com>', 'a real address is left alone')
  assert.equal(agentCoAuthor(''), null)
  assert.equal(agentCoAuthor(null), null)
})

ok('ledger: stages append to the registry row and survive re-reads', () => {
  const org = path.join(tmp, 'Acme')
  fs.mkdirSync(path.join(org, 'notes'), { recursive: true })
  fs.writeFileSync(path.join(org, 'org.json'), '{"name":"Acme"}\n')
  initOrgRepo(org)
  wipCommit(org, { message: 'seed' })
  const id = 'Acme/notes/note-wt-260903-001'
  openSession(org, { id, workspace: 'notes' })

  assert.deepEqual(readLedger(org, id), [], 'a fresh session has an empty ledger')
  recordStage(org, id, { stage: 'committed', actor: 'Evan', sha: 'abcdef1234', detail: 'feat: thing' })
  recordStage(org, id, { stage: 'checks', actor: 'github actions', result: 'red' })
  recordStage(org, id, { stage: 'checks', actor: 'github actions', result: 'green' })
  const l = readLedger(org, id)
  assert.equal(l.length, 3)
  assert.equal(l[0].sha, 'abcdef1', 'the sha is stored short')
  // A re-run APPENDS. "went red, then green after a fix" is the history worth
  // keeping; collapsing to the last outcome would hide exactly that.
  assert.deepEqual(l.filter((e) => e.stage === 'checks').map((e) => e.result), ['red', 'green'])
  assert.ok(l.every((e) => typeof e.at === 'string' && e.at.endsWith('Z')), 'every row is stamped UTC')
  assert.throws(() => recordStage(org, id, {}), /stage is required/)
})

ok('ledger: renders a table with a Next: line, and survives a pipe in the detail', () => {
  const md = renderLedger(
    [{ stage: 'committed', actor: 'Evan | boss', result: 'ok', sha: 'abcdef1', at: '2026-09-03T10:00:00Z', detail: 'a|b' }],
    { sessionId: 'Acme/notes/n-wt-260903-001', container: 'notes', next: 'a human reviewer' },
  )
  assert.ok(md.includes('| stage | actor | result | sha | when (UTC) | detail |'))
  assert.ok(md.includes('**Next:** a human reviewer'))
  assert.ok(md.includes('`Acme/notes/n-wt-260903-001`'))
  // An unescaped pipe would silently break the table into the wrong columns.
  assert.ok(md.includes('Evan \\| boss') && md.includes('a\\|b'))
  assert.ok(renderLedger([]).includes('no stages recorded yet'), 'an empty ledger still renders a table')
})

ok('ledger: the PR-body fence replaces in place and never duplicates', () => {
  const prose = 'Problem\n\nFix'
  const one = withLedger(prose, 'TABLE-1')
  assert.ok(one.startsWith('Problem'), 'the human prose is kept')
  assert.ok(one.includes('TABLE-1'))
  const two = withLedger(one, 'TABLE-2')
  assert.ok(two.includes('TABLE-2') && !two.includes('TABLE-1'), 'the table is replaced, not appended')
  assert.equal(two.match(/arxa:ledger/g).length, 2, 'exactly one fence (open + close)')
  // Nine stages must not leave nine tables behind.
  let body = prose
  for (let i = 0; i < 9; i++) body = withLedger(body, 'T' + i)
  assert.equal(body.match(/<!-- arxa:ledger -->/g).length, 1)
  assert.ok(body.includes('T8') && !body.includes('T7'))
  // A reviewer's edits on either side of the fence survive the next stage.
  const edited = two.replace('Problem', 'Problem (edited by a reviewer)') + '\n\nTrailing note.'
  const after = withLedger(edited, 'TABLE-3')
  assert.ok(after.includes('edited by a reviewer') && after.includes('Trailing note.') && after.includes('TABLE-3'))
})

ok('ledger: STAGES names the whole life of a session, in order', () => {
  assert.deepEqual([...STAGES], ['opened', 'committed', 'pushed', 'checks', 'gate', 'review', 'merged', 'archived', 'cleaned'])
})

console.log(`\nledger selftest: ${passed} checks passed`)
