import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Spike 2026-09-03: under dsh's exact Seatbelt/bwrap profile Claude Code runs and
// answers with only the workspace + tmp writable; `--resume` additionally needs its
// transcript dir. Keychain credentials are keyed per config dir, so CLAUDE_CONFIG_DIR
// must NOT be relocated — we grant this one hidden dir instead.
export const CLAUDE_EXTRA_ROOTS = [join(homedir(), '.claude', 'projects')]

/** Build the SDK `spawnClaudeCodeProcess` hook: arxa's sandbox wraps the exact argv the SDK asked for. */
export function makeSpawner ({ confine, policy, spawn = nodeSpawn, mkdir = mkdirSync }) {
  return ({ command, args, cwd, env, signal }) => {
    // The transcript dir may not exist yet on first run. canonicalPath does not
    // partially resolve a missing leaf, so if it's absent the grant stays
    // unresolved and matches nothing once Seatbelt/bwrap resolve symlinks —
    // create it first (Claude Code creates it itself anyway) so canonicalising
    // it downstream, in the sandbox provider, fully resolves.
    for (const root of CLAUDE_EXTRA_ROOTS) mkdir(root, { recursive: true })
    const confined = confine([command, ...args], { ...policy, extraWritableRoots: CLAUDE_EXTRA_ROOTS })
    const [cmd, ...rest] = confined.argv
    return spawn(cmd, rest, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], signal })
  }
}
