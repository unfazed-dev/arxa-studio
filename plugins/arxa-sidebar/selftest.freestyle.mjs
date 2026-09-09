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
assert.match(client, /function FreestyleRootRow\(/, 'Freestyle roots render as real rows')
assert.match(client, /function FreestyleTrashRows\(\{ trash, roots, ask \}\)/, 'Freestyle trash is an independent disclosure surface')
assert.match(client, /function FreestyleArchivesRows\(\{ roots, ask \}\)/, 'Freestyle archives are an independent disclosure surface')
assert.match(client, /function FreestyleSessionRows\(\{ root \}\)/, 'active Freestyle sessions render beneath their root')
assert.equal((client.match(/ctx\.slots\.register\(\{\s*name: "sidebar\.workspaces"/g) || []).length, 1, 'stock sidebar.workspaces registration stays singular')
assert.match(client, /fetch\("\/__arxa\/freestyle\/action", \{[\s\S]*?action: "session\.new", arg: \{ rootId: sel\.rootId, relDir: sel\.relDir \}/, 'shell CTA posts the selected Freestyle folder')
assert.match(client, /if \(typeof w\.refreshFreestyle === "function"\) w\.refreshFreestyle\(\)/, 'successful CTA creation refreshes the shared Freestyle store')
assert.match(client, /b && b\.result && b\.result\.reason/, 'CTA failures preserve a structured result reason')
assert.match(client, /fetch\("\/__arxa\/sidebar\/pick-folder", \{ method: "POST", headers: \{ "content-type": "application\/json" \}, body: JSON\.stringify\(\{ title \}\) \}\)/, 'add menu uses the existing native picker contract')
assert.match(client, /function ArxaDirRows\(\{ dir, depth, mode, hideDirs, rootId, verbs, onSelect, selected \}\)/, 'shared lazy tree accepts Freestyle authority and actions')
assert.match(client, /freestyleStore\.mutate\("root\.publish", \{ rootId, visibility: "private" \}\)/, 'root menu publishes privately through the Freestyle action')
assert.match(client, /freestyleStore\.mutate\("entry\.move", \{ rootId, relPath, toDir \}\)/, 'same-root drops use the entry.move action')
assert.match(client, /freestyleStore\.mutate\("archive\.revive"/, 'archives can be revived')
assert.match(client, /freestyleStore\.mutate\("archive\.trash"/, 'archives can move to trash')
assert.match(client, /freestyleStore\.mutate\("trash\.restore"/, 'trash entries can be restored')
assert.match(client, /freestyleStore\.mutate\("trash\.purge"/, 'trash entries can be purged after confirmation')
assert.match(client, /arxaClientSessions\.open\(dshId\)/, 'Freestyle session rows open their DSH conversation')
assert.match(client, /const dshId = row\.dshSessionId;/, 'session clicks use the persisted root-scoped DSH id')
assert.doesNotMatch(client, /const dshId = row\.dshSessionId \|\|/, 'session clicks do not derive an ambiguous fallback id')
assert.match(client, /if \(action === "session\.open"[\s\S]{0,180}?cancelFreestyleOpen\(\)/, 'an organisation session selection supersedes a pending Freestyle open')
assert.match(client, /root\.sessions && root\.sessions\.parked/, 'parked Freestyle sessions remain visible')
assert.match(client, /verbs\.newSession\(relPath\)\)\.then\(freestyleOpenConversation\)/, 'folder-created sessions open their conversation immediately')
assert.match(client, /verbs\.newSession\(""\)\.then\(freestyleOpenConversation\)/, 'root-created sessions open their conversation immediately')
assert.match(client, /window\.addEventListener\("arxa-freestyle-tree-refresh", refreshTree\)/, 'mounted lazy trees refresh after store changes')
assert.match(client, /new EventSource\("\/__arxa\/artifacts\/events"\)/, 'Freestyle tree owns a disposable root watcher stream')
assert.match(client, /event\.detail\.rootId === rootId/, 'watcher invalidation reloads only the matching root')
assert.match(client, /previous\.status === "ready" \|\| previous\.refreshing/, 'tree refresh preserves mounted rows and their expanded children')
assert.match(client, /serial === loadSerial\.current/, 'overlapping tree loads cannot install a stale response')
assert.match(client, /const done = \(0, react\.useRef\)\(false\)/, 'inline submission is one-shot across Enter and blur')
assert.match(client, /onClick: \(e\) => e\.stopPropagation\(\)/, 'inline editing does not trigger its owning row')
assert.match(client, /freestyleStore\.mutate\(root\.open \? "root\.close" : "root\.open"/, 'root disclosure toggles independently from selection')
assert.match(client, /action: "entry\.trash", arg: \{ rootId, relPath \}/, 'entry trash is routed through confirmation')
assert.match(client, /setBusy\(false\);\s*onClose\(\);/, 'a successful confirmation resets its persistent busy state before the next target')
assert.match(client, /"data-root-id": root\.id/, 'archive rows expose their owning root identity')
assert.match(client, /"data-root-id": row\.rootId/, 'trash rows expose their owning root identity')
assert.match(client, /className: "aXa_fs_meta", children: rootName/, 'trash rows show the owning root as secondary text')
assert.match(client, /hero\.guide\.freestyle/, 'the empty conversation hero follows the active Freestyle tab')
assert.match(client, /snap && snap\.current === row\.dshSessionId\) arxaClientSessions\.clear\(\)/, 'archiving clears only the conversation owned by that row')
assert.match(client, /for \(const root of freestyleStore\.get\(\)\.roots \|\| \[\]\)[\s\S]*?root\.sessions\?\.active/, 'rider ownership includes active Freestyle conversations')
for (const key of ['freestyle.tab.org', 'freestyle.tab.freestyle', 'freestyle.empty', 'freestyle.add.open', 'freestyle.add.new', 'freestyle.cta.pick', 'freestyle.menu.publish', 'freestyle.publish.unlinked', 'freestyle.confirm.purge', 'freestyle.session.noConversation']) {
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
assert.doesNotMatch(snippet, /void freestyleStore\.refresh\(\)/, 'Freestyle boot I/O is not started at module scope')
assert.match(client, /ctx\.effect\(\(\) => \{\s*const controller = new AbortController\(\);\s*void freestyleStore\.refresh\(\{ signal: controller\.signal \}\);\s*return \(\) => \{ controller\.abort\(\); cancelFreestyleOpen\(\); \}/, 'Freestyle boot refresh and pending conversation open belong to a disposable plugin effect')
const requests = []
let activeTab = 'org'
let rootOpen = true
let rootsPresent = true
let deferredState = null
const fetch = async (url, options = {}) => {
  requests.push({ url, options })
  if (url === '/__arxa/freestyle/state' && deferredState) return new Promise((resolve) => deferredState.push(resolve))
  if (url === '/__arxa/freestyle/state') return { json: async () => ({ roots: rootsPresent ? [{ id: 'root-1', open: rootOpen, hasHead: true }] : [], trash: [], ui: { activeTab } }) }
  const body = JSON.parse(options.body)
  if (body.action === 'ui.tab') activeTab = body.arg.tab
  if (body.action === 'fail') return { json: async () => ({ ok: false, error: 'visible failure' }) }
  if (body.action === 'refuse') return { json: async () => ({ ok: false, reason: 'raw refusal reason' }) }
  return { json: async () => ({ ok: true }) }
}
const catalog = { ids: [] }
const opened = []
let catalogListener = null
let catalogUnsubscribed = 0
let timerId = 0
const timers = new Map()
const context = {
  fetch, Set, Map, JSON, Error,
  orgT: (key) => key,
  arxaClientSessions: {
    open: (id) => { opened.push(id) },
    list: {
      getSnapshot: () => catalog,
      subscribe: (listener) => { catalogListener = listener; return () => { catalogUnsubscribed++ } },
    },
  },
  window: {
    setInterval: (fn) => { const id = ++timerId; timers.set(id, fn); return id },
    clearInterval: (id) => timers.delete(id),
    setTimeout: (fn) => { const id = ++timerId; timers.set(id, fn); return id },
    clearTimeout: (id) => timers.delete(id),
    dispatchEvent: () => {},
  },
  Event: class Event { constructor(type) { this.type = type } },
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail } },
}
context.globalThis = context
vm.runInNewContext(`(function () {\n${snippet}\nglobalThis.createFreestyleStore = createFreestyleStore;\nglobalThis.freestyleSelectedWorkspace = freestyleSelectedWorkspace;\nglobalThis.validFreestyleName = validFreestyleName;\nglobalThis.freestyleJoin = freestyleJoin;\nglobalThis.freestyleTreeRequest = freestyleTreeRequest;\nglobalThis.freestyleMenuActions = freestyleMenuActions;\nglobalThis.dropTargetFor = dropTargetFor;\nglobalThis.parseFreestyleDrop = parseFreestyleDrop;\nglobalThis.freestyleOpenConversation = freestyleOpenConversation;\nglobalThis.cancelFreestyleOpen = cancelFreestyleOpen;\n})()`, context, { filename: snippetPath })

const delayedRow = { dshSessionId: 'persisted-dsh-id', dshStatus: 'live' }
context.freestyleOpenConversation(delayedRow)
context.freestyleOpenConversation(delayedRow)
assert.deepEqual(opened, [], 'a Freestyle conversation is not opened before its persisted id reaches the dsh catalog')
assert.equal(typeof catalogListener, 'function', 'a missing catalog id installs one bounded subscription')
catalog.ids.push('persisted-dsh-id')
catalogListener()
catalogListener()
assert.deepEqual(opened, ['persisted-dsh-id'], 'catalog arrival opens the persisted dsh id exactly once')
assert.equal(catalogUnsubscribed, 1, 'catalog arrival releases the transient subscription')
assert.equal(timers.size, 0, 'catalog arrival clears every transient open timer')

catalog.ids.length = 0
context.freestyleOpenConversation({ dshSessionId: 'old-choice', dshStatus: 'live' })
const staleCatalogListener = catalogListener
context.freestyleOpenConversation({ dshSessionId: 'new-choice', dshStatus: 'live' })
catalog.ids.push('old-choice')
staleCatalogListener()
assert.deepEqual(opened, ['persisted-dsh-id'], 'a superseded catalog arrival cannot reopen the old selection')
catalog.ids.push('new-choice')
catalogListener()
assert.deepEqual(opened, ['persisted-dsh-id', 'new-choice'], 'the newest selection opens when its persisted id arrives')
assert.equal(catalogUnsubscribed, 3, 'supersession and final arrival release both transient subscriptions')
assert.equal(timers.size, 0, 'superseded and completed waits leave no timers')

catalog.ids.length = 0
context.freestyleOpenConversation({ dshSessionId: 'freestyle-before-org', dshStatus: 'live' })
const beforeOrgListener = catalogListener
context.cancelFreestyleOpen()
catalog.ids.push('freestyle-before-org')
beforeOrgListener()
assert.deepEqual(opened, ['persisted-dsh-id', 'new-choice'], 'an organisation selection cancellation prevents a stale Freestyle open')
assert.equal(catalogUnsubscribed, 4, 'organisation selection releases the pending Freestyle subscription')
assert.equal(timers.size, 0, 'organisation selection clears the pending Freestyle timer')

catalog.ids.length = 0
context.freestyleOpenConversation({ dshSessionId: 'catalog-timeout', dshStatus: 'live' })
const timeoutCatalogListener = catalogListener
assert.equal(timers.size, 1, 'a catalog wait owns one bounded timeout after service discovery')
Array.from(timers.values())[0]()
catalog.ids.push('catalog-timeout')
timeoutCatalogListener()
assert.deepEqual(opened, ['persisted-dsh-id', 'new-choice'], 'a timed-out catalog wait cannot open later')
assert.equal(catalogUnsubscribed, 5, 'catalog timeout releases its transient subscription')
assert.equal(timers.size, 0, 'catalog timeout clears its timer')

assert.equal(context.validFreestyleName('notes.md'), true, 'inline names accept a normal file name')
assert.equal(context.validFreestyleName(''), false, 'inline names reject empty input')
assert.equal(context.validFreestyleName('a/b'), false, 'inline names reject a forward slash')
assert.equal(context.validFreestyleName('a\\b'), false, 'inline names reject a backslash')
assert.equal(context.freestyleJoin('notes', 'todo.md'), 'notes/todo.md', 'inline creation joins a folder and name with a repo-relative slash')
assert.equal(context.freestyleJoin('', 'todo.md'), 'todo.md', 'inline creation at a root stays relative')
assert.deepEqual(JSON.parse(JSON.stringify(context.freestyleTreeRequest('root-1', 'notes', 'tok'))), {
  tokenBody: { scope: 'tree-read', rootId: 'root-1' },
  url: '/__arxa/artifacts/tree?dir=notes&avt=tok&root=root-1',
}, 'Freestyle tree requests bind both the token and list URL to the root')
assert.deepEqual(JSON.parse(JSON.stringify(context.freestyleTreeRequest(null, 'notes', 'tok'))), {
  tokenBody: { scope: 'tree-read' },
  url: '/__arxa/artifacts/tree?dir=notes&avt=tok',
}, 'organisation tree requests keep their original unscoped shape')
assert.deepEqual(Array.from(context.freestyleMenuActions('file')), ['rename', 'duplicate', 'reveal', 'trash'], 'file menu exposes the supported file verbs')
assert.deepEqual(Array.from(context.freestyleMenuActions('dir')), ['newFile', 'newFolder', 'newSession', 'rename', 'duplicate', 'reveal', 'trash'], 'folder menu exposes create, session and entry verbs')
assert.equal(context.dropTargetFor('notes/todo.md', 'file'), 'notes', 'a file row drops into its parent folder')
assert.equal(context.dropTargetFor('notes/archive', 'dir'), 'notes/archive', 'a folder row is its own drop target')
assert.deepEqual({ ...context.parseFreestyleDrop(JSON.stringify({ rootId: 'root-1', rel: 'a.md' }), 'root-2', '') }, { ok: false, reason: 'cross-root' }, 'cross-root drops are refused')
assert.deepEqual({ ...context.parseFreestyleDrop(JSON.stringify({ rootId: 'root-1', rel: 'notes' }), 'root-1', 'notes/sub') }, { ok: false, reason: 'self' }, 'a folder cannot move into itself')
assert.deepEqual({ ...context.parseFreestyleDrop(JSON.stringify({ rootId: 'root-1', rel: 'notes/a.md' }), 'root-1', 'archive') }, { ok: true, rootId: 'root-1', relPath: 'notes/a.md', toDir: 'archive' }, 'a valid same-root drop produces the host action arguments')
const store = context.createFreestyleStore()
let emissions = 0
const dispose = store.subscribe(() => { emissions++ })
await store.refresh()
assert.equal(store.get().roots[0].id, 'root-1', 'refresh installs server roots')
assert.equal(context.freestyleSelectedWorkspace(store), null, 'organisation tab does not expose a Freestyle selection')

catalog.ids.length = 0
context.freestyleOpenConversation({ dshSessionId: 'archive-before-catalog', dshStatus: 'live' })
const archivedCatalogListener = catalogListener
const archiveMutation = store.mutate('session.archive', { rootId: 'root-1', id: 'session-1' })
assert.equal(timers.size, 0, 'archiving a pending Freestyle session cancels its open before host I/O completes')
await archiveMutation
catalog.ids.push('archive-before-catalog')
archivedCatalogListener()
assert.deepEqual(opened, ['persisted-dsh-id', 'new-choice'], 'an archived session cannot open on a stale catalog arrival')
assert.equal(catalogUnsubscribed, 6, 'archive cancellation releases the pending catalog subscription')

store.select('root-1', 'notes')
assert.deepEqual({ ...store.selected() }, { rootId: 'root-1', relDir: 'notes' }, 'selection retains root and relative directory')
await store.setTab('freestyle')
assert.deepEqual({ ...context.freestyleSelectedWorkspace(store) }, { kind: 'freestyle', rootId: 'root-1', relDir: 'notes' }, 'Freestyle tab exposes the selected folder to the shell CTA')
assert.deepEqual(JSON.parse(requests.find((r) => r.url === '/__arxa/freestyle/action' && JSON.parse(r.options.body).action === 'ui.tab').options.body), { action: 'ui.tab', arg: { tab: 'freestyle' } }, 'setTab posts the action contract')
assert.equal(requests.at(-1).url, '/__arxa/freestyle/state', 'every mutation refreshes state')

rootOpen = false
await store.refresh()
assert.equal(store.selected(), null, 'closing a selected root clears the hidden CTA target')
rootOpen = true
await store.refresh()
store.select('root-1', 'notes')
rootsPresent = false
await store.refresh()
assert.equal(store.selected(), null, 'forgetting a selected root clears the hidden CTA target')
rootsPresent = true

await assert.rejects(store.mutate('fail', {}), /visible failure/, 'failed mutations surface the host error after refresh')
assert.equal(requests.at(-1).url, '/__arxa/freestyle/state', 'failed mutations also refresh state')
await assert.rejects(store.mutate('refuse', {}), /raw refusal reason/, 'failed mutations preserve the host result reason')
assert.equal(requests.at(-1).url, '/__arxa/freestyle/state', 'reason-bearing failures also refresh state')

deferredState = []
const orderedStore = context.createFreestyleStore()
const older = orderedStore.refresh()
const newer = orderedStore.refresh()
assert.equal(deferredState.length, 2, 'parallel refreshes reached the host')
deferredState[1]({ json: async () => ({ roots: [{ id: 'newer' }], trash: [], ui: { activeTab: 'freestyle' } }) })
await newer
deferredState[0]({ json: async () => ({ roots: [{ id: 'older' }], trash: [], ui: { activeTab: 'org' } }) })
await older
assert.equal(orderedStore.get().roots[0].id, 'newer', 'a stale response cannot overwrite a newer refresh')
deferredState = null

dispose()
const beforeDisposedSelect = emissions
store.select('root-1', '')
assert.equal(emissions, beforeDisposedSelect, 'subscription disposer removes the listener')

// The welcome gate is gone (2026-09-09): an empty app shows the same hero as
// an app with nothing open, so there is no longer a gate to keep Freestyle
// reachable *past*. What the three assertions here used to protect — that a
// zero-org app is still usable — is now structural rather than conditional.
assert.ok(!snippet.includes('showWelcomeGate'), 'no welcome gate survives in the Freestyle region')

console.log('arxa-sidebar selftest.freestyle: ALL GREEN')
