/**
 * arxa-dashboard — arxa engine figures from the FILE CONTRACT (plan §4 step 6, D5).
 *
 * D5 chose files over shelling out to the `arxa` binary (PATH fragility, proven
 * by the monaco work). Everything here is a bounded JSON read of what the
 * engine's own Dart writes:
 *
 *   pipeline/state/run.state.json      the live FSM state (gates.dart StateReader
 *   pipeline/state/default.state.json  precedence: run first, then default)
 *   pipeline/state/deploy-ledger.json  { attempts: [{ target, version, status }] }
 *   design/structure.json              { screens: [], shellRoots: {}, flows: [] }
 *
 * `evidence/` is NEVER walked: one lens smoke is 1.5 MB of PNGs and an org
 * roll-up would read it once per project.
 *
 * ABSENT UNIT ⇒ NULL, NEVER ZERO. A project with no `pipeline/` directory has
 * not run the engine; its phase is `null`, not "intake", and its deploy count
 * is `null`, not 0. Only a literal zero INSIDE an existing state file (the
 * engine's own initPipeline writes `rejections: 0`) is reported as zero.
 *
 * Pure over an injected `readJson(path) → object | null` so the selftest drives
 * it without a filesystem.
 */

/** The FSM's own order (arxa/lib/phases.dart `phases`). Position = progress. */
export const PHASES = Object.freeze(['intake', 'prototype', 'design', 'scaffold', 'review', 'build', 'deploy'])

const j = (readJson, base, rel) => readJson(base + '/' + rel)

/** One project's engine state, or null when the engine never ran there. */
export function engineOf(readJson, path, name) {
  // StateReader precedence: the live run file wins, default.state.json is the fallback.
  const state = j(readJson, path, 'pipeline/state/run.state.json') || j(readJson, path, 'pipeline/state/default.state.json')
  const structure = j(readJson, path, 'design/structure.json') || j(readJson, path, 'structure.json')
  if (!state && !structure) return null

  const phase = state && typeof state.phase === 'string' && PHASES.includes(state.phase) ? state.phase : null
  const ps = state && state.phaseStatus && typeof state.phaseStatus === 'object' ? state.phaseStatus : null
  const here = phase && ps ? ps[phase] : null
  const ledger = j(readJson, path, 'pipeline/state/deploy-ledger.json')
  const attempts = ledger && Array.isArray(ledger.attempts) ? ledger.attempts : null
  const screens = structure && Array.isArray(structure.screens) ? structure.screens.length : null

  return {
    name,
    phase,
    // Position is only meaningful once a phase is known.
    step: phase ? PHASES.indexOf(phase) + 1 : null,
    steps: PHASES.length,
    status: here && typeof here.status === 'string' ? here.status : null,
    // attempts IS written as a literal 0 by initPipeline — a real zero.
    attempts: here && Number.isFinite(here.attempts) ? here.attempts : null,
    dirty: state && typeof state.dirty === 'boolean' ? state.dirty : null,
    rejections: state && state.review && Number.isFinite(state.review.rejections) ? state.review.rejections : null,
    approved: state && state.review && typeof state.review.approved === 'boolean' ? state.review.approved : null,
    targets: state && Array.isArray(state.targets) ? state.targets : null,
    updatedAt: state && typeof state.updatedAt === 'string' ? state.updatedAt : null,
    screens,
    flows: structure && Array.isArray(structure.flows) ? structure.flows.length : null,
    shipped: attempts ? attempts.filter((a) => a && a.status === 'shipped').length : null,
    halted: attempts ? attempts.filter((a) => a && a.status === 'halted').length : null,
  }
}

/**
 * Engine for a resolved row.
 * A category row has no engine data by construction — it reports `reason` and
 * the card states it, rather than disappearing (a hidden card would leave a
 * hole in the 12-column bento, which the operator ruled out).
 * @param {{ readJson: Function, row: {kind: string}, repos: {path: string, name: string}[] }} io
 */
export function engineFor({ readJson, row, repos }) {
  if (row.kind === 'category') return { reason: 'not-applicable', projects: [] }
  const projects = repos.map((r) => engineOf(readJson, r.path, r.name)).filter(Boolean)
  if (!projects.length) return { reason: 'not-set-up', projects: [], scanned: repos.length }
  const shipped = projects.filter((p) => p.shipped !== null)
  return {
    projects,
    scanned: repos.length,
    withEngine: projects.length,
    // Roll-up: the LEAST advanced project is how far the org actually is.
    phase: projects.reduce((a, p) => (p.step && (!a || p.step < a.step) ? p : a), null)?.phase ?? null,
    shipped: shipped.length ? shipped.reduce((n, p) => n + p.shipped, 0) : null,
  }
}
