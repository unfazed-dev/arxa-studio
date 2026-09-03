// Root project .gitignore (D73, extended by D110). Template v2 (D73) first
// shipped a generic ignore — local noise + secrets only, never the ten
// numbered pipeline containers (00-moodboard … 08-deploy, notes), which are
// managed CONTENT, not build output.
//
// §10.1 of docs/plans/git-card-sessions-worktree-rewire.md found the gap
// this file closes: a real Flutter app copied into a v3 project (before
// this fix existed) shipped no ignore of its own kind, so `initProjectRepo`'s
// `git add -A` staged 447 files — including a `pubspec.yaml` carrying
// absolute local `/Volumes/...` paths that would have become permanent
// history on the first auto-commit. D110 (docs/plans/open-items-completion.md)
// resolved: derive the org's view of a project SHA LIVE (nothing to track,
// no write amplification) + ship this file so a v4 project (application
// track: ios/android/macos/windows/linux/web) can never repeat that.
//
// Flutter/Dart patterns below are transcribed from the flutter/flutter SDK's
// own root .gitignore — NOT invented — fetched and verified at:
// https://github.com/flutter/flutter/blob/master/.gitignore
// (raw: https://raw.githubusercontent.com/flutter/flutter/master/.gitignore)
// which is itself the superset the `flutter create` app template draws
// from (Flutter/Dart/Pub, Android, iOS/Xcode, macOS, Windows, Linux
// sections — including the platform `.../Flutter/ephemeral` / `.../flutter/
// ephemeral/` entries, confirmed present there section-for-section).
//
// SAFETY (read before editing this file): platform build dirs are matched
// ONLY when nested under a known platform folder name (`ios/`, `android/`,
// `macos/`, `windows/`, `linux/`, `web/` — the v4 application-track target
// catalogue, template.js PROJECT_TARGETS_V4) — e.g. `**/ios/build/`, never
// a bare `**/build/` or `build/` (the official file uses a bare `build/`,
// which is safe there because it lives at a real Flutter app's own root).
// Template v2 (PROJECT_CONTAINERS_V2) named its own managed container
// literally `build` (no numeric prefix — v3 renamed it to `06-build`); a
// bare `build/` pattern in THIS file would silently swallow that
// container's real content on ANY template version this file is ever
// loaded against, since a v4 project can nest a Flutter app several levels
// below the arxa project root. Scoping under the platform name makes that
// collision impossible regardless of template version, so this module
// never needs to know which version is asking.

import fs from 'node:fs'
import path from 'node:path'

/** Original v2/v3 content (D73) — UNCHANGED. Local noise + secrets only,
 * never project content. `build/` is a MANAGED CONTAINER (template v2) and
 * must never be ignored. Templates v2 and v3 keep pointing at this exact
 * constant: getTemplate(2)/(3) are replayed by migrations and must keep
 * producing what they always produced. */
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

/**
 * A target's own `build/` output, at any depth EXCEPT the project root.
 *
 * The platform-scoped rules below (`**\/ios/build/`, `**\/macos/build/`, …)
 * only cover a target whose folder is NAMED after a platform. The gate
 * finds targets by their stack marker, not by folder name (check.sh walks
 * to every `pubspec.yaml`/`package.json`), so a target called anything
 * else — `backoffice`, `admin`, a website-track `landing` — kept its build
 * output tracked. Measured on RESTO/kitchen-project after the tier-2
 * smoke: 46 MB of `unit_test_assets/`, `NOTICES.Z`, shaders and
 * `.cache.dill.track.dill` committed to the user's repo, re-churned by
 * every gate run and carried into every PR by the WIP watcher.
 *
 * The gate had it right all along and the ignore disagreed: check.sh
 * PRUNES `-name build` when walking for targets, i.e. arxa already treats
 * a nested `build` as generated. This makes git agree.
 *
 * The exception is the whole point. Template v2's managed container was
 * named literally `build` at the project ROOT (v3 renamed it `06-build`),
 * and the SAFETY note at the top of this file forbids ever swallowing it.
 * `!/build/` is anchored to the root, so the v2 container is re-included
 * while every nested one stays ignored — verified empirically, not
 * reasoned about, in selftest.gitignore.mjs.
 */
export const TARGET_BUILD_LINES = Object.freeze([
  '# A target\'s own build output, at any depth — the gate already prunes',
  '# `-name build` when it walks for targets. The negation keeps template',
  '# v2\'s managed root container (SAFETY note, top of gitignore.js).',
  '**/build/',
  '!/build/',
])

/** v4 content (D110): everything PROJECT_GITIGNORE covers, plus the OS/
 * editor, Node-framework, and Flutter/Dart sections the v4 application
 * track (ios/android/macos/windows/linux/web) needs. Written by template
 * v4's project.files and backfilled onto pre-v4 projects that have no
 * `.gitignore` at all by migrate.js's v3→v4 step. */
export const PROJECT_GITIGNORE_V4 = [
  '# arxa studio (project scaffold): local noise and secrets only — never',
  '# project content. Extend freely. The ten numbered pipeline containers',
  '# (00-moodboard .. 08-deploy, notes) are managed content — none of their',
  '# own names are ever matched below.',
  '.DS_Store',
  'Thumbs.db',
  '~$*',
  '*.swp',
  '.env',
  '.env.*',
  '!.env.example',
  '.vscode/',
  '.idea/',
  '*.iml',
  '',
  '# Node (arxa studio itself, and any Node-based target)',
  'node_modules/',
  'dist/',
  'out/',
  'coverage/',
  '.next/',
  '.turbo/',
  '',
  '# Python',
  '.venv/',
  '__pycache__/',
  '*.pyc',
  '',
  '# Flutter / Dart — application track (ios, android, macos, windows,',
  '# linux, web). Scoped under the platform folder name so a bare `build/`',
  '# never matches — see the SAFETY note at the top of gitignore.js.',
  '**/.dart_tool/',
  '**/.flutter-plugins',
  '**/.flutter-plugins-dependencies',
  '**/ios/**/Pods/',
  '**/ios/**/.symlinks/',
  '**/ios/Flutter/ephemeral',
  '**/ios/build/',
  '**/android/.gradle/',
  '**/android/local.properties',
  '**/android/**/GeneratedPluginRegistrant.java',
  '**/android/build/',
  '**/macos/Flutter/ephemeral',
  '**/macos/build/',
  '**/windows/flutter/ephemeral/',
  '**/windows/build/',
  '**/linux/flutter/ephemeral/',
  '**/linux/build/',
  '**/web/build/',
  '',
  ...TARGET_BUILD_LINES,
  '',
].join('\n')

/**
 * Write `<projectPath>/.gitignore` with `content` ONLY when no `.gitignore`
 * exists there yet — additive, forward-only, never overwrites a
 * human-modified (or older-template) file. Used by scaffoldProject (via
 * template.js's project.files) for NEW projects, and by migrate.js's
 * v3→v4 step to backfill EXISTING projects that predate D110 and have no
 * `.gitignore` at all (the §10.1 accident).
 *
 * @returns {boolean} true when a file was written, false when one already existed
 */
export function ensureProjectGitignore(projectPath, content = PROJECT_GITIGNORE_V4) {
  const target = path.join(projectPath, '.gitignore')
  if (fs.existsSync(target)) return false
  fs.writeFileSync(target, content)
  return true
}

/**
 * Append TARGET_BUILD_LINES to an EXISTING project `.gitignore` that
 * predates them. Idempotent.
 *
 * Without this the fix reaches nobody who needs it: `ensureProjectGitignore`
 * is deliberately write-only-when-absent, so every project scaffolded
 * before today keeps its old file forever — and those are exactly the
 * projects already committing build output. Same shape and same reason as
 * repos.js's `ensureFrameUnignored`.
 *
 * Appending is safe where rewriting would not be: these two lines are
 * self-contained (a plain ignore plus a root-anchored negation), so they
 * cannot change the meaning of any rule above them, and a human's own
 * edits are left untouched.
 *
 * Ignoring a path does NOT untrack what is already committed — git keeps
 * honouring the index. A project that already committed its build output
 * needs `git rm -r --cached <dir>` as well; this function only stops the
 * bleeding.
 *
 * @returns {{ changed: boolean, reason?: string }}
 */
export function ensureGeneratedIgnored(projectPath) {
  const file = path.join(projectPath, '.gitignore')
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return { changed: false, reason: 'no-gitignore' } }
  const lines = text.split('\n')
  const missing = TARGET_BUILD_LINES.filter((l) => !lines.includes(l))
  if (missing.length === 0) return { changed: false, reason: 'already' }
  const body = text.endsWith('\n') ? text : text + '\n'
  fs.writeFileSync(file, body + missing.join('\n') + '\n')
  return { changed: true }
}
