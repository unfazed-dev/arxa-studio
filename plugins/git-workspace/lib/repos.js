// Repo boundaries (D37): the org root is one git repo (notes, meetings,
// communications, org context); each projects/<name> is its own repo,
// nested inside and IGNORED by the org repo; account/ is excluded from
// version control entirely (billing mirrors + secrets never enter git
// history). The ignore rules live in a committed .gitignore so they
// travel with the org repo when it is cloned/shared per D17.

import fs from 'node:fs'
import path from 'node:path'
import { runGit } from './run.js'

// Committed at the org root. The "/projects/" star pattern keeps every
// nested project repo (and any stray folder under projects/) out of the
// org repo — without it, git would record nested repos as gitlink
// entries and `git add -A` would embed them in org history. "/account/"
// implements the D37 exclusion of billing mirrors and secrets.
export const ORG_GITIGNORE = `# arxa studio (D37): nested project repos are their own repos — the org
# repo never tracks anything under projects/.
/projects/*/
# account/ is excluded from version control entirely (D37): billing
# mirrors and secrets never enter git history.
/account/
`

/** True when `dir` is itself the top level of a git repo. */
export function isRepo(dir, env = process.env) {
  if (!fs.existsSync(path.join(dir, '.git'))) return false
  const top = runGit(['rev-parse', '--show-toplevel'], { cwd: dir, env, allowFail: true })
  if (top === null) return false
  // realpath both sides: macOS tmp dirs are symlinks (/var → /private/var)
  // and git reports the resolved path.
  return fs.realpathSync(top) === fs.realpathSync(dir)
}

function initRepo(dir, env) {
  runGit(['init'], { cwd: dir, env })
}

/**
 * Turn a scaffolded org folder (plugins/workspace scaffoldOrg output)
 * into the org repo: git init, D37 ignore rules, and an initial stage
 * commit — so a stage-boundary squash base always exists from day one.
 * Idempotent: re-running on an existing org repo is a no-op.
 *
 * @returns {{ path: string, initialised: boolean }}
 */
export function initOrgRepo(orgPath, env = process.env) {
  if (isRepo(orgPath, env)) return { path: orgPath, initialised: false }
  initRepo(orgPath, env)
  fs.writeFileSync(path.join(orgPath, '.gitignore'), ORG_GITIGNORE)
  runGit(['add', '-A'], { cwd: orgPath, env })
  runGit(['commit', '-m', 'stage: scaffold organisation'], { cwd: orgPath, env })
  runGit(['update-ref', 'refs/arxa/stage-base', 'HEAD'], { cwd: orgPath, env })
  return { path: orgPath, initialised: true }
}

/**
 * Turn a scaffolded project folder (scaffoldProject output) into its own
 * repo, nested inside and ignored by the org repo (D37). Initial stage
 * commit covers project.json + AGENTS.md. Idempotent.
 *
 * @returns {{ path: string, initialised: boolean }}
 */
export function initProjectRepo(projectPath, env = process.env) {
  if (isRepo(projectPath, env)) return { path: projectPath, initialised: false }
  initRepo(projectPath, env)
  runGit(['add', '-A'], { cwd: projectPath, env })
  runGit(['commit', '-m', 'stage: scaffold project'], { cwd: projectPath, env })
  runGit(['update-ref', 'refs/arxa/stage-base', 'HEAD'], { cwd: projectPath, env })
  return { path: projectPath, initialised: true }
}
