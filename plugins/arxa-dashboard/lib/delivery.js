/**
 * arxa-dashboard — tier-3 Delivery figures (plan §4 step 5, D4/D7).
 *
 * Everything here is GitHub-through-`github-link`, which is per-user and
 * local-first (OS keyring + the user's own OAuth grant): no Arxa Digital
 * Solutions database is in the request path, per arxa-studio/CLAUDE.md. With
 * no link at all the row still renders — it says `not-linked` and the tier-1
 * local git figures beside it are unaffected.
 *
 * Pure over injected `g` (the github-link service), `gw` (git-workspace, for
 * `runGit`) and `readManifest`, so the selftest drives it with fakes and the
 * host never reaches the network itself.
 *
 * Absent unit ⇒ null, never zero: a repo whose runs could not be read reports
 * `runs: null`, never `{ total: 0 }` — zero runs is a claim about the repo.
 */

/** D7: fetch on open, reuse for 60 s, `fresh` bypasses. Module scope, keyed by
  * owner/name so two orgs holding the same repo share one entry. Bounded by
  * the number of repos a user actually opens in a minute.
  * ponytail: no eviction — a Map of a few dozen small objects. Add an LRU if a
  * single session ever touches thousands of repos. */
const runsCache = new Map()
export const RUNS_TTL_MS = 60_000
export const MAX_REPOS = 8

/** Ordered so the worst state wins a roll-up: red > pending > green > none. */
const RANK = { red: 3, pending: 2, green: 1, none: 0 }

/** The repo's own manifest (project.json, else org.json) — owner/name + local-only flag. */
export function manifestOf(readManifest, path) {
  for (const f of ['project.json', 'org.json']) {
    const m = readManifest(path + '/' + f)
    if (m && (m.repoOwner || m.repoName || m.localOnly !== undefined)) return m
  }
  return null
}

/** Recent workflow runs for one repo → { total, ok, failed, lastAt, lastConclusion }, or null. */
export async function runsOf(g, owner, name, branch, fresh) {
  const key = owner + '/' + name + '#' + (branch || '')
  const hit = runsCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < RUNS_TTL_MS) return hit.value
  let value = null
  try {
    const out = await g.workflowRuns({ owner, name, branch: branch || undefined, perPage: 20 })
    const runs = Array.isArray(out?.runs) ? out.runs : null
    if (runs) {
      // A run still in flight has no conclusion: it is neither ok nor failed,
      // so it counts in `total` only. Rate is over the CONCLUDED runs.
      const done = runs.filter((r) => r && r.conclusion)
      const ok = done.filter((r) => r.conclusion === 'success').length
      const newest = runs.find((r) => r && r.createdAt) || null
      value = {
        total: runs.length,
        ok,
        failed: done.length - ok,
        rate: done.length ? Math.round((ok / done.length) * 100) : null,
        lastAt: newest ? newest.createdAt : null,
        lastConclusion: newest ? (newest.conclusion || newest.status || null) : null,
      }
    }
  } catch { value = null }
  runsCache.set(key, { at: Date.now(), value })
  return value
}

/** Drop cached runs for one repo, or everything when called bare (manual refresh). */
export function invalidateRuns(owner, name) {
  if (!owner) return runsCache.clear()
  const prefix = owner + '/' + (name || '')
  for (const k of runsCache.keys()) if (k.startsWith(prefix)) runsCache.delete(k)
}

/**
 * Delivery for a resolved row's repos.
 * @param {{ g: any, gw: any, mainChecksFor: Function, readManifest: Function,
 *          repos: {path: string, name: string}[], fresh?: boolean }} io
 */
export async function deliveryOf({ g, gw, mainChecksFor, readManifest, repos, fresh = false }) {
  if (!g || !gw || typeof gw.runGit !== 'function') return { reason: 'unavailable' }
  let status = null
  try { status = await g.status() } catch { return { reason: 'unavailable' } }
  if (!status || status.linked !== true) return { reason: 'not-linked' }
  if (status.relinkRequired === true) return { reason: 'relink', login: status.login ?? null, detail: status.relinkReason ?? null }

  const list = repos.slice(0, MAX_REPOS)
  const out = []
  for (const r of list) {
    const manifest = manifestOf(readManifest, r.path)
    if (!manifest || !manifest.repoOwner || !manifest.repoName || manifest.localOnly) {
      out.push({ name: r.name, owner: null, repo: null, reason: 'local-only', ci: null, runs: null })
      continue
    }
    const branch = gw.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: r.path, allowFail: true }) || null
    const checks = await mainChecksFor(r.path, manifest, g, gw).catch(() => null)
    out.push({
      name: r.name,
      owner: manifest.repoOwner,
      repo: manifest.repoName,
      branch,
      // mainChecksFor returns null for anything it cannot state — never a false green.
      ci: checks ? { state: checks.state ?? null, asleep: checks.asleep === true } : null,
      runs: await runsOf(g, manifest.repoOwner, manifest.repoName, 'main', fresh),
    })
  }

  const rated = out.filter((r) => r.runs && r.runs.rate !== null)
  const stated = out.filter((r) => r.ci && r.ci.state && r.ci.state !== 'none')
  return {
    login: status.login ?? null,
    repos: out,
    truncated: repos.length - list.length,
    linkedRepos: out.filter((r) => r.owner).length,
    // Roll-up: worst CI wins; rate is the mean of the repos that HAVE one.
    ci: stated.length ? stated.reduce((a, b) => (RANK[b.ci.state] > RANK[a] ? b.ci.state : a), 'green') : null,
    rate: rated.length ? Math.round(rated.reduce((a, r) => a + r.runs.rate, 0) / rated.length) : null,
    fetchedAt: new Date().toISOString(),
  }
}
