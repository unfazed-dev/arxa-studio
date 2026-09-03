// arxa-sandbox — the arxa `SandboxProvider` (Decision S1,
// docs/plans/arxa-isolation-levels.md §17-18).
//
// WHY THIS EXISTS
// ---------------
// dsh's `workspace-write` mode means exactly three writable roots:
// `@deepseek-ai/dsh-sandbox/lib/index.js:154-161` (`writableRoots`) returns
// `[policy.workspaceRoot, "/tmp", os.tmpdir()]` and nothing else. §17 measured
// what that costs on this stack: `git`, `node` and `npm` pass, but `dart` and
// `flutter` FAIL. The toolchain writes OUTSIDE the workspace on every single
// invocation — the SDK's own `bin/cache` (§17's engine stamp) and, the root §17
// did not name, `~/.dart-tool`, where flutter's telemetry layer touches a
// session file before it will do anything at all. None of that is a one-time
// cache warm that could be done before confinement, so the preset could not be
// flipped to `workspace-write` without breaking the studio's own toolchain.
// `resolveToolchainRoots` below records the exact measurement for each root.
//
// This provider is the fix the plan calls for: keep dsh's confinement exactly
// as it is and ADD the runtime-resolved toolchain caches to the writable set.
// It is the same model Claude Code (`sandbox.filesystem.allowWrite`) and Codex
// (`sandbox_workspace_write.writable_roots`) expose — cwd + temp + explicit
// extra roots — spelled as a provider rather than a settings key, because dsh
// has no settings key for it.
//
// THE SEAM (no forked profile builder)
// ------------------------------------
// `@deepseek-ai/dsh-sandbox-local/lib/index.js:322-331` — `runnerArgv(runner,
// policy)`, the instance method `confine()` (`:313`) calls to turn a policy
// into the selected rung's invocation. It is a plain prototype method, so a
// subclass can call `super.runnerArgv(...)` and APPEND grants to what comes
// back. The module-local builders (`seatbeltProfileArgs` :65, `bwrapProfileArgs`
// :22) stay untouched and unduplicated — this file never rebuilds a profile,
// it only extends one.
//
// Seatbelt (the macOS rung, and the only rung in `PLATFORM_CHAINS.darwin`)
// makes that append trivial and safe: SBPL is last-match-wins, which is the
// mechanism the base profile ALREADY relies on — it writes `(deny file-write*)`
// and then re-allows `/dev/null` and the roots after it. One more trailing
// `(allow file-write* (subpath ...))` form is the identical move.
//
// WHAT IS DELIBERATELY UNCHANGED
// ------------------------------
// * `.git` semantics. The base Seatbelt profile carries NO `.git` rule at all —
//   `.git` is writable because it sits under the workspace subpath grant, which
//   is what lets `git commit` work under confinement (§17's session-workflow
//   measurement). Nothing here adds or removes a `.git` rule, so the semantics
//   are identical to the base provider by construction.
// * `read-only`. `extraWritableRoots()` returns nothing unless the policy mode
//   is `workspace-write`, so `read-only` stays the empty allow-list dsh
//   promises.
// * The fail-closed posture. Every unavailable-runner path, probe, denial
//   signature and runner-failure rule is inherited untouched.
// * The `runnerCommand` escape hatch (`:299-309`) bypasses `runnerArgv`
//   entirely — an operator who configures an explicit runner gets dsh's stock
//   grants, unextended. arxa configures no `runnerCommand`.
// * The `landlock` and `windows-acl` rungs. Their grant dialects are the
//   landlock addon's `grantArgs` flags and ACL SIDs; extending them correctly
//   needs measurement on those platforms, and arxa's target is darwin. They
//   pass through super's argv unchanged rather than being extended by guess.
//   `bwrap` IS extended (`--bind <root> <root>`, appended, order-applied) since
//   its dialect is unambiguous.
//
// NEVER HARDCODE A PATH. The Flutter SDK here is an fvm checkout on an external
// volume; on another machine it is Homebrew, or an unzipped tarball, or absent.
// Every root below is resolved at runtime from `PATH` + env and dropped when it
// does not exist, so a machine without Flutter gets dsh's stock behaviour.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { canonicalPath, writableRoots } from '@deepseek-ai/dsh-sandbox'
import LocalSandboxProvider from '@deepseek-ai/dsh-sandbox-local'

/**
 * Locate an executable on PATH the way a shell would.
 * @param {string} command - the bare command name.
 * @returns {string | undefined} the absolute path, or undefined when absent.
 */
export function whichOnPath (command) {
  try {
    const out = execFileSync('/usr/bin/which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    })
    const first = out.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
    return first === undefined ? undefined : first
  } catch {
    return undefined
  }
}

/**
 * The SDK root of a `bin/<tool>` launcher: the directory CONTAINING `bin`,
 * after symlinks are resolved (fvm points `~/fvm/default/bin/flutter` at a
 * versioned checkout somewhere else entirely).
 * @param {string} launcher - the path `which` reported.
 * @param {(p: string) => string} canonical - path canonicaliser.
 * @returns {string | undefined} the SDK root, or undefined when the launcher
 *   does not sit in a `bin/` directory (an unrecognised layout — grant nothing).
 */
export function sdkRootOf (launcher, canonical) {
  const real = canonical(launcher)
  const binDir = dirname(real)
  if (basename(binDir) !== 'bin') return undefined
  return dirname(binDir)
}

/**
 * Resolve the toolchain roots a confined `workspace-write` execution must be
 * able to write, from the live environment only.
 *
 * MEASURED, NOT GUESSED. Every root below was arrived at by running the real
 * command under real Seatbelt and reading what the kernel refused:
 *
 *   * `<sdk>/bin/cache` — §17's finding: `bin/internal/update_engine_version.sh`
 *     writes `cache/engine.stamp.tmp.NNNNN` inside the SDK, and the engine
 *     artifacts land here too. (`flutter --version` alone happens to pass
 *     without it when the stamp is already fresh, but it is required the moment
 *     the stamp goes stale — an SDK update or an fvm channel switch — and by
 *     any command that materializes artifacts.)
 *   * `~/.dart-tool` — the root §17 did not reach, and the ACTUAL blocker for
 *     `flutter --version` on this stack. `unified_analytics` touches
 *     `dart-flutter-telemetry-session.json` on every run; the refusal surfaces
 *     as an UNHANDLED EXCEPTION from inside flutter's own error handler
 *     ("Failed to set file modification time … Operation not permitted"), which
 *     is why the §17 measurement read as a bare "FAIL".
 *   * `PUB_CACHE` / `~/.pub-cache` — every `pub get`.
 *
 * Verified sufficient (and no wider): `flutter create --template=package` plus
 * `flutter pub get` complete under exactly these three. `~/.config/flutter` and
 * `~/.flutter` were NOT needed and are therefore NOT granted — if a future
 * command needs one, measure it and add it here rather than widening pre-emptively.
 * The SDK ROOT is likewise not granted; only its `bin/cache`.
 *
 * Nothing is granted at all when neither `flutter` nor `dart` is on PATH.
 *
 * @param {object} [deps] - injection seam for the selftest.
 * @param {(c: string) => string | undefined} [deps.which] - PATH lookup.
 * @param {Record<string, string | undefined>} [deps.env] - environment.
 * @param {(p: string) => boolean} [deps.exists] - existence predicate.
 * @param {(p: string) => string} [deps.canonical] - path canonicaliser; MUST be
 *   `canonicalPath` semantics (dsh compares resolved paths — `/tmp` IS
 *   `/private/tmp` on darwin, so an as-spelled grant would match nothing).
 * @param {string} [deps.home] - home directory.
 * @returns {string[]} canonical, deduplicated, existing roots; `[]` when no
 *   toolchain is installed.
 */
export function resolveToolchainRoots (deps = {}) {
  const which = deps.which ?? whichOnPath
  const env = deps.env ?? process.env
  const exists = deps.exists ?? existsSync
  const canonical = deps.canonical ?? canonicalPath
  const home = deps.home ?? homedir()

  const flutter = which('flutter')
  const dart = which('dart')
  // No toolchain, no grants — this provider is then byte-for-byte dsh.
  if (flutter === undefined && dart === undefined) return []

  const roots = []

  // Flutter: the SDK's own cache (§17's engine stamp + the artifact store).
  if (flutter !== undefined) {
    const sdk = sdkRootOf(flutter, canonical)
    if (sdk !== undefined) roots.push(join(sdk, 'bin', 'cache'))
  }

  // Dart: usually the same SDK reached through the same `bin/` (fvm ships
  // `bin/dart` beside `bin/flutter`), but a standalone Dart SDK is its own
  // root. The existence filter below drops it when there is no such cache.
  if (dart !== undefined) {
    const sdk = sdkRootOf(dart, canonical)
    if (sdk !== undefined) roots.push(join(sdk, 'bin', 'cache'))
  }

  // The Dart tool's per-user state — `unified_analytics`' telemetry session
  // file lives here and is touched on EVERY flutter/dart invocation. This is
  // the root whose denial crashed `flutter --version` outright.
  roots.push(join(home, '.dart-tool'))

  // The pub package cache — every `pub get`. PUB_CACHE wins when set, exactly
  // as the Dart tooling reads it.
  const pubCache = env.PUB_CACHE !== undefined && env.PUB_CACHE.trim().length > 0
    ? env.PUB_CACHE
    : join(home, '.pub-cache')
  roots.push(pubCache)

  // Canonicalise the same way dsh does, drop what does not exist (a missing
  // toolchain adds nothing), dedupe.
  const seen = new Set()
  const out = []
  for (const root of roots) {
    if (!exists(root)) continue
    const c = canonical(root)
    if (seen.has(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out
}

/**
 * Quote one path as an SBPL string literal — byte-identical to
 * `dsh-sandbox-local:54-56`, replicated because it is module-local there.
 * @param {string} path - the path to quote.
 * @returns {string} the SBPL string literal.
 */
export function sbplString (path) {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

/**
 * Append extra writable-root grants to a Seatbelt invocation without rebuilding
 * its profile. The base rung's argv is `[sandbox-exec, "-p", <SBPL>]`
 * (`dsh-sandbox-local:74`); one more trailing allow form wins under SBPL's
 * last-match-wins evaluation, which is the same mechanism the base profile uses
 * to re-allow roots after its own `(deny file-write*)`.
 * @param {string[]} argv - `super.runnerArgv('seatbelt', policy)`.
 * @param {string[]} roots - canonical roots to add.
 * @returns {string[]} the extended invocation.
 */
export function extendSeatbeltArgv (argv, roots) {
  if (roots.length === 0) return argv
  const flag = argv.length - 2
  if (argv[flag] !== '-p') {
    // Fail loudly rather than silently shipping an unextended profile: an
    // unextended profile is exactly the §17 breakage this provider exists to
    // prevent, and it would surface as an opaque permission error on every
    // Flutter command instead of here.
    throw new Error(
      'arxa-sandbox: unexpected sandbox-exec invocation shape from ' +
      `@deepseek-ai/dsh-sandbox-local (expected a trailing "-p <profile>", got ${JSON.stringify(argv)}). ` +
      'The upstream profile builder changed; re-verify the seam before extending it.'
    )
  }
  const forms = roots.map((root) => `(subpath ${sbplString(root)})`).join(' ')
  const extended = [...argv]
  extended[flag + 1] = `${argv[flag + 1]} (allow file-write* ${forms})`
  return extended
}

/**
 * The arxa sandbox provider: `LocalSandboxProvider` with the runtime-resolved
 * Flutter/Dart toolchain caches added to `workspace-write`'s writable roots.
 * Registers as the same `"sandbox"` service (the name is fixed by
 * `SandboxProvider`'s constructor), so it is a drop-in swap at the
 * `id: sandbox` cordis row.
 */
export default class ArxaSandboxProvider extends LocalSandboxProvider {
  /** Memoized toolchain roots — resolution shells out, so it runs once. */
  #toolchainRoots

  /** Injection seam for the selftest (mirrors the base class's `internals`). */
  arxaInternals = {}

  /**
   * The toolchain roots for this host, resolved once per provider instance.
   * @returns {string[]} canonical existing roots.
   */
  toolchainRoots () {
    if (this.#toolchainRoots === undefined) {
      this.#toolchainRoots = (this.arxaInternals.resolveToolchainRoots ?? resolveToolchainRoots)()
    }
    return this.#toolchainRoots
  }

  /**
   * The roots this provider adds BEYOND dsh's own `writableRoots(policy)` —
   * empty for every mode but `workspace-write`, and never a root dsh already
   * grants.
   * @param {object} policy - the resolved per-call file-effect policy, optionally
   *   carrying `extraWritableRoots` — a per-call grant a caller attaches (e.g.
   *   claude-code's `~/.claude/projects`).
   * @returns {string[]} the additional canonical roots.
   */
  extraWritableRoots (policy) {
    if (policy.mode !== 'workspace-write') return []
    const already = new Set(writableRoots(policy))
    // Per-call grants a caller attaches to the policy (claude-code: ~/.claude/projects).
    // Canonicalised the same way dsh's own roots are — `already` is built from
    // canonical paths, and an as-spelled grant would neither dedupe against it
    // nor match anything once Seatbelt/bwrap resolve symlinks themselves.
    const requested = (Array.isArray(policy.extraWritableRoots) ? policy.extraWritableRoots : []).map(canonicalPath)
    return [...this.toolchainRoots(), ...requested].filter((root, i, all) => !already.has(root) && all.indexOf(root) === i)
  }

  /**
   * `super.runnerArgv` plus this provider's extra grants, in the selected
   * rung's own dialect. Never rebuilds a profile.
   * @param {string} runner - the selected rung.
   * @param {object} policy - the resolved per-call file-effect policy.
   * @returns {string[]} the runner invocation.
   */
  runnerArgv (runner, policy) {
    const argv = super.runnerArgv(runner, policy)
    const extra = this.extraWritableRoots(policy)
    if (extra.length === 0) return argv
    switch (runner) {
      case 'seatbelt':
        return extendSeatbeltArgv(argv, extra)
      case 'bwrap':
        // bwrap applies mount ops in argument order; a trailing bind is the
        // same grant the base makes for the workspace root (`:36`).
        return [...argv, ...extra.flatMap((root) => ['--bind', root, root])]
      default:
        // landlock / windows-acl: not extended by guess. See the header note.
        return argv
    }
  }
}
