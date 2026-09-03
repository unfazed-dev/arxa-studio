import { spawn as nodeSpawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Spike 2026-09-03: under dsh's exact Seatbelt/bwrap profile Claude Code runs and
// answers with only the workspace + tmp writable; `--resume` additionally needs its
// transcript dir. Keychain credentials are keyed per config dir, so CLAUDE_CONFIG_DIR
// must NOT be relocated — we grant this one hidden dir instead.
export const CLAUDE_EXTRA_ROOTS = [join(homedir(), '.claude', 'projects')]

/** Build the SDK `spawnClaudeCodeProcess` hook: arxa's sandbox wraps the exact argv the SDK asked for. */
export function makeSpawner ({ confine, policy, spawn = nodeSpawn }) {
  return ({ command, args, cwd, env, signal }) => {
    const confined = confine([command, ...args], { ...policy, extraWritableRoots: CLAUDE_EXTRA_ROOTS })
    const [cmd, ...rest] = confined.argv
    return spawn(cmd, rest, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], signal })
  }
}
