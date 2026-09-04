#!/usr/bin/env node
// Every session event arxa appends must be a type dsh can LOAD, or the whole conversation
// becomes unreadable.
//
// dsh-session-persistence `assertEventsSupported` refuses an entire log the moment it meets an
// event type outside KNOWN_SESSION_EVENT_TYPES, unless the envelope carries `ignorable: true`.
// `Session.append()` provides no way to set that flag, and dsh's own known-event-types note says
// a registration surface for downstream plugin events is "deferred until such a consumer exists".
// So for arxa today the rule is simply: only append types dsh already knows.
//
// The failure is quiet in the worst way. Appending works, the turn runs, and the transcript is
// written correctly — it is only REOPENING the session that fails, so nothing goes red until a
// user restarts and finds the conversation replaced by "Failed to load history". Two real
// sessions were lost that way (claude-code/session, seq 15 and seq 1251) before this gate existed.
//
// This reads the vocabulary out of the installed dsh rather than hardcoding it, so a dsh upgrade
// that adds or removes a type is reflected automatically.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** The installed dsh's own vocabulary — the same Set the persistence read path consults. */
export function knownEventTypes (repo = root) {
  const src = readFileSync(join(repo, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js'), 'utf8')
  const at = src.indexOf('const KNOWN_SESSION_EVENT_TYPES = new Set([')
  if (at < 0) throw new Error('could not locate KNOWN_SESSION_EVENT_TYPES in the installed dsh-session')
  const body = src.slice(at, src.indexOf(']', at) + 1)
  return new Set(body.match(/"[^"]+"/g).map((s) => s.slice(1, -1)))
}

/** Every `.append('type'` literal under plugins/, with its file and line. */
export function appendedEventTypes (repo = root) {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(js|mjs)$/.test(e.name)) continue
      // selftests append fixture events to plain arrays, not to a real session
      if (/^selftest(\.[\w-]+)?\.mjs$|^smoke\.mjs$/.test(e.name)) continue
      const lines = readFileSync(p, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\.append\(\s*'([^']+)'/g)) out.push({ type: m[1], file: relative(repo, p), line: i + 1 })
      })
    }
  }
  walk(join(repo, 'plugins'))
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const known = knownEventTypes()
  const appended = appendedEventTypes()
  const bad = appended.filter((a) => !known.has(a.type))
  for (const a of appended) console.log(`${known.has(a.type) ? 'ok  ' : 'BAD '} ${a.type}  (${a.file}:${a.line})`)
  if (bad.length > 0) {
    console.log(`\nsession-event-vocabulary: ${bad.length} append(s) of a type dsh cannot load.`)
    console.log('Any session containing one renders as "Failed to load history" once it is reopened.')
    console.log('Keep the value off the log (an in-memory map, as plugins/claude-code/lib/adapter.js does')
    console.log('for the resume id), or reuse a type dsh already knows.')
    process.exit(1)
  }
  console.log(`\nsession-event-vocabulary: ${appended.length} append(s), all loadable (${known.size} known types)`)
}
