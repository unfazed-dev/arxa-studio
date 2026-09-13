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
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Bumped whenever a generated frame file changes shape. Existing repos keep
 * the file they were created with — `writeFrameFiles` never clobbers — so
 * without a version a fix to the generator reaches new repos only and every
 * older project keeps the old gate forever, silently. v2 is the per-target
 * walk (B11/B15/B16); v1 is anything generated before stamping existed.
 */
/* v3 (2026-09-03, Q7): ci.yml's push trigger gained `arxa/session/**` so a
 * session branch pushed at its stage boundary is actually CHECKED on GitHub.
 * Before this a session-branch push fired no workflow at all — the trigger was
 * main-only — so "push the branch" would have been a backup, not CI. */
/* v4 (2026-09-03, path identity): session branches are `arxa/<org>/<workspace>/
 * <leaf>` now, so the push trigger widens from `arxa/session/**` to `arxa/**`.
 * (v4's note used to also promise the t3ci checks below. It shipped without
 * them — the note was written from the plan, not from the code. They are v5.) */
/* v5 (2026-09-03, Q13): the t3ci reproducibility checks reach project targets —
 * SDK pinned by `.fvmrc`, `pub get --enforce-lockfile`, `analyze
 * --fatal-warnings`. A separate version because `writeFrameFiles` keeps any
 * file whose stamp already reads FRAME_VERSION: editing v4's body in place
 * would have upgraded new repos only and left every existing one — RESTO
 * included — silently on the old gate. */
/* v6 (2026-09-13, B1/B2 — docs/plans/arxa-isolation-levels.md §15/S4): the
 * integrity gates ship unconditionally into every project frame.
 * B1: `npm ci --ignore-scripts` where package-lock.json exists (the Dart half
 * already enforced its lockfile in v5), OSV scanning when the scanner is
 * installed (an honest note, never a red, otherwise).
 * B2: a base-branch diff-policy gate — forbidden paths with CI config first,
 * gitleaks over the diff when installed — plus a hard red on a TRACKED
 * plaintext .env (§7's ranked failure #1), and ci.yml now runs the BASE
 * branch's copy of check.sh against PR heads so the gate is never
 * self-modifying. */
export const FRAME_VERSION = 6

const STAMP_RE = /^# arxa-frame: v(\d+) ([0-9a-f]{16})$/m
const STAMP_LINE_RE = /^# arxa-frame: v\d+ [0-9a-f]{16}\n/m

const digest = (body) => crypto.createHash('sha256').update(body).digest('hex').slice(0, 16)

/** Stamp generated content: after the shebang when there is one, else on top. */
export function stampContent(content) {
  const line = `# arxa-frame: v${FRAME_VERSION} ${digest(content)}\n`
  if (!content.startsWith('#!')) return line + content
  const nl = content.indexOf('\n') + 1
  return content.slice(0, nl) + line + content.slice(nl)
}

/** `{ version, hash }` for a stamped file, else null. */
export function readStamp(text) {
  const m = STAMP_RE.exec(text)
  return m ? { version: Number(m[1]), hash: m[2] } : null
}

const unstamp = (text) => text.replace(STAMP_LINE_RE, '')

/**
 * How a frame file on disk relates to what the generator would write now.
 * `modified` means a human edited it: an upgrade must never overwrite that,
 * because the whole point of the hash is to tell "old" from "customised".
 */
export function frameFileState(abs) {
  if (!fs.existsSync(abs)) return 'missing'
  const text = fs.readFileSync(abs, 'utf8')
  const st = readStamp(text)
  if (!st) return 'unversioned'
  if (digest(unstamp(text)) !== st.hash) return 'modified'
  return st.version === FRAME_VERSION ? 'current' : 'stale'
}

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
    // POSIX sh: ci.yml (and the selftest) run this with `sh`, which is dash on
    // Debian/Ubuntu — dash has no pipefail and `set -o pipefail` there is a
    // hard "Illegal option" exit 2, i.e. red on day zero (found by the Ubuntu
    // lane, 2026-09-07). Keep pipefail where the shell has it, skip it where not.
    'set -u',
    '(set -o pipefail) 2>/dev/null && set -o pipefail',
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
    '# Numbered (stage) folders are NN-kebab. B19: this used to walk the WHOLE',
    '# tree, including into projects/ — which are NESTED, SEPARATE repos whose',
    '# content is the user\'s own application. A Flutter app carries',
    '# android/.gradle/9.1.0, and "9.1.0" starts with a digit, so the ORG gate',
    '# failed on a Gradle cache directory it had no business reading. Projects',
    '# are excluded from the org repo entirely (D37) and carry their own gate,',
    '# so prune them here and let each repo police its own stages.',
    'find . -name .git -prune -o -name account -prune -o -name projects -prune -o -type d -print | while read -r d; do',
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
    '# A project\'s own stages live at DEPTH 1 and are NN-kebab (notes is',
    '# free-form and unnumbered). Depth 1 only, deliberately: below a stage is',
    '# the user\'s application content, where a version-numbered directory is',
    '# entirely normal (android/.gradle/9.1.0, node_modules/.../4.17.21). The',
    '# org gate used to walk all of it and fail on exactly that — B19.',
    'find . -mindepth 1 -maxdepth 1 -type d ! -name .git | while read -r d; do',
    '  b=' + '$' + '{d##*/}',
    '  case "$b" in',
    '    [0-9][0-9]-[a-z0-9]*) ;;',
    '    [0-9]*) fail "stage folder not NN-kebab: $d" ;;',
    '  esac',
    'done || exit 1',
    '',
    "# --- project stack probe (the stack's own tests, when present) ------------",
    '# The repo root, captured before the walk: a target is probed from its own',
    '# directory, but a project-level .fvmrc lives up here.',
    'root=$(pwd)',
    '# Targets live at <stage>/<track>/<target>/, not at the project root, so',
    '# walk to every stack marker and probe in ITS directory (B11 — probing the',
    '# root alone passed a broken real app in 0.03s). Green by absence: a tree',
    '# with no targets still passes. Vendored and generated trees are pruned so',
    '# a dependency is never mistaken for a target.',
    'find . \\( -name node_modules -o -name .dart_tool -o -name .git -o -name .arxa \\',
    '       -o -name build -o -name Pods -o -name vendor -o -name .symlinks \\',
    '       -o -name ephemeral \\) -prune -o \\',
    '     \\( -name package.json -o -name pubspec.yaml -o -name Cargo.toml \\',
    '       -o -name pyproject.toml \\) -print \\',
    '| sort | while IFS= read -r marker; do',
    '  d=$(dirname "$marker")',
    '  (',
    '    cd "$d" || exit 1',
    '    # B1/§7: a TRACKED plaintext .env is the ranked #1 secret failure —',
    '    # red wherever it appears (root below, targets here). An UNtracked',
    '    # .env is the legitimate pre-encryption state and stays green.',
    '    if [ -f .env ] && git ls-files --error-unmatch .env >/dev/null 2>&1; then',
    '      fail ".env is TRACKED at $d — encrypt to .env.sops (never commit plaintext)"',
    '    fi',
    '    case "$(basename "$marker")" in',
    '      package.json)',
    '        command -v npm >/dev/null 2>&1 || exit 0',
    '        # B1: the lockfile is the dependency truth — `ci` refuses a drifted',
    '        # package-lock.json (lockfile/manifest coherence, enforced by npm',
    '        # itself), and --ignore-scripts keeps install scripts (Shai-Hulud\'s',
    '        # vector) from running as this user. Green by absence: no lockfile,',
    '        # no install step.',
    '        if [ -f package-lock.json ]; then',
    '          npm ci --ignore-scripts --silent || fail "npm ci --ignore-scripts ($d)"',
    '        fi',
    '        grep -q \'"test"\' package.json || exit 0',
    '        npm test --silent || fail "npm test ($d)"',
    '        ;;',
    '      pubspec.yaml)',
    '        # A Flutter target must be driven by flutter, not dart: `dart test`',
    '        # cannot load dart:ui and reds a perfectly healthy app (B16), which',
    '        # is how a gate earns a reputation for lying and gets switched off.',
    '        if grep -q "sdk:[[:space:]]*flutter" pubspec.yaml 2>/dev/null; then',
    '          run=flutter',
    '        else',
    '          run=dart',
    '        fi',
    '        # t3ci reproducibility (Q13), and every one of the three is GUARDED.',
    '        # arxa studio is distributed software: a check that reds a tree for',
    '        # LACKING an optional file is a check the user switches off, which',
    '        # costs more than it ever caught. So green by absence survives here —',
    '        # no .fvmrc or no fvm means the system SDK, and no pubspec.lock means',
    '        # a plain `pub get` that writes one. Absence is never the failure.',
    '        # fvm resolves .fvmrc by walking UP (verified against fvm 4.1.2),',
    '        # so one pin at the project root governs every target under it and',
    '        # a target may still pin its own. Both places are checked; testing',
    '        # only the target dir would ignore the project-level pin the',
    '        # scaffold writes, which is the common case.',
    '        pin=""',
    '        if command -v fvm >/dev/null 2>&1 && { [ -f .fvmrc ] || [ -f "$root/.fvmrc" ]; }; then pin="fvm"; fi',
    '        lock=""',
    '        if [ -f pubspec.lock ]; then lock="--enforce-lockfile"; fi',
    '        # Unpinned needs the tool on PATH; pinned only needs fvm, which',
    '        # supplies the SDK itself.',
    '        [ -n "$pin" ] || command -v "$run" >/dev/null 2>&1 || exit 0',
    '        # Analysis does not need tests (B15 — `[ -d test ]` used to AND the',
    '        # analyzer away, so every freshly scaffolded target went unchecked).',
    '        # An unresolvable pubspec is a hard red: the target cannot build.',
    '        # stdout is dropped, stderr is KEPT: a lockfile rejection that does',
    '        # not say which dependency drifted is a gate nobody can act on.',
    '        $pin "$run" pub get $lock >/dev/null || fail "$run pub get ($d)"',
    '        $pin "$run" analyze --fatal-warnings || fail "$run analyze ($d)"',
    '        if [ -d test ]; then $pin "$run" test || fail "$run test ($d)"; fi',
    '        ;;',
    '      Cargo.toml)',
    '        command -v cargo >/dev/null 2>&1 || exit 0',
    '        cargo test --quiet || fail "cargo test ($d)"',
    '        ;;',
    '      pyproject.toml)',
    '        command -v python3 >/dev/null 2>&1 || exit 0',
    '        grep -q pytest pyproject.toml || exit 0',
    '        python3 -m pytest -q || fail "pytest ($d)"',
    '        ;;',
    '    esac',
    '    # B1: OSV scan of the target\'s lockfile(s), only when the scanner is',
    '    # installed — arxa studio is distributed software and a gate that reds',
    '    # for a MISSING OPTIONAL TOOL is one users switch off, so absence is a',
    '    # printed note, never a failure.',
    '    if command -v osv-scanner >/dev/null 2>&1; then',
    '      for lock in package-lock.json pubspec.lock; do',
    '        [ -f "$lock" ] || continue',
    '        osv-scanner --lockfile="$lock" >/dev/null 2>&1 || fail "osv-scanner $lock ($d)"',
    '      done',
    '    elif [ -f package-lock.json ] || [ -f pubspec.lock ]; then',
    '      echo "note: osv-scanner not installed — vulnerability scan skipped (B1)"',
    '    fi',
    '  ) || exit 1',
    'done || exit 1',
    '',
    '# --- B2: base-branch diff policy (CI PRs only; local runs stay green) -----',
    '# Fires only where a base ref exists (GitHub sets GITHUB_BASE_REF on PR',
    '# events). Forbidden paths, CI config FIRST: a PR must not author the',
    '# workflow that judges it (§15 — otherwise the gate is self-modifying',
    '# and worth nothing). gitleaks sweeps the diff when installed, with the',
    '# same honest-absence note as the OSV row. Lockfile/manifest coherence',
    '# is NOT re-checked textually here: npm ci and pub get --enforce-lockfile',
    '# already refuse drifted manifests at install time, and a weaker textual',
    '# check on top would only lie.',
    'if [ -n "${GITHUB_BASE_REF:-}" ]; then',
    '  if git rev-parse -q --verify "origin/$GITHUB_BASE_REF" >/dev/null 2>&1; then',
    '    range="origin/$GITHUB_BASE_REF...HEAD"',
    '    changed=$(git diff --name-only "$range" -- .github/workflows .git/hooks 2>/dev/null)',
    '    [ -z "$changed" ] || fail "PR modifies forbidden control paths: $changed"',
    '    if command -v gitleaks >/dev/null 2>&1; then',
    '      gitleaks detect --source . --log-opts="$range" --redact >/dev/null 2>&1 \\',
    '        || fail "gitleaks: secrets detected in the PR diff"',
    '    else',
    '      echo "note: gitleaks not installed — diff secret scan skipped (B2)"',
    '    fi',
    '  fi',
    'fi',
    '',
    '# --- light checks ---------------------------------------------------------',
    '[ ! -e .git/index.lock ] || fail ".git/index.lock present"',
    '# B1/§7 root-level twin of the per-target guard above.',
    'if [ -f .env ] && git ls-files --error-unmatch .env >/dev/null 2>&1; then',
    '  fail ".env is TRACKED at the repo root — encrypt to .env.sops (never commit plaintext)"',
    'fi',
  ].join('\n')
  return checkShHead() + '\n' + body + '\n' + subjectCheckSh() + '\n'
}

/** Freestyle repos (F4/F8): one root, ANY stack (or none), no stage/track
 * layout to assume — a Freestyle folder is not an arxa-scaffolded project,
 * so this probes for whichever stack marker lives at the root and runs its
 * own test command when the tool is on PATH. Green by absence: an
 * unrecognised root still passes on commit hygiene alone. */
export function freestyleCheckSh() {
  const body = [
    '',
    '# --- freestyle stack probe (whatever lives at the root) -------------------',
    'if [ -f package.json ]; then',
    '  if command -v npm >/dev/null 2>&1 && grep -q \'"test"\' package.json; then',
    '    npm test --silent || fail "npm test"',
    '  fi',
    'elif [ -f pubspec.yaml ]; then',
    '  if command -v flutter >/dev/null 2>&1; then',
    '    flutter test || fail "flutter test"',
    '  fi',
    'elif [ -f Cargo.toml ]; then',
    '  if command -v cargo >/dev/null 2>&1; then',
    '    cargo test --quiet || fail "cargo test"',
    '  fi',
    'elif [ -f go.mod ]; then',
    '  if command -v go >/dev/null 2>&1; then',
    '    go test ./... || fail "go test"',
    '  fi',
    'elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then',
    '  if command -v python3 >/dev/null 2>&1; then',
    '    python3 -m pytest -q || fail "pytest"',
    '  fi',
    'fi',
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
    // Q7 (2026-09-03): session branches are checked too. The stage boundary
    // already runs this exact check.sh locally before it merges; this is the
    // same gate re-run on the runner against what actually landed. The local
    // gate stays authoritative for the merge, so an offline or local-only org
    // is unaffected (a local-only org gets no ci.yml at all).
    "    branches: [main, 'arxa/**']",
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
    // B2 (§15): CI must run the BASE branch's copy of check.sh against the
    // PR head — otherwise the agent (or anyone) edits the gate in the same
    // PR the gate is supposed to judge, and the gate is self-modifying.
    // Push events and local runs keep the head copy (nothing judges a push
    // except the branch owner).
    '      - name: arxa base-branch frame gate (PRs only)',
    '        if: github.event_name == \'pull_request\'',
    '        run: |',
    '          set -e',
    '          git fetch -q origin "+$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"',
    '          git show "origin/$GITHUB_BASE_REF:check.sh" > "$RUNNER_TEMP/arxa-base-check.sh"',
    '          sh "$RUNNER_TEMP/arxa-base-check.sh"',
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

/**
 * Repo merge settings (D107, flipped 2026-09-02 after the gate was proven).
 *
 * The session flow collapses its WIP run on the BRANCH and then merges with
 * `--no-ff`, so the merge commit's ancestry contains the branch. GitHub's
 * *squash* merge creates a new commit whose ancestry does NOT include the
 * branch — which silently breaks `git branch --merged`, "is this session in
 * main?", and every ancestry question the card asks. Squash was the day-one
 * default; keeping it would have made the collapse-then-`--no-ff` decision
 * unenforceable on the server side.
 *
 * Order matters and was chosen deliberately: fix the gate, watch it red real
 * code, THEN flip. Flipping first would have left a window where main was
 * protected by a gate that checked nothing.
 */
export function settingsPayload() {
  return {
    allow_squash_merge: false,
    allow_merge_commit: true,
    allow_rebase_merge: false,
  }
}

/** Write the frame local files. NEVER clobbers — an existing file is the
 * user (or a newer frame) and stays (returned under kept). check.sh lands
 * executable; ci.yml only when the repo is being published (a local-only
 * org has no use for workflow YAML). */
/**
 * The generated frame files. `stamped` files carry a version + content hash so
 * a later fix can be rolled out to repos that already exist; the PR template is
 * prose a human is meant to edit, so it is written once and never upgraded.
 *
 * Freestyle (F4) is not GitHub-shaped by default: a Freestyle root has no
 * PR workflow assumed (it may never be pushed anywhere), so it gets check.sh
 * alone unless the caller opts into ci.yml for publish time — at which point
 * it gets the PR template too, same as org/project, since publishing is what
 * makes the GitHub-hosted-repo conventions apply.
 */
function frameFiles(kind, includeCiYml) {
  let checkContent
  if (kind === 'org') checkContent = orgCheckSh()
  else if (kind === 'project') checkContent = projectCheckSh()
  else if (kind === 'freestyle') checkContent = freestyleCheckSh()
  else throw new TypeError('frame kind must be org|project|freestyle')

  const files = [{ rel: 'check.sh', content: checkContent, mode: 0o755, stamped: true }]
  if (kind !== 'freestyle' || includeCiYml) files.push({ rel: path.join('.github', 'pull_request_template.md'), content: prTemplate(), mode: 0o644, stamped: false })
  if (includeCiYml) files.push({ rel: path.join('.github', 'workflows', 'ci.yml'), content: ciYml(), mode: 0o644, stamped: true })
  return files
}

/**
 * Report each frame file's state without touching disk — the card's source for
 * "this repo's frame is out of date". Only stamped files can be judged.
 */
export function frameStatus(repoPath, kind = 'org', { includeCiYml = false } = {}) {
  const out = {}
  for (const f of frameFiles(kind, includeCiYml)) {
    if (!f.stamped) continue
    out[f.rel] = frameFileState(path.join(repoPath, f.rel))
  }
  return out
}

/**
 * Write the frame. Missing files are always created. An existing file is kept
 * untouched unless `upgrade` is set, and even then a file a human has edited
 * (hash no longer matches its stamp) is reported as `conflicted` rather than
 * overwritten — `force` is the only way past that, and it is a data-losing
 * operation the caller must ask for explicitly.
 */
export function writeFrameFiles(repoPath, kind = 'org', { includeCiYml = false, upgrade = false, force = false } = {}) {
  const written = []; const kept = []; const upgraded = []; const conflicted = []
  const put = (abs, f) => {
    const body = f.stamped ? stampContent(f.content) : f.content
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body, { mode: f.mode })
    // writeFileSync mode is masked by umask — chmod explicitly.
    fs.chmodSync(abs, f.mode)
  }
  for (const f of frameFiles(kind, includeCiYml)) {
    const abs = path.join(repoPath, f.rel)
    const state = f.stamped ? frameFileState(abs) : (fs.existsSync(abs) ? 'current' : 'missing')
    if (state === 'missing') { put(abs, f); written.push(f.rel); continue }
    if (!upgrade || state === 'current') { kept.push(f.rel); continue }
    if (state === 'modified' && !force) { conflicted.push(f.rel); continue }
    put(abs, f); upgraded.push(f.rel)
  }
  return { written, kept, upgraded, conflicted }
}
