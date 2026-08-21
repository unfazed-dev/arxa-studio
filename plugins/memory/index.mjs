/**
 * arxa-memory — dsh cordis plugin: inject project memory at session start.
 *
 * The engine owns memory; this is one of its hands (G.17): a thin adapter
 * that shells `appbox memory recall --project <dir>` once at mount and
 * registers the result as a system-prompt section. No parsing, no store
 * access, no write path — writes are pipeline output through the engine
 * verbs, never a harness behavior.
 *
 * Config: { project?: string  (default process.cwd() — the patch layer can
 *           pass `!!js process.cwd()`), appbox?: string (binary path),
 *           maxBytes?: number (cap on injected text, default 4096) }
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'arxa-memory'
export const inject = ['systemPrompt']

export function apply(ctx, config = {}) {
  const project = config.project || process.cwd()
  const appbox = config.appbox || join(homedir(), '.local', 'bin', 'appbox')
  const maxBytes = config.maxBytes ?? 4096

  const r = spawnSync(appbox, ['memory', 'recall', '--project', project], {
    encoding: 'utf8', timeout: 10_000,
  })
  // A missing binary, an error, or an empty store all mean the same thing
  // here: nothing to inject. Memory is an enhancement, never a boot gate.
  if (r.error || r.status !== 0) return
  const out = (r.stdout ?? '').trim()
  if (!out || out.startsWith('no matching facts') || out.startsWith('no topic')) return

  ctx.systemPrompt.section({
    name: 'arxa:memory',
    order: 10,
    text: 'Project memory (appbox memory recall — cite ids, `appbox memory why '
      + '<topic> <i>` for provenance):\n'
      + out.slice(0, maxBytes),
  })
}
