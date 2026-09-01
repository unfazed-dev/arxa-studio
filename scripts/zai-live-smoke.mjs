// Live authenticated smoke for the zai / glm-5.3-flash route through
// pi-ai 0.84.4 — the one acceptance item the grill sandbox could not run
// (no credential resolution there). Run from a shell where the Z.ai key
// resolves:  ZAI_API_KEY=... node scripts/zai-live-smoke.mjs
// The key is read from the environment and never printed.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { stream } = await import(fileURLToPath(new URL('../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js', import.meta.url)))
const catalog = require(fileURLToPath(new URL('../node_modules/@earendil-works/pi-ai/dist/providers/data/zai.json', import.meta.url)))

const apiKey = process.env.ZAI_API_KEY
if (!apiKey) {
  console.error('ZAI_API_KEY is not set. Resolve the credential first, e.g.:')
  console.error('  ZAI_API_KEY=$(arxa credentials exec ZAI_API_KEY -- printenv ZAI_API_KEY)   # needs ZAI_API_KEY in env/vault node scripts/zai-live-smoke.mjs')
  process.exit(2)
}

const catalogModel = catalog['openai-completions']['glm-5.3-flash']
// Spread the catalog entry exactly as dsh materialization does — cost fields
// included, or pi-ai's cost finalizer crashes on model.cost.tiers.
const model = {
  ...catalogModel,
  baseUrl: 'https://api.z.ai/api/paas/v4',
  reasoning: true,
  thinkingLevelMap: { minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' },
}
const context = {
  systemPrompt: 'You are arxa, the agentic app studio harness by Totem Labs.',
  messages: [{ role: 'user', content: 'Call the demo_tool with x="1". Then say done.', timestamp: Date.now() }],
  tools: [{
    name: 'demo_tool',
    description: 'Demo tool for the smoke test.',
    parameters: { type: 'object', properties: { x: { type: 'string' } } },
    execute: async () => 'ok',
  }],
}
const options = { apiKey, maxTokens: 4096, sessionId: 'zai-live-smoke', reasoningEffort: 'max' }

let text = '', toolCalls = [], stopReason, usage, doneEvent = null
const seenTypes = new Set()
for await (const ev of stream(model, context, options)) {
  seenTypes.add(ev.type)
  if (ev.type === 'text' && ev.delta) text += ev.delta
  const cand = ev.delta ?? ev.toolCall ?? null
  if (cand && (cand.name || cand.id) && (cand.name?.includes('tool') || cand.name === 'demo_tool')) toolCalls.push(cand.name + ' ' + JSON.stringify(cand.arguments ?? ''))
  if (ev.type === 'done') { doneEvent = ev; stopReason = ev.reason ?? ev.stopReason; usage = ev.usage }
  if (ev.type === 'error') {
    console.error('STREAM ERROR: ' + JSON.stringify({ errorMessage: ev.error?.errorMessage, stopReason: ev.error?.stopReason }))
    process.exit(1)
  }
}
console.log('event types seen:', [...seenTypes].join(', '))
const msg = doneEvent?.message ?? doneEvent?.assistantMessage
const msgToolCalls = (msg?.content ?? []).filter(c => c.type === 'toolCall').map(c => c.name + ' ' + JSON.stringify(c.arguments))
if (msgToolCalls.length) toolCalls = msgToolCalls
else if (!toolCalls.length && msg) toolCalls = ['(message content types: ' + (msg.content ?? []).map(c => c.type).join(', ') + ')']
console.log('stopReason:', stopReason)
console.log('toolCalls:', toolCalls.length ? toolCalls.map(t => t.name ?? t.id).join(', ') : '(none)')
console.log('text tail:', JSON.stringify(text.slice(-80)))
console.log('usage:', usage ? `in ${usage.input} / out ${usage.output} tokens` : '(not reported)')
const ok = toolCalls.length > 0
console.log(ok ? 'SMOKE PASS: streamed tool call arrived on glm-5.3-flash' : 'SMOKE INCONCLUSIVE: no tool call — check text tail above')
process.exit(ok ? 0 : 1)
