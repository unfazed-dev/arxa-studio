// arxa project-database — per-project Supabase lifecycle with the local
// floor (Task 10 Step 5, docs/plans/arxa-isolation-levels.md §8).
//
// THE DESIGN, from the plan:
//   * L1: `supabase init` + `supabase start` INSIDE each project's isolated
//     clone — own containers, own volume, own project_id. The stable
//     project id (the studio's project slug) is the addressing handle for
//     `--project-id` and the port registry alike.
//   * Default ports collide (54321-54324 across every project), so a
//     DISTINCT block of 5 ports is auto-assigned per project, persisted by
//     stable project id in a JSON registry, and re-checked against live
//     binds before first use.
//   * ONE active local stack at a time (§8: the RAM design assumption) —
//     start stops every other arxa-managed active stack first.
//   * The VENDOR's Supabase project is never linked: `supabase link` is not
//     merely avoided, it is asserted against — this module has no code path
//     that constructs it (CLAUDE.md: arxa studio is distributed software;
//     its users never touch the Arxa Digital Solutions database, and the
//     local floor has equivalent capability).
//   * Missing Docker or CLI degrades to the local file/SQLite floor (L0,
//     the mandatory floor for everyone) with a truthful reason — never a
//     failure, never a silent difference in capability.

import { createServer } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { whichOnPath } from './index.js'

/** The size of one project's port block: api, db, studio, email, storage. */
const BLOCK_SIZE = 5
const FIRST_BLOCK = 54321
const BLOCK_STEP = 10

/** config.toml sections carrying a port, and their offset inside the block. */
const PORT_SECTIONS = { api: 0, db: 1, studio: 2, email: 3, storage: 4 }

/** Where the port registry lives by default (the machine's arxa state). */
export const DEFAULT_REGISTRY_PATH = join(homedir(), '.arxa', 'project-databases.json')

/**
 * Detect the Supabase CLI — detect-only, never install.
 * @param {object} [deps] - injection seam (tests): `{ which }`.
 * @returns {{ available: boolean, cli: string | undefined, reason: string }}
 */
export function detectSupabase (deps = {}) {
  const which = deps.which ?? whichOnPath
  const cli = which('supabase')
  if (cli === undefined) {
    return { available: false, cli: undefined, reason: 'the Supabase CLI is not installed — arxa detects rather than assumes; the per-project database degrades to the local sqlite floor' }
  }
  return { available: true, cli, reason: 'the Supabase CLI is installed — the per-project local stack tier is available' }
}

const readRegistryJson = (path) => {
  if (!existsSync(path)) return { projects: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { projects: {}, ...parsed, projects: parsed.projects ?? {} }
  } catch {
    return { projects: {} }
  }
}

/** Can this port be bound right now? (A live stack or any other listener
 * makes the block unusable — allocation skips it rather than fighting.) */
const defaultCanBind = (port) => new Promise((resolve) => {
  const srv = createServer()
  srv.once('error', () => resolve(false))
  srv.once('listening', () => srv.close(() => resolve(true)))
  srv.listen(port, '127.0.0.1')
})

const rangesOverlap = (aBase, bBase) => Math.abs(aBase - bBase) < BLOCK_SIZE

/**
 * Allocate one project's port block, persisted by stable project id.
 * Deterministic-first (the recorded block always wins — a project never
 * migrates ports because a neighbour appeared), then the first free block
 * that collides with nothing recorded and nothing live.
 *
 * @param {{ projectId: string, registryPath?: string }} input
 * @param {object} [deps] - injection seam (tests): `{ canBind }`.
 * @returns {Promise<{ base: number, ports: number[] }>}
 */
export async function allocatePortBlock ({ projectId, registryPath = DEFAULT_REGISTRY_PATH }, deps = {}) {
  const canBind = deps.canBind ?? defaultCanBind
  const registryPathAbs = String(registryPath)
  const reg = readRegistryJson(registryPathAbs)
  const existing = reg.projects[projectId]
  if (existing !== undefined && Number.isInteger(existing.base)) {
    return { base: existing.base, ports: blockPorts(existing.base) }
  }
  const taken = Object.values(reg.projects).map((p) => p.base).filter((b) => Number.isInteger(b))
  for (let base = FIRST_BLOCK; base < FIRST_BLOCK + BLOCK_STEP * 100; base += BLOCK_STEP) {
    if (taken.some((t) => rangesOverlap(base, t))) continue
    const ports = blockPorts(base)
    const bindable = await Promise.all(ports.map((p) => canBind(p)))
    if (bindable.every(Boolean)) {
      reg.projects[projectId] = { base, active: false }
      mkdirSync(dirname(registryPathAbs), { recursive: true })
      writeFileSync(registryPathAbs, JSON.stringify(reg, null, 2) + '\n')
      return { base, ports }
    }
  }
  throw new Error('project-database: no collision-free port block available (searched 100 blocks from 54321)')
}

const blockPorts = (base) => Array.from({ length: BLOCK_SIZE }, (_, i) => base + i)

/**
 * Patch a supabase config.toml onto one project's port block: the section's
 * offset inside the block (§8's collision fix). Also pins `project_id` to
 * the stable project id — the handle `--project-id` addressing needs.
 * @returns {string} the patched TOML text.
 */
function patchConfigToml (toml, projectId, base) {
  let section = null
  return toml.split('\n').map((line) => {
    const sec = /^\[([a-z-]+)\]\s*$/.exec(line.trim())
    if (sec) { section = sec[1]; return line }
    const pid = /^project_id\s*=/.test(line.trim())
    if (pid) return `project_id = "${projectId}"`
    const port = new RegExp(`^port\\s*=\\s*\\d+`).test(line.trim())
    if (port && section !== null && section in PORT_SECTIONS) {
      return line.replace(/port\s*=\s*\d+/, `port = ${base + PORT_SECTIONS[section]}`)
    }
    return line
  }).join('\n')
}

/**
 * The zero-Docker floor: a real local sqlite database under the project's
 * own `.arxa/` (reserved path — the agent cannot rewrite it, arxa owns it).
 * @param {string} repoPath - the project repo root.
 * @returns {{ engine: 'sqlite', path: string, db: object }} the open handle.
 */
function openLocalFloor (repoPath) {
  const dir = join(repoPath, '.arxa')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'arxa.db')
  const db = new DatabaseSync(path)
  return { engine: 'sqlite', path, db }
}

/**
 * Ensure one project's database tier, honestly resolved:
 * Docker + CLI present → the per-project local supabase stack (init inside
 * the isolated clone + the port block); anything missing → the sqlite
 * floor, with the truthful reason.
 *
 * @param {{ projectId: string, repoPath: string, registryPath?: string }} input
 * @param {object} [deps] - injection seam (tests): `{ docker, supabase,
 *   runner, canBind }`.
 * @returns {Promise<{ tier: 'supabase-local' | 'file', reason?: string,
 *   ports?: object, local?: object }>}
 */
export async function ensureProjectDatabase ({ projectId, repoPath, registryPath = DEFAULT_REGISTRY_PATH }, deps = {}) {
  const docker = deps.docker ?? { available: true, reason: 'injected' }
  const supabase = deps.supabase ?? detectSupabase()
  const runner = deps.runner ?? (async () => { throw new Error('project-database: no runner — this path needs Docker and the supabase CLI') })
  if (!docker.available) {
    return { tier: 'file', reason: docker.reason, local: openLocalFloor(repoPath) }
  }
  if (!supabase.available) {
    return { tier: 'file', reason: supabase.reason, local: openLocalFloor(repoPath) }
  }
  const { base, ports } = await allocatePortBlock({ projectId, registryPath }, deps)
  const init = await runner(['supabase', 'init'], { cwd: repoPath })
  if (init.code !== 0) {
    return { tier: 'file', reason: `supabase init failed (${(init.stderr || init.stdout).trim().slice(0, 200)}) — degrading to the local sqlite floor`, local: openLocalFloor(repoPath) }
  }
  const configPath = join(repoPath, 'supabase', 'config.toml')
  if (existsSync(configPath)) {
    writeFileSync(configPath, patchConfigToml(readFileSync(configPath, 'utf8'), projectId, base))
  }
  return { tier: 'supabase-local', ports: { base, ports } }
}

/**
 * Start the project's stack — ONE active at a time: every OTHER
 * arxa-managed active stack is stopped first (§8's RAM assumption).
 * @returns {Promise<{ started: boolean, ports?: number[] }>}
 */
export async function startProjectDatabase ({ projectId, repoPath, registryPath = DEFAULT_REGISTRY_PATH }, deps = {}) {
  const runner = deps.runner
  const reg = readRegistryJson(String(registryPath))
  const { base, ports } = await allocatePortBlock({ projectId, registryPath }, deps)
  for (const [other, row] of Object.entries(reg.projects)) {
    if (other !== projectId && row.active === true) {
      await runner(['supabase', 'stop', '--project-id', other], { cwd: repoPath })
      reg.projects[other].active = false
    }
  }
  const start = await runner(['supabase', 'start'], { cwd: repoPath })
  const started = start.code === 0
  reg.projects[projectId].active = started
  writeFileSync(String(registryPath), JSON.stringify(reg, null, 2) + '\n')
  return { started, ports }
}

/**
 * Stop the project's stack (its containers and volume are the CLI's to
 * remove; the port allocation STAYS — a project never migrates ports).
 * @returns {Promise<{ stopped: boolean }>}
 */
export async function stopProjectDatabase ({ projectId, repoPath, registryPath = DEFAULT_REGISTRY_PATH }, deps = {}) {
  const runner = deps.runner
  const reg = readRegistryJson(String(registryPath))
  const stop = await runner(['supabase', 'stop', '--project-id', projectId], { cwd: repoPath })
  if (reg.projects[projectId] !== undefined) {
    reg.projects[projectId].active = false
    writeFileSync(String(registryPath), JSON.stringify(reg, null, 2) + '\n')
  }
  return { stopped: stop.code === 0 }
}
