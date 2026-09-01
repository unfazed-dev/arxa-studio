#!/usr/bin/env node
// Selftest for V5 version-minting shape + Gap 2
// (docs/plans/arxa-studio-vocabulary-collisions.md:402-454, adopted in
// docs/plans/open-items-completion.md "V5 shape"). Covers:
//  1. VERSION_STATES: existing four states plus changes-requested (Gap 2,
//     design_tools.dart:2944-2949)
//  2. transitionVersion: legal review transitions, throws on illegal ones
//     (including anything touching Superseded)
//  3. mintVersion: designHash-keyed idempotent re-mint (opt-in, additive —
//     no such behaviour existed before this change)
//  4. targets ledger: recordTargetRelease appends a row bound to the
//     current project version, validates track/target against
//     PROJECT_TARGETS_V4, rejects duplicates, never renumbers
//  5. mint after recordTargetRelease preserves existing target rows
//     (write must be read-modify-write, not a blind overwrite)
//  6. versionChip surfaces the latest target release when present
//  7. migration: a versions.json without `targets` reads as `targets: []`
//     without being rewritten
//  8. stress: 200 target rows, valid JSON throughout, read < 50ms,
//     uniqueness still enforced
// Runs against throwaway directories under a temp dir; versions.js has no
// git dependency, so no repo init is needed here.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  VERSIONS_FILE, VERSION_STATES,
  readVersions, readTargetReleases,
  mintVersion, transitionVersion, recordTargetRelease,
  versionChip,
} from './lib/versions.js'
import { PROJECT_TARGETS_V4 } from '../workspace/lib/template.js'

let passed = 0
function ok(label, fn) {
  fn()
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-versions-selftest-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function freshRepo(name) {
  const p = path.join(tmp, name)
  fs.mkdirSync(p, { recursive: true })
  return p
}

// ---- 1. states --------------------------------------------------------

ok('VERSION_STATES: existing four plus changes-requested (Gap 2)', () => {
  assert.deepEqual(VERSION_STATES, ['Draft', 'In review', 'Approved', 'Superseded', 'changes-requested'])
})

// ---- 2. transitionVersion ------------------------------------------------

ok('transitionVersion: Draft -> In review -> changes-requested -> In review -> Approved', () => {
  const repo = freshRepo('transitions')
  const v1 = mintVersion(repo, { name: 'draft' })
  assert.equal(v1.state, 'Draft')
  let entry = transitionVersion(repo, v1.version, 'In review')
  assert.equal(entry.state, 'In review')
  entry = transitionVersion(repo, v1.version, 'changes-requested')
  assert.equal(entry.state, 'changes-requested')
  entry = transitionVersion(repo, v1.version, 'In review')
  assert.equal(entry.state, 'In review')
  entry = transitionVersion(repo, v1.version, 'Approved')
  assert.equal(entry.state, 'Approved')
  assert.equal(readVersions(repo)[0].state, 'Approved') // persisted, not just in-memory
})

ok('transitionVersion: illegal transitions throw', () => {
  const repo = freshRepo('transitions-illegal')
  const v1 = mintVersion(repo, { name: 'draft' })
  assert.throws(() => transitionVersion(repo, v1.version, 'Approved'), RangeError) // Draft -> Approved skips review
  assert.throws(() => transitionVersion(repo, v1.version, 'Superseded'), RangeError) // system-only, never a user transition
  assert.throws(() => transitionVersion(repo, 'v99', 'In review'), RangeError) // unknown version
  assert.throws(() => transitionVersion(repo, v1.version, 'bogus'), TypeError) // unknown state
  transitionVersion(repo, v1.version, 'In review')
  transitionVersion(repo, v1.version, 'Approved')
  assert.throws(() => transitionVersion(repo, v1.version, 'changes-requested'), RangeError) // Approved is terminal
})

// ---- 3. mintVersion designHash idempotency --------------------------------

ok('mintVersion: same designHash is a no-op; different designHash mints and supersedes', () => {
  const repo = freshRepo('idempotent')
  const first = mintVersion(repo, { name: 'first', designHash: 'hash-a' })
  assert.equal(readVersions(repo).length, 1)
  const again = mintVersion(repo, { name: 'ignored', state: 'Approved', designHash: 'hash-a' })
  assert.equal(again.version, first.version)
  assert.equal(again.mintedAt, first.mintedAt)
  assert.equal(again.name, first.name) // untouched — a true no-op, not a re-write
  assert.equal(readVersions(repo).length, 1) // no new entry
  const second = mintVersion(repo, { name: 'second', designHash: 'hash-b' })
  assert.equal(second.version, 'v2')
  assert.equal(readVersions(repo).length, 2)
  assert.equal(readVersions(repo)[0].state, 'Superseded')
})

ok('mintVersion: callers that never pass designHash keep the always-mint behaviour', () => {
  const repo = freshRepo('no-hash')
  mintVersion(repo, { name: 'a' })
  mintVersion(repo, { name: 'b' })
  assert.equal(readVersions(repo).length, 2) // unconditional mint — matches the shared selftest.mjs
})

// ---- 4/5. targets ledger ---------------------------------------------------

ok('targets: fresh ledger has an empty target list', () => {
  const repo = freshRepo('targets-empty')
  mintVersion(repo, { name: 'a' })
  assert.deepEqual(readTargetReleases(repo), [])
})

ok('recordTargetRelease: validates track/target against PROJECT_TARGETS_V4', () => {
  const repo = freshRepo('targets-validate')
  mintVersion(repo, { name: 'a' })
  assert.throws(() => recordTargetRelease(repo, { track: 'bogus', target: 'ios', buildNumber: 1 }), TypeError)
  assert.throws(() => recordTargetRelease(repo, { track: 'application', target: 'roku', buildNumber: 1 }), TypeError)
  const row = recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 1 })
  assert.equal(row.track, 'application')
  assert.equal(row.target, 'ios')
  assert.equal(row.buildNumber, 1)
  assert.ok(row.shippedAt)
})

ok('recordTargetRelease: binds to the current project version and never renumbers it', () => {
  const repo = freshRepo('targets-bind')
  const v1 = mintVersion(repo, { name: 'a' })
  const row1 = recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 1 })
  assert.equal(row1.projectVersion, v1.version)
  assert.equal(readVersions(repo).length, 1) // recording a release never mints
  const v2 = mintVersion(repo, { name: 'b' })
  assert.equal(v2.version, 'v2')
  const row2 = recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 2 })
  assert.equal(row2.projectVersion, 'v2')
  assert.equal(readTargetReleases(repo).length, 2)
  assert.equal(readTargetReleases(repo)[0].projectVersion, 'v1') // untouched — ledger never renumbers
})

ok('recordTargetRelease: rejects duplicate (track, target, buildNumber)', () => {
  const repo = freshRepo('targets-dup')
  mintVersion(repo, { name: 'a' })
  recordTargetRelease(repo, { track: 'website', target: 'landing', buildNumber: '1.0.0' })
  assert.throws(
    () => recordTargetRelease(repo, { track: 'website', target: 'landing', buildNumber: '1.0.0' }),
    RangeError,
  )
  recordTargetRelease(repo, { track: 'website', target: 'landing', buildNumber: '1.0.1' }) // different build, ok
  assert.equal(readTargetReleases(repo).length, 2)
})

ok('recordTargetRelease: requires a minted version to bind to', () => {
  const repo = freshRepo('targets-no-version')
  assert.throws(() => recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 1 }), RangeError)
})

ok('mint after recordTargetRelease preserves existing target rows (read-modify-write)', () => {
  const repo = freshRepo('targets-survive-mint')
  mintVersion(repo, { name: 'a' })
  recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 1 })
  mintVersion(repo, { name: 'b' }) // must not wipe the row just recorded
  assert.equal(readTargetReleases(repo).length, 1)
  assert.equal(readTargetReleases(repo)[0].buildNumber, 1)
})

// ---- 6. versionChip surfaces the latest target release ---------------------

ok('versionChip: shows state until a target ships, then the latest release', () => {
  const repo = freshRepo('chip')
  mintVersion(repo, { name: 'a' })
  assert.equal(versionChip(repo).label, 'v1 · Draft')
  recordTargetRelease(repo, { track: 'application', target: 'ios', buildNumber: 12 })
  const chip = versionChip(repo)
  assert.equal(chip.label, 'v1 · ios#12')
  assert.ok(!/[0-9a-f]{7,40}/.test(chip.label), 'chip leaks a SHA-like token (D44)')
  recordTargetRelease(repo, { track: 'application', target: 'android', buildNumber: 7 })
  assert.equal(versionChip(repo).label, 'v1 · android#7') // most recent by append order
})

// ---- 7. migration ------------------------------------------------------------

ok('migration: a versions.json without targets reads as [] and is not rewritten', () => {
  const repo = freshRepo('migration')
  fs.writeFileSync(
    path.join(repo, VERSIONS_FILE),
    JSON.stringify(
      { versions: [{ version: 'v1', name: 'legacy', state: 'Draft', mintedAt: new Date().toISOString() }] },
      null,
      2,
    ) + '\n',
  )
  const before = fs.readFileSync(path.join(repo, VERSIONS_FILE), 'utf8')
  assert.deepEqual(readTargetReleases(repo), [])
  const after = fs.readFileSync(path.join(repo, VERSIONS_FILE), 'utf8')
  assert.equal(before, after, 'reading target releases must not rewrite the file')
  assert.ok(!before.includes('"targets"'), 'legacy file has no targets key until the next write')
})

// ---- 8. stress: 200 target rows ----------------------------------------------

ok('stress: 200 target rows stay valid JSON, uniqueness enforced, reads stay fast', () => {
  const repo = freshRepo('stress')
  mintVersion(repo, { name: 'a' })
  const tracks = Object.keys(PROJECT_TARGETS_V4)
  for (let i = 0; i < 200; i++) {
    const track = tracks[i % tracks.length]
    const targets = PROJECT_TARGETS_V4[track]
    const target = targets[i % targets.length]
    recordTargetRelease(repo, { track, target, buildNumber: i })
  }
  assert.equal(readTargetReleases(repo).length, 200)
  const raw = fs.readFileSync(path.join(repo, VERSIONS_FILE), 'utf8')
  assert.doesNotThrow(() => JSON.parse(raw)) // valid JSON on disk, not just in the returned array

  const start = process.hrtime.bigint()
  readVersions(repo)
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
  assert.ok(elapsedMs < 50, `read took ${elapsedMs}ms, expected < 50ms`)

  assert.throws(
    () => recordTargetRelease(repo, { track: tracks[0], target: PROJECT_TARGETS_V4[tracks[0]][0], buildNumber: 0 }),
    RangeError,
  ) // uniqueness still enforced after 200 rows
})

console.log(`\nselftest.versions: ${passed}/${passed} passed`)
