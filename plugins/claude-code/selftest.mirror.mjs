import { strict as assert } from 'node:assert'
import { MIRROR_TOOL_NAMES, mirrorToolDefinitions } from './lib/mirror-tools.js'
import { PendingResults } from './lib/pending.js'

let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const defineTool = (d) => d // identity: we only assert the shape defineTool receives
const pending = new PendingResults()
const defs = mirrorToolDefinitions(defineTool, pending)
assert.deepEqual(defs.map((d) => d.name), MIRROR_TOOL_NAMES)
ok('mirrorToolDefinitions produces one def per MIRROR_TOOL_NAMES entry, in order')
for (const n of ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'Skill', 'WebFetch', 'WebSearch', 'TodoWrite']) assert.ok(MIRROR_TOOL_NAMES.includes(n), n)
ok('the well-known Claude Code tool names are present')
const read = defs.find((d) => d.name === 'Read')
assert.equal(read.parameters.file_path.type, 'string')
ok('Read carries a named file_path parameter')
assert.deepEqual(read.output.render({}, { text: 'hello' }), [{ type: 'text', text: 'hello' }])
ok('output.render formats the relayed text as a text block')

const r = read.execute({ file_path: 'a' }, { callId: 'tu_1', signal: new AbortController().signal })
pending.resolve('tu_1', { text: 'file body', isError: false })
assert.deepEqual(await r, { text: 'file body' })
ok('execute() relays a success outcome keyed by exec.callId')

const e = read.execute({}, { callId: 'tu_2', signal: new AbortController().signal })
pending.resolve('tu_2', { text: 'ENOENT', isError: true })
await assert.rejects(e, /ENOENT/)
ok('execute() throws when the relayed outcome is an error')

console.log(`# ${passed} ok`)
