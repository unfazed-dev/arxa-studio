/**
 * Full-scan indexer (Phase 2). Walks the on-disk workspace tree — the single
 * source of truth (D46) — and emits plain rows for orgs, projects, and files.
 * Never writes anything; external edits made with plain fs are legal by
 * definition and simply show up on the next scan.
 *
 * Documented on-disk format:
 *   <root>/<org-slug>/org.json                      org manifest
 *   <root>/<org-slug>/{projects,notes,meetings,account,communications}/
 *   <root>/<org-slug>/projects/<slug>/project.json  project manifest
 *   Manifests: { id, name, createdAt, formatStamp }
 *
 * Skips: `.arxa/trash/` subtrees and the internals of dot-directories,
 * EXCEPT `<org>/.arxa/facts/` (D20 fact logs are part of the truth).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

export const CATEGORIES = [
  'projects',
  'notes',
  'meetings',
  'account',
  'communications',
]

const toPosix = (p) => p.split('\\').join('/')

function readManifest(absPath) {
  try {
    const m = JSON.parse(readFileSync(absPath, 'utf8'))
    return m && typeof m === 'object' ? m : null
  } catch {
    return null
  }
}

function kindOf(relParts) {
  // relParts is the path relative to the org dir, split on '/'
  if (relParts.length === 1 && relParts[0] === 'org.json') return 'org-manifest'
  if (
    relParts[0] === 'projects' &&
    relParts.length === 3 &&
    relParts[2] === 'project.json'
  )
    return 'project-manifest'
  if (relParts[0] === '.arxa' && relParts[1] === 'facts') return 'fact-log'
  if (CATEGORIES.includes(relParts[0])) return relParts[0]
  return 'other'
}

/**
 * Scan the workspace at `root`. Returns { orgs, projects, files }, each a
 * deterministically sorted array of plain rows:
 *   org:     { id, slug, name, createdAt, formatStamp, path }
 *   project: { id, slug, orgId, name, createdAt, formatStamp, path }
 *   file:    { path, kind, orgId, projectId, mtimeMs, size }
 * All paths are posix-style, relative to `root`.
 */
export function scanWorkspace(root) {
  const orgs = []
  const projects = []
  const files = []

  // Emit one org's rows (manifest row, project rows, file walk). Shared by
  // the D69 in-place layout (root folder IS the org) and the legacy
  // wrapper layout (orgs are subdirectories of the root).
  const emitOrg = (orgDir, orgSlug, manifest, manifestPath) => {
    orgs.push({
      id: manifest.id ?? null,
      slug: orgSlug,
      name: manifest.name ?? null,
      createdAt: manifest.createdAt ?? null,
      formatStamp: manifest.formatStamp ?? null,
      path: manifestPath,
    })

    // Project manifests
    const projectsDir = join(orgDir, 'projects')
    let projectIdBySlug = new Map()
    try {
      for (const p of readdirSync(projectsDir, { withFileTypes: true })) {
        if (!p.isDirectory() || p.name.startsWith('.')) continue
        const pm = readManifest(join(projectsDir, p.name, 'project.json'))
        if (!pm) continue
        projectIdBySlug.set(p.name, pm.id ?? null)
        projects.push({
          id: pm.id ?? null,
          slug: p.name,
          orgId: manifest.id ?? null,
          name: pm.name ?? null,
          createdAt: pm.createdAt ?? null,
          formatStamp: pm.formatStamp ?? null,
          path: `${orgSlug}/projects/${p.name}/project.json`,
        })
      }
    } catch {
      /* no projects dir — fine */
    }

    // File walk of the org dir
    walk(orgDir, [], (relParts, st) => {
      const kind = kindOf(relParts)
      const projectId =
        relParts[0] === 'projects' && relParts.length >= 2
          ? (projectIdBySlug.get(relParts[1]) ?? null)
          : null
      files.push({
        path: toPosix([orgSlug, ...relParts].join('/')),
        kind,
        orgId: manifest.id ?? null,
        projectId,
        mtimeMs: Math.floor(st.mtimeMs),
        size: st.size,
      })
    })
  }

  // D69 in-place layout: the root itself carries org.json.
  const rootManifest = readManifest(join(root, 'org.json'))
  if (rootManifest) emitOrg(root, basename(root), rootManifest, 'org.json')

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // Top-level dot-dirs (e.g. the workspace's own .arxa index store) are
    // not orgs and are never indexed.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const orgSlug = entry.name
    const orgDir = join(root, orgSlug)
    const manifest = readManifest(join(orgDir, 'org.json'))
    if (!manifest) continue // not an org dir
    emitOrg(orgDir, orgSlug, manifest, `${orgSlug}/org.json`)
  }

  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  orgs.sort(byPath)
  projects.sort(byPath)
  files.sort(byPath)
  return { orgs, projects, files }
}

function walk(base, relParts, emit) {
  const dir = join(base, ...relParts)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const nextRel = [...relParts, e.name]
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) {
        // Dot-dir internals are skipped, except .arxa (to reach facts).
        if (e.name !== '.arxa') continue
      }
      // Inside .arxa: only descend into facts/; trash/ is explicitly skipped.
      if (nextRel[nextRel.length - 2] === '.arxa' && e.name !== 'facts') continue
      walk(base, nextRel, emit)
    } else if (e.isFile()) {
      // Files directly inside a dot-dir other than .arxa/facts are internals.
      const parentIsDot = relParts.some((p) => p.startsWith('.'))
      const inFacts = relParts[0] === '.arxa' && relParts[1] === 'facts'
      if (parentIsDot && !inFacts) continue
      let st
      try {
        st = statSync(join(dir, e.name))
      } catch {
        continue
      }
      emit(nextRel, st)
    }
  }
}
