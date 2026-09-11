// arxa-dashboard: per-session metrics from dsh's own projections.
//
// SPIKE RESULT (docs/plans/org-row-dashboard.md §4 step 1, 2026-09-09).
// dsh already folds everything the dashboard needs per session:
//   - `sessionStats`  (@deepseek-ai/dsh-session-stats): turns, steps, llmMs,
//     toolMs, ttftMs, decodeMs, decodeTokens.
//   - `tokenUsage`    (@deepseek-ai/dsh-token-meter): provider-reported
//     totals {uncachedInputTokens, outputTokens, cacheReadTokens,
//     cacheWriteTokens} plus the `last` step's buckets.
//   - `sessionListMetadata`: lastPromptAt; `title`: the session title.
// Two read paths, same normaliser:
//   LIVE   — a session loaded in-process: ctx.sessions.get(id) →
//            ctx.sessionProjections.cachedSnapshot(session).values
//            (the sidebar host already injects `sessions`).
//   CLOSED — dsh's persisted projection cache, one plain-JSON file per
//            session at <dshHome>/storages/session_projcache/sessions/<id>.json
//            with { record: { identity: {createdAt, cwd}, rows: {<key>: {ver, seq, val}} } }.
//            The cache is written by @deepseek-ai/dsh-session-projection-cache
//            on a debounced timer, so a LIVE session's file may lag — prefer
//            the live path when the session is loaded.
// Verified against a 25-turn real session: cache row val === projection
// state (the checkpoint carries fold fields such as lastTurn/openStep on top
// of the view fields; the normaliser reads only the view fields).
//
// NOT read here: the session log itself (session.jsonl.zstd). It is a
// concatenated-frame zstd container that Node's one-shot and streaming
// decoders both stop reading after frame 1 ("Unknown frame descriptor");
// dsh keeps its frame scanner private (dsh-session-persistence-jsonl,
// `scanZstdFrames`, not exported). Per-turn series (tokens per turn, wall
// span from event times) will come through ctx.get('sessionQuery').listEvents(id)
// when a card needs them — dsh decodes, arxa never re-implements the container.
//
// `dshHome` is the directory holding `sessions/` and `storages/` — the same
// derivation plugins/arxa-sidebar/lib/session-header-index.js uses
// (dirname(persistence.root)).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Path of one session's persisted projection row. */
export function cacheFileFor(dshHome, dshSessionId) {
  if (typeof dshHome !== 'string' || dshHome === '') throw new Error('dshHome required')
  if (typeof dshSessionId !== 'string' || dshSessionId === '' || /[\\/]/.test(dshSessionId) || dshSessionId.includes('..')) {
    throw new Error('dshSessionId must be a single path segment')
  }
  return join(dshHome, 'storages', 'session_projcache', 'sessions', dshSessionId + '.json')
}

/**
 * Normalise projection VALUES (live `snapshot.values` or a cache file's
 * `rows[key].val` map) into the dashboard's owned metrics shape. Only leaf
 * scalars cross this boundary (cordis live-data rule).
 * @param {Record<string, any>} values - `{ sessionStats?, tokenUsage?, title?, sessionListMetadata? }`
 */
export function metricsFromValues(values) {
  const v = values && typeof values === 'object' ? values : {}
  const s = v.sessionStats && typeof v.sessionStats === 'object' ? v.sessionStats : null
  const t = v.tokenUsage && typeof v.tokenUsage.totals === 'object' ? v.tokenUsage.totals : null
  const meta = v.sessionListMetadata && typeof v.sessionListMetadata === 'object' ? v.sessionListMetadata : null
  const tokens = t
    ? {
        uncachedInput: num(t.uncachedInputTokens),
        output: num(t.outputTokens),
        cacheRead: num(t.cacheReadTokens),
        cacheWrite: num(t.cacheWriteTokens),
      }
    : null
  return {
    title: typeof v.title === 'string' ? v.title : null,
    // Absent unit ⇒ null, never zero: "zero is a claim" (arxa-git-card/lib/index.js:305).
    stats: s
      ? { turns: num(s.turns), steps: num(s.steps), llmMs: num(s.llmMs), toolMs: num(s.toolMs), ttftMs: num(s.ttftMs), decodeMs: num(s.decodeMs) }
      : null,
    tokens: tokens ? { ...tokens, total: tokens.uncachedInput + tokens.output + tokens.cacheRead + tokens.cacheWrite } : null,
    lastPromptAt: meta && typeof meta.lastPromptAt === 'number' ? meta.lastPromptAt : null,
  }
}

/**
 * CLOSED path: one session's cached projection VALUES from disk.
 * @returns {null | { live: false, createdAt, cwd, asOfSeq, values }}
 *   null when no cache row exists (a session that never produced a checkpoint)
 *   or when no dshHome is known (a host without sessionPersistence).
 */
export function readCachedValues(dshHome, dshSessionId) {
  if (typeof dshHome !== 'string' || dshHome === '') return null
  const file = cacheFileFor(dshHome, dshSessionId)
  if (!existsSync(file)) return null
  let doc
  try { doc = JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
  const rec = doc && doc.record && typeof doc.record === 'object' ? doc.record : null
  if (!rec) return null
  const rows = rec.rows && typeof rec.rows === 'object' ? rec.rows : {}
  const values = {}
  let asOfSeq = -1
  for (const [key, row] of Object.entries(rows)) {
    if (!row || typeof row !== 'object' || !('val' in row)) continue
    values[key] = row.val
    if (typeof row.seq === 'number' && row.seq > asOfSeq) asOfSeq = row.seq
  }
  const identity = rec.identity && typeof rec.identity === 'object' ? rec.identity : {}
  return {
    live: false,
    createdAt: typeof identity.createdAt === 'number' ? identity.createdAt : null,
    cwd: typeof identity.cwd === 'string' ? identity.cwd : null,
    asOfSeq,
    values,
  }
}

/**
 * LIVE-first VALUES read: `projections` is ctx.sessionProjections-shaped
 * (cachedSnapshot(session)) and `sessions` is ctx.sessions-shaped (get(id)).
 * Falls back to the disk row. Never throws on a missing session.
 */
export function readValues({ dshHome, sessions, projections }, dshSessionId) {
  try {
    const session = sessions && typeof sessions.get === 'function' ? sessions.get(dshSessionId) : undefined
    if (session && projections && typeof projections.cachedSnapshot === 'function') {
      const snap = projections.cachedSnapshot(session)
      if (snap && snap.values && Object.keys(snap.values).length > 0) {
        // The live checkpoint is a VIEW, not the record: dsh's viewCheckpoint only
        // serves projections registered in this engine that declare a wire view
        // (dsh-session-projection/lib/index.js viewCheckpoint). Returning it alone
        // erased any figure the durable row holds and the live view does not —
        // on 2026-09-11 a real GLM 5.3 turn reported turns/steps/llmMs/ttftMs
        // exactly and tokens: null, while the record on disk held
        // uncachedInputTokens 14627 / outputTokens 277.
        //
        // So merge per key, live winning wherever it actually served one. A key the
        // live view served is authoritative; a key it never served is not evidence
        // of absence, and absence is what turns a real figure into a null.
        // ponytail: whole-record merge, no per-key freshness compare — the durable
        // row only ever fills gaps, so a stale value can never displace a live one.
        const durable = readCachedValues(dshHome, dshSessionId)
        const values = durable && durable.values ? { ...durable.values, ...snap.values } : { ...snap.values }
        // NOT done here: reading the raw cell with projections.stateOf(session, key)
        // to reach tokenUsage mid-session, before dsh flushes. It looked right —
        // stateOf skips the `wire` requirement that hides tokenUsage from the
        // checkpoint — but on a live engine it yielded nothing, and the reason was
        // not established. Unproven code does not ship. The consequence is bounded
        // and stated: an ACTIVE session reports tokens: null until dsh writes the
        // cache, and every other figure is live throughout.
        return { live: true, createdAt: null, cwd: null, asOfSeq: typeof snap.asOfSeq === 'number' ? snap.asOfSeq : -1, values }
      }
    }
  } catch { /* live read is best-effort; the disk row is the durable answer */ }
  return readCachedValues(dshHome, dshSessionId)
}

const withMetrics = (id, r) => (r ? { id, createdAt: r.createdAt, cwd: r.cwd, asOfSeq: r.asOfSeq, ...(r.live ? { live: true } : {}), ...metricsFromValues(r.values) } : null)

/** CLOSED path metrics: @returns {null | { id, createdAt, cwd, asOfSeq, title, stats, tokens, lastPromptAt }} */
export function readCachedMetrics(dshHome, dshSessionId) {
  return withMetrics(dshSessionId, readCachedValues(dshHome, dshSessionId))
}

/** LIVE-first metrics (live: true rides along when the in-process snapshot answered). */
export function readMetrics(env, dshSessionId) {
  return withMetrics(dshSessionId, readValues(env, dshSessionId))
}

/**
 * What the session DID, from dsh's projection values — never the transcript
 * (2026-09-09 operator rule: the summary shows what was last done, not text
 * the operator can read again by opening the session). Reads the `goal` and
 * `todos` units when present and the turn count off `turnOutline`.
 * @returns {{ turnCount: number, goal: string|null, todos: { done: number, open: number, lastDone: string|null, nextOpen: string|null } | null }}
 */
export function summaryFromValues(values) {
  const v = values && typeof values === 'object' ? values : {}
  const raw = v.turnOutline
  const turns = Array.isArray(raw) ? raw : raw && Array.isArray(raw.turns) ? raw.turns : []
  const g = v.goal && typeof v.goal === 'object' ? v.goal.current : null
  const goal = typeof g === 'string' ? g : g && typeof g === 'object' && typeof g.text === 'string' ? g.text : g && typeof g === 'object' && typeof g.title === 'string' ? g.title : null
  const items = Array.isArray(v.todos) ? v.todos : v.todos && typeof v.todos === 'object' && Array.isArray(v.todos.items) ? v.todos.items : null
  let todos = null
  if (items) {
    const text = (t) => (t && typeof t === 'object' ? (typeof t.content === 'string' ? t.content : typeof t.text === 'string' ? t.text : typeof t.title === 'string' ? t.title : null) : typeof t === 'string' ? t : null)
    const status = (t) => String(t && typeof t === 'object' ? (t.status ?? t.state ?? '') : '').toLowerCase()
    const done = items.filter((t) => /done|complete/.test(status(t)))
    const open = items.filter((t) => !/done|complete|cancel/.test(status(t)))
    todos = { done: done.length, open: open.length, lastDone: done.length ? text(done[done.length - 1]) : null, nextOpen: open.length ? text(open[0]) : null }
  }
  return { turnCount: turns.length, goal: goal ? goal.replace(/\s+/g, ' ').trim().slice(0, 200) : null, todos }
}

const PATH_KEYS = new Set(['path', 'file', 'filePath', 'file_path', 'filename', 'target', 'notebook_path', 'cwd'])
const CMD_KEYS = new Set(['command', 'cmd', 'script'])
const looksLikePath = (s) => typeof s === 'string' && s.length > 1 && s.length < 400 && !/\s/.test(s) && /\//.test(s) && !/^https?:/.test(s)

/**
 * Fold dsh surface events (`sessionQuery.readSurface(id).events`) into what
 * the session did: tool counts, files touched, commands run, last tool time.
 * Only `tool/call` events are read and only leaf strings leave here.
 * @param {{ type: string, time?: number, data?: any }[]} events
 * @returns {{ toolCalls: number, tools: { name: string, n: number }[], files: string[], filesTotal: number, commands: number, lastCommand: string|null, lastTool: string|null, lastToolAt: number|null }}
 */
export function activityFromEvents(events) {
  const tools = new Map()
  const files = []
  const seenFiles = new Set()
  let commands = 0
  let lastCommand = null
  let lastTool = null
  let lastToolAt = null
  let toolCalls = 0
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.type !== 'tool/call' || !e.data || typeof e.data !== 'object') continue
    toolCalls += 1
    const name = typeof e.data.name === 'string' ? e.data.name : 'tool'
    tools.set(name, (tools.get(name) || 0) + 1)
    lastTool = name
    if (typeof e.time === 'number') lastToolAt = e.time
    const args = e.data.arguments && typeof e.data.arguments === 'object' ? e.data.arguments : {}
    for (const [k, val] of Object.entries(args)) {
      if (CMD_KEYS.has(k) && typeof val === 'string') { commands += 1; lastCommand = val.replace(/\s+/g, ' ').trim().slice(0, 120); continue }
      if ((PATH_KEYS.has(k) || looksLikePath(val)) && typeof val === 'string' && looksLikePath(val)) {
        const short = val.split('/').slice(-2).join('/')
        if (!seenFiles.has(val)) { seenFiles.add(val); files.push(short) }
      }
    }
  }
  return {
    toolCalls,
    tools: [...tools.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 6),
    files: files.slice(-6),
    filesTotal: files.length,
    commands,
    lastCommand,
    lastTool,
    lastToolAt,
  }
}
