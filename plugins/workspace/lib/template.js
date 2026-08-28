// Versioned in-app template (D44). The template is data shipped inside
// the app that describes the org tree — folders, initial files, repo
// boundaries. Scaffolding executes it (scaffold.js) and stamps the org
// with the template version (stamp.js); migrations (migrate.js) move an
// org from one template version to the next. Template v1 IS the phase-1
// tree, exactly — the five fixed categories (D42), org.json/project.json
// manifests (D41/Q3), and thin AGENTS.md context files (D43).

/** The template version this build of the app scaffolds and expects. */
export const TEMPLATE_VERSION = 1

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

function projectAgentsStub(displayName) {
  return `# ${displayName} — standing instructions

Thin project-level context (D43). Keep this short; it applies to every
session working inside this project.

- Display name lives in project.json; the folder slug never changes.
`
}

/**
 * The templates this build ships, keyed by version. Each template
 * describes the org tree and the project tree as plain data:
 *   dirs  — folders to create (org dirs are the fixed categories, D42)
 *   files — { path, content(ctx) } initial files; ctx = { displayName }
 * The manifest (org.json / project.json) is not listed here — it is the
 * identity + stamp carrier and is always written by the scaffolder.
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
})

/** Look up a shipped template by version (defaults to current). */
export function getTemplate(version = TEMPLATE_VERSION) {
  const template = TEMPLATES[version]
  if (!template) {
    throw new Error(`no template shipped for version ${version}`)
  }
  return template
}
