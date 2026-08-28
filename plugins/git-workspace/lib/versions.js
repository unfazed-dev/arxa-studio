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

import fs from 'node:fs'
import path from 'node:path'

export const VERSIONS_FILE = 'versions.json'

/** Version states surfaced on the chip. */
export const VERSION_STATES = Object.freeze(['Draft', 'In review', 'Approved', 'Superseded'])

function versionsPath(repoPath) {
  return path.join(repoPath, VERSIONS_FILE)
}

/** The full version chain, oldest first. Empty array when none minted. */
export function readVersions(repoPath) {
  const p = versionsPath(repoPath)
  if (!fs.existsSync(p)) return []
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!Array.isArray(parsed.versions)) throw new TypeError(`${p} is not a version chain`)
  return parsed.versions
}

function writeVersions(repoPath, versions) {
  fs.writeFileSync(versionsPath(repoPath), JSON.stringify({ versions }, null, 2) + '\n')
}

/**
 * Mint the next version in the timeline (auto-called at stage
 * transitions, D20). The previous latest version is marked Superseded —
 * archived in the chain, never deleted. Writes the file only; committing
 * it is the caller's stage commit (mintAtStageBoundary does both).
 *
 * @returns {{ version: string, name: string, state: string, mintedAt: string }}
 */
export function mintVersion(repoPath, { name, state = 'Draft' } = {}) {
  if (!VERSION_STATES.includes(state)) {
    throw new TypeError(`unknown version state "${state}" — expected one of ${VERSION_STATES.join(', ')}`)
  }
  const versions = readVersions(repoPath)
  const prev = versions[versions.length - 1]
  if (prev && prev.state !== 'Superseded') prev.state = 'Superseded'
  const entry = {
    version: `v${versions.length + 1}`,
    name: name || `Version ${versions.length + 1}`,
    state,
    mintedAt: new Date().toISOString(),
  }
  versions.push(entry)
  writeVersions(repoPath, versions)
  return entry
}

/**
 * What the version chip renders: current semantic version + state
 * (D20), e.g. `{ version: "v4", state: "Approved", label: "v4 · Approved" }`.
 * Contains no git SHAs and no format stamp (D44). Null before the first
 * mint (chip hidden).
 */
export function versionChip(repoPath) {
  const versions = readVersions(repoPath)
  const current = versions[versions.length - 1]
  if (!current) return null
  return {
    version: current.version,
    name: current.name,
    state: current.state,
    label: `${current.version} · ${current.state}`,
  }
}
