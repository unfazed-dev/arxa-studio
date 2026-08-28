/**
 * D20 facts — append-only JSONL event logs under `<org>/.arxa/facts/*.jsonl`.
 *
 * The JSONL files ARE the truth (part of the file tree, D46). The reader
 * derives current state by replaying events in order; the index DB only
 * caches that derivation and may be thrown away at any time.
 *
 * Ordering / last-write-wins: events are ordered by (log filename asc, line
 * position asc). Line position within an append-only file is a monotonic
 * sequence number, so LWW never depends on wall-clock timestamps (which can
 * tie or go backwards). The `at` field on each event is informational only.
 *
 * Durability ordering: appendFact fsyncs the JSONL before returning, so the
 * truth is on disk before any caller re-derives and caches. A crash between
 * the two leaves a rebuildable state — never a cache ahead of its source.
 *
 * Event shape (one JSON object per line):
 *   { key, value, at }   — value === null retracts the key
 */

import {
  appendFileSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const FACTS_DIR = ['.arxa', 'facts']

function factsDir(root, orgSlug) {
  return join(root, orgSlug, ...FACTS_DIR)
}

/**
 * Append one fact event to `<org>/.arxa/facts/<topic>.jsonl` and fsync it.
 * `fact` must include a string `key`; `value: null` retracts the key.
 */
export function appendFact(root, orgSlug, topic, fact) {
  if (!fact || typeof fact.key !== 'string') {
    throw new Error('appendFact: fact.key (string) is required')
  }
  const dir = factsDir(root, orgSlug)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${topic}.jsonl`)
  const line =
    JSON.stringify({ ...fact, at: fact.at ?? new Date().toISOString() }) + '\n'
  const fd = openSync(file, 'a')
  try {
    appendFileSync(fd, line, 'utf8')
    fsyncSync(fd) // truth hits disk before any cache is updated
  } finally {
    closeSync(fd)
  }
}

/**
 * Read all fact events for an org, in replay order:
 * (topic filename asc, line position asc). Malformed lines are skipped.
 * Returns [{ topic, seq, key, value, at }].
 */
export function readFactEvents(root, orgSlug) {
  const dir = factsDir(root, orgSlug)
  let names
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.jsonl'))
  } catch {
    return []
  }
  const events = []
  for (const name of names.sort()) {
    const topic = name.slice(0, -'.jsonl'.length)
    const text = readFileSync(join(dir, name), 'utf8')
    let seq = 0
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line) continue
      seq += 1
      try {
        const ev = JSON.parse(line)
        if (ev && typeof ev.key === 'string') {
          events.push({
            topic,
            seq,
            key: ev.key,
            value: ev.value ?? null,
            at: ev.at ?? null,
          })
        }
      } catch {
        /* skip malformed line — append-only logs may have torn tails */
      }
    }
  }
  return events
}

/**
 * Derive current fact state for an org by replaying all events.
 * Returns { <topic>: { <key>: value } }. Retracted keys are absent.
 */
export function deriveFactState(root, orgSlug) {
  const state = {}
  for (const ev of readFactEvents(root, orgSlug)) {
    const topic = (state[ev.topic] ??= {})
    if (ev.value === null) delete topic[ev.key]
    else topic[ev.key] = ev.value
  }
  return state
}
