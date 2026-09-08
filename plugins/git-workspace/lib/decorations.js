/**
 * D117 — VS Code-style git decorations for the sidebar tree.
 *
 * What a decoration answers: "does this file differ from main, in THIS session?"
 * That is the question the operator is actually asking when they scan the tree,
 * and it is not the question `git status` answers on its own.
 *
 * ## Why two reads, unioned
 *
 * A session is a worktree on its own branch, and its work lives in two places at
 * once:
 *
 *  - **committed** — everything the D18 auto-commit has already swept up. Every
 *    Monaco save fires a `wipCommit` about 1.5s later, so within seconds of
 *    typing the change is no longer "uncommitted" at all.
 *  - **uncommitted** — the last second and a half, plus anything the watcher
 *    has not reached.
 *
 * Reading only `status --porcelain` therefore makes decorations BLINK: they
 * appear on save and vanish 1.5s later when the WIP commit lands, which is the
 * exact moment the file has most definitely changed. Reading only the diff
 * misses the newest edit. Both, unioned, is the only combination that stays
 * lit.
 *
 * ## Why `main...HEAD` and not `main..HEAD`
 *
 * Three dots diffs against the MERGE BASE — where the session actually forked.
 * Two dots would diff against main's tip, so every commit landing on main from
 * some *other* session would light up files this session never touched. The
 * three-dot form is the difference between "what I changed" and "what has
 * changed since I forked", and only the first is a decoration.
 *
 * ## Cost
 *
 * Exactly two `spawnSync` calls per refresh, whatever the tree's size. The
 * per-file shape (`git status <path>` on each row) is the obvious way to write
 * this and it is O(files) processes on every render — the plan's Tier 4 makes
 * that a test, not a hope. Everything here is one map, built once, read by
 * every row.
 */
import { runGit } from './run.js'

/** Decoration letters, narrowed from git's much larger vocabulary.
 *
 * The tree has room for one glyph and the reader has room for one idea, so
 * every git code collapses into four: modified, added, deleted, renamed.
 * `U` (unmerged) deliberately reports as `M` — a conflicted file IS modified,
 * and a session mid-conflict should not lose its decorations. */
const LETTER = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'A', T: 'M', U: 'M', '?': 'A' }

/** Strip git's porcelain quoting. Paths with spaces, quotes or non-ASCII come
 * back wrapped in double quotes with C-style escapes; everything else is
 * literal. Getting this wrong silently drops exactly the files whose names are
 * most interesting. */
function unquote (p) {
  if (!p.startsWith('"')) return p
  try { return JSON.parse(p) } catch { return p.slice(1, -1) }
}

/**
 * Files that differ from `main` in this worktree, as `{ [relPath]: letter }`.
 *
 * Paths are relative to the worktree root — the caller maps them into whatever
 * space its tree speaks, because only the caller knows whether this repo is an
 * org seat or a project seat.
 *
 * @param {string} worktree absolute path to the session's worktree
 * @param {{ env?: NodeJS.ProcessEnv, base?: string }} [opts]
 * @returns {{ files: Record<string, string>, base: string, ok: boolean, reason: string|null }}
 */
export function decorate (worktree, { env = process.env, base = 'main' } = {}) {
  const files = {}
  const empty = (reason) => ({ files: {}, base, ok: false, reason })

  // A worktree whose base branch does not exist yet (a brand-new org before its
  // first commit) is not an error — there is simply nothing to compare against.
  // Returning `ok:false` lets the client render NOTHING rather than render
  // "no changes", which would be a claim we cannot support.
  const haveBase = runGit(['rev-parse', '--verify', '--quiet', base], { cwd: worktree, env, allowFail: true })
  if (haveBase === null) return empty('no-base')

  // 1. Committed: what this session put on its branch since it forked.
  const diff = runGit(['diff', '--name-status', base + '...HEAD'], { cwd: worktree, env, allowFail: true })
  if (diff === null) return empty('diff-failed')
  for (const line of diff.split('\n')) {
    if (line.trim() === '') continue
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const code = line.slice(0, tab).trim()
    // A rename reads `R100\told\tnew` — the NEW path is the one in the tree, so
    // take the last field, not the second.
    const parts = line.slice(tab + 1).split('\t')
    const path = unquote(parts[parts.length - 1])
    const letter = LETTER[code[0]]
    if (letter) files[path] = letter
  }

  // 2. Uncommitted: the last edit, before the watcher gets to it.
  //
  // Ordering matters and it is not alphabetical: this runs SECOND so it wins.
  // A file committed as modified and since deleted is deleted; the newest
  // observation is the true one.
  const status = runGit(['status', '--porcelain'], { cwd: worktree, env, allowFail: true })
  if (status === null) return empty('status-failed')
  for (const raw of status.split('\n')) {
    if (raw.trim() === '') continue
    // `runGit` trims the whole output, which eats the leading space of the FIRST
    // line and no other: ' M notes/a.md' arrives as 'M notes/a.md', and a fixed
    // slice(3) then bites a character off the path. Only ever the first file in
    // the list, so three of four cases pass and the bug reads as a fluke.
    //
    // Restore the two-character XY field by testing for the separator space at
    // index 2. 'M  path' (staged, Y blank) already has it and is left alone;
    // 'M path' (the trimmed ' M path') does not, and gets its space back. The
    // two are only distinguishable by that gap, which is why this checks the
    // separator rather than trying to classify the code.
    const line = /^..[ ]/.test(raw) ? raw : ' ' + raw
    if (line.length < 4) continue
    const x = line[0]
    const y = line[1]
    const rest = line.slice(3)
    // `R  old -> new`: again the destination is what the tree shows.
    const path = unquote(rest.includes(' -> ') ? rest.slice(rest.indexOf(' -> ') + 4) : rest)
    // Prefer the staged code, fall back to the worktree code — `??` has neither,
    // and both slots read '?' there.
    const letter = LETTER[x !== ' ' && x !== '?' ? x : y === ' ' ? x : y] ?? LETTER[x]
    if (letter) files[path] = letter
  }

  return { files, base, ok: true, reason: null }
}

/** Fold a file map up into the directories that contain it.
 *
 * VS Code marks a collapsed folder when anything inside it changed, which is the
 * whole point of a decoration: it survives collapse. Without this, closing a
 * folder hides the only signal that there is something in there to look at.
 *
 * A directory holding several kinds of change gets `M` — "something in here
 * moved" — rather than the first letter encountered, which would depend on
 * readdir order and make the same tree render differently twice.
 */
export function foldDirs (files) {
  const dirs = {}
  for (const [path, letter] of Object.entries(files)) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      dirs[dir] = dirs[dir] === void 0 || dirs[dir] === letter ? letter : 'M'
    }
  }
  return dirs
}
