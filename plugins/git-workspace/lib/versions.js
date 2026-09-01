// Version-chip data source (D20 surface, D44 rider): arxa owns the
// semantic layer — a linear named version timeline per deliverable,
// auto-minted at stage transitions — while git stays the invisible
// substrate. The chip shows semantic version + state (e.g.
// "v4 · Approved") and NEVER git SHAs or the format stamp (D44).
//
// The file tree is SSOT: the timeline lives in `versions.json` inside
// the project repo (committed, so it travels with the D17 clone/share
// path). Superseded versions are archived in the chain, never deleted
// (D20). Phase 3 ships the data source only; approval/variant flows
// build on it later.
//
// V5 (docs/plans/arxa-studio-vocabulary-collisions.md:402-454; adopted
// verbatim in docs/plans/open-items-completion.md, "V5 shape"): ONE
// ledger per project, with per-target release rows appended alongside
// it. `mintVersion()` keeps minting the project version at a stage
// boundary; a target row `{ track, target, projectVersion, buildNumber,
// shippedAt }` is appended when a target ships (`recordTargetRelease`).
// The project ledger never renumbers because of a target shipping.
//
// Gap 2 (vocab.md §V3): studio adopts `changes-requested`, spelled
// exactly as arxa spells it — arxa's design status vocabulary is
// `needs-review | approved | changes-requested`
// (../arxa/arxa/lib/design_tools.dart:2944-2949, read directly, not
// paraphrased). Legal review transitions: Draft → In review →
// {Approved, changes-requested}; changes-requested → {In review,
// Approved}. Superseded is a system transition mint alone performs
// (never a legal target of transitionVersion) — see its guard below.

import fs from 'node:fs'
import path from 'node:path'
import { validateTargets } from '../../workspace/lib/template.js'

export const VERSIONS_FILE = 'versions.json'

/** Version states surfaced on the chip. */
export const VERSION_STATES = Object.freeze(['Draft', 'In review', 'Approved', 'Superseded', 'changes-requested'])

// Legal human-driven review transitions (transitionVersion). Superseded is
// deliberately absent as both a key and a value here — it is set only by
// mintVersion superseding the previous latest entry, never by a reviewer
// action, so any transition into or out of it throws.
const REVIEW_TRANSITIONS = Object.freeze({
  Draft: Object.freeze(['In review']),
  'In review': Object.freeze(['Approved', 'changes-requested']),
  'changes-requested': Object.freeze(['In review', 'Approved']),
  Approved: Object.freeze([]),
})

function versionsPath(repoPath) {
  return path.join(repoPath, VERSIONS_FILE)
}

/**
 * The whole on-disk document: `{ versions, targets }`. Missing `targets`
 * (a ledger written before V5) reads as `[]` — no rewrite happens until
 * the next mint or recordTargetRelease actually writes the file.
 */
function readDoc(repoPath) {
  const p = versionsPath(repoPath)
  if (!fs.existsSync(p)) return { versions: [], targets: [] }
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!Array.isArray(parsed.versions)) throw new TypeError(`${p} is not a version chain`)
  return { versions: parsed.versions, targets: Array.isArray(parsed.targets) ? parsed.targets : [] }
}

function writeDoc(repoPath, doc) {
  fs.writeFileSync(versionsPath(repoPath), JSON.stringify(doc, null, 2) + '\n')
}

/** The full version chain, oldest first. Empty array when none minted. */
export function readVersions(repoPath) {
  return readDoc(repoPath).versions
}

/** Target release rows, oldest first. Empty array when none shipped. */
export function readTargetReleases(repoPath) {
  return readDoc(repoPath).targets
}

/**
 * Mint the next version in the timeline (auto-called at stage
 * transitions, D20). The previous latest version is marked Superseded —
 * archived in the chain, never deleted. Writes the file only; committing
 * it is the caller's stage commit (mintAtStageBoundary does both).
 *
 * `designHash` is optional and additive (it did not exist in the shipped
 * Phase 3 code — there was no idempotency to "verify", only to build).
 * When passed and it matches the current latest version's stored
 * designHash, minting is a no-op: the design has not changed since that
 * mint, so nothing new is written and the existing entry is returned
 * unchanged. Callers that never pass designHash (mintAtStageBoundary
 * today) keep the original always-mint-and-supersede behaviour exactly.
 *
 * @returns {{ version: string, name: string, state: string, mintedAt: string, designHash?: string }}
 */
export function mintVersion(repoPath, { name, state = 'Draft', designHash } = {}) {
  if (!VERSION_STATES.includes(state)) {
    throw new TypeError(`unknown version state "${state}" — expected one of ${VERSION_STATES.join(', ')}`)
  }
  const doc = readDoc(repoPath)
  const prev = doc.versions[doc.versions.length - 1]

  if (designHash && prev && prev.designHash === designHash) return prev

  if (prev && prev.state !== 'Superseded') prev.state = 'Superseded'
  const entry = {
    version: `v${doc.versions.length + 1}`,
    name: name || `Version ${doc.versions.length + 1}`,
    state,
    mintedAt: new Date().toISOString(),
    ...(designHash ? { designHash } : {}),
  }
  doc.versions.push(entry)
  writeDoc(repoPath, doc)
  return entry
}

/**
 * Move an already-minted version between review states (Gap 2). Enforces
 * REVIEW_TRANSITIONS above; throws RangeError on an illegal transition —
 * including anything touching Superseded, which only mintVersion sets.
 *
 * @returns {{ version: string, name: string, state: string, mintedAt: string }}
 */
export function transitionVersion(repoPath, version, nextState) {
  if (!VERSION_STATES.includes(nextState)) {
    throw new TypeError(`unknown version state "${nextState}" — expected one of ${VERSION_STATES.join(', ')}`)
  }
  const doc = readDoc(repoPath)
  const entry = doc.versions.find((v) => v.version === version)
  if (!entry) throw new RangeError(`no version "${version}" minted in ${repoPath}`)
  const allowed = REVIEW_TRANSITIONS[entry.state] || []
  if (!allowed.includes(nextState)) {
    throw new RangeError(`illegal transition ${entry.state} → ${nextState} for ${version}`)
  }
  entry.state = nextState
  writeDoc(repoPath, doc)
  return entry
}

/**
 * Record that a target actually shipped (V5). Binds the row to the
 * CURRENT project version at call time and never renumbers it — the
 * project ledger and the target rows answer different questions ("what
 * did the client approve" vs. "what is on the App Store").
 *
 * track/target are validated against plugins/workspace/lib/template.js's
 * PROJECT_TARGETS_V4 catalogue (the same check the scaffolder itself
 * uses), so a typo here throws instead of silently recording a target
 * the gate never recognises. Duplicate (track, target, buildNumber)
 * triples are rejected.
 *
 * @returns {{ track: string, target: string, projectVersion: string, buildNumber: string|number, shippedAt: string }}
 */
export function recordTargetRelease(repoPath, { track, target, buildNumber, shippedAt } = {}) {
  validateTargets({ [track]: [target] })
  const doc = readDoc(repoPath)
  const current = doc.versions[doc.versions.length - 1]
  if (!current) throw new RangeError(`cannot record a target release before mintVersion has run for ${repoPath}`)
  const duplicate = doc.targets.some(
    (t) => t.track === track && t.target === target && t.buildNumber === buildNumber,
  )
  if (duplicate) throw new RangeError(`duplicate release: ${track}/${target}#${buildNumber} already recorded`)
  const row = {
    track,
    target,
    projectVersion: current.version,
    buildNumber,
    shippedAt: shippedAt || new Date().toISOString(),
  }
  doc.targets.push(row)
  writeDoc(repoPath, doc)
  return row
}

/**
 * What the version chip renders: current semantic version + state (D20),
 * e.g. `{ version: "v4", state: "Approved", label: "v4 · Approved" }`.
 * When at least one target has shipped, the label instead surfaces the
 * most recently recorded target release (append order, not shippedAt,
 * which is caller-supplied and can be back-dated), e.g. `v3 · ios#12`.
 * Contains no git SHAs and no format stamp (D44). Null before the first
 * mint (chip hidden).
 */
export function versionChip(repoPath) {
  const doc = readDoc(repoPath)
  const current = doc.versions[doc.versions.length - 1]
  if (!current) return null
  const latestTarget = doc.targets.length ? doc.targets[doc.targets.length - 1] : null
  return {
    version: current.version,
    name: current.name,
    state: current.state,
    ...(latestTarget ? { target: latestTarget.target, buildNumber: latestTarget.buildNumber } : {}),
    label: latestTarget
      ? `${current.version} · ${latestTarget.target}#${latestTarget.buildNumber}`
      : `${current.version} · ${current.state}`,
  }
}
