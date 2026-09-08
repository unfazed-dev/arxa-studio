#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
const snippetPath = join(here, 'lib', 'freestyle-region.snippet.txt')

assert.equal((client.match(/__ARXA_FREESTYLE_REGION__/g) || []).length, 1, 'generated bundle contains one Freestyle region')
assert.match(client, /function SidebarTabs\(\{ wide, active, onChange \}\)/, 'tab strip is generated')
assert.match(client, /function FreestyleBrowser\(\{ wide, expandSidebar \}\)/, 'Freestyle shell is generated')
assert.equal((client.match(/ctx\.slots\.register\(\{\s*name: "sidebar\.workspaces"/g) || []).length, 1, 'stock sidebar.workspaces registration stays singular')
assert.match(client, /fetch\("\/__arxa\/freestyle\/action", \{[\s\S]*?action: "session\.new", arg: \{ rootId: sel\.rootId, relDir: sel\.relDir \}/, 'shell CTA posts the selected Freestyle folder')
assert.match(client, /fetch\("\/__arxa\/sidebar\/pick-folder", \{ method: "POST", headers: \{ "content-type": "application\/json" \}, body: JSON\.stringify\(\{ title \}\) \}\)/, 'add menu uses the existing native picker contract')
for (const key of ['freestyle.tab.org', 'freestyle.tab.freestyle', 'freestyle.empty', 'freestyle.add.open', 'freestyle.add.new', 'freestyle.cta.pick', 'welcome.freestyle']) {
  assert.equal(client.split(`"${key}":`).length - 1, 3, `${key} is translated in en/pl/fr`)
}

const originalWrite = process.stdout.write
let spliceFreestyleBrowser
try {
  process.stdout.write = () => true
  ;({ spliceFreestyleBrowser } = await import('../../scripts/gen-workspace.mjs?selftest-freestyle'))
} finally {
  process.stdout.write = originalWrite
}
assert.equal(typeof spliceFreestyleBrowser, 'function', 'generator exposes its guarded tab splice')
assert.throws(() => spliceFreestyleBrowser('anchor deliberately absent'), /OrgBrowser render anchor missing/, 'missing tab anchor fails loudly')

const snippet = readFileSync(snippetPath, 'utf8')
const requests = []
let activeTab = 'org'
const fetch = async (url, options = {}) => {
  requests.push({ url, options })
  if (url === '/__arxa/freestyle/state') return { json: async () => ({ roots: [{ id: 'root-1', hasHead: true }], trash: [], ui: { activeTab } }) }
  const body = JSON.parse(options.body)
  if (body.action === 'ui.tab') activeTab = body.arg.tab
  if (body.action === 'fail') return { json: async () => ({ ok: false, error: 'visible failure' }) }
  return { json: async () => ({ ok: true }) }
}
const context = { fetch, Set, JSON, Error }
context.globalThis = context
vm.runInNewContext(`(function () {\n${snippet}\nglobalThis.createFreestyleStore = createFreestyleStore;\nglobalThis.freestyleSelectedWorkspace = freestyleSelectedWorkspace;\nglobalThis.showWelcomeGate = showWelcomeGate;\n})()`, context, { filename: snippetPath })

const store = context.createFreestyleStore()
let emissions = 0
const dispose = store.subscribe(() => { emissions++ })
await store.refresh()
assert.equal(store.get().roots[0].id, 'root-1', 'refresh installs server roots')
assert.equal(context.freestyleSelectedWorkspace(store), null, 'organisation tab does not expose a Freestyle selection')

store.select('root-1', 'notes')
assert.deepEqual({ ...store.selected() }, { rootId: 'root-1', relDir: 'notes' }, 'selection retains root and relative directory')
await store.setTab('freestyle')
assert.deepEqual({ ...context.freestyleSelectedWorkspace(store) }, { kind: 'freestyle', rootId: 'root-1', relDir: 'notes' }, 'Freestyle tab exposes the selected folder to the shell CTA')
assert.deepEqual(JSON.parse(requests.find((r) => r.url === '/__arxa/freestyle/action').options.body), { action: 'ui.tab', arg: { tab: 'freestyle' } }, 'setTab posts the action contract')
assert.equal(requests.at(-1).url, '/__arxa/freestyle/state', 'every mutation refreshes state')

await assert.rejects(store.mutate('fail', {}), /visible failure/, 'failed mutations surface the host error after refresh')
assert.equal(requests.at(-1).url, '/__arxa/freestyle/state', 'failed mutations also refresh state')
dispose()
const beforeDisposedSelect = emissions
store.select('root-1', '')
assert.equal(emissions, beforeDisposedSelect, 'subscription disposer removes the listener')

assert.equal(context.showWelcomeGate(0, 'org'), true, 'zero-organisation organisation view keeps the welcome gate')
assert.equal(context.showWelcomeGate(0, 'freestyle'), false, 'zero-organisation Freestyle view remains reachable')
assert.equal(context.showWelcomeGate(1, 'org'), false, 'an organisation lifts the welcome gate')

console.log('arxa-sidebar selftest.freestyle: ALL GREEN')
