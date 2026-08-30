/**
 * arxa-pi-delegate — dsh cordis plugin: Pi as a delegated subagent engine
 * (plan decision 3ii). Registers one model-callable tool, `delegate_pi`,
 * that runs a one-shot `pi -p` in the workspace and returns its stdout.
 *
 * Deliberately NOT a ctx.subagents provider: dsh-tool-subagent's contract
 * (foreground/background, continuable children, followup/interrupt) is the
 * dsh-child machinery; decision 3ii only needs "hand Pi a bounded task where
 * its strengths earn it". The spawned Pi inherits PI_CODING_AGENT_DIR from
 * bin/arxa-studio.mjs, so it runs from ~/.arxa/pi with the arxa gate extension
 * loaded — delegated work is gated exactly like a raw Pi session.
 *
 * Config: { provider?: string ('zai-coding'), model?: string ('glm-5.3-flash'),
 *           piBin?: string ('pi' from PATH), timeoutMs?: number (300000),
 *           maxBytes?: number (65536, output cap) }
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Resolve defineTool the way bin/arxa-studio.mjs resolves the dsh bin: arxa's own
// install first, else the operator install this machine already carries
// (read-only reuse). Top-level await so `apply` stays sync for cordis.
const defineTool = await (async () => {
  try { return (await import('@deepseek-ai/dsh-tools')).defineTool } catch { /* not installed here */ }
  const op = join(homedir(), '.dsh', 'profiles', 'node_modules',
    '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  if (existsSync(op)) return (await import(pathToFileURL(op).href)).defineTool
  throw new Error('arxa-pi-delegate: cannot resolve @deepseek-ai/dsh-tools')
})()

export const name = 'arxa-pi-delegate'
export const inject = ['tools']

export function apply (ctx, config = {}) {
  const provider = config.provider ?? 'zai-coding'
  // Flash is the studio default (grill decision 4); per-call args override.
  const model = config.model ?? 'glm-5.3-flash'
  const piBin = config.piBin ?? 'pi'
  const timeoutMs = config.timeoutMs ?? 300_000
  const maxBytes = config.maxBytes ?? 65_536

  ctx.tools.register(defineTool({
    name: 'delegate_pi',
    description: 'Delegate one bounded task to Pi (the lean coding agent) as a '
      + 'one-shot subagent run in this workspace. Pi reads and edits files, runs '
      + 'commands, and returns its final answer as text. Use for well-scoped '
      + 'mechanical slices; give it a self-contained prompt — it has no '
      + 'conversation context.',
    parameters: {
      task: { type: 'string', required: true, description: 'Self-contained task prompt for Pi.' },
      // Optional params OMIT `required` — the schema compiler rejects
      // `required: false` ("required must be true when present").
      cwd: { type: 'string', description: 'Working directory (default: this session’s cwd).' },
      provider: { type: 'string', description: `Pi provider id (default ${provider}).` },
      model: { type: 'string', description: `Model id (default ${model}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', required: true, description: 'Pi’s final output.' },
          exitCode: { type: 'number', required: true, description: 'Pi process exit code.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    timeoutMs,
    async execute (args, exec) {
      const { code, out, err } = await new Promise((resolve) => {
        const child = spawn(piBin,
          ['-p', '--no-session', '--provider', args.provider ?? provider,
            '--model', args.model ?? model, args.task],
          {
            cwd: args.cwd ?? process.cwd(),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            signal: exec.signal,
            timeout: timeoutMs,
          })
        let out = ''
        let err = ''
        child.stdout.on('data', (d) => { out += d })
        child.stderr.on('data', (d) => { err += d })
        child.on('close', (code) => resolve({ code, out, err }))
        child.on('error', (e) => resolve({ code: -1, out, err: String(e) }))
      })
      const text = (out.trim() || err.trim()).slice(0, maxBytes)
      if (code !== 0) {
        return { text: `Pi run failed (exit ${code}).\n${text}`, exitCode: code ?? -1 }
      }
      return { text: text || '(Pi returned no output)', exitCode: 0 }
    },
  }))
}
