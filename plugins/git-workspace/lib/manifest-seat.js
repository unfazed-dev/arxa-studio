// A "seat" is whatever repo directory the git card / the session gate is
// currently describing: a Freestyle root, a project, or an org — each keeps
// its own manifest at a fixed name in its own folder. This resolver tries
// them in one fixed order so callers stop hard-coding which file to read
// (freestyle-section Task 7): a Freestyle root's `.arxa/freestyle.json`
// wins over a stray `project.json` at the same path (a project can sit
// inside a Freestyle root — the root itself is still a Freestyle seat),
// which wins over `org.json`. `fallbackOrgPath`, when given, is tried last
// (its own `org.json`) for a seat that carries no manifest of its own.
//
// Deliberately dependency-free (fs/path only, no plugin-specific imports):
// both plugins/arxa-git-card and plugins/arxa-sidebar import this.
import fs from 'node:fs'
import path from 'node:path'

const read = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null // missing or unreadable — try the next candidate
  }
}

/**
 * Resolve a seat's manifest. Order: `<repoPath>/.arxa/freestyle.json` →
 * `<repoPath>/project.json` → `<repoPath>/org.json` → (if given)
 * `<fallbackOrgPath>/org.json`. Returns the first one that exists and
 * parses; `{ manifest: null, kind: null, file: null }` when none do —
 * never throws.
 */
export function seatManifest(repoPath, fallbackOrgPath = null) {
  const tries = [
    [path.join(repoPath, '.arxa', 'freestyle.json'), 'freestyle'],
    [path.join(repoPath, 'project.json'), 'project'],
    [path.join(repoPath, 'org.json'), 'org'],
  ]
  if (fallbackOrgPath) tries.push([path.join(fallbackOrgPath, 'org.json'), 'org'])
  for (const [file, kind] of tries) {
    const manifest = read(file)
    if (manifest) return { manifest, kind, file }
  }
  return { manifest: null, kind: null, file: null }
}
