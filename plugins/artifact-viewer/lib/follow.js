// Open-org follow loop: watches the ON-DISK open-org truth and keeps exactly
// one per-org server alive for it (D7: "spawned on org mount, killed on org
// switch").
//
// Why on-disk: the lifecycle instance (and its open-org handle) lives inside
// the arxa-sidebar host half — instance memory no other plugin can read. The
// durable truth is the shell-lock holder the lifecycle itself writes on open:
// <org>/.arxa/locks/<slug>.lock = { pid, orgPath, startedAt } (same-pid
// reentrant, released on close). An org counts as open iff its lock exists
// AND the holder pid is alive (shell-lock staleness rule mirrors this).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Inline (was a relative import of workspace/lib/root.js): pnpm's virtual
// store copies file: deps, so cross-package RELATIVE imports break at boot
// in installed profiles (measured 2026-08-31). arxaHome is one line.
function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch (err) { return err.code === 'EPERM' }
}

/** The open org from disk, or null. Pure fs — no locks taken, no git. */
export function readOpenOrg(env = process.env) {
  let orgs = []
  try {
    orgs = JSON.parse(fs.readFileSync(path.join(arxaHome(env), 'organisation.json'), 'utf8')).orgs ?? []
  } catch { return null }
  for (const org of orgs) {
    if (typeof org !== 'string' || org === '') continue
    const slug = path.basename(org)
    let holder = null
    try {
      holder = JSON.parse(fs.readFileSync(path.join(org, '.arxa', 'locks', slug + '.lock'), 'utf8'))
    } catch { continue }
    if (Number.isInteger(holder?.pid) && pidAlive(holder.pid)) {
      return { orgPath: typeof holder.orgPath === 'string' ? holder.orgPath : org, slug }
    }
  }
  return null
}

/**
 * Poll the open-org truth and reconcile one server.
 * createServer is injectable for tests ({ orgRoot, orgSlug } -> { origin, close() }).
 * Returns { stop(), current() }; never throws into the poll loop.
 */
export function startOrgFollow({ env = process.env, intervalMs = 2000, createServer, log = () => {}, onServing = null }) {
  let serving = null // { orgPath, handle }
  let switching = false
  let stopped = false

  async function reconcile() {
    if (stopped || switching) return
    const want = readOpenOrg(env)
    const cur = serving
    if (want && cur && want.orgPath === cur.orgPath) return
    if (!want && !cur) return
    switching = true
    try {
      if (cur) {
        serving = null
        await cur.handle.close().catch((err) => log('close failed for ' + cur.orgPath + ': ' + err.message))
        log('org server closed: ' + cur.orgPath)
      }
      if (want) {
        const handle = await createServer({ orgRoot: want.orgPath, orgSlug: want.slug })
        serving = { orgPath: want.orgPath, handle }
        log('org server serving ' + want.orgPath + ' at ' + handle.origin)
      }
    } catch (err) {
      log('reconcile failed: ' + (err && err.message))
    } finally {
      switching = false
      if (onServing) { try { onServing(serving ? serving.orgPath : null) } catch {} }
    }
  }

  const timer = setInterval(() => { void reconcile() }, intervalMs)
  void reconcile()
  return {
    stop() {
      stopped = true
      clearInterval(timer)
      return serving ? serving.handle.close() : Promise.resolve()
    },
    current() { return serving ? { orgPath: serving.orgPath, origin: serving.handle.origin } : null },
  }
}
