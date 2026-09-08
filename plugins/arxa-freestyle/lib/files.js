// arxa-freestyle file verbs (F6) and per-root trash (F9). Every mutation
// resolves the nearest enclosing repo via resolveFreestyleRepo and leaves a
// WIP auto-commit there, so undo/history works the same as the org/project
// docks — nested repos commit in the right place, not at the Freestyle root.
import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveInside, trashDir, RESERVED } from './paths.js'
import { resolveFreestyleRepo } from '../../git-workspace/lib/routing.js'
import { wipCommit } from '../../git-workspace/lib/commits.js'

function repoOf(root, rel, env) { return resolveFreestyleRepo(root.path, path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), { env, requireHead: false }).repoPath }
function commit(root, rel, verb, env) { wipCommit(repoOf(root, rel, env), { message: `chore: ${verb} ${rel}`, env }) }
function mustNotExist(abs) { if (fs.existsSync(abs)) throw new Error('exists: ' + abs) }

export function createFile(root, relPath, { env = process.env } = {}) {
  const { abs, rel } = resolveInside(root.path, relPath); mustNotExist(abs)
  fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, ''); commit(root, rel, 'create', env); return { rel }
}
export function createDir(root, relPath, { env = process.env } = {}) {
  const { abs, rel } = resolveInside(root.path, relPath); mustNotExist(abs)
  fs.mkdirSync(abs, { recursive: true }); fs.writeFileSync(path.join(abs, '.gitkeep'), ''); commit(root, rel, 'mkdir', env); return { rel }
}
export function renameEntry(root, relPath, newName, { env = process.env } = {}) {
  if (typeof newName !== 'string' || newName.includes('/') || newName.includes('\\') || newName === '' || newName === '.' || newName === '..') throw new Error('bad-name')
  const from = resolveInside(root.path, relPath); const to = resolveInside(root.path, path.posix.join(path.posix.dirname(from.rel), newName)); mustNotExist(to.abs)
  fs.renameSync(from.abs, to.abs); commit(root, to.rel, 'rename ' + from.rel + ' ->', env); return { rel: to.rel }
}
export function moveEntry(root, relPath, toDir, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); const dir = resolveInside(root.path, toDir || '')
  if (dir.rel === from.rel || dir.rel.startsWith(from.rel + '/')) throw new Error('cannot move a folder into itself')
  const to = resolveInside(root.path, path.posix.join(dir.rel, path.posix.basename(from.rel))); mustNotExist(to.abs)
  fs.renameSync(from.abs, to.abs); commit(root, to.rel, 'move ' + from.rel + ' ->', env); return { rel: to.rel }
}
export function duplicateEntry(root, relPath, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); const ext = path.posix.extname(from.rel); const stem = from.rel.slice(0, from.rel.length - ext.length)
  let i = 1, cand; do { cand = stem + (i === 1 ? ' copy' : ' copy ' + i) + ext; i++ } while (fs.existsSync(path.join(root.path, cand)))
  const to = resolveInside(root.path, cand); fs.cpSync(from.abs, to.abs, { recursive: true }); commit(root, to.rel, 'duplicate', env); return { rel: to.rel }
}
export function trashEntry(root, relPath, { env = process.env } = {}) {
  const from = resolveInside(root.path, relPath); if (!fs.existsSync(from.abs)) throw new Error('missing: ' + relPath)
  const id = randomUUID(); const dir = path.join(trashDir(root.path), id); fs.mkdirSync(dir, { recursive: true })
  const entry = { id, relPath: from.rel, name: path.posix.basename(from.rel), kind: fs.statSync(from.abs).isDirectory() ? 'dir' : 'file', trashedAt: new Date().toISOString() }
  fs.renameSync(from.abs, path.join(dir, entry.name)); fs.writeFileSync(path.join(dir, 'entry.json'), JSON.stringify(entry, null, 2))
  commit(root, from.rel, 'trash', env); return entry
}
export function listTrash(root) {
  const d = trashDir(root.path); if (!fs.existsSync(d)) return []
  return fs.readdirSync(d).flatMap((id) => { try { return [JSON.parse(fs.readFileSync(path.join(d, id, 'entry.json'), 'utf8'))] } catch { return [] } }).sort((a, b) => b.trashedAt.localeCompare(a.trashedAt))
}
export function restoreEntry(root, entryId, { env = process.env } = {}) {
  const e = listTrash(root).find((x) => x.id === entryId); if (!e) throw new Error('unknown-entry')
  let target = resolveInside(root.path, e.relPath)
  if (fs.existsSync(target.abs)) { const ext = path.posix.extname(e.relPath); target = resolveInside(root.path, e.relPath.slice(0, e.relPath.length - ext.length) + ' (restored)' + ext) }
  fs.mkdirSync(path.dirname(target.abs), { recursive: true }); fs.renameSync(path.join(trashDir(root.path), entryId, e.name), target.abs)
  fs.rmSync(path.join(trashDir(root.path), entryId), { recursive: true, force: true }); commit(root, target.rel, 'restore', env); return { rel: target.rel }
}
export function purgeEntry(root, entryId) { const d = path.join(trashDir(root.path), entryId); if (!fs.existsSync(path.join(d, 'entry.json'))) throw new Error('unknown-entry'); fs.rmSync(d, { recursive: true, force: true }); return { ok: true } }
export function revealEntry(root, relPath) {
  const { abs } = resolveInside(root.path, relPath)
  const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', abs]] : ['xdg-open', [fs.statSync(abs).isDirectory() ? abs : path.dirname(abs)]]
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); return { ok: true } } catch (e) { return { ok: false, reason: String(e.message) } }
}
export function listDir(root, relDir = '') {
  const { abs } = resolveInside(root.path, relDir || ''); const dirs = [], files = []
  for (const d of fs.readdirSync(abs, { withFileTypes: true })) { if (RESERVED.includes(d.name)) continue; (d.isDirectory() ? dirs : files).push(d.name) }
  dirs.sort(); files.sort(); return { dirs, files }
}
