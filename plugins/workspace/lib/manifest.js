// Manifests (D41, Q3). Every org root carries an org.json and every
// project root a project.json: the folder-local file holding the stable
// id and the display name. Rename = update `name` here; the slug/folder
// on disk never changes.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { TEMPLATE_VERSION, stampFor } from './template.js'

export const ORG_MANIFEST = 'org.json'
export const PROJECT_MANIFEST = 'project.json'

/**
 * Tree-format stamp written into every manifest this code creates —
 * derived from the shipped template version (D44), so bumping
 * TEMPLATE_VERSION bumps the stamp in one place.
 */
export const FORMAT_STAMP = stampFor(TEMPLATE_VERSION)

/**
 * Build a fresh manifest object for a new org or project. Pass `null` for
 * `formatStamp` to omit it: only ORGS carry one.
 *
 * B13 — migration is org-scoped and atomic (`migrateOrg` walks the whole tree,
 * projects included), so a per-project stamp is derived data whose only
 * possible divergence is being stale. It was written at creation, republished
 * by the workspace index, and never read by any decision — a field that looks
 * authoritative and is not. The org stamp is the single authority.
 */
export function createManifest(displayName, formatStamp = FORMAT_STAMP) {
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    throw new TypeError('displayName must be a non-empty string')
  }
  const manifest = {
    id: randomUUID(),
    name: displayName,
    createdAt: new Date().toISOString(),
  }
  if (formatStamp !== null) manifest.formatStamp = formatStamp
  return manifest
}

/** Read and validate a manifest file. Throws if missing or malformed. */
export function readManifest(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(`manifest ${filePath} is not valid JSON: ${err.message}`)
  }
  if (typeof data !== 'object' || data === null || typeof data.id !== 'string' || typeof data.name !== 'string') {
    throw new Error(`manifest ${filePath} is missing required fields (id, name)`)
  }
  return data
}

/** Write a manifest file (pretty-printed, trailing newline). */
export function writeManifest(filePath, manifest) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n')
}

/**
 * Rename the org/project that `filePath`'s manifest describes: update
 * the display name ONLY. Slug and folder are immutable (D41) — this
 * function never moves anything on disk.
 */
export function renameInManifest(filePath, newName) {
  if (typeof newName !== 'string' || newName.trim() === '') {
    throw new TypeError('newName must be a non-empty string')
  }
  const manifest = readManifest(filePath)
  manifest.name = newName
  writeManifest(filePath, manifest)
  return manifest
}

/** Path to the org manifest inside an org root. */
export function orgManifestPath(orgPath) {
  return path.join(orgPath, ORG_MANIFEST)
}

/** Path to the project manifest inside a project root. */
export function projectManifestPath(projectPath) {
  return path.join(projectPath, PROJECT_MANIFEST)
}
