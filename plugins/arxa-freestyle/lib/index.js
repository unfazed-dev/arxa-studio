// arxa-freestyle host plugin (Task 6, docs/plans/freestyle-section.md):
// exposes the roots/files/sessions libraries built in Tasks 3-5 over HTTP so
// a client can drive them. Composes those libraries — never reimplements
// them; see roots.js, files.js, sessions.js, paths.js for the actual logic.
//
//   GET  /__arxa/freestyle/state   -> { roots, trash, ui }
//   POST /__arxa/freestyle/action  body { action, arg } -> { ok, ... } | { ok:false, error }
import { readRegistry, listRoots, rootById, addRoot, newRoot, openRoot, closeRoot, forgetRoot, renameRoot, publishRoot, setActiveTab } from './roots.js'
import { createFile, createDir, renameEntry, moveEntry, duplicateEntry, trashEntry, listTrash, restoreEntry, purgeEntry, revealEntry } from './files.js'
import { createFreestyleSessions } from './sessions.js'
import { isRepo, hasHead } from '../../git-workspace/lib/repos.js'
import { dshSessionKey } from '../../git-workspace/lib/sessions.js'

// The git card resolves session seats through the installed package in a
// profile and through this same entry in a checkout. Keep the registry
// primitives behind one package import instead of asking consumers to reach
// through package-private lib subpaths.
export { listRoots, createFreestyleSessions }

export const name = 'arxa-freestyle'
export const inject = ['webServer', 'sessions', 'workspaceRegistry', 'sessionTitle', 'agents']

const noDshBridge = { spawn: async () => ({ ok: false, reason: 'dsh-unavailable' }) }

async function importShell() {
  try { return await import('arxa-file-org-shell') }
  catch { return import(new URL('../../file-org-shell/lib/index.js', import.meta.url).href) }
}

/**
 * The production half of the Freestyle → dsh seam. Freestyle currently needs
 * only spawn; the throw-proof behavior remains owned by createDshBridge.
 * This mirrors the sidebar's established birth contract: a deterministic dsh
 * id, a live agent from the engine factory, the session title pinned to the
 * registry name, and workspace residency at the worktree cwd.
 */
function makeDshFaces(ctx) {
  let sessions
  try { sessions = ctx.sessions } catch { return {} }
  if (!sessions || typeof sessions.create !== 'function') return {}

  const pinTitle = (id, name) => {
    try {
      const live = typeof sessions.get === 'function' ? sessions.get(id) : null
      const titles = ctx.sessionTitle
      if (live && typeof titles?.rename === 'function' && typeof name === 'string' && name.trim() !== '') titles.rename(live, name)
    } catch { /* a title is presentation; session birth still succeeds */ }
  }

  const seatWorkspace = async (cwd, name, id) => {
    try {
      const registry = ctx.workspaceRegistry
      if (!registry || typeof registry.resolveByPath !== 'function') return
      const { realpath } = await import('node:fs/promises')
      const canonical = await realpath(cwd)
      let workspace = await registry.resolveByPath(canonical)
      if (!workspace && typeof registry.createCanonical === 'function') workspace = await registry.createCanonical(canonical, name)
      if (workspace && typeof workspace.attachSession === 'function') await workspace.attachSession(id)
    } catch { /* residency is best-effort, as in arxa-sidebar */ }
  }

  return {
    spawn: async ({ cwd, name, id: registryId }) => {
      const wanted = typeof registryId === 'string' && registryId.trim() !== '' ? dshSessionKey(registryId) : undefined
      let agents
      try { agents = ctx.agents } catch { agents = null }
      if (agents && typeof agents.create === 'function') {
        let presetId
        let setup
        try {
          const presets = typeof ctx.get === 'function' ? ctx.get('agentPresets') : null
          if (presets && typeof presets.resolve === 'function' && typeof presets.mount === 'function') {
            const resolved = await presets.resolve(undefined)
            if (typeof resolved?.id === 'string' && resolved.id !== '') {
              presetId = resolved.id
              setup = async (agentCtx) => {
                try { await presets.mount(agentCtx, presetId) }
                catch (err) { console.log('[arxa-freestyle] preset mount failed for ' + presetId + ': ' + String(err?.message ?? err)) }
              }
            }
          }
        } catch { /* host default composition */ }
        const handle = await agents.create({
          ...(wanted ? { sessionId: wanted } : {}),
          meta: { cwd, ...(presetId ? { agentPreset: presetId } : {}) },
          ...(setup ? { setup } : {}),
        })
        const id = handle?.session?.id ?? handle?.id ?? wanted
        if (typeof id !== 'string' || id === '') throw new Error('agent-factory-returned-no-session-id')
        pinTitle(id, name)
        await seatWorkspace(cwd, name, id)
        return { id }
      }

      let id
      try { id = sessions.create(wanted, { meta: { cwd } }).id }
      catch (err) {
        if (!(wanted && typeof sessions.get === 'function' && sessions.get(wanted))) throw err
        id = wanted
      }
      pinTitle(id, name)
      await seatWorkspace(cwd, name, id)
      return { id }
    },
  }
}

async function githubBridgeFor(faces, env) {
  const shell = await import('arxa-file-org-shell').catch(() => import('../../file-org-shell/lib/index.js'))
  let source = faces
  if (!source) {
    const link = await import('arxa-github-link').catch(() => import('../../github-link/lib/index.js'))
    source = link.createGithubLink({ env })
  }
  return shell.createGithubBridge(source)
}

function json(res, body) {
  res.writeHead(200, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

export function apply(ctx, opts = {}) {
  const env = opts.env || process.env
  let productionBridge = null
  const dshBridge = opts.dshBridge || {
    spawn: async (arg) => {
      if (!productionBridge) {
        try {
          const shell = await importShell()
          productionBridge = typeof shell?.createDshBridge === 'function' ? shell.createDshBridge(makeDshFaces(ctx)) : noDshBridge
        } catch { productionBridge = noDshBridge }
      }
      const id = typeof arg?.rootId === 'string' && arg.rootId !== ''
        ? arg.rootId + '/' + arg.id
        : arg?.id
      return productionBridge.spawn({ ...arg, id })
    },
  }
  const S = createFreestyleSessions({ env, dshBridge })
  let githubPromise = null
  const github = () => { githubPromise ??= githubBridgeFor(opts.github, env); return githubPromise }

  const isDshLive = (id) => {
    if (typeof id !== 'string' || id === '') return false
    try { return typeof ctx.agents?.get === 'function' && Boolean(ctx.agents.get(id)) }
    catch { return false }
  }

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
    'root.publish': async ({ rootId, visibility }) => {
      if (visibility !== 'private') throw new Error('private-visibility-required')
      return publishRoot(rootOr(rootId), { github: await github(), env })
    },
    'file.create': ({ rootId, relPath }) => createFile(rootOr(rootId), relPath, { env }),
    'dir.create': ({ rootId, relPath }) => createDir(rootOr(rootId), relPath, { env }),
    'entry.rename': ({ rootId, relPath, name }) => renameEntry(rootOr(rootId), relPath, name, { env }),
    'entry.move': ({ rootId, relPath, toDir }) => moveEntry(rootOr(rootId), relPath, toDir, { env }),
    'entry.duplicate': ({ rootId, relPath }) => duplicateEntry(rootOr(rootId), relPath, { env }),
    'entry.trash': ({ rootId, relPath }) => ({ entry: trashEntry(rootOr(rootId), relPath, { env }) }),
    'entry.reveal': ({ rootId, relPath }) => revealEntry(rootOr(rootId), relPath),
    'trash.restore': ({ rootId, entryId }) => restoreEntry(rootOr(rootId), entryId, { env }),
    'trash.purge': ({ rootId, entryId }) => purgeEntry(rootOr(rootId), entryId),
    'session.new': async ({ rootId, relDir, name }) => {
      const session = await S.newSession(rootOr(rootId), relDir || '', name)
      return { ...session, dshLive: isDshLive(session.dshSessionId) }
    },
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
