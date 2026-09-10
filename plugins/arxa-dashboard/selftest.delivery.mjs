#!/usr/bin/env node
/**
 * arxa-dashboard delivery selftest — docs/plans/org-row-dashboard.md §4 step 5.
 * The host half is RUN against fake github-link / git-workspace services: what
 * it asks for, what it caches, and above all what it REFUSES to claim.
 * Run: node plugins/arxa-dashboard/selftest.delivery.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_REPOS, RUNS_TTL_MS, deliveryOf, invalidateRuns, manifestOf } from './lib/delivery.js'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// ---- fakes -----------------------------------------------------------------
const gwOk = { runGit: () => 'main' }
const manifests = { '/o/project.json': null, '/o/org.json': { repoOwner: 'acme', repoName: 'org' } }
const readManifest = (f) => (f in manifests ? manifests[f] : null)
function github(over = {}) {
  const calls = []
  return {
    calls,
    status: async () => ({ linked: true, login: 'octo' }),
    workflowRuns: async (o) => { calls.push(o); return { runs: [
      { conclusion: 'success', createdAt: '2026-09-10T10:00:00Z' },
      { conclusion: 'failure', createdAt: '2026-09-09T10:00:00Z' },
      { conclusion: null, status: 'in_progress', createdAt: '2026-09-08T10:00:00Z' },
    ] } },
    ...over,
  }
}
const checksOk = async () => ({ state: 'green', asleep: false })
const repo1 = [{ path: '/o', name: 'org' }]
const run = (io) => deliveryOf({ gw: gwOk, mainChecksFor: checksOk, readManifest, repos: repo1, ...io })

// ---- connect-state: every refusal is stated, none is a false green ----------
check('no git-workspace ⇒ unavailable, never an empty green card',
  (await deliveryOf({ g: github(), gw: null, mainChecksFor: checksOk, readManifest, repos: repo1 })).reason === 'unavailable')
check('no github-link service ⇒ unavailable', (await run({ g: null })).reason === 'unavailable')
check('status() throwing ⇒ unavailable, not a crash', (await run({ g: github({ status: async () => { throw new Error('offline') } }) })).reason === 'unavailable')
check('unlinked account ⇒ not-linked (the local-only fallback path, CLAUDE.md boundary)',
  (await run({ g: github({ status: async () => ({ linked: false }) }) })).reason === 'not-linked')
{
  const d = await run({ g: github({ status: async () => ({ linked: true, login: 'octo', relinkRequired: true, relinkReason: 'refresh failed' }) }) })
  check('expired grant ⇒ relink, carrying login + reason', d.reason === 'relink' && d.login === 'octo' && d.detail === 'refresh failed', JSON.stringify(d))
}

// ---- per-repo shapes -------------------------------------------------------
invalidateRuns()
{
  const g = github()
  const d = await run({ g, fresh: true })
  const r = d.repos[0]
  check('a linked repo carries owner/repo, branch, CI state and run figures',
    r.owner === 'acme' && r.repo === 'org' && r.branch === 'main' && r.ci.state === 'green' && r.runs.total === 3, JSON.stringify(r))
  check('rate is over CONCLUDED runs only — an in-flight run is neither a pass nor a fail',
    r.runs.ok === 1 && r.runs.failed === 1 && r.runs.rate === 50, JSON.stringify(r.runs))
  check('runs are read for main, twenty at a time', g.calls[0].branch === 'main' && g.calls[0].perPage === 20, JSON.stringify(g.calls[0]))
  check('roll-up states the worst CI and the mean rate', d.ci === 'green' && d.rate === 50 && d.linkedRepos === 1, JSON.stringify({ ci: d.ci, rate: d.rate }))
}
invalidateRuns()
{
  const d = await run({ g: github({ workflowRuns: async () => ({ runs: [] }) }), fresh: true })
  check('a repo with no runs at all reports rate null, never 0% (absent unit ⇒ null)',
    d.repos[0].runs.total === 0 && d.repos[0].runs.rate === null && d.rate === null, JSON.stringify(d.repos[0].runs))
}
invalidateRuns()
{
  const d = await run({ g: github({ workflowRuns: async () => { throw new Error('403') } }), fresh: true })
  check('an unreadable run list is null, not zero — and the rest of the row still renders',
    d.repos[0].runs === null && d.repos[0].ci.state === 'green' && d.rate === null, JSON.stringify(d.repos[0]))
}
invalidateRuns()
{
  const d = await run({ g: github(), mainChecksFor: async () => null, fresh: true })
  check('mainChecksFor returning null leaves ci null — never a false green', d.repos[0].ci === null && d.ci === null)
}
{
  const d = await deliveryOf({ g: github(), gw: gwOk, mainChecksFor: checksOk, readManifest: () => null, repos: repo1 })
  check('a repo with no manifest is local-only, and asks GitHub nothing about it',
    d.repos[0].reason === 'local-only' && d.repos[0].runs === null && d.linkedRepos === 0, JSON.stringify(d.repos[0]))
}
{
  const d = await deliveryOf({ g: github(), gw: gwOk, mainChecksFor: checksOk, repos: repo1, readManifest: () => ({ repoOwner: 'a', repoName: 'b', localOnly: true }) })
  check('localOnly in the manifest is honoured — a published-then-unpublished repo is not queried', d.repos[0].reason === 'local-only')
}

// ---- worst-state roll-up ---------------------------------------------------
invalidateRuns()
{
  const many = [{ path: '/a', name: 'a' }, { path: '/b', name: 'b' }]
  const mans = { '/a/project.json': { repoOwner: 'x', repoName: 'a' }, '/b/project.json': { repoOwner: 'x', repoName: 'b' } }
  const states = { a: 'green', b: 'red' }
  const d = await deliveryOf({
    g: github(), gw: gwOk, repos: many, fresh: true,
    readManifest: (f) => mans[f] || null,
    mainChecksFor: async (p) => ({ state: states[p.slice(1)], asleep: false }),
  })
  check('one failing repo makes the org roll-up red (worst state wins, never the average)', d.ci === 'red', JSON.stringify(d.ci))
}

// ---- cache (D7) ------------------------------------------------------------
invalidateRuns()
{
  const g = github()
  await run({ g, fresh: true })
  await run({ g })
  check('a second read inside 60 s is served from the cache — one GitHub call, not two', g.calls.length === 1, String(g.calls.length))
  await run({ g, fresh: true })
  check('manual refresh (fresh: true) bypasses the cache', g.calls.length === 2, String(g.calls.length))
  invalidateRuns('acme', 'org')
  await run({ g })
  check('invalidateRuns drops just that repo and forces a re-read', g.calls.length === 3, String(g.calls.length))
  check('the TTL is the 60 s the plan specifies (D7)', RUNS_TTL_MS === 60_000)
}

// ---- fan-out ceiling -------------------------------------------------------
invalidateRuns()
{
  const many = Array.from({ length: MAX_REPOS + 3 }, (_, i) => ({ path: '/r' + i, name: 'r' + i }))
  const g = github()
  const d = await deliveryOf({ g, gw: gwOk, mainChecksFor: checksOk, repos: many, fresh: true, readManifest: (f) => ({ repoOwner: 'x', repoName: f }) })
  check('an org with more repos than the ceiling fetches at most MAX_REPOS and SAYS how many it skipped',
    d.repos.length === MAX_REPOS && d.truncated === 3, JSON.stringify({ n: d.repos.length, truncated: d.truncated }))
}

// ---- manifestOf ------------------------------------------------------------
check('manifestOf prefers project.json and falls back to org.json',
  manifestOf((f) => (f === '/o/org.json' ? { repoOwner: 'a' } : null), '/o').repoOwner === 'a'
  && manifestOf((f) => (f === '/o/project.json' ? { repoOwner: 'p' } : null), '/o').repoOwner === 'p')
check('manifestOf on a repo with neither file is null', manifestOf(() => null, '/o') === null)

// ---- wiring (byte level) ---------------------------------------------------
const host = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
check('host: the row.delivery verb is registered', host.includes("'row.delivery': async () =>"))
check('host: delivery reads github through the SIDEBAR host, never its own import', host.includes('sb.getGithub') && host.includes('sb.mainChecksFor') && !host.includes('createGithubLink'))
check('host: the verb refuses a row whose path is gone rather than fanning out', /row\.delivery[\s\S]{0,300}existsSync\(row\.path\)/.test(host))
check('client: the Delivery card renders DeliveryBody, not the "soon" placeholder',
  client.includes("hook: 'delivery'") && client.includes('h(DeliveryBody, { d: delivery })') && !/hook: 'delivery'[^\n]*group\.soon/.test(client))
check('client: only the refresh button asks for a fresh fetch (D7)',
  /freshRef\.current = true; setTick/.test(client) && /const fresh = freshRef\.current/.test(client))
check('client: delivery is its own request — a slow GitHub cannot block row.stats',
  /postAction\(ROUTE, 'row\.delivery'/.test(client) && /postAction\(ROUTE, 'row\.stats'/.test(client))
check('client: an unknown figure prints an em dash, never a zero',
  client.includes("d.rate === null || d.rate === undefined ? '\\u2014'"))
const dictKeys = ['delivery.not-linked', 'delivery.relink', 'delivery.unavailable', 'delivery.local-only', 'delivery.rate', 'delivery.rateNote', 'delivery.linked', 'delivery.mainCi', 'delivery.truncated', 'delivery.ci.green', 'delivery.ci.red', 'delivery.ci.pending', 'delivery.ci.none', 'delivery.ci.unknown']
check('client: every delivery key exists in all three dictionaries',
  dictKeys.every((k) => (client.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length === 3),
  dictKeys.filter((k) => (client.match(new RegExp("'" + k.replace(/\./g, '\\.') + "':", 'g')) || []).length !== 3).join(', '))
check('client: no fact labels itself with a parameterised template (the {done} defect)',
  !/t\('delivery\.truncated'\)/.test(client))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
