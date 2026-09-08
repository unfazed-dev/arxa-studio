// arxa-freestyle host plugin (Task 6, docs/plans/freestyle-section.md):
// exposes the roots/files/sessions libraries built in Tasks 3-5 over HTTP so
// a client can drive them. Composes those libraries — never reimplements
// them; see roots.js, files.js, sessions.js, paths.js for the actual logic.
//
//   GET  /__arxa/freestyle/state   -> { roots, trash, ui }
//   POST /__arxa/freestyle/action  body { action, arg } -> { ok, ... } | { ok:false, error }
import { readRegistry, rootById, addRoot, newRoot, openRoot, closeRoot, forgetRoot, renameRoot, setActiveTab } from './roots.js'
import { createFile, createDir, renameEntry, moveEntry, duplicateEntry, trashEntry, listTrash, restoreEntry, purgeEntry, revealEntry } from './files.js'
import { createFreestyleSessions } from './sessions.js'
import { isRepo, hasHead } from '../../git-workspace/lib/repos.js'

export const name = 'arxa-freestyle'
export const inject = ['webServer']

// ponytail: no-op default. dshBridge is an injection seam (opts.dshBridge) —
// this default just means session.new reports dshStatus: 'dsh-unavailable'
// until a real bridge (file-org-shell's createDshBridge, Task 5) is passed
// through apply(). Not importing that factory here: a relative cross-package
// import from lib/ has previously broken boot under pnpm's virtual store
// (see paths.js:8-14) — the seam lets a caller wire a real bridge without
// this file risking that failure class.
const noDshBridge = { spawn: async () => ({ ok: false, reason: 'dsh-unavailable' }) }

function json(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

export function apply(ctx, opts = {}) {
  const env = opts.env || process.env
  const dshBridge = opts.dshBridge || noDshBridge
  const S = createFreestyleSessions({ env, dshBridge })

  const rootOr = (id) => { const r = rootById(id, { env }); if (!r) throw new Error('unknown-root: ' + id); return r }

  const state = () => {
    const reg = readRegistry({ env })
    const roots = reg.roots.map((r) => ({
      ...r,
      isRepo: isRepo(r.path, env),
      hasHead: isRepo(r.path, env) && hasHead(r.path, env),
      sessions: r.open ? S.list(r) : { active: [], parked: [], archived: [] },
      trashCount: listTrash(r).length,
    }))
    const trash = roots.flatMap((r) => listTrash(r).map((e) => ({ ...e, rootId: r.id })))
    return { roots, trash, ui: reg.ui }
  }

  const ACTIONS = {
    'root.add': ({ path: p }) => ({ root: addRoot(p, { env }) }),
    'root.new': ({ parent, name }) => ({ root: newRoot(parent, name, { env }) }),
    'root.open': ({ rootId }) => ({ root: openRoot(rootId, { env }) }),
    'root.close': ({ rootId }) => ({ root: closeRoot(rootId, { env }) }),
    'root.forget': ({ rootId }) => ({ root: forgetRoot(rootId, { env }) }),
    'root.rename': ({ rootId, name }) => ({ root: renameRoot(rootId, name, { env }) }),
    'file.create': ({ rootId, relPath }) => createFile(rootOr(rootId), relPath, { env }),
    'dir.create': ({ rootId, relPath }) => createDir(rootOr(rootId), relPath, { env }),
    'entry.rename': ({ rootId, relPath, name }) => renameEntry(rootOr(rootId), relPath, name, { env }),
    'entry.move': ({ rootId, relPath, toDir }) => moveEntry(rootOr(rootId), relPath, toDir, { env }),
    'entry.duplicate': ({ rootId, relPath }) => duplicateEntry(rootOr(rootId), relPath, { env }),
    'entry.trash': ({ rootId, relPath }) => ({ entry: trashEntry(rootOr(rootId), relPath, { env }) }),
    'entry.reveal': ({ rootId, relPath }) => revealEntry(rootOr(rootId), relPath),
    'trash.restore': ({ rootId, entryId }) => restoreEntry(rootOr(rootId), entryId, { env }),
    'trash.purge': ({ rootId, entryId }) => purgeEntry(rootOr(rootId), entryId),
    'session.new': ({ rootId, relDir, name }) => S.newSession(rootOr(rootId), relDir || '', name),
    'session.archive': ({ rootId, id }) => S.archive(rootOr(rootId), id),
    'archive.revive': ({ rootId, id }) => S.revive(rootOr(rootId), id),
    'archive.trash': ({ rootId, id }) => S.trashArchived(rootOr(rootId), id),
    'session.finish': ({ rootId, id, dryRun }) => S.finish(rootOr(rootId), id, { dryRun: !!dryRun }),
    'session.sweep': ({ rootId, dryRun }) => S.sweep(rootOr(rootId), { dryRun: dryRun !== false }),
    'ui.tab': ({ tab }) => ({ ui: setActiveTab(tab, { env }) }),
  }

  ctx.webServer.register({
    name: 'arxa-freestyle-state',
    path: '/__arxa/freestyle/state',
    kind: 'exact',
    handler: async (req, res) => {
      try { json(res, state()) }
      catch (e) { json(res, { roots: [], trash: [], ui: { activeTab: 'org' }, error: String(e?.message ?? e) }) }
    },
  })

  ctx.webServer.register({
    name: 'arxa-freestyle-action',
    path: '/__arxa/freestyle/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          const { action, arg } = JSON.parse(raw || '{}')
          const fn = ACTIONS[action]
          if (!fn) throw new Error('unknown action: ' + action)
          const out = await fn(arg || {})
          json(res, { ok: true, ...out })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
}
