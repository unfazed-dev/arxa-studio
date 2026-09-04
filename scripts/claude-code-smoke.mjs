#!/usr/bin/env node
// LIVE smoke for the claude-code adapter — real `claude`, real subscription, real sandbox.
// HAND-RUN ONLY (`node scripts/claude-code-smoke.mjs --yes`); never joins scripts/ci.mjs.
//
// Part A asserts what earlier tasks already believe offline, against a real binary:
// (1) apiKeySource none; (2) text reply; (3) a Read tool round mirrors into
// tool-call/tool-result shape; (4) a write outside the workspace is denied by the sandbox.
//
// Part B (Task 12) answers four questions only a live binary can settle:
// Q1 the real tool list vs MIRROR_TOOL_NAMES; Q2 whether `tools` also gates MCP names
// (exercises mcp__arxa__gen_ui); Q3 that the never-yielding-prompt + abort.abort() probe
// pattern returns bounded; Q4 that a superseded turn's child is genuinely killed, checked
// against a real OS process (not just the code path that calls endTurn).
//
// Fixes applied vs the task brief's sample: ArxaSandboxProvider takes a cordis Context plus
// config (two args) — plugins/sandbox/selftest.mjs is the real constructor, the brief's
// one-arg form does not exist. And the account probe below never prints subscriptionType —
// only the model list and tool names are meant to be visible from this script.
//
// Security: never print/log an OAuth token, the account email, `~/.claude` content, raw env,
// or the subscription tier. Never commit captured output from a run of this script.
import { strict as assert } from 'node:assert'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn as nodeSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { query, startup } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAdapter } from '../plugins/claude-code/lib/adapter.js'
import { Probe, resolveClaudeBinary } from '../plugins/claude-code/lib/probe.js'
import { scrubEnv } from '../plugins/claude-code/lib/env.js'
import { makeSpawner } from '../plugins/claude-code/lib/spawn.js'
import { fromClaude } from '../plugins/claude-code/lib/pending.js'
import { MIRROR_TOOL_NAMES } from '../plugins/claude-code/lib/mirror-tools.js'

if (!process.argv.includes('--yes')) { console.log('live smoke: pass --yes to run against your real Claude subscription'); process.exit(0) }

const require = createRequire(import.meta.url)
// The SDK's exports map has no './package.json' subpath (0.3.259), so resolving that
// path throws ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the package entry and take its dir.
const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'))
const ws = mkdtempSync(join(tmpdir(), 'arxa-cc-smoke-'))
writeFileSync(join(ws, 'note.txt'), 'PEACH')
const escape = join(homedir(), 'arxa-cc-smoke-escape.txt'); rmSync(escape, { force: true })

// Real sandbox provider — plugins/sandbox/selftest.mjs's construction, not the brief's one-arg
// version: ArxaSandboxProvider extends LocalSandboxProvider and takes a cordis Context first.
const { default: ArxaSandboxProvider } = await import('../plugins/sandbox/lib/index.js')
const sandbox = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })

const events = []
const agent = { id: 'smoke', session: { header: { cwd: ws }, events, append: (type, data) => { events.push({ type, data }); return { seq: events.length - 1 } } }, ctx: { tools: { schemas: () => [] } } }
const ctx = {
  agents: { currentInitiator: () => agent },
  sandbox,
  sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: ws, sessionId: 'smoke' }) },
  approval: { request: async () => 'allowed-once' },
}
const env = scrubEnv(process.env, { version: 'smoke' })
const binary = resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
// Q4 needs the real child process behind each turn. This wrapper is a pass-through to Node's
// own spawn — it changes nothing about what runs, it just keeps a handle so we can check later
// whether endTurn() actually killed it. `spawn`/`mkdir` are adapter constructor seams that
// production leaves undefined (see adapter.js); a hand-run verification script is exactly the
// case they exist for.
const spawnedChildren = []
const trackingSpawn = (cmd, args, opts) => { const child = nodeSpawn(cmd, args, opts); spawnedChildren.push(child); return child }
process.on('exit', () => { for (const c of spawnedChildren) if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL') } catch { /* already gone */ } } })

// The probe child is confined exactly like a turn child: probe.js requires a spawner so that
// no claude process can ever start outside arxa's sandbox (commit fa9becc).
const probePolicy = ctx.sandboxPolicy.resolve({ session: agent.session })
const probe = new Probe({
  startup,
  binary,
  env,
  spawnClaudeCodeProcess: makeSpawner({
    confine: (argv, p) => sandbox.confine(argv, p),
    policy: probePolicy,
    spawn: trackingSpawn,
  }),
})


const a = new ClaudeCodeAdapter({ query, probe, ctx, binary, env, version: 'smoke', spawn: trackingSpawn })
const collect = async (gen) => { const out = []; for await (const c of gen) out.push(c); return out }
const base = { provider: 'claude-code', model: 'sonnet', system: 'You are arxa. Be terse.', tools: [] }

// ---------------------------------------------------------------------------------------------
// Part A — the four assertions the brief specifies.
// ---------------------------------------------------------------------------------------------
const acct = await probe.current(); assert.equal(acct.loggedIn, true, acct.error)
console.log('probe ok: version=' + acct.version + ' subscriptionType=[redacted]')

const t1 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly the word OK.' }] }] }))
assert.match(t1.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /OK/); console.log('text turn ok')

const t2 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Use the Read tool on note.txt in the current directory and reply with its content only.' }] }] }))
const call = t2.find((c) => c.type === 'block-end' && c.block.type === 'tool-call')
assert.ok(call, 'expected a Read tool-call block'); assert.equal(call.block.name, 'Read')
assert.deepEqual(t2.at(-1).reason, { kind: 'tool-calls' })
const mirrored = await fromClaude.expect(call.block.id)
assert.match(mirrored.text, /PEACH/); console.log('mirror result ok')
const t2b = await collect(a.stream({ ...base, messages: [
  { role: 'user', content: [{ type: 'text', text: 'x' }] },
  { role: 'assistant', content: [call.block] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: call.block.id, content: [{ type: 'text', text: mirrored.text }] }] }] }))
assert.match(t2b.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /PEACH/); console.log('tool round ok')

const t3 = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: `Use the Bash tool to run: touch ${escape} ; then report the exit status only.` }] }] }))
for (const c of t3.filter((c) => c.type === 'block-end' && c.block.type === 'tool-call')) await fromClaude.expect(c.block.id).catch(() => {})
assert.equal(existsSync(escape), false, 'SANDBOX ESCAPE: file written outside the workspace'); console.log('sandbox confinement ok')
console.log('claude-code live smoke, part A: all green')

// ---------------------------------------------------------------------------------------------
// Part B (Task 12) — the four open questions.
// ---------------------------------------------------------------------------------------------

// Q1: the real tool list the live binary exposes, unrestricted, vs MIRROR_TOOL_NAMES.
const neverPrompt = { [Symbol.asyncIterator] () { return { next: () => new Promise(() => {}) } } }
const q1Abort = new AbortController()
const q1 = query({
  prompt: neverPrompt,
  options: {
    pathToClaudeCodeExecutable: binary, env, settingSources: [], persistSession: false,
    maxTurns: 0, abortController: q1Abort, cwd: ws,
    tools: { type: 'preset', preset: 'claude_code' }, // the CLI's own default set, not arxa's allowlist
    systemPrompt: { type: 'custom', prompt: 'smoke' }, permissionMode: 'default',
  },
})
const q1Timer = setTimeout(() => q1Abort.abort(), 15_000)
let liveTools = []
try {
  const { value: init } = await q1[Symbol.asyncIterator]().next()
  assert.ok(init && init.type === 'system' && init.subtype === 'init', 'Q1: expected an init message')
  liveTools = init.tools ?? []
} finally { clearTimeout(q1Timer); q1.close?.() }
const gap = liveTools.filter((t) => !MIRROR_TOOL_NAMES.includes(t))
console.log(`Q1 live tool list (${liveTools.length}): ${liveTools.join(', ')}`)
console.log(`Q1 MIRROR_TOOL_NAMES (${MIRROR_TOOL_NAMES.length}): ${MIRROR_TOOL_NAMES.join(', ')}`)
console.log(gap.length ? `Q1 capability gap — live built-ins NOT in MIRROR_TOOL_NAMES: ${gap.join(', ')}` : 'Q1 capability gap: none — MIRROR_TOOL_NAMES covers every live built-in')

// Q2: does `tools` also gate MCP names? Fake a gen_ui schema so arxaMcpToolNames() adds
// mcp__arxa__gen_ui to the live allowlist, then make Claude actually call it end to end.
agent.ctx.tools.schemas = () => [{ name: 'gen_ui', description: 'Render a UI card for the user', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }]
const q2a = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: "Use the gen_ui tool with title 'Smoke Test' to render a card, then reply with exactly the word RENDERED." }] }] }))
const q2aCalls = q2a.filter((c) => c.type === 'block-end' && c.block.type === 'tool-call').map((c) => c.block.name)
const genCall = q2a.find((c) => c.type === 'block-end' && c.block.type === 'tool-call' && c.block.name === 'gen_ui')
assert.ok(genCall, `Q2: expected a gen_ui tool-call block — model made these tool calls instead: [${q2aCalls.join(', ') || 'none'}] (empty means the tool was unreachable, non-empty means the model chose not to call it)`)
const q2b = await collect(a.stream({ ...base, messages: [
  { role: 'user', content: [{ type: 'text', text: 'x' }] },
  { role: 'assistant', content: [genCall.block] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: genCall.block.id, content: [{ type: 'text', text: 'card rendered' }] }] }] }))
assert.match(q2b.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /RENDERED/i, 'Q2: gen_ui result did not make it back into the turn')
console.log('Q2: mcp__arxa__gen_ui reachable through the live `tools` allowlist — the arxa MCP tool worked end to end')
agent.ctx.tools.schemas = () => [] // back to the Part A / Q4 baseline

// Q3: the never-yielding-prompt + abort.abort() pattern (Task 3's Probe) returns bounded
// against the real SDK — a tiny timeout must not hang.
const tightProbe = new Probe({ query, binary, env, timeoutMs: 50 })
const q3Started = Date.now()
const q3Result = await tightProbe.current(true)
const q3Elapsed = Date.now() - q3Started
assert.ok(q3Elapsed < 10_000, `Q3: probe did not return bounded — took ${q3Elapsed}ms`)
console.log(`Q3: probe with a 50ms timeout returned in ${q3Elapsed}ms (bounded, did not hang); loggedIn=${q3Result.loggedIn}`)

// Q4: a superseded turn's child is genuinely stopped — checked against the real OS process
// captured via trackingSpawn, not just trusted from reading endTurn(). endTurn() is the one
// function both the supersede path and the error path call to tear a turn down, so proving it
// here covers both call sites.
const beforeQ4 = spawnedChildren.length
const q4aChunks = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Use the Read tool on note.txt, then wait for further instructions before replying.' }] }] }))
assert.ok(spawnedChildren.length > beforeQ4, 'Q4: expected the first turn to spawn a child')
// Pick the first child from this turn that is STILL ALIVE right now, and assert that alive-ness
// before triggering the supersede below. A short-lived helper the SDK spawns and exits on its
// own would otherwise let this whole check pass without endTurn() having killed anything.
const supersededChild = spawnedChildren.slice(beforeQ4).find((c) => c.exitCode === null && c.signalCode === null)
assert.ok(supersededChild, 'Q4: every child spawned by the first turn had already exited on its own — nothing live to prove endTurn() kills')
assert.ok(q4aChunks.some((c) => c.type === 'block-end' && c.block.type === 'tool-call'), 'Q4: expected a tool-call block so the turn stays parked for the supersede')

const q4b = await collect(a.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'Never mind that. Reply with exactly the word CANCELLED.' }] }] }))
assert.match(q4b.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /CANCELLED/i)

const q4Deadline = Date.now() + 10_000
while (Date.now() < q4Deadline && supersededChild.exitCode === null && supersededChild.signalCode === null) {
  await new Promise((r) => setTimeout(r, 100))
}
const reallyStopped = supersededChild.exitCode !== null || supersededChild.signalCode !== null
console.log(`Q4: superseded turn's child (pid ${supersededChild.pid}) — ${reallyStopped ? `exited (code=${supersededChild.exitCode}, signal=${supersededChild.signalCode})` : 'STILL RUNNING after 10s'}`)
assert.ok(reallyStopped, 'Q4: the superseded turn left its child process running — endTurn did not actually stop it')

console.log('claude-code live smoke: all green')
