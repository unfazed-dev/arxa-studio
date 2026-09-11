#!/usr/bin/env node
/**
 * arxa-dashboard selftest — projections reader (docs/plans/org-row-dashboard.md §4 step 1).
 * Synthetic fixtures in a temp dir (CI never depends on ~/.arxa), plus an
 * opportunistic real-data smoke when this machine has a dsh home with a
 * projection cache. Run: node plugins/arxa-dashboard/selftest.projections.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { cacheFileFor, metricsFromValues, readCachedMetrics, readMetrics , activityFromEvents, summaryFromValues, readValues } from './lib/projections.js'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// ---- fixture: one cache row shaped exactly like dsh's session_projcache ----
const home = mkdtempSync(join(tmpdir(), 'arxa-dash-'))
const dir = join(home, 'storages', 'session_projcache', 'sessions')
mkdirSync(dir, { recursive: true })
const id = 'arxa-TESTO-notes-note-wt-260909-001'
writeFileSync(join(dir, id + '.json'), JSON.stringify({
  version: 5,
  record: {
    identity: { createdAt: 1788500000000, cwd: '/tmp/TESTO/.arxa/worktrees/TESTO/notes/note-wt-260909-001', isSeeded: false, inheritedEventCount: 0 },
    rows: {
      title: { ver: 1, seq: 508, val: 'note-wt-260909-001' },
      sessionStats: { ver: 1, seq: 508, val: { turns: 4, steps: 9, llmMs: 12000, toolMs: 3400, ttftMs: 800, ttftSteps: 9, decodeMs: 9000, decodeTokens: 1939, lastTurn: 4, openStep: null, pendingCalls: {} } },
      tokenUsage: { ver: 2, seq: 508, val: { totals: { uncachedInputTokens: 13301, outputTokens: 1939, cacheReadTokens: 9072, cacheWriteTokens: 67755 }, last: { turn: 4, step: 1, buckets: {} } } },
      sessionListMetadata: { ver: 1, seq: 508, val: { blank: false, lastPromptAt: 1788500900000 } },
    },
  },
}))

check('cacheFileFor: <home>/storages/session_projcache/sessions/<id>.json',
  cacheFileFor(home, id) === join(dir, id + '.json'))
check('cacheFileFor: rejects path segments in the id',
  (() => { try { cacheFileFor(home, '../x'); return false } catch { return true } })())

const m = readCachedMetrics(home, id)
check('readCachedMetrics: identity + asOfSeq', !!m && m.createdAt === 1788500000000 && m.cwd.endsWith('note-wt-260909-001') && m.asOfSeq === 508, JSON.stringify(m))
check('readCachedMetrics: stats view fields only (no fold fields leak)',
  !!m && m.stats.turns === 4 && m.stats.steps === 9 && m.stats.llmMs === 12000 && m.stats.toolMs === 3400 && !('lastTurn' in m.stats) && !('pendingCalls' in m.stats))
check('readCachedMetrics: tokens totals + computed total',
  !!m && m.tokens.uncachedInput === 13301 && m.tokens.output === 1939 && m.tokens.cacheRead === 9072 && m.tokens.cacheWrite === 67755 && m.tokens.total === 13301 + 1939 + 9072 + 67755)
check('readCachedMetrics: title + lastPromptAt', !!m && m.title === 'note-wt-260909-001' && m.lastPromptAt === 1788500900000)
check('readCachedMetrics: unknown session ⇒ null (never throws)', readCachedMetrics(home, 'arxa-NOPE-001') === null)

// ---- absent units are null, never zero ----
const empty = metricsFromValues({ title: 'blank' })
check('metricsFromValues: missing units ⇒ null, not 0', empty.stats === null && empty.tokens === null && empty.lastPromptAt === null && empty.title === 'blank')

// ---- corrupt file degrades to null ----
writeFileSync(join(dir, 'arxa-BAD-001.json'), '{not json')
check('readCachedMetrics: corrupt row ⇒ null', readCachedMetrics(home, 'arxa-BAD-001') === null)

// ---- LIVE path wins when the session is loaded; disk path otherwise ----
const liveSessions = { get: (sid) => (sid === id ? { id: sid } : undefined) }
const liveProjections = { cachedSnapshot: () => ({ asOfSeq: 999, values: { sessionStats: { turns: 5, steps: 10, llmMs: 1, toolMs: 2 }, tokenUsage: { totals: { uncachedInputTokens: 1, outputTokens: 2 } } } }) }
const live = readMetrics({ dshHome: home, sessions: liveSessions, projections: liveProjections }, id)
check('readMetrics: live snapshot preferred (asOfSeq 999, turns 5)', live.live === true && live.asOfSeq === 999 && live.stats.turns === 5 && live.tokens.total === 3)
const cold = readMetrics({ dshHome: home, sessions: { get: () => undefined }, projections: liveProjections }, id)
check('readMetrics: unloaded session falls back to the disk row (turns 4)', !cold.live && cold.stats.turns === 4)
const throwing = readMetrics({ dshHome: home, sessions: { get: () => { throw new Error('boom') } }, projections: liveProjections }, id)
check('readMetrics: a throwing live face still yields the disk row', !!throwing && throwing.stats.turns === 4)

// ---- opportunistic real-data smoke (skipped when this machine has no dsh cache) ----
const realHome = join(homedir(), '.arxa', 'dsh')
const realDir = join(realHome, 'storages', 'session_projcache', 'sessions')
if (existsSync(realDir)) {
  const files = readdirSync(realDir).filter((f) => f.endsWith('.json'))
  let rich = 0, read = 0
  for (const f of files) {
    const r = readCachedMetrics(realHome, f.slice(0, -5))
    if (r) read++
    if (r && r.stats && r.stats.turns > 0 && r.tokens && r.tokens.total > 0) rich++
  }
  check(`real cache: ${read}/${files.length} rows readable, ${rich} with turns+tokens`, read === files.length && rich > 0)
} else {
  console.log('SKIP  real cache smoke (no ~/.arxa/dsh/storages/session_projcache)')
}

{
  const ev = [
    { type: 'user/message', time: 1, data: {} },
    { type: 'tool/call', time: 10, data: { callId: 'a', name: 'Read', arguments: { path: '/x/y/a.js' } } },
    { type: 'tool/call', time: 20, data: { callId: 'b', name: 'Bash', arguments: { command: 'npm test  --silent' } } },
    { type: 'tool/call', time: 30, data: { callId: 'c', name: 'Edit', arguments: { file_path: '/x/y/a.js', old: 'q', new: 'z' } } },
    { type: 'tool/call', time: 40, data: { callId: 'd', name: 'Write', arguments: { file_path: '/x/z/b.md', content: 'hello world' } } },
    { type: 'tool/result', time: 41, data: {} },
  ]
  const a = activityFromEvents(ev)
  check('activityFromEvents: counts tools, dedupes files, keeps the last command, ignores non-tool events', a.toolCalls === 4 && a.tools.length === 4 && a.files.join('|') === 'y/a.js|z/b.md' && a.filesTotal === 2 && a.commands === 1 && a.lastCommand === 'npm test --silent' && a.lastTool === 'Write' && a.lastToolAt === 40, JSON.stringify(a))
  check('activityFromEvents: prose values are not files, junk input never throws', activityFromEvents([{ type: 'tool/call', data: { name: 'Write', arguments: { content: 'a/b c' } } }]).filesTotal === 0 && activityFromEvents(null).toolCalls === 0)
  const sm = summaryFromValues({ turnOutline: { turns: [{ turn: 1 }, { turn: 2 }], draft: '' }, goal: { current: 'Ship  it' }, todos: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'pending' }] })
  check('summaryFromValues: facts only — turn count, goal, todo counts + last done / next open; no transcript', sm.turnCount === 2 && sm.goal === 'Ship it' && sm.todos.done === 1 && sm.todos.open === 1 && sm.todos.lastDone === 'one' && sm.todos.nextOpen === 'two' && !('turns' in sm), JSON.stringify(sm))
  check('summaryFromValues: absent units ⇒ null goal / null todos', summaryFromValues({}).goal === null && summaryFromValues({}).todos === null && summaryFromValues({}).turnCount === 0)
}
{
  // Defect (2026-09-11): the operator ran a real GLM 5.3 turn in the shipping app.
  // Its own status bar read "Input 14.6K tok · Output 277 tok"; the dashboard read
  // tokens: null. sessionStats (turns/steps/llmMs/ttftMs) all matched exactly.
  //
  // Cause: readValues returns the LIVE checkpoint the moment it is non-empty, and
  // dsh's viewCheckpoint only serves projections registered in THIS engine with a
  // wire view. tokenUsage was not among them, while the durable record on disk
  // carried the real totals. Live must not silently lose a figure the durable row
  // has — the two are merged per key, live winning where it actually served one.
  const home = mkdtempSync(join(tmpdir(), 'arxa-proj-merge-'))
  const id = 'arxa-merge-probe'
  const file = cacheFileFor(home, id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ record: { rows: {
    tokenUsage: { seq: 9, val: { totals: { uncachedInputTokens: 14627, outputTokens: 277, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    sessionStats: { seq: 9, val: { turns: 1, steps: 1, llmMs: 7402, toolMs: 0, ttftMs: 5722, decodeMs: 1680 } },
  } } }))
  // A live engine that serves sessionStats but has no tokenUsage projection.
  const projections = { cachedSnapshot: () => ({ asOfSeq: 300, values: { sessionStats: { turns: 1, steps: 1, llmMs: 7402, toolMs: 0, ttftMs: 5722, decodeMs: 1680 } } }) }
  const env = { dshHome: home, sessions: { get: () => ({ id }) }, projections }
  const v = readValues(env, id)
  const m = metricsFromValues(v.values)
  check('defect (2026-09-11): a live checkpoint that omits tokenUsage no longer erases the durable token totals — 14627 + 277 is reported, and the live sessionStats still wins',
    v.live === true && m.tokens !== null && m.tokens.uncachedInput === 14627 && m.tokens.output === 277 && m.tokens.total === 14904 && m.stats.llmMs === 7402,
    JSON.stringify({ live: v.live, tokens: m.tokens, llmMs: m.stats && m.stats.llmMs }))
  // …and a live view that DOES serve a key must not be overwritten by a stale disk row.
  const fresh = { cachedSnapshot: () => ({ asOfSeq: 400, values: { sessionStats: { turns: 5, steps: 5, llmMs: 999, toolMs: 0, ttftMs: 1, decodeMs: 1 } } }) }
  const m2 = metricsFromValues(readValues({ ...env, projections: fresh }, id).values)
  check('defect (2026-09-11): the durable row never overwrites a key the live checkpoint actually served', m2.stats.turns === 5 && m2.stats.llmMs === 999, JSON.stringify(m2.stats))
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
