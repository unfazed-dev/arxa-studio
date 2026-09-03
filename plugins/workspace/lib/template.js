// Versioned in-app template (D44). The template is data shipped inside
// the app that describes the org tree — folders, initial files, repo
// boundaries. Scaffolding executes it (scaffold.js) and stamps the org
// with the template version (stamp.js); migrations (migrate.js) move an
// org from one template version to the next. Template v1 IS the phase-1
// tree, exactly — the five fixed categories (D42), org.json/project.json
// manifests (D41/Q3), and thin AGENTS.md context files (D43).

import { PROJECT_GITIGNORE, PROJECT_GITIGNORE_V4 } from './gitignore.js'

// Re-exported for compatibility — some callers/tests import PROJECT_GITIGNORE
// from template.js directly; the constant itself now lives in gitignore.js
// alongside PROJECT_GITIGNORE_V4 and the D110 backfill helper.
export { PROJECT_GITIGNORE }

/** The template version this build of the app scaffolds and expects. */
export const TEMPLATE_VERSION = 4

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

// Project .gitignore (D73, extended by D110): PROJECT_GITIGNORE (imported
// above from gitignore.js) is local noise + secrets only — never project
// content (the managed containers ARE content). `build/` is a MANAGED
// CONTAINER (template v2) and must never be ignored. Templates v2/v3 keep
// using it unchanged since getTemplate(2)/(3) are replayed by migrations.
// PROJECT_GITIGNORE_V4 (also imported above) extends it with OS/editor,
// Node-framework, and Flutter/Dart coverage for the v4 application track.

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
/** v3 (D78, grilled 2026-08-30): the same ten containers, renamed to carry a
 * 2-digit prefix in arxa's own pipeline order (docs/research/pipeline-map.md
 * §1 + arxa-orchestrator): moodboard is stage 0 (optional, before intake),
 * intake 1, design 2 (architecture = its structure output, diagrams its
 * visuals), scaffold 3, build 4, config = deploy prep, deploy 9. notes is
 * NOT a stage (D42 free-form) and stays unnumbered, last. Empty containers
 * ship a .gitkeep (scaffold.js) so the whole tree reaches GitHub. */
const PROJECT_CONTAINERS_V3 = Object.freeze([
  '00-moodboard', '01-intake', '02-design', '03-architecture', '04-diagrams',
  '05-scaffold', '06-build', '07-config', '08-deploy', 'notes',
])
const PROJECT_TARGETS_V2 = Object.freeze(['website', 'application'])

/**
 * v4 vocabulary (V1 + V1a, grilled 2026-09-02). The tree gains one level:
 *
 *   <NN-stage>/<track>/<target>/
 *              │        └─ ios, android, macos   (application)
 *              │           landing, docs         (website)
 *              └────────── application | website
 *
 * `application/` and `website/` are the **TRACK**. What sits under a track is
 * the **TARGET**. This makes studio agree with arxa rather than compete with
 * it: `ios`/`android` genuinely are arxa's targets, "the platforms a project
 * ships to". It also stops `website` being a target name, which cleared
 * arxa's `Artifact` _Avoid_ violation.
 *
 * The upper level is `Track`, NOT `Kind` — arxa already owns `Kind` as a
 * gate-enforced closed vocabulary of UI widgets (`gate_kind_registry`).
 *
 * Accepted asymmetry, stated so nobody later reads it as an accident:
 * arxa's targets are platform-only *by contract*, and that holds for the
 * `application` track only. Under `website`, a target is the concrete thing
 * shipped (`landing`, `docs`); the platform is always web and stays implicit.
 *
 * NOTE: the track level ALREADY EXISTS in v3 — `projectDirsV3()` builds
 * `<stage>/website` and `<stage>/application` from PROJECT_TARGETS_V2. v4
 * therefore renames the concept and adds the level beneath it; it does not
 * restructure what v3 produced. PROJECT_TARGETS_V2 stays exactly as it is,
 * because getTemplate(2)/(3) are replayed by migrations.
 */
const PROJECT_TRACKS_V4 = Object.freeze(['website', 'application'])

/** The catalogue of targets each track may contain. */
export const PROJECT_TARGETS_V4 = Object.freeze({
  application: Object.freeze(['ios', 'android', 'macos', 'windows', 'linux', 'web']),
  website: Object.freeze(['landing', 'docs', 'app']),
})

/**
 * Validate a chosen `{ track: [target, …] }` selection against the catalogue.
 * Throws on an unknown track or target — a typo here would silently scaffold
 * a folder the gate then never recognises.
 */
export function validateTargets(selection = {}) {
  const out = {}
  for (const [track, targets] of Object.entries(selection)) {
    if (!PROJECT_TRACKS_V4.includes(track)) {
      throw new TypeError(`unknown track ${JSON.stringify(track)} — expected one of ${PROJECT_TRACKS_V4.join(', ')}`)
    }
    if (!Array.isArray(targets)) throw new TypeError(`targets for ${track} must be an array`)
    for (const t of targets) {
      if (!PROJECT_TARGETS_V4[track].includes(t)) {
        throw new TypeError(`unknown target ${JSON.stringify(t)} for track ${track} — expected one of ${PROJECT_TARGETS_V4[track].join(', ')}`)
      }
    }
    if (targets.length) out[track] = Object.freeze([...new Set(targets)])
  }
  return Object.freeze(out)
}

/**
 * v4 project dirs: every stage, every track, plus one dir per CHOSEN target.
 * Targets are chosen at project creation (arxa: "chosen once at project
 * creation") — scaffolding all of them up front would contradict that and
 * leave ten empty folders in every one of ten stages.
 */
function projectDirsV4(selection = {}) {
  const chosen = validateTargets(selection)
  const dirs = []
  for (const c of PROJECT_CONTAINERS_V3) {
    dirs.push(c)
    for (const track of PROJECT_TRACKS_V4) {
      dirs.push(`${c}/${track}`)
      for (const target of chosen[track] ?? []) dirs.push(`${c}/${track}/${target}`)
    }
  }
  return dirs
}

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

function projectDirsV3() {
  const dirs = []
  for (const c of PROJECT_CONTAINERS_V3) {
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
  3: Object.freeze({
    version: 3,
    docks: DOCKS_V2,
    projectContainers: PROJECT_CONTAINERS_V3,
    projectTargets: PROJECT_TARGETS_V2,
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
      dirs: Object.freeze(projectDirsV3()),
      files: Object.freeze([
        { path: 'AGENTS.md', content: (ctx) => projectAgentsStub(ctx.displayName) },
        { path: '.gitignore', content: () => PROJECT_GITIGNORE },
      ]),
    }),
  }),
  4: Object.freeze({
    version: 4,
    docks: DOCKS_V2,
    projectContainers: PROJECT_CONTAINERS_V3,
    /** v4 renames this level: these are TRACKS, not targets (V1a). */
    projectTracks: PROJECT_TRACKS_V4,
    /** Kept under the old key so existing readers of `projectTargets` still
     * see the track list rather than crashing; new code reads projectTracks. */
    projectTargets: PROJECT_TRACKS_V4,
    /** The catalogue a project chooses its targets from. */
    targetCatalogue: PROJECT_TARGETS_V4,
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
      /** Tracks only. Target dirs are added per project from its chosen
       * selection — see projectDirs(). */
      dirs: Object.freeze(projectDirsV4()),
      /** Build the dirs for a specific target selection. */
      projectDirs: (selection) => Object.freeze(projectDirsV4(selection)),
      files: Object.freeze([
        { path: 'AGENTS.md', content: (ctx) => projectAgentsStub(ctx.displayName) },
        // D110: v4's application track (ios/android/macos/windows/linux/web)
        // needs Flutter/Dart + Node + OS coverage PROJECT_GITIGNORE doesn't
        // carry — see gitignore.js. v2/v3 above stay on PROJECT_GITIGNORE.
        { path: '.gitignore', content: () => PROJECT_GITIGNORE_V4 },
        // Q13: the SDK pin the project gate honours. fvm resolves .fvmrc by
        // walking up, so one pin here governs every target beneath it.
        // Declines (null) when no Flutter is installed — see
        // detectFlutterVersion in scaffold.js.
        {
          path: '.fvmrc',
          content: (ctx) => (ctx.flutterVersion ? JSON.stringify({ flutter: ctx.flutterVersion }, null, 2) + '\n' : null),
        },
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
