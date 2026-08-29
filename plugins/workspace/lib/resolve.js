// Resolve-by-id. Callers address orgs and projects by the stable
// manifest id, never by path — paths embed slugs, and although slugs are
// immutable (D41) the id is the identity the rest of the studio keys on.
// This walks the workspace tree, reads every org.json/project.json, and
// answers lookups by id.

import fs from 'node:fs'
import path from 'node:path'
import { readManifest, ORG_MANIFEST, PROJECT_MANIFEST } from './manifest.js'

function subdirs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(dir, e.name))
}

/**
 * Scan a workspace root and index every org and project by manifest id.
 *
 * @returns {{
 *   orgs: Map<string, { id: string, name: string, slug: string, path: string, manifest: object }>,
 *   projects: Map<string, { id: string, name: string, slug: string, path: string, orgId: string, manifest: object }>,
 * }}
 */
export function scanWorkspace(workspaceRoot) {
  const orgs = new Map()
  const projects = new Map()
  // D69 in-place layout: the scanned folder itself may BE the org —
  // org.json sits directly inside it (no wrapper directory).
  const rootSelf = path.join(workspaceRoot, ORG_MANIFEST)
  if (fs.existsSync(rootSelf)) {
    addOrg(workspaceRoot)
  }
  const addOrg = (orgPath) => {
    const orgManifest = readManifest(path.join(orgPath, ORG_MANIFEST))
    orgs.set(orgManifest.id, {
      id: orgManifest.id,
      name: orgManifest.name,
      slug: path.basename(orgPath),
      path: orgPath,
      manifest: orgManifest,
    })
    for (const projectPath of subdirs(path.join(orgPath, 'projects'))) {
      const projectManifestFile = path.join(projectPath, PROJECT_MANIFEST)
      if (!fs.existsSync(projectManifestFile)) continue // free-form folder, not a project
      const projectManifest = readManifest(projectManifestFile)
      projects.set(projectManifest.id, {
        id: projectManifest.id,
        name: projectManifest.name,
        slug: path.basename(projectPath),
        path: projectPath,
        orgId: orgManifest.id,
        manifest: projectManifest,
      })
    }
  }
  for (const orgPath of subdirs(workspaceRoot)) {
    if (!fs.existsSync(path.join(orgPath, ORG_MANIFEST))) continue // not an org folder
    addOrg(orgPath)
  }
  return { orgs, projects }
}

/** Find one org by stable id. Returns null when absent. */
export function resolveOrgById(workspaceRoot, id) {
  return scanWorkspace(workspaceRoot).orgs.get(id) ?? null
}

/** Find one project by stable id. Returns null when absent. */
export function resolveProjectById(workspaceRoot, id) {
  return scanWorkspace(workspaceRoot).projects.get(id) ?? null
}
