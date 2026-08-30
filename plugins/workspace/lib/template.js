// Versioned in-app template (D44). The template is data shipped inside
// the app that describes the org tree — folders, initial files, repo
// boundaries. Scaffolding executes it (scaffold.js) and stamps the org
// with the template version (stamp.js); migrations (migrate.js) move an
// org from one template version to the next. Template v1 IS the phase-1
// tree, exactly — the five fixed categories (D42), org.json/project.json
// manifests (D41/Q3), and thin AGENTS.md context files (D43).

/** The template version this build of the app scaffolds and expects. */
export const TEMPLATE_VERSION = 2

/** Stamp string prefix; full stamps look like `arxa-tree/1` (D21/D44). */
export const STAMP_PREFIX = 'arxa-tree/'

/** Compose the format stamp for a template version. */
export function stampFor(version) {
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError(`template version must be a positive integer, got ${version}`)
  }
  return `${STAMP_PREFIX}${version}`
}

/**
 * Typed failure for a stamp that cannot be parsed at all — corruption,
 * not version skew (that is StampRefusalError's job). Callers get a
 * catchable name instead of a crash.
 */
export class StampParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StampParseError'
  }
}

/** Parse a stamp string back to its integer version. Throws StampParseError on garbage. */
export function parseStamp(stamp) {
  if (typeof stamp !== 'string' || !stamp.startsWith(STAMP_PREFIX)) {
    throw new StampParseError(`unrecognised format stamp: ${JSON.stringify(stamp)}`)
  }
  const version = Number(stamp.slice(STAMP_PREFIX.length))
  if (!Number.isInteger(version) || version < 1) {
    throw new StampParseError(`unrecognised format stamp version: ${JSON.stringify(stamp)}`)
  }
  return version
}

function orgAgentsStub(displayName) {
  return `# ${displayName} — standing instructions

Thin org-level context (D43). Keep this short; it is read by every
session working anywhere inside this organisation.

- Display name lives in org.json; the folder slug never changes.
- The five top-level categories are fixed; free-form folders go inside
  projects/<name>/ and notes/.
`
}

/** Project .gitignore (D73): local noise and secrets ONLY — never project
 * content (the managed containers ARE content). Nested project repos are
 * published to GitHub as-is, so this list stays deliberately small and
 * extendable by the user. `build/` is a MANAGED CONTAINER (template v2)
 * and must never be ignored. */
export const PROJECT_GITIGNORE = [
  '# arxa studio (project scaffold): local noise and secrets only — never',
  '# project content. Extend freely.',
  '.DS_Store',
  'Thumbs.db',
  '~$*',
  '.env',
  '.env.*',
  '!.env.example',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '.venv/',
  'dist/',
  'out/',
  'coverage/',
  '',
].join('\n')

function projectAgentsStub(displayName) {
  return `# ${displayName} — standing instructions

Thin project-level context (D43). Keep this short; it applies to every
session working inside this project.

- Display name lives in project.json; the folder slug never changes.
`
}

/**
 * v2 tree shape (grilled 2026-08-30, session 3): the five docks are
 * containers; their FIXED containers are the session workspaces, and so
 * are the fixed containers of every project. A dock without containers
 * (notes) is itself a workspace. Org rows, dock rows and project rows
 * never host sessions directly.
 */
const DOCKS_V2 = Object.freeze([
  Object.freeze({ slug: 'projects', containers: null }), // dynamic: user projects
  Object.freeze({ slug: 'notes', containers: Object.freeze([]) }), // bare dock = workspace
  Object.freeze({ slug: 'meetings', containers: Object.freeze(['scheduler', 'notes']) }),
  Object.freeze({ slug: 'account', containers: Object.freeze(['receipts', 'invoices', 'subscriptions', 'profile']) }),
  Object.freeze({ slug: 'communications', containers: Object.freeze(['emails', 'messages', 'comments']) }),
])
const PROJECT_CONTAINERS_V2 = Object.freeze([
  'design', 'config', 'deploy', 'diagrams', 'intake',
  'architecture', 'notes', 'build', 'moodboard', 'scaffold',
])
const PROJECT_TARGETS_V2 = Object.freeze(['website', 'application'])

function orgDirsV2() {
  const dirs = []
  for (const dock of DOCKS_V2) {
    dirs.push(dock.slug)
    for (const c of dock.containers ?? []) dirs.push(`${dock.slug}/${c}`)
  }
  return dirs
}

function projectDirsV2() {
  const dirs = []
  for (const c of PROJECT_CONTAINERS_V2) {
    dirs.push(c)
    for (const t of PROJECT_TARGETS_V2) dirs.push(`${c}/${t}`)
  }
  return dirs
}

/**
 * The templates this build ships, keyed by version. Each template
 * describes the org tree and the project tree as plain data:
 *   dirs  — folders to create (org dirs are the fixed categories, D42)
 *   files — { path, content(ctx) } initial files; ctx = { displayName }
 * The manifest (org.json / project.json) is not listed here — it is the
 * identity + stamp carrier and is always written by the scaffolder.
 * v2 adds the structured faces (docks, projectContainers, projectTargets,
 * fixedWorkspaces) the sidebar tree and session validation read.
 */
export const TEMPLATES = Object.freeze({
  1: Object.freeze({
    version: 1,
    org: Object.freeze({
      dirs: Object.freeze(['projects', 'notes', 'meetings', 'account', 'communications']),
      files: Object.freeze([{ path: 'AGENTS.md', content: (ctx) => orgAgentsStub(ctx.displayName) }]),
    }),
    project: Object.freeze({
      dirs: Object.freeze([]),
      files: Object.freeze([{ path: 'AGENTS.md', content: (ctx) => projectAgentsStub(ctx.displayName) }]),
    }),
  }),
  2: Object.freeze({
    version: 2,
    docks: DOCKS_V2,
    projectContainers: PROJECT_CONTAINERS_V2,
    projectTargets: PROJECT_TARGETS_V2,
    /** Fixed org-level workspace paths (project workspaces are dynamic):
     * every bare dock (containers === [] — the dock IS the workspace) +
     * every dock-container path. Container docks and projects are not
     * themselves workspaces. */
    fixedWorkspaces: Object.freeze(
      orgDirsV2().filter((d) => {
        if (d === 'projects') return false
        const dock = DOCKS_V2.find((k) => k.slug === d)
        return !dock || (dock.containers ?? []).length === 0
      }),
    ),
    org: Object.freeze({
      dirs: Object.freeze(orgDirsV2()),
      files: Object.freeze([{ path: 'AGENTS.md', content: (ctx) => orgAgentsStub(ctx.displayName) }]),
    }),
    project: Object.freeze({
      dirs: Object.freeze(projectDirsV2()),
      files: Object.freeze([
        { path: 'AGENTS.md', content: (ctx) => projectAgentsStub(ctx.displayName) },
        // D73: nested project repos publish to GitHub — scaffold carries an
        // ignore from day one (git init alone was the old behaviour).
        { path: '.gitignore', content: () => PROJECT_GITIGNORE },
      ]),
    }),
  }),
})

/** Look up a shipped template by version (defaults to current). */
export function getTemplate(version = TEMPLATE_VERSION) {
  const template = TEMPLATES[version]
  if (!template) {
    throw new Error(`no template shipped for version ${version}`)
  }
  return template
}
