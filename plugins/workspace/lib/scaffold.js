// Org/project scaffolder (D42, D43, D44). The versioned in-app template
// (template.js) is the single description of the org tree; the scaffolder
// EXECUTES it — creates its dirs, writes its initial files, writes the
// manifest — and stamps the org with the template version (D44). An org
// gets exactly the five fixed studio-owned categories — users cannot add
// top-level categories; free-form folders live inside projects/<name>
// and notes/. Each org and each project also gets a thin AGENTS.md
// context-file stub (org root's copy is the thin standing-instructions
// layer, D1-capped).

import fs from 'node:fs'
import path from 'node:path'
import { uniqueSlug } from './slug.js'
import { getTemplate, stampFor, TEMPLATE_VERSION } from './template.js'
import {
  createManifest,
  writeManifest,
  orgManifestPath,
  projectManifestPath,
} from './manifest.js'

/** The five fixed categories inside every org (D42). Exactly these. */
export const CATEGORIES = getTemplate(TEMPLATE_VERSION).org.dirs

function existingSlugs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/** Execute one template tree spec ({ dirs, files }) at targetPath. */
function executeTemplateTree(spec, targetPath, ctx) {
  fs.mkdirSync(targetPath, { recursive: true })
  for (const dir of spec.dirs) {
    fs.mkdirSync(path.join(targetPath, dir), { recursive: true })
  }
  for (const file of spec.files) {
    fs.writeFileSync(path.join(targetPath, file.path), file.content(ctx))
  }
}

/**
 * Create `<workspaceRoot>/<slug>/` for a new organisation by executing
 * the current template's org tree: the five fixed categories, org.json
 * (carrying the template-version stamp, D44), and a thin AGENTS.md.
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 */
export function scaffoldOrg(workspaceRoot, displayName) {
  const template = getTemplate()
  const slug = uniqueSlug(displayName, existingSlugs(workspaceRoot))
  const orgPath = path.join(workspaceRoot, slug)
  executeTemplateTree(template.org, orgPath, { displayName })
  const manifest = createManifest(displayName, stampFor(template.version))
  writeManifest(orgManifestPath(orgPath), manifest)
  return { path: orgPath, slug, manifest }
}

/**
 * Create `<orgPath>/projects/<slug>/` for a new project by executing the
 * current template's project tree: project.json and a thin AGENTS.md.
 * (The org's stamp governs the whole tree; projects carry the same
 * stamp value informationally.)
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 */
export function scaffoldProject(orgPath, displayName) {
  const template = getTemplate()
  const projectsDir = path.join(orgPath, 'projects')
  const slug = uniqueSlug(displayName, existingSlugs(projectsDir))
  const projectPath = path.join(projectsDir, slug)
  executeTemplateTree(template.project, projectPath, { displayName })
  const manifest = createManifest(displayName, stampFor(template.version))
  writeManifest(projectManifestPath(projectPath), manifest)
  return { path: projectPath, slug, manifest }
}
