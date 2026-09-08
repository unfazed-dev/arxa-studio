/**
 * D117 decorations — the offline half of the plan's Tier 2.
 *
 * Every case here builds a real repository and runs real git. The interesting
 * assertions are the two that a plausible implementation gets wrong:
 *
 *  - a decoration must SURVIVE the D18 auto-commit (a status-only reading goes
 *    blank 1.5s after every save, exactly when the file most obviously changed);
 *  - a commit landing on main from ELSEWHERE must not decorate this session (a
 *    two-dot diff lights up files this session never touched).
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { decorate, foldDirs } from './lib/decorations.js'

let failures = 0
const check = (label, ok, extra = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (ok ? '' : '\n      ' + extra))
  if (!ok) failures++
}

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@b.c',
    GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@b.c',
  },
})

const root = mkdtempSync(join(tmpdir(), 'arxa-deco-'))
try {
  // ---- a repo with a main, and a session branch forked from it ----
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'notes'), { recursive: true })
  git(root, 'init', '-q', '-b', 'main', 'repo')
  writeFileSync(join(repo, 'notes', 'kept.md'), 'kept\n')
  writeFileSync(join(repo, 'notes', 'edited.md'), 'before\n')
  writeFileSync(join(repo, 'notes', 'gone.md'), 'doomed\n')
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base')

  git(repo, 'checkout', '-q', '-b', 'session')

  // ---- 1. uncommitted only: the moment right after a save ----
  writeFileSync(join(repo, 'notes', 'edited.md'), 'after\n')
  writeFileSync(join(repo, 'notes', 'born.md'), 'new\n')
  rmSync(join(repo, 'notes', 'gone.md'))
  let d = decorate(repo)
  check('uncommitted edits decorate', d.ok && d.files['notes/edited.md'] === 'M', JSON.stringify(d.files))
  check('an untracked file reads as added', d.files['notes/born.md'] === 'A', JSON.stringify(d.files))
  check('a deleted file reads as deleted', d.files['notes/gone.md'] === 'D', JSON.stringify(d.files))
  check('an untouched file is not decorated', d.files['notes/kept.md'] === void 0, JSON.stringify(d.files))

  // ---- 2. THE REGRESSION TEST: the auto-commit must not blank them ----
  //
  // This is the one that fails on a status-only implementation. Every Monaco
  // save fires a wipCommit ~1.5s later; if decorations are read from `status`
  // alone they light up on save and go dark on the commit, which reads to the
  // operator as "my change was undone".
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'wip: autosave')
  d = decorate(repo)
  check('a decoration SURVIVES the auto-commit (Tier 2 regression)',
    d.files['notes/edited.md'] === 'M' && d.files['notes/born.md'] === 'A' && d.files['notes/gone.md'] === 'D',
    'after wipCommit the map was ' + JSON.stringify(d.files))
  check('the untouched file is still clean after the commit', d.files['notes/kept.md'] === void 0)

  // ---- 3. someone else lands on main: not this session's business ----
  //
  // `main..HEAD` (two dots) would decorate other.md here, because it compares
  // against main's TIP. Three dots compares against the fork point.
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'notes', 'other.md'), 'theirs\n')
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'someone else')
  git(repo, 'checkout', '-q', 'session')
  d = decorate(repo)
  check("another session's commit on main does not decorate this one",
    d.files['notes/other.md'] === void 0,
    'other.md leaked in — the diff is two-dot, not three-dot: ' + JSON.stringify(d.files))
  check('this session keeps its own decorations after main moved',
    d.files['notes/edited.md'] === 'M', JSON.stringify(d.files))

  // ---- 4. a rename decorates the destination, which is what the tree shows ----
  git(repo, 'mv', 'notes/kept.md', 'notes/renamed.md')
  git(repo, 'commit', '-qm', 'wip: rename')
  d = decorate(repo)
  check('a rename decorates the NEW path', d.files['notes/renamed.md'] !== void 0, JSON.stringify(d.files))

  // ---- 5. folding, so a collapsed folder still shows there is work inside ----
  const dirs = foldDirs({ 'a/b/c.md': 'M', 'a/d.md': 'A', 'top.md': 'M' })
  check('a folder inherits the mark of what is inside it', dirs['a/b'] === 'M' && dirs.a !== void 0, JSON.stringify(dirs))
  check('mixed contents fold to M rather than to whichever came first',
    foldDirs({ 'a/x.md': 'A', 'a/y.md': 'D' }).a === 'M')
  check('a top-level file makes no directory entry', dirs['top.md'] === void 0 && Object.keys(dirs).length === 2, JSON.stringify(dirs))

  // ---- 6. no base branch: say nothing rather than say "clean" ----
  const bare = join(root, 'bare')
  mkdirSync(bare); git(root, 'init', '-q', '-b', 'main', 'bare')
  d = decorate(bare)
  check('a repo with no commits reports not-ok, never a confident "clean"',
    d.ok === false && d.reason === 'no-base' && Object.keys(d.files).length === 0,
    JSON.stringify(d))

  // ---- 7. a path git has to quote ----
  const odd = 'notes/a file "with" quotes.md'
  writeFileSync(join(repo, odd), 'x\n')
  d = decorate(repo)
  check('a quoted path is unescaped, not dropped or mangled',
    d.files[odd] === 'A', 'looked for ' + JSON.stringify(odd) + ' in ' + JSON.stringify(Object.keys(d.files)))
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\ngit-workspace decorations selftest: ' + (failures === 0 ? 'ALL GREEN' : failures + ' FAILURE(S)'))
process.exit(failures === 0 ? 0 : 1)
