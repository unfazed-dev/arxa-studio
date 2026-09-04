// AGENT-plane plugin: registers the mirror tools (Task 5) into this session's tool registry.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mirrorToolDefinitions } from './lib/mirror-tools.js'
import { fromClaude } from './lib/pending.js'

// Same resolution dance as plugins/pi-delegate/index.mjs:26-31.
const defineTool = await (async () => {
  try { return (await import('@deepseek-ai/dsh-tools')).defineTool } catch { /* not installed here */ }
  const op = join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')
  if (existsSync(op)) return (await import(pathToFileURL(op).href)).defineTool
  throw new Error('arxa-claude-code-tools: cannot resolve @deepseek-ai/dsh-tools')
})()

export const name = 'arxa-claude-code-tools'
export const inject = ['tools']

export function apply (ctx) {
  for (const def of mirrorToolDefinitions(defineTool, fromClaude)) ctx.tools.register(def)
}
