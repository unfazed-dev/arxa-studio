#!/usr/bin/env node
/**
 * jobs-fence-check — pin the ONE undocumented thing arxa-jobs depends on.
 *
 * `plugins/arxa-jobs` calls `registry.list(caller)` and `registry.kill(id,
 * caller, reason)` with a bare `{ id: sessionId }`. That works because
 * `@deepseek-ai/dsh-jobs-local` fences access by comparing `.id` strings, and
 * because `Agent.id` IS the session id. Neither fact is in a published
 * contract — they are read off the installed implementation.
 *
 * So a dsh upgrade that adds a real identity check would not break a test; it
 * would break a button, in a user's hands, silently. This script is the
 * tripwire: it reads the INSTALLED dsh and fails RED naming the file and the
 * line, so the breakage is caught here instead.
 *
 * If this goes red, do NOT loosen the assertion. Read the new implementation
 * and decide whether arxa can still act for the human — if it cannot, the
 * runtime already degrades to `no-job-api`, so shipping is safe while the
 * decision is made.
 *
 *   node scripts/jobs-fence-check.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JOBS_LOCAL = join(ROOT, 'node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js')
const AGENT_TYPES = join(ROOT, 'node_modules/@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts')

let failed = 0
const ok = (label, cond, note = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
  if (!cond) failed++
}

if (!existsSync(JOBS_LOCAL)) {
  console.log('SKIP  @deepseek-ai/dsh-jobs-local is not installed — arxa-jobs degrades to no-job-api')
  process.exit(0)
}

const src = readFileSync(JOBS_LOCAL, 'utf8')

// 1. The fence itself. Whitespace-tolerant, shape-strict: it must still be an
//    id comparison against the caller, with no other credential consulted.
const fence = src.match(/assertAccess\s*\(\s*job\s*,\s*caller\s*\)\s*\{([\s\S]{0,320}?)\}/)
ok('assertAccess(job, caller) still exists', fence !== null,
  fence ? '' : 'the fence was renamed or removed — arxa-jobs cannot assume its shape')
if (fence) {
  const body = fence[1]
  ok('…and still compares job.owner.id to caller?.id',
    /job\.owner\.id\s*!==\s*caller\?\.id/.test(body), body.trim().slice(0, 120))
  ok('…and consults nothing but that id (no token, scope or Agent check)',
    !/scopeOf|Symbol|token|signature|instanceof/.test(body), body.trim().slice(0, 120))
}

// 2. list() must filter on the same field, or `list({id})` returns [] silently —
//    a wrong answer that looks exactly like "no jobs".
const list = src.match(/\blist\s*\(\s*caller\s*\)\s*\{([\s\S]{0,320}?)\n\t\}/)
ok('list(caller) still keys off caller?.id', list !== null && /caller\?\.id/.test(list[1]),
  list ? '' : 'list() shape moved — an empty result would be indistinguishable from no jobs')

// 3. kill() must still route through the fence and take (id, caller, reason).
ok('kill(id, caller, reason) still asserts access',
  /kill\s*\(\s*id\s*,\s*caller\s*,\s*reason\s*\)\s*\{[\s\S]{0,200}?assertAccess\s*\(\s*job\s*,\s*caller\s*\)/.test(src),
  '')

// 4. Agent.id is the session id. If this became `sessionId`, `{ id }` would
//    match nothing and every list would come back empty.
if (existsSync(AGENT_TYPES)) {
  const agent = readFileSync(AGENT_TYPES, 'utf8')
  const iface = agent.match(/interface Agent\b[\s\S]{0,400}/)
  ok('Agent still carries `id: SessionId`',
    iface !== null && /readonly\s+id\s*:\s*SessionId/.test(iface[0]),
    iface ? '' : 'Agent interface moved')
} else {
  console.log('note  dsh-agent types absent — skipped the Agent.id check')
}

console.log(failed === 0
  ? '\njobs fence: intact — arxa-jobs may act for the human'
  : `\njobs fence: ${failed} CHANGED — read node_modules/@deepseek-ai/dsh-jobs-local/lib/index.js before shipping`)
process.exit(failed === 0 ? 0 : 1)
