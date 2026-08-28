// Org/project scaffolder (D42, D43). An org gets exactly the five fixed
// studio-owned categories — users cannot add top-level categories;
// free-form folders live inside projects/<name> and notes/. Each org and
// each project also gets a thin AGENTS.md context-file stub (org root's
// copy is the thin standing-instructions layer, D1-capped).

import fs from 'node:fs'
import path from 'node:path'
import { uniqueSlug } from './slug.js'
import {
  createManifest,
  writeManifest,
  orgManifestPath,
  projectManifestPath,
  ORG_MANIFEST,
  PROJECT_MANIFEST,
} from './manifest.js'

/** The five fixed categories inside every org (D42). Exactly these. */
export const CATEGORIES = Object.freeze([
  'projects',
  'notes',
  'meetings',
  'account',
  'communications',
])

function orgAgentsStub(displayName) {
  return `# ${displayName} — standing instructions

Thin org-level context (D43). Keep this short; it is read by every
session working anywhere inside this organisation.

- Display name lives in ${ORG_MANIFEST}; the folder slug never changes.
- The five top-level categories are fixed; free-form folders go inside
  projects/<name>/ and notes/.
`
}

function projectAgentsStub(displayName) {
  return `# ${displayName} — standing instructions

Thin project-level context (D43). Keep this short; it applies to every
session working inside this project.

- Display name lives in ${PROJECT_MANIFEST}; the folder slug never changes.
`
}

function existingSlugs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/**
 * Create `<workspaceRoot>/<slug>/` for a new organisation: the five
 * fixed categories, org.json, and a thin AGENTS.md.
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 */
export function scaffoldOrg(workspaceRoot, displayName) {
  const slug = uniqueSlug(displayName, existingSlugs(workspaceRoot))
  const orgPath = path.join(workspaceRoot, slug)
  fs.mkdirSync(orgPath, { recursive: true })
  for (const category of CATEGORIES) {
    fs.mkdirSync(path.join(orgPath, category), { recursive: true })
  }
  const manifest = createManifest(displayName)
  writeManifest(orgManifestPath(orgPath), manifest)
  fs.writeFileSync(path.join(orgPath, 'AGENTS.md'), orgAgentsStub(displayName))
  // phase 3: git init the org repo here (D37 git half — out of Phase 1 scope)
  return { path: orgPath, slug, manifest }
}

/**
 * Create `<orgPath>/projects/<slug>/` for a new project: project.json
 * and a thin AGENTS.md.
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 */
export function scaffoldProject(orgPath, displayName) {
  const projectsDir = path.join(orgPath, 'projects')
  const slug = uniqueSlug(displayName, existingSlugs(projectsDir))
  const projectPath = path.join(projectsDir, slug)
  fs.mkdirSync(projectPath, { recursive: true })
  const manifest = createManifest(displayName)
  writeManifest(projectManifestPath(projectPath), manifest)
  fs.writeFileSync(path.join(projectPath, 'AGENTS.md'), projectAgentsStub(displayName))
  // phase 3: git init the project repo (own repo, nested inside and ignored by the org repo, D37)
  return { path: projectPath, slug, manifest }
}
