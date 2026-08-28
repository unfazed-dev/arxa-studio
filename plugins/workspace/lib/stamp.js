// Format stamp (D21/D44). Every org carries the template version it was
// scaffolded at (or migrated to) in its org.json `formatStamp`. On open,
// an older app meeting a newer org refuses cleanly — a typed
// StampRefusalError with a user-facing message, never a crash. Stamp
// read/check is pure filesystem: it must keep working when git is absent.

import { TEMPLATE_VERSION, stampFor, parseStamp } from './template.js'
import { readManifest, writeManifest, orgManifestPath } from './manifest.js'

/**
 * Thrown when this build is too old for the org on disk (D21). The
 * `message` is user-facing; `orgVersion`/`appVersion` let the caller
 * render its own copy.
 */
export class StampRefusalError extends Error {
  constructor(orgVersion, appVersion) {
    super(
      `This organisation was last used with a newer version of arxa studio ` +
        `(format v${orgVersion}; this app supports up to v${appVersion}). ` +
        `Update arxa studio to open it — nothing has been changed on disk.`
    )
    this.name = 'StampRefusalError'
    this.orgVersion = orgVersion
    this.appVersion = appVersion
  }
}

/** Read an org's stamped template version from its manifest. */
export function readOrgStampVersion(orgPath) {
  return parseStamp(readManifest(orgManifestPath(orgPath)).formatStamp)
}

/** Write an org's stamped template version into its manifest. */
export function writeOrgStampVersion(orgPath, version) {
  const manifestPath = orgManifestPath(orgPath)
  const manifest = readManifest(manifestPath)
  manifest.formatStamp = stampFor(version)
  writeManifest(manifestPath, manifest)
  return manifest
}

/**
 * The open-time check (D21). Throws StampRefusalError when the org is
 * newer than this build; otherwise reports whether migration is needed.
 *
 * @returns {{ orgVersion: number, appVersion: number, needsMigration: boolean }}
 */
export function checkOrgStamp(orgPath, appVersion = TEMPLATE_VERSION) {
  const orgVersion = readOrgStampVersion(orgPath)
  if (orgVersion > appVersion) {
    throw new StampRefusalError(orgVersion, appVersion)
  }
  return { orgVersion, appVersion, needsMigration: orgVersion < appVersion }
}
