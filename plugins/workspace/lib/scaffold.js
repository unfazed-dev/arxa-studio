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
import { slugify, uniqueSlug } from './slug.js'
import { getTemplate, stampFor, TEMPLATE_VERSION, validateTargets } from './template.js'
import { validateWorkspaceRoot } from './root.js'
import {
  createManifest,
  writeManifest,
  orgManifestPath,
  projectManifestPath,
} from './manifest.js'

/** The five fixed dock slugs inside every org (D42; v2 names them docks —
 *  the top-level dir set is still exactly these). */
export const CATEGORIES = ['projects', 'notes', 'meetings', 'account', 'communications']

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
  // Every dir the template names — including parents of nested entries
  // ('meetings/scheduler' also creates 'meetings').
  const created = new Set([targetPath])
  for (const dir of spec.dirs) {
    fs.mkdirSync(path.join(targetPath, dir), { recursive: true })
    const abs = path.join(targetPath, dir)
    created.add(abs)
    const parts = dir.split('/')
    for (let i = 1; i < parts.length; i++) created.add(path.join(targetPath, ...parts.slice(0, i)))
  }
  for (const file of spec.files) {
    fs.writeFileSync(path.join(targetPath, file.path), file.content(ctx))
    const abs = path.dirname(path.join(targetPath, file.path))
    created.add(abs)
    const rel = path.relative(targetPath, abs)
    if (rel && rel !== '.') {
      const parts = rel.split('/')
      for (let i = 1; i < parts.length; i++) created.add(path.join(targetPath, ...parts.slice(0, i)))
    }
  }
  // D78: git (and therefore GitHub) cannot track an empty directory — a
  // scaffolded folder that ships no file would silently never reach the
  // remote. Drop a .gitkeep into every created dir that ended up empty —
  // EXCEPT the account dock, which D37 excludes from version control
  // entirely (billing mirrors and secrets never enter git history).
  for (const dir of created) {
    const rel = path.relative(targetPath, dir)
    if (rel === 'account' || rel.startsWith('account/')) continue
    try {
      if (fs.readdirSync(dir).length === 0) fs.writeFileSync(path.join(dir, '.gitkeep'), '')
    } catch { /* best effort — the tree is still correct without it */ }
  }
}

/**
 * Scaffold a new organisation INTO the picked folder DIRECTLY (D69): the
 * folder chosen by the user IS the org root — org.json (carrying the
 * template-version stamp, D44), the five fixed categories, and a thin
 * AGENTS.md are created inside it. No wrapper directory. D36 placement
 * rules apply to the org folder itself; scaffolding into a folder that is
 * already an organisation fails loud. The slug is the folder's own
 * kebab-cased basename (D41) — the user picked the name by picking the
 * folder.
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 */
export function scaffoldOrg(orgFolder, displayName) {
  const template = getTemplate()
  const orgPath = validateWorkspaceRoot(orgFolder)
  if (fs.existsSync(orgManifestPath(orgPath))) {
    throw new Error(`already-an-organisation: ${orgPath} already carries org.json (D69)`)
  }
  const slug = slugify(path.basename(orgPath))
  if (slug === '') {
    throw new Error(`org folder name ${path.basename(orgPath)} has no slug form — rename the folder`)
  }
  executeTemplateTree(template.org, orgPath, { displayName })
  const manifest = createManifest(displayName, stampFor(template.version))
  writeManifest(orgManifestPath(orgPath), manifest)
  return { path: orgPath, slug, manifest }
}

/**
 * Legacy-shape helper (pre-D69 callers that still hold a parent root):
 * create `<root>/<slug>/` (slug collision-suffixed) and scaffold the org
 * IN PLACE inside it. New code should call scaffoldOrg on the picked
 * folder directly.
 */
export function scaffoldOrgInRoot(root, displayName) {
  const slug = uniqueSlug(displayName, existingSlugs(root))
  const orgPath = path.join(root, slug)
  fs.mkdirSync(orgPath, { recursive: true })
  return scaffoldOrg(orgPath, displayName)
}

/**
 * Create `<orgPath>/projects/<slug>/` for a new project by executing the
 * current template's project tree: project.json and a thin AGENTS.md.
 * The org's stamp governs the whole tree; projects carry no stamp (B13).
 *
 * @returns {{ path: string, slug: string, manifest: object }}
 *
 * `targets` is the v4 selection — `{ application: ['ios'], website: ['landing'] }`
 * — validated against the shipped catalogue. Only the CHOSEN targets get
 * folders: arxa's contract is that targets are "chosen once at project
 * creation", so scaffolding the whole catalogue would put fifty empty
 * directories in every project and make the choice meaningless.
 *
 * The selection is recorded in `project.json` rather than inferred from the
 * folders later, so "this project has no targets yet" is a fact the card can
 * state, not an absence it has to guess at.
 */
export function scaffoldProject(orgPath, displayName, { targets = {} } = {}) {
  const template = getTemplate()
  const chosen = typeof template.project.projectDirs === 'function'
    ? validateTargets(targets)
    : {}
  const projectsDir = path.join(orgPath, 'projects')
  const slug = uniqueSlug(displayName, existingSlugs(projectsDir))
  const projectPath = path.join(projectsDir, slug)
  const tree = typeof template.project.projectDirs === 'function'
    ? { ...template.project, dirs: template.project.projectDirs(chosen) }
    : template.project
  executeTemplateTree(tree, projectPath, { displayName })
  // No project-level stamp (B13): the org's stamp governs the whole tree.
  const manifest = createManifest(displayName, null)
  manifest.targets = chosen
  writeManifest(projectManifestPath(projectPath), manifest)
  return { path: projectPath, slug, manifest }
}
