// arxa-workspace — Phase 1 tree format (docs/plans/file-organisation-implementation.md).
// Pure-library plugin: no prompt sections, no client injection. Exposes
// the on-disk workspace primitives — slugs, manifests, scaffolding,
// workspace-root persistence, resolve-by-id.

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
