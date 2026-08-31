// The arxa CI frame (Part B grill Q3/Q4/Q5/Q7/Q8 — docs/plans/
// git-card-part-b-grill.md). Every arxa-created repo ships the frame from
// day zero: a green-by-absence check.sh, and — once the repo is published —
// a ci.yml on the canon self-hosted labels, a PR template, squash-only
// repo settings, and branch protection (strict, frame-check required).
//
// SSOT WARNING: the conventional-subject regex exists TWICE by necessity —
// here (JS, for the card + tests) and inside the check.sh bodies (sh, for
// local + CI runs). Edit both together. The types list and the pattern
// must stay identical.
import fs from 'node:fs'
import path from 'node:path'

/** The one CI job the day-one frame runs (protection contexts match it). */
export const FRAME_JOB = 'frame-check'

/** Conventional-subject pattern (Q7). Twin: the sh fragment below. */
export const SUBJECT_TYPES = ['docs', 'feat', 'fix', 'refactor', 'test', 'chore', 'perf', 'build', 'ci', 'style', 'merge']
export const SUBJECT_RE = new RegExp('^(' + SUBJECT_TYPES.join('|') + ')(\\([^)]*\\))?!?: ')

/** Shared sh tail: REQUIRED conventional subjects (--no-merges, canon
 * window: origin/main..HEAD when a remote base exists, else a bounded
 * HEAD window; green by absence when there is nothing to check).
 * WIP-tier commits (committer wip@arxa.invalid, D18) are app plumbing
 * squashed away at the next boundary — never subject-checked. */
function subjectCheckSh() {
  return [
    '',
    '# --- commit subjects (REQUIRED from day one: no legacy commits) ---------',
    '# Twin of SUBJECT_RE in plugins/git-workspace/lib/frame.js — edit both.',
    'range=""',
    '# With a remote base: only what the base has not seen. Without one (a',
    '# young local repo): the whole history — arxa repos are conventional',
    '# from their first commit. Unborn HEAD yields nothing: green by absence.',
    'if git rev-parse -q --verify origin/main >/dev/null 2>&1; then',
    '  range="origin/main..HEAD"',
    'fi',
    'bad=$(git log --no-merges --format="%ce%x09%s" $range 2>/dev/null \\',
    '    | grep -v "^wip@arxa.invalid" \\',
    '    | cut -f2- \\',
    '    | grep -vcE \'^(docs|feat|fix|refactor|test|chore|perf|build|ci|style|merge)(\\([^)]*\\))?!?: \' || true)',
    '[ "$bad" -eq 0 ] || fail "non-conventional commit subjects ${range:-in history}: $bad — pattern: <type>(<scope>): <what is now true>"',
  ].join('\n')
}

function checkShHead() {
  return [
    '#!/bin/sh',
    '# arxa frame — day-zero check. Green by absence: a fresh tree passes;',
    '# red only when something real is wrong. Local green = CI green (the',
    '# ci.yml runs this exact script). SSOT: plugins/git-workspace/lib/frame.js',
    'set -uo pipefail',
    'cd "$(dirname "$0")"',
    'fail() { echo "FAIL: $1" >&2; exit 1; }',
  ].join('\n')
}

/** Org repos: content-light checks (Q4) — the failures we have actually hit. */
export function orgCheckSh() {
  const body = [
    '',
    '# --- org content checks ---------------------------------------------------',
    '[ -f org.json ] || fail "org.json missing"',
    'if command -v node >/dev/null 2>&1; then',
    '  node -e "JSON.parse(require(\'fs\').readFileSync(\'org.json\',\'utf8\'))" >/dev/null 2>&1 || fail "org.json does not parse"',
    'elif command -v python3 >/dev/null 2>&1; then',
    '  python3 -c "import json,sys;json.load(open(sys.argv[1]))" org.json >/dev/null 2>&1 || fail "org.json does not parse"',
    'fi',
    '# Top-level DIRECTORIES: the five fixed docks + dotted entries only.',
    '# Loose top-level files stay legal (not a measured failure class).',
    'find . -mindepth 1 -maxdepth 1 -type d ! -name .git | while read -r d; do',
    '  case "$d" in',
    '    ./projects|./notes|./meetings|./account|./communications) ;;',
    '    ./.*) ;;',
    '    *) fail "unexpected top-level directory: $d — free-form folders live inside projects/<name> and notes/" ;;',
    '  esac',
    'done || exit 1',
    '# No stray locks or temp files (the PLATO/D92c class of rot).',
    '[ ! -e .git/index.lock ] || fail ".git/index.lock present — a git operation is stuck or crashed"',
    'found_tmp=$(find . -maxdepth 1 -name .git -prune -o -type f \\( -name "*.tmp" -o -name "*.swp" -o -name "*~" \\) -print)',
    '[ -z "$found_tmp" ] || fail "stray temp file at org root: $found_tmp"',
    '# Numbered (stage) folders are NN-kebab, everywhere except .git/account.',
    'find . -name .git -prune -o -name account -prune -o -type d -print | while read -r d; do',
    '  b=' + '$' + '{d##*/}',
    '  case "$b" in',
    '    [0-9][0-9]-[a-z0-9]*) ;;',
    '    [0-9]*) fail "stage folder not NN-kebab: $d" ;;',
    '  esac',
    'done || exit 1',
  ].join('\n')
  return checkShHead() + '\n' + body + '\n' + subjectCheckSh() + '\n'
}

/** Project repos: stack probe (Q4) — run the stack's own tests when the
 * stack and its tool are present; light checks otherwise. */
export function projectCheckSh() {
  const body = [
    '',
    "# --- project stack probe (the stack's own tests, when present) ------------",
    'if [ -f package.json ] && command -v npm >/dev/null 2>&1 && grep -q \'"test"\' package.json; then',
    '  npm test --silent || fail "npm test"',
    'fi',
    'if [ -f pubspec.yaml ] && command -v dart >/dev/null 2>&1 && [ -d test ]; then',
    '  dart pub get >/dev/null 2>&1 || fail "dart pub get"',
    '  dart analyze || fail "dart analyze"',
    '  dart test || fail "dart test"',
    'fi',
    'if [ -f Cargo.toml ] && command -v cargo >/dev/null 2>&1; then',
    '  cargo test --quiet || fail "cargo test"',
    'fi',
    'if [ -f pyproject.toml ] && command -v python3 >/dev/null 2>&1 && grep -q pytest pyproject.toml; then',
    '  python3 -m pytest -q || fail "pytest"',
    'fi',
    '',
    '# --- light checks ---------------------------------------------------------',
    '[ ! -e .git/index.lock ] || fail ".git/index.lock present"',
  ].join('\n')
  return checkShHead() + '\n' + body + '\n' + subjectCheckSh() + '\n'
}

/** ci.yml — canon: self-hosted labels, concurrency+cancel, timeout always. */
export function ciYml() {
  return [
    '# arxa frame — generated by arxa studio (plugins/git-workspace/lib/frame.js).',
    '# Runner canon: docs/ci/self-hosted-runners.md — never GitHub-hosted for',
    '# arxa-managed (private) repos. End users may override on their own repos.',
    'name: ci',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    'concurrency:',
    '  group: ci-@@EXPR@@',
    '  cancel-in-progress: true',
    'jobs:',
    '  ' + FRAME_JOB + ':',
    '    runs-on: [self-hosted, macOS, ARM64, arxa]',
    '    timeout-minutes: 15',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '      - name: arxa frame checks',
    '        run: sh check.sh',
    '',
  ].join('\n').replace('@@EXPR@@', '$' + '{{ github.ref }}')
}

/** PR template — problem first, then the fix; attribution footer (Q7). */
export function prTemplate() {
  return [
    '## Problem',
    "<!-- the problem in the user's words, a sentence or two -->",
    '',
    '## Fix',
    '<!-- how you fixed it — no implementation inventory -->',
    '',
    '— written by <model> in arxa studio',
    '',
  ].join('\n')
}

/** Branch protection payload (Q3/Q8): strict, frame-check required. */
export function protectionPayload() {
  return {
    required_status_checks: { strict: true, checks: [{ context: FRAME_JOB }] },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  }
}

/** Repo settings payload (Q8): squash-only, locked structurally. */
export function settingsPayload() {
  return {
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
  }
}

/** Write the frame local files. NEVER clobbers — an existing file is the
 * user (or a newer frame) and stays (returned under kept). check.sh lands
 * executable; ci.yml only when the repo is being published (a local-only
 * org has no use for workflow YAML). */
export function writeFrameFiles(repoPath, kind = 'org', { includeCiYml = false } = {}) {
  const isOrg = kind === 'org'
  const files = [
    { rel: 'check.sh', content: isOrg ? orgCheckSh() : projectCheckSh(), mode: 0o755 },
    { rel: path.join('.github', 'pull_request_template.md'), content: prTemplate(), mode: 0o644 },
  ]
  if (includeCiYml) files.push({ rel: path.join('.github', 'workflows', 'ci.yml'), content: ciYml(), mode: 0o644 })
  const written = []
  const kept = []
  for (const f of files) {
    const abs = path.join(repoPath, f.rel)
    if (fs.existsSync(abs)) { kept.push(f.rel); continue }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, f.content, { mode: f.mode })
    // writeFileSync mode is masked by umask — chmod explicitly.
    fs.chmodSync(abs, f.mode)
    written.push(f.rel)
  }
  return { written, kept }
}
