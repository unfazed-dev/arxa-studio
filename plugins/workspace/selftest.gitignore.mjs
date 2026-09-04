// D110 (docs/plans/open-items-completion.md) exit checks: a scaffolded
// project must ship a root .gitignore before any auto-commit action is
// wired — see §10.1 of docs/plans/git-card-sessions-worktree-rewire.md for
// the accident this closes (a v3 project with no ignore at all; `git add
// -A` staged 447 files, including a pubspec.yaml with absolute local
// paths). Covers: scaffold-time content, a real `git add -A` proving the
// junk/managed-container split holds, and the v3→v4 migration backfill for
// pre-existing projects (additive, never overwrites).
// Run: node plugins/workspace/selftest.gitignore.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { scaffoldOrgInRoot, scaffoldProject } from './lib/scaffold.js'
import { getTemplate, TEMPLATE_VERSION } from './lib/template.js'
import { PROJECT_GITIGNORE_V4, TARGET_BUILD_LINES, ensureProjectGitignore, ensureGeneratedIgnored } from './lib/gitignore.js'
import { openOrg, MIGRATIONS } from './lib/migrate.js'
import { writeOrgStampVersion } from './lib/stamp.js'
import { initOrgRepo, initProjectRepo, runGit } from '../git-workspace/lib/index.js'

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`PASS ${label}`)
  } catch (err) {
    failures++
    console.log(`FAIL ${label} — ${err.message}`)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arxa-gitignore-selftest-'))
const workspaceRoot = path.join(tmp, 'workspace')
fs.mkdirSync(workspaceRoot, { recursive: true })

try {
  // --- scaffold-time content ---
  const org = scaffoldOrgInRoot(workspaceRoot, 'Gitignore Org')
  const project = scaffoldProject(org.path, 'Gitignore Project', { targets: { application: ['ios'] } })

  check('scaffold writes a root .gitignore with Flutter/Node/Python/OS coverage (D110)', () => {
    const body = fs.readFileSync(path.join(project.path, '.gitignore'), 'utf8')
    assert.equal(body, PROJECT_GITIGNORE_V4, 'matches the v4 constant byte-for-byte')
    // Node
    assert.match(body, /node_modules\//)
    assert.match(body, /\.env\b/)
    // Python
    assert.match(body, /__pycache__\//)
    assert.match(body, /\.venv\//)
    // OS/editor
    assert.match(body, /\.DS_Store/)
    assert.match(body, /\.vscode\//)
    // Flutter/Dart (scoped, per SAFETY note in gitignore.js)
    assert.match(body, /\*\*\/\.dart_tool\//)
    assert.match(body, /\*\*\/ios\/\*\*\/Pods\//)
    assert.match(body, /\*\*\/ios\/build\//)
    assert.match(body, /\*\*\/android\/build\//)
    assert.match(body, /\*\*\/macos\/Flutter\/ephemeral/)
    assert.match(body, /\*\*\/windows\/flutter\/ephemeral\//)
    assert.match(body, /\*\*\/linux\/flutter\/ephemeral\//)
    // Never a bare build/ — v2's managed container is literally named `build`
    assert.doesNotMatch(body, /(^|\n)build\//)
  })

  // --- D110's actual claim: the .gitignore is in place BEFORE the auto-commit,
  // so `initProjectRepo`'s own `git add -A` + commit (the §10.1 accident path)
  // never stages the junk in the first place. Junk is created BEFORE
  // initProjectRepo runs, and we assert on what actually got committed
  // (`git ls-files`), not on a separately-staged/reset diff. ---
  check('initProjectRepo (the real auto-commit) never tracks Flutter/Node junk, still tracks the managed 06-build container (D110 x D95)', () => {
    const container = getTemplate(TEMPLATE_VERSION).projectContainers.find((c) => c.endsWith('build'))
    assert.ok(container, 'template ships a build-stage container')
    const stage = getTemplate(TEMPLATE_VERSION).projectContainers[0]
    // Junk nested under the chosen ios target, at various noise points.
    const iosBuild = path.join(project.path, stage, 'application', 'ios', 'build')
    fs.mkdirSync(iosBuild, { recursive: true })
    fs.writeFileSync(path.join(iosBuild, 'output.app'), 'junk')
    fs.mkdirSync(path.join(project.path, stage, 'application', 'ios', '.dart_tool'), { recursive: true })
    fs.writeFileSync(path.join(project.path, stage, 'application', 'ios', '.dart_tool', 'package_config.json'), '{}')
    fs.mkdirSync(path.join(project.path, 'node_modules', 'left-pad'), { recursive: true })
    fs.writeFileSync(path.join(project.path, 'node_modules', 'left-pad', 'index.js'), 'junk')
    fs.writeFileSync(path.join(project.path, '.DS_Store'), 'junk')
    // Real content inside the managed build container — must stay trackable.
    fs.writeFileSync(path.join(project.path, container, 'application', 'notes.md'), 'real content')

    initProjectRepo(project.path) // the real init + `git add -A` + commit path
    const tracked = runGit(['ls-files'], { cwd: project.path })
    assert.doesNotMatch(tracked, /ios\/build\/output\.app/, 'ios build/ output never committed')
    assert.doesNotMatch(tracked, /\.dart_tool\/package_config\.json/, '.dart_tool/ never committed')
    assert.doesNotMatch(tracked, /node_modules\/left-pad\/index\.js/, 'node_modules/ never committed')
    assert.doesNotMatch(tracked, /(^|\n)\.DS_Store$/m, '.DS_Store never committed')
    assert.match(tracked, /06-build\/application\/notes\.md/, 'managed 06-build content IS committed')
  })

  // --- ensureProjectGitignore direct unit tests ---
  check('ensureProjectGitignore writes only when absent, never overwrites', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'ensure-'))
    assert.equal(ensureProjectGitignore(dir), true, 'writes when absent')
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), PROJECT_GITIGNORE_V4)
    fs.writeFileSync(path.join(dir, '.gitignore'), '# human-modified\ncustom-rule/\n')
    assert.equal(ensureProjectGitignore(dir), false, 'no-op when present')
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), '# human-modified\ncustom-rule/\n', 'untouched')
  })

  // --- migration backfill: pre-v4 project missing .gitignore gets it; one that already has it is left alone ---
  const migOrg = scaffoldOrgInRoot(workspaceRoot, 'Gitignore Migration Org')
  initOrgRepo(migOrg.path)
  writeOrgStampVersion(migOrg.path, 1)
  runGit(['add', '-A'], { cwd: migOrg.path })
  runGit(['commit', '-m', 'test: stamp at v1'], { cwd: migOrg.path })

  // A v2-shaped project predating D73/D110: its own nested repo, no .gitignore at all — the §10.1 accident, reproduced.
  const bareProj = path.join(migOrg.path, 'projects', 'bare-project')
  for (const c of getTemplate(2).projectContainers) {
    fs.mkdirSync(path.join(bareProj, c, 'website'), { recursive: true })
    fs.mkdirSync(path.join(bareProj, c, 'application'), { recursive: true })
  }
  fs.writeFileSync(path.join(bareProj, 'project.json'), JSON.stringify({ id: 'bare', name: 'Bare', createdAt: 'now' }))
  runGit(['init'], { cwd: bareProj })
  runGit(['add', '-A'], { cwd: bareProj })
  runGit(['commit', '-m', 'chore(project): scaffold the project tree'], { cwd: bareProj })

  // A second project that already carries a (custom) .gitignore — migration must leave it byte-for-byte alone.
  const customProj = path.join(migOrg.path, 'projects', 'custom-project')
  for (const c of getTemplate(2).projectContainers) {
    fs.mkdirSync(path.join(customProj, c, 'website'), { recursive: true })
    fs.mkdirSync(path.join(customProj, c, 'application'), { recursive: true })
  }
  fs.writeFileSync(path.join(customProj, 'project.json'), JSON.stringify({ id: 'custom', name: 'Custom', createdAt: 'now' }))
  const customIgnore = '# a human already wrote this\nmy-custom-ignore/\n'
  fs.writeFileSync(path.join(customProj, '.gitignore'), customIgnore)
  runGit(['init'], { cwd: customProj })
  runGit(['add', '-A'], { cwd: customProj })
  runGit(['commit', '-m', 'chore(project): scaffold the project tree'], { cwd: customProj })

  check('org migration to latest backfills .gitignore where absent, leaves a pre-existing one untouched (D110)', () => {
    openOrg(migOrg.path, { appVersion: TEMPLATE_VERSION, migrations: MIGRATIONS })
    const backfilled = fs.readFileSync(path.join(bareProj, '.gitignore'), 'utf8')
    assert.equal(backfilled, PROJECT_GITIGNORE_V4, 'bare project gets the v4 content')
    const unchanged = fs.readFileSync(path.join(customProj, '.gitignore'), 'utf8')
    assert.equal(unchanged, customIgnore, 'pre-existing .gitignore is never overwritten')
  })

  // --- TARGET_BUILD_LINES: what git ACTUALLY does, not what the string says --
  // The whole rule is a claim about git's matching behaviour, so it is tested
  // by staging a real tree in a real repo. A string assertion here would have
  // passed happily while `!/build/` silently failed to re-include anything.
  check('a target build/ is ignored at depth while template v2\'s root container survives', () => {
    const d = fs.mkdtempSync(path.join(tmp, 'buildignore-'))
    runGit(['init'], { cwd: d })
    fs.writeFileSync(path.join(d, '.gitignore'), PROJECT_GITIGNORE_V4)
    const put = (rel, body) => {
      fs.mkdirSync(path.join(d, path.dirname(rel)), { recursive: true })
      fs.writeFileSync(path.join(d, rel), body)
    }
    // Template v2's MANAGED container, literally named `build` at the root.
    put('build/brief/spec.md', 'user content, never generated\n')
    // A target the platform-scoped rules cannot see: not named after a
    // platform, which is exactly the case that leaked (RESTO tier 2).
    put('06-build/application/backoffice/pubspec.yaml', 'name: backoffice\n')
    put('06-build/application/backoffice/lib/menu.dart', 'class Menu {}\n')
    put('06-build/application/backoffice/build/unit_test_assets/NOTICES.Z', 'junk\n')
    put('06-build/application/backoffice/build/native_assets.json', '{}\n')
    // The website track leaked the same way.
    put('06-build/website/landing/build/out.js', 'junk\n')
    runGit(['add', '-A'], { cwd: d })
    const tracked = (runGit(['ls-files'], { cwd: d }) ?? '').split('\n').filter(Boolean)

    assert.ok(tracked.includes('build/brief/spec.md'), 'the v2 managed root container must stay tracked — the SAFETY invariant')
    assert.ok(tracked.includes('06-build/application/backoffice/lib/menu.dart'), 'real source next to the build dir must stay tracked')
    assert.ok(tracked.includes('06-build/application/backoffice/pubspec.yaml'), 'the stack marker must stay tracked')
    assert.deepEqual(tracked.filter((f) => f.includes('/build/')), [], 'no nested build output may be tracked')
  })

  check('ensureGeneratedIgnored patches a project that predates the rule, and is idempotent', () => {
    const d = fs.mkdtempSync(path.join(tmp, 'patch-'))
    // Exactly what an already-scaffolded project has on disk: the v4 file
    // as it shipped BEFORE these lines existed.
    const old = PROJECT_GITIGNORE_V4.split('\n').filter((l) => !TARGET_BUILD_LINES.includes(l)).join('\n')
    fs.writeFileSync(path.join(d, '.gitignore'), old)
    assert.equal(ensureGeneratedIgnored(d).changed, true, 'a pre-rule project is patched')
    const after = fs.readFileSync(path.join(d, '.gitignore'), 'utf8').split('\n')
    for (const line of TARGET_BUILD_LINES) assert.ok(after.includes(line), 'missing line: ' + line)
    assert.equal(ensureGeneratedIgnored(d).changed, false, 'idempotent')
    assert.equal(ensureGeneratedIgnored(d).reason, 'already')
  })

  check('ensureGeneratedIgnored keeps a human\'s own rules and never invents a file', () => {
    const d = fs.mkdtempSync(path.join(tmp, 'human-'))
    fs.writeFileSync(path.join(d, '.gitignore'), '# mine\nsecret-notes/\n')
    assert.equal(ensureGeneratedIgnored(d).changed, true)
    const after = fs.readFileSync(path.join(d, '.gitignore'), 'utf8')
    assert.ok(after.startsWith('# mine\nsecret-notes/\n'), 'the human\'s rules stay first and intact')
    const empty = fs.mkdtempSync(path.join(tmp, 'none-'))
    assert.deepEqual(ensureGeneratedIgnored(empty), { changed: false, reason: 'no-gitignore' }, 'no .gitignore is never created here — that is ensureProjectGitignore\'s job')
  })

} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (failures > 0) {
  console.log(`\n${failures} FAILURE(S)`)
  process.exit(1)
}
console.log('\nPASS — all checks green')
