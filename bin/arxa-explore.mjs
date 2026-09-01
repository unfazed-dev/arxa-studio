#!/usr/bin/env node
// arxa-explore — design exploration on Pi's session DAG (plan decision 17):
// one session file, one branch per design option, optional branch summaries.
//
//   arxa-explore --base "<brief/context prompt>" \
//     --option "glass:lean fully into liquid glass" \
//     --option "m3e:material 3 expressive baseline" \
//     [--cwd <project dir>] [--provider zai-coding] [--model glm-5.3] \
//     [--effort off|low|medium|high|max]   (default max)   [--summarize]
//
// Runs the base prompt once, then for each option navigates the DAG back to
// the base node and prompts down a fresh branch (labelled with the option
// name). Prints one JSON object with each branch's final assistant text and
// the session file path — resume it interactively with `pi --session <file>`
// and /tree to keep exploring.
//
// Home discipline: runs against arxa's Pi home (~/.arxa/pi) unless
// PI_CODING_AGENT_DIR is already set. Auth comes from models.json's shelled
// apiKey (the arxa vault) — no key ever lands here.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Must be set before the SDK is imported — resource discovery reads it.
process.env.PI_CODING_AGENT_DIR ||= join(homedir(), '.arxa', 'pi')

// ---- args --------------------------------------------------------------------
const argv = process.argv.slice(2)
// glm-5.3 + effort max on the wallet endpoint — verified working 2026-08-21
// (the earlier 1302 tier-limit conclusion was stale; the operator confirmed).
const opts = { options: [], provider: 'zai-coding', model: 'glm-5.3', effort: 'max', cwd: process.cwd() }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--base') opts.base = argv[++i]
  else if (a === '--option') opts.options.push(argv[++i])
  else if (a === '--cwd') opts.cwd = argv[++i]
  else if (a === '--provider') opts.provider = argv[++i]
  else if (a === '--model') opts.model = argv[++i]
  else if (a === '--effort') opts.effort = argv[++i]
  else if (a === '--summarize') opts.summarize = true
  else { console.error(`arxa-explore: unknown arg ${a}`); process.exit(2) }
}
if (!opts.base || opts.options.length === 0) {
  console.error('usage: arxa-explore --base "<prompt>" --option "label:prompt" [--option ...]')
  process.exit(2)
}

// ---- locate the Pi SDK -------------------------------------------------------
// arxa's own node_modules first, else the global install this machine carries.
function sdkPath () {
  const here = new URL('.', import.meta.url).pathname
  const roots = [join(here, '..', 'node_modules')]
  const g = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' }).stdout?.trim()
  if (g) roots.push(g)
  for (const root of roots) {
    const dir = join(root, '@earendil-works', 'pi-coding-agent')
    const pkg = join(dir, 'package.json')
    if (!existsSync(pkg)) continue
    // The package exports only an "import" condition, so require.resolve
    // can't see it — read the export map ourselves.
    const meta = JSON.parse(readFileSync(pkg, 'utf8'))
    const dot = meta.exports?.['.']
    const entry = (typeof dot === 'string' ? dot : dot?.import) ?? meta.main
    if (entry) return join(dir, entry)
  }
  console.error('arxa-explore: cannot find @earendil-works/pi-coding-agent (npm install here, or install pi globally)')
  process.exit(127)
}
const { createAgentSession, ModelRuntime, SessionManager } = await import(sdkPath())

// ---- run ---------------------------------------------------------------------
const modelRuntime = await ModelRuntime.create()
const model = modelRuntime.getModel(opts.provider, opts.model)
if (!model) {
  console.error(`arxa-explore: model ${opts.provider}/${opts.model} not found (check ${process.env.PI_CODING_AGENT_DIR}/models.json)`)
  process.exit(1)
}

const sm = SessionManager.create(opts.cwd)
const { session } = await createAgentSession({
  sessionManager: sm,
  modelRuntime,
  model,
  ...(opts.effort ? { thinkingLevel: opts.effort } : {}),
})

// prompt() resolves even when the model call fails (errors ride the event
// stream), so surface them — a silent failure looks like an empty branch.
session.subscribe((ev) => {
  const err = ev.errorMessage ?? ev.finalError
  if (err) console.error(`arxa-explore: ${ev.type}: ${err}`)
})

const requireAnswer = (label, text) => {
  if (text) return text
  const leaf = sm.getLeafEntry()
  console.error(`arxa-explore: branch "${label}" produced no assistant text — model call failed. Leaf entry:`)
  console.error(JSON.stringify(leaf, null, 2).slice(0, 2000))
  process.exit(1)
}

const lastAssistantText = () => {
  // root→leaf path; sdk.md calls this getPath() but the shipped build's name
  // is getBranch() (dist/core/session-manager.d.ts:261).
  const path = sm.getBranch()
  for (let i = path.length - 1; i >= 0; i--) {
    const e = path[i]
    if (e.type === 'message' && e.message?.role === 'assistant') {
      const c = e.message.content
      if (typeof c === 'string') return c
      return (c ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    }
  }
  return ''
}

console.error(`arxa-explore: base prompt on ${opts.provider}/${opts.model} …`)
await session.prompt(opts.base)
requireAnswer('base', lastAssistantText())
const baseLeaf = sm.getLeafEntry()
const branches = []

for (const raw of opts.options) {
  const sep = raw.indexOf(':')
  const label = sep > 0 ? raw.slice(0, sep) : `option-${branches.length + 1}`
  const prompt = sep > 0 ? raw.slice(sep + 1) : raw
  // Leave the previous branch (summarizing it if asked), re-root at the base
  // node, then grow this option's branch.
  const nav = await session.navigateTree(baseLeaf.id, { summarize: !!opts.summarize })
  if (nav.cancelled) { console.error(`arxa-explore: navigation to base cancelled before "${label}"`); process.exit(1) }
  console.error(`arxa-explore: branch "${label}" …`)
  await session.prompt(prompt)
  const leaf = sm.getLeafEntry()
  sm.appendLabelChange(leaf.id, label)
  branches.push({ label, prompt, leafId: leaf.id, answer: requireAnswer(label, lastAssistantText()) })
}

console.log(JSON.stringify({
  sessionFile: session.sessionFile,
  baseEntryId: baseLeaf.id,
  resume: `pi --session ${session.sessionFile}  (then /tree to switch branches)`,
  branches,
}, null, 2))
session.dispose()
