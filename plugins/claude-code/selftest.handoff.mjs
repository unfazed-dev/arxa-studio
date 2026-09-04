import { strict as assert } from 'node:assert'
import { renderHandoff } from './lib/handoff.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const msgs = [
  { role: 'user', content: [{ type: 'text', text: 'Build me a thing' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Sure.' }, { type: 'tool-call', id: 'c1', name: 'write', arguments: '{"path":"a"}' }] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }] },
  { role: 'user', content: [{ type: 'text', text: 'Now test it' }] },
]
const text = renderHandoff(msgs.slice(0, -1))
assert.match(text, /^Conversation so far in this arxa session \(another model handled it\):/); ok('rendered transcript is labelled as another model’s work')
assert.match(text, /User: Build me a thing/); assert.match(text, /Assistant: Sure\./); ok('user and assistant text carry their role')
assert.match(text, /\[tool write\({"path":"a"}\) → ok\]/); ok('a tool call and its result render on one line')
assert.equal(renderHandoff([]), ''); ok('an empty conversation renders nothing')
const big = renderHandoff([{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(100_000) }] }])
assert.ok(big.length <= 40_200 && big.includes('…(earlier turns trimmed)')); ok('an oversized transcript is trimmed oldest-first')
assert.ok(big.length <= 40_000); ok('the cap holds on the rendered string, header and marker included')
assert.ok(big.endsWith('x'.repeat(100)), 'the newest text survives the trim'); ok('trimming keeps the tail, which is what the next model needs')

// out-of-order parallel results still pair with their own call
const parallel = renderHandoff([
  { role: 'assistant', content: [{ type: 'tool-call', id: 'a', name: 'read', arguments: '{}' }, { type: 'tool-call', id: 'b', name: 'grep', arguments: '{}' }] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'b', content: [{ type: 'text', text: 'hit' }] }] },
  { role: 'user', content: [{ type: 'tool-result', toolCallId: 'a', content: [{ type: 'text', text: 'file' }] }] },
])
assert.match(parallel, /\[tool read\({}\) → file\]/); assert.match(parallel, /\[tool grep\({}\) → hit\]/); ok('results pair by call id, not by arrival order')
// a call whose result never came back still renders as a closed line
const dangling = renderHandoff([{ role: 'assistant', content: [{ type: 'tool-call', id: 'z', name: 'bash', arguments: '{}' }] }])
assert.equal(dangling.split('\n').at(-1), '[tool bash({})]'); ok('a call with no result is closed rather than left dangling')

console.log(`# ${passed} ok`)
