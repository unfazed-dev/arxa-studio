// arxa-workspace — Phases 1 + 5 tree format (docs/plans/file-organisation-implementation.md).
// Pure-library plugin: no prompt sections, no client injection. Exposes
// the on-disk workspace primitives — slugs, manifests, scaffolding,
// workspace-root persistence, resolve-by-id — plus the versioned
// template, format stamp, and migration runner (D21/D44). Only the
// migration runner touches git (through arxa-git-workspace); everything
// else, including the stamp refusal, works with git absent.

export const name = 'arxa-workspace'

export { slugify, uniqueSlug } from './slug.js'
export {
  FORMAT_STAMP,
  ORG_MANIFEST,
  PROJECT_MANIFEST,
  createManifest,
  readManifest,
  writeManifest,
  renameInManifest,
  orgManifestPath,
  projectManifestPath,
} from './manifest.js'
export { CATEGORIES, scaffoldOrg, scaffoldProject } from './scaffold.js'
export {
  ROOT_FILE,
  arxaHome,
  rootFilePath,
  validateWorkspaceRoot,
  saveWorkspaceRoot,
  loadWorkspaceRoot,
} from './root.js'
export { scanWorkspace, resolveOrgById, resolveProjectById } from './resolve.js'
export { TEMPLATE_VERSION, TEMPLATES, STAMP_PREFIX, getTemplate, stampFor, parseStamp } from './template.js'
export {
  StampRefusalError,
  readOrgStampVersion,
  writeOrgStampVersion,
  checkOrgStamp,
} from './stamp.js'
export { MigrationError, MIGRATIONS, migrationChain, migrateOrg, openOrg } from './migrate.js'
export { OrgLockedError, acquireOrgLock, withOrgLock } from './lock.js'
export {
  TRASH_DIR,
  ORIGIN_MANIFEST,
  TrashError,
  RestoreConflictError,
  HistoryBoundaryError,
  ConfirmRequiredError,
  hardDeleteToken,
  trashRoot,
  softDelete,
  listTrash,
  restoreFromTrash,
  hardDelete,
  sweepTrash,
} from './trash.js'
