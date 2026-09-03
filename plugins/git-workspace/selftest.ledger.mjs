#!/usr/bin/env node
// Q14 follow-up records: trailers, the stage ledger, and its PR-body fence.
// The ledger's whole promise is that the RECORD survives without GitHub, so
// everything here runs against a real registry and never touches the network.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  initOrgRepo, openSession, wipCommit,
  sessionTrailers, agentCollaborator, readLedger, recordStage, renderLedger, withLedger, STAGES,
  stageComment, rowAuthor,
  stageTime, readableTime,
} from './lib/index.js'

let passed = 0
const ok = (label, fn) => { fn(); passed++; console.log(`ok ${passed} - ${label}`) }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-ledger-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

ok('trailers: identity and attribution, each optional but the session always present', () => {
  const t = sessionTrailers({ id: 'RESTO/notes/note-wt-260903-001', container: 'notes', author: 'unfazed-dev', collaborator: 'Claude Opus 5@(high)' })
  assert.equal(t.split('\n')[0], 'Arxa-Session: RESTO/notes/note-wt-260903-001')
  assert.ok(t.includes('Arxa-Container: notes'))
  assert.ok(t.includes('Arxa-Author: unfazed-dev'))
  assert.ok(t.includes('Arxa-Collaborator: Claude Opus 5@(high)'))
  assert.ok(!/Co-authored-by/.test(t), 'Co-authored-by is gone — Arxa-Collaborator replaced it')
  // `actor` still works as an alias so a half-migrated caller records someone
  // rather than silently dropping the identity.
  assert.ok(sessionTrailers({ id: 'x', actor: 'legacy' }).includes('Arxa-Author: legacy'))
  // Every line is a real trailer key — `git interpret-trailers` needs `Key: value`.
  for (const line of t.split('\n')) assert.match(line, /^[A-Za-z-]+: .+$/)
  assert.equal(sessionTrailers({ id: 'x' }), 'Arxa-Session: x')
})

ok('collaborator: the effort half always renders, never invented', () => {
  assert.equal(agentCollaborator('Claude Opus 5', 'high'), 'Claude Opus 5@(high)')
  // An absent effort renders `unspecified` rather than a level nobody supplied
  // — and stays greppable, so "which commits predate effort tracking" is still
  // an answerable question.
  assert.equal(agentCollaborator('Claude Opus 5'), 'Claude Opus 5@(unspecified)')
  assert.equal(agentCollaborator('Claude Opus 5', '  '), 'Claude Opus 5@(unspecified)')
  assert.equal(agentCollaborator(''), null)
  assert.equal(agentCollaborator(null), null)
})

ok('rows written before the rename still render their author', () => {
  // Every ledger published before 2026-09-03 carries `actor`, not `author`.
  assert.equal(rowAuthor({ actor: 'Evan F Pierre Louis' }), 'Evan F Pierre Louis')
  assert.equal(rowAuthor({ author: 'unfazed-dev', actor: 'ignored' }), 'unfazed-dev')
  const table = renderLedger([{ stage: 'merged', actor: 'Evan F Pierre Louis', result: 'ok', at: '2026-09-03T05:45:40Z' }], { sessionId: 's' })
  assert.ok(table.includes('Evan F Pierre Louis'), 'an old row is not rendered as an em-dash')
})

ok('stageComment: one builder, carrying the recorded time', () => {
  const row = { stage: 'committed', author: 'unfazed-dev', collaborator: 'Claude Opus 5@(high)', result: 'ok', sha: 'abcdef1234', detail: 'feat: x', ...stageTime(new Date('2026-09-03T05:44:00Z')) }
  const body = stageComment(row)
  assert.ok(body.startsWith('**arxa · committed**'))
  assert.ok(body.includes('_unfazed-dev_ · ok · `abcdef1`'), 'author, result and sha all present')
  assert.ok(body.includes('Collaborator: Claude Opus 5@(high)'))
  // The whole point: GitHub stamps its own posting time in the READER's zone,
  // so the recorded instant has to travel in the body.
  assert.ok(/2026-09-03 05:44:00 UTC/.test(body), 'the recorded UTC time is in the comment')
  assert.ok(body.includes('feat: x'))
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
  assert.ok(l.every((e) => e.atLocal && e.tz && e.atUtc), 'and every row carries the local clock it was recorded on')
  assert.throws(() => recordStage(org, id, {}), /stage is required/)
})

ok('time: a stage is stamped in UTC and in the recording machine`s own clock', () => {
  const t = stageTime(new Date('2026-09-03T10:00:00Z'))
  assert.equal(t.at, '2026-09-03T10:00:00.000Z', 'the ISO instant stays the sort key')
  assert.equal(t.atUtc, '2026-09-03 10:00:00', 'UTC, formatted for a person')
  assert.match(t.atLocal, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'local wall clock, same shape')
  assert.ok(typeof t.tz === 'string' && t.tz !== '', 'a zone name — "14:32" means nothing without one')
  // The local half must be the RECORDER's clock, captured now. Proven by
  // running the same instant under a different TZ and seeing it move.
  const inTokyo = JSON.parse(execFileSync(process.execPath, ['-e',
    "import('" + new URL('./lib/index.js', import.meta.url).href + "').then(m=>console.log(JSON.stringify(m.stageTime(new Date('2026-09-03T10:00:00Z')))))",
  ], { env: { ...process.env, TZ: 'Asia/Tokyo' }, encoding: 'utf8' }))
  assert.equal(inTokyo.at, t.at, 'same instant')
  assert.equal(inTokyo.atUtc, t.atUtc, 'same UTC clock')
  assert.equal(inTokyo.atLocal, '2026-09-03 19:00:00', 'Tokyo is UTC+9 — the local half follows the machine')
  assert.equal(inTokyo.tz, 'Asia/Tokyo')
})

ok('time: a row written before the column existed shows UTC and no invented local', () => {
  // Formatting the instant in the READER's zone and labelling it "local"
  // would be a quiet lie about where the work happened.
  assert.equal(readableTime({ at: '2026-09-03T10:04:11.000Z' }), '2026-09-03 10:04:11 UTC')
  assert.equal(readableTime({ atUtc: '2026-09-03 10:00:00', atLocal: '2026-09-03 12:00:00', tz: 'Europe/Paris' }),
    '2026-09-03 10:00:00 UTC · 2026-09-03 12:00:00 Europe/Paris')
  assert.equal(readableTime({}), null)
})

ok('ledger: renders a table with a Next: line, and survives a pipe in the detail', () => {
  const md = renderLedger(
    [{ stage: 'committed', actor: 'Evan | boss', result: 'ok', sha: 'abcdef1', at: '2026-09-03T10:00:00Z', atUtc: '2026-09-03 10:00:00', atLocal: '2026-09-03 12:00:00', tz: 'Europe/Paris', detail: 'a|b' }],
    { sessionId: 'Acme/notes/n-wt-260903-001', container: 'notes', next: 'a human reviewer' },
  )
  assert.ok(md.includes('| stage | author | collaborator | result | sha | when (UTC) | when (readable) | detail |'))
  assert.ok(md.includes('2026-09-03 10:00:00 UTC · 2026-09-03 12:00:00 Europe/Paris'), 'both clocks in one cell')
  // Header, separator and body must agree on the column count or GitHub
  // renders the row as prose instead of a table.
  // Count UNESCAPED pipes only — an escaped `\|` inside a cell is content,
  // not a column boundary, which is the whole point of escaping it.
  const cols = (line) => line.replace(/\\\|/g, '').split('|').length
  const lines = md.split('\n').filter((l) => l.startsWith('|'))
  assert.equal(new Set(lines.map(cols)).size, 1, 'every table row has the same column count')
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
  assert.deepEqual([...STAGES], ['opened', 'integrated', 'committed', 'pushed', 'checks', 'gate', 'review', 'merged', 'archived', 'cleaned'])
})

console.log(`\nledger selftest: ${passed} checks passed`)
