// Task9: execute the production save closure with a delayed token response.
// Navigation must not cancel file A's frozen autosave or let its completion
// mutate the newly opened file B.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const client = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
const start = client.indexOf('const save = async (force = false) =>')
const end = client.indexOf('/** Auto-save:', start)
assert.ok(start >= 0 && end > start, 'production save function is extractable')
const saveSource = client.slice(start, end)

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const buildSave = new AsyncFunction(
  'session', 'state', 'docRef', 'saveTimer', 'openRequestRef', 'mtimeRef',
  'setSavePhase', 'setSaveNote', 'fetchToken', 'fetch', 'WRITE_ROUTE',
  'setDirty', 't',
  saveSource + '\nreturn save',
)

let releaseToken
const delayedToken = new Promise(resolve => { releaseToken = resolve })
const tokenCalls = []
const posts = []
const phases = []
const notes = []
const dirtyWrites = []
const openRequestRef = { current: 41 }
const mtimeRef = { current: 123.5 }
const docRef = { current: { getText: () => 'file A bytes' } }
const save = await buildSave(
  null,
  { rootId: 'root-a', relPath: 'notes/a.md', rootName: 'Root A' },
  docRef,
  { current: null },
  openRequestRef,
  mtimeRef,
  value => phases.push(value),
  value => notes.push(value),
  async (...args) => { tokenCalls.push(args); return delayedToken },
  async (url, options) => {
    posts.push({ url, options, body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => ({ committed: true, mtimeMs: 999 }) }
  },
  '/__arxa/artifacts/write',
  value => dirtyWrites.push(value),
  key => key,
)

const pending = save()
assert.deepEqual(tokenCalls, [[null, null, 'root-a']], 'file A token request started')
assert.deepEqual(phases, ['saving'])
assert.deepEqual(notes, [''])

// Open B while A's token is still pending. React keeps this save closure's A
// state, while the refs move immediately to the new editor generation/model.
openRequestRef.current = 42
docRef.current = { getText: () => 'file B bytes' }
const uiCheckpoint = { phases: [...phases], notes: [...notes] }
releaseToken({ token: 'write-a' })
await pending

assert.equal(posts.length, 1, 'navigation does not cancel the frozen A write')
assert.deepEqual(posts[0].body, {
  rootId: 'root-a',
  relPath: 'notes/a.md',
  content: 'file A bytes',
  expectedMtimeMs: 123.5,
})
assert.equal(posts[0].options.headers['x-arxa-write-token'], 'write-a')
assert.deepEqual(phases, uiCheckpoint.phases, 'A completion does not change B save phase')
assert.deepEqual(notes, uiCheckpoint.notes, 'A completion does not change B save note')
assert.deepEqual(dirtyWrites, [], 'A completion does not mark B clean')
assert.equal(mtimeRef.current, 123.5, 'A completion does not install its mtime into B')
console.log('GREEN artifact-viewer delayed-token save race')
