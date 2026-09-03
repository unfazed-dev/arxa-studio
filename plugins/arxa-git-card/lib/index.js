/**
 * arxa-git-card — host half (docs/plans/git-card-stock-dock-rebuild.md, A2).
 *
 * The Git card's engine actions, MOVED verbatim out of arxa-sidebar's action
 * table (2026-09-02): card.status / card.commit.draft / card.commit /
 * card.push / card.pr.create / card.pr.status / card.pr.merge /
 * version.mint / card.runner.wake / insight.streak / insight.ci /
 * insight.sessions. One route on the same webServer pattern:
 *
 *   POST /__arxa/git-card/action  body { action, arg }
 *     → { ok: true, action, result } | { ok: false, error, action? }
 *
 * The org shell (single open-org handle, ensureOpen, lifecycle) stays owned
 * by arxa-sidebar; this half reaches it through the host object the sidebar
 * publishes under Symbol.for('arxa.sidebar.host') — one process-wide
 * singleton, immune to the two module instances pnpm's virtual store can
 * produce for file: deps (bare import falls back for the checkout shape).
 * Nothing here is duplicated from the sidebar: getGithub / mainChecksFor /
 * importGitWorkspace ride on that object because workspace.new-session
 * (D111 gate) still needs them there.
 */

export const name = 'arxa-git-card'
export const inject = ['webServer']

const HOST_KEY = Symbol.for('arxa.sidebar.host')

/** The sidebar's published host object, or null before its apply() ran. */
async function sidebarHost() {
  const g = globalThis[HOST_KEY]
  if (g?.ready) return g
  try {
    const m = await import('arxa-sidebar')
    if (m.sidebarHost?.ready) return m.sidebarHost
  } catch { /* not resolvable bare — checkout shape below */ }
  try {
    const m = await import(new URL('../../arxa-sidebar/lib/index.js', import.meta.url).href)
    if (m.sidebarHost?.ready) return m.sidebarHost
  } catch { /* fall through */ }
  return globalThis[HOST_KEY]?.ready ? globalThis[HOST_KEY] : null
}

/** prflow.js is not re-exported by the git-workspace barrel (D116); it is
  * reachable bare only through the "./lib/prflow.js" exports entry. */
let prflowCache = null
async function importPrflow() {
  if (prflowCache) return prflowCache
  try {
    prflowCache = await import('git-workspace/lib/prflow.js')
  } catch {
    prflowCache = await import(new URL('../../git-workspace/lib/prflow.js', import.meta.url).href)
  }
  return prflowCache
}

export function apply(ctx) {
  const json = (res, body) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(body))
  }

  ctx.webServer.register({
    name: 'arxa-git-card-action',
    path: '/__arxa/git-card/action',
    kind: 'exact',
    handler: async (req, res) => {
      let raw = ''
      req.on('data', (c) => { raw += c })
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(raw || '{}')
          const action = parsed.action
          let arg = parsed.arg
          const sb = await sidebarHost()
          if (!sb) return json(res, { ok: false, error: 'sidebar-not-ready', action })
          const oc = await sb.orgContext()
          if (!oc) return json(res, { ok: false, seam: sb.seam, error: 'no-workspace', action })
          const { handle, ensureOpen } = oc
          const { getGithub, mainChecksFor, importGitWorkspace } = sb

          // The shell seats the card with the dsh conversation id
          // (`arxa-<id>`, stored on the registry row as dshSessionId), while
          // git-workspace only knows registry ids — handing the dsh id down
          // made card.commit / version.mint / insight.* answer "unknown
          // session" for every live seat (2026-09-02, flow 2 smoke). Resolve
          // ONCE here so every handler below sees a registry id; a bare
          // registry id passes through untouched.
          if (typeof arg?.sessionId === 'string' && arg.sessionId !== '') {
            const gw = await importGitWorkspace()
            const rows = gw.parkedSessions(handle().path)
            const hit = rows.find((s) => s.id === arg.sessionId) || rows.find((s) => s.dshSessionId === arg.sessionId) || null
            if (hit && hit.id !== arg.sessionId) arg = { ...arg, sessionId: hit.id }
          }

          /**
           * Publish a session's branch to its OWN repo's remote.
           *
           * D98: push the repo that actually HOLDS this branch. A project
           * session's `arxa/<identity>` exists only in the project repo and
           * its origin is the project's remote — pushing it from the org would
           * push a ref that is not there, to the wrong remote.
           *
           * Two callers, two temperaments: `card.push` is an explicit button so
           * it throws loudly (`loud`), while the stage boundary calls it as a
           * side effect and must never turn a landed commit into a failure —
           * there it returns a reason instead.
           */
          /** The published org repo behind the current handle. Throws the same
           * `org-not-published` the PR handlers use, so the card's error
           * vocabulary stays one word wide. */
          const orgRepoFor = async (cur) => {
            let manifest = {}
            try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
            if (!manifest.repoOwner || !manifest.repoName) throw new Error('org-not-published')
            return { owner: manifest.repoOwner, name: manifest.repoName }
          }

          /** Resolve the repo a run-control call must act on.
           * D98 again: a project session's workflow runs live in the PROJECT
           * repo, so reading the org manifest would re-run or cancel a run in
           * the wrong repository. Every neighbouring PR handler refuses a
           * project seat for exactly this reason; these do the same rather than
           * act confidently on the wrong remote. */
          const ciTarget = async () => {
            const g = await getGithub().catch(() => null)
            if (!g) throw new Error('github-unavailable')
            const runId = arg?.runId
            if (runId === undefined || runId === null || runId === '') throw new Error('runId-required')
            const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
            if (sid) {
              const gw = await importGitWorkspace()
              const s = gw.parkedSessions(handle().path).find((x) => x.id === sid)
              if (s && s.origin === 'project') throw new Error('project-session-pr-pending: run control for project repos lands in Phase 2')
            }
            const { owner, name } = await orgRepoFor(handle())
            return { g, owner, name, runId }
          }

          const pushSessionBranch = async (gw, cur, sid, { loud = false } = {}) => {
            const fail = (reason) => { if (loud) throw new Error(reason); return { ok: false, reason } }
            const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
            if (!s) return fail('session-not-found: ' + sid)
            const g = await getGithub().catch(() => null)
            if (!g) return fail('github-unavailable')
            const repoPath = s.repoPath ?? cur.path
            const origin = gw.getOrigin(repoPath)
            if (!origin) return fail('no-origin — connect this org to GitHub first')
            const urlFor = (creds) => origin.replace('https://', 'https://' + encodeURIComponent(creds.login) + ':' + creds.token + '@')
            let creds
            try { creds = await g.gitCredentials() } catch (err) { return fail(String(err?.message ?? err).slice(0, 120)) }
            // Non-interactive + bounded (2026-09-03, RESTO smoke): with a
            // rejected token git falls back to prompting for a password, and
            // runGit is synchronous — the prompt sat on the launcher's TTY for
            // six minutes with the entire engine frozen behind it. prflow.js
            // and repos.js already push this way; the card was the odd one out.
            const pushOpts = { cwd: repoPath, allowFail: true, timeout: 90_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
            let out = gw.runGit(['push', '-u', urlFor(creds), s.branch], pushOpts)
            if (out === null) {
              // Same hole the org sync had: git reports a dead token as text on
              // a non-zero exit, so nothing retries unless we ask. One forced
              // refresh, one retry — then report.
              try {
                const fresh = await g.gitCredentials(true)
                out = gw.runGit(['push', '-u', urlFor(fresh), s.branch], pushOpts)
              } catch { /* refresh unavailable — fall through to the failure */ }
            }
            return out !== null ? { ok: true, branch: s.branch } : fail('push-failed')
          }

          const table = {
            // ---- Part B S3: composer git card engine actions (Q1/Q2/Q6/
            // Q7/Q10 — docs/plans/git-card-part-b-grill.md). The card is
            // SEAT-AWARE: a sessionId resolves the session worktree + its
            // branch; without one it serves the org primary worktree. The
            // engine NEVER drafts messages (Q6): card.commit.draft returns
            // evidence only — the session model writes the subject.
            'card.status': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              let repoPath = cur.path
              let branch = 'main'
              let sessionRow = null
              if (sid) {
                // D98: a session id can live in the org registry OR any
                // project registry. `parkedSessions` merges every repo's
                // rows (each tagged with its owning `repoPath`); looking
                // only at the org registry made project sessions
                // unresolvable — "session-not-found" for work that exists.
                // The shell injects the dsh conversation id (`arxa-<id>`),
                // which the registry stores as `dshSessionId`; matching only
                // the bare `id` answered session-not-found for every live seat
                // and the client silently fell back to the org seat ("main")
                // (2026-09-02).
                sessionRow = gw.parkedSessions(cur.path).find((s) => s.id === sid || s.dshSessionId === sid) ?? null
                if (!sessionRow) throw new Error('session-not-found: ' + sid)
                repoPath = sessionRow.worktree
                branch = sessionRow.branch
              }
              // B1: a session worktree can be deleted out from under the
              // registry. `status --porcelain` then returns null, and the old
              // `?? ''` turned that into "no output" — which the counters below
              // read as CLEAN, so the card reported a worktree that no longer
              // exists as having nothing to commit. Ask health first, and never
              // report counts we did not actually measure.
              const health = gw.worktreeHealth(repoPath)
              const porcelain = health === 'ok'
                ? (gw.runGit(['status', '--porcelain'], { cwd: repoPath, allowFail: true }) ?? '')
                : ''
              let staged = 0; let unstaged = 0; let untracked = 0
              for (const line of porcelain.split('\n')) {
                if (!line) continue
                const x = line[0]; const y = line[1]
                if (line.startsWith('??')) untracked++
                else { if (x !== ' ' && x !== '?') staged++; if (y !== ' ' && y !== '?') unstaged++ }
              }
              let aheadBehind = null
              if (health === 'ok' && gw.runGit(['rev-parse', '-q', '--verify', 'origin/main'], { cwd: cur.path, allowFail: true }) !== null) {
                const c = gw.runGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], { cwd: repoPath, allowFail: true })
                if (c) { const [behind, ahead] = c.split(/\s+/).map(Number); aheadBehind = { ahead, behind } }
              }
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch { /* unreadable — plain status */ }
              const g = await getGithub().catch(() => null)
              const mainChecks = await mainChecksFor(cur.path, manifest, g, gw).catch(() => null)
              return {
                seat: { kind: sid ? 'session' : 'org', sessionId: sid, branch },
                // `health` is what the card must read before any count. When it
                // is not 'ok' the counts were never measured, so they are null
                // rather than zero — zero is a claim, and it would be a lie.
                health,
                dirty: health === 'ok' ? { staged, unstaged, untracked } : null,
                aheadBehind,
                // wipRun throws outright on a missing worktree, which used to
                // reject the whole card.status call; the client swallows that
                // and leaves stale numbers on screen.
                wipRun: health === 'ok' ? gw.wipRun(repoPath).length : null,
                chip: health === 'ok' ? gw.versionChip(repoPath) : null,
                linked: Boolean(manifest.repoUrl),
                localOnly: Boolean(manifest.localOnly),
                // `files` is the per-file state of the GENERATED frame. openOrg
                // upgrades a stale file on its own, but one a human edited comes
                // back `modified` and is deliberately left alone — without this
                // nobody could ever say so, and that repo would keep an old gate
                // forever while looking fine.
                frame: { wired: manifest.frameWired === true ? 'ok' : (manifest.frameWired ?? null), protection: manifest.frameProtection ?? null, runner: manifest.frameRunner ?? null, files: (() => { try { return gw.frameStatus(cur.path, 'org', { includeCiYml: true }) } catch { return null } })() },
                main: { checks: mainChecks?.state ?? null },
              }
            },
            /** Q6: EVIDENCE ONLY — the session model drafts the subject. */
            'card.commit.draft': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              const repoPath = sid
                ? (gw.parkedSessions(cur.path).find((s) => s.id === sid || s.dshSessionId === sid) ?? {}).worktree ?? cur.path
                : cur.path
              return {
                uncommittedStat: gw.runGit(['diff', '--stat'], { cwd: repoPath, allowFail: true }) ?? '',
                wipSubjects: gw.wipRun(repoPath).map((c) => c.subject),
                recentStageSubjects: gw.stageLog(repoPath).slice(0, 5).map((c) => c.subject),
                rule: '<type>(<scope>): <what is now true, in words a human would use> — types: ' + gw.SUBJECT_TYPES.join(' '),
              }
            },
            'card.commit': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const subject = String(arg?.subject ?? '').split('\n')[0].trim()
              if (!gw.SUBJECT_RE.test(subject)) throw new Error('subject-not-conventional: use <type>(<scope>): <what is now true> — got: ' + subject)
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (sid) {
                // Session seat: squash + gate + merge to main (Q2 local half).
                // The boundary's main push needs credentials on the URL — a
                // bare `origin` has none, and github-link is the only holder
                // (2026-09-03, RESTO smoke: unauthenticated push prompted on
                // the TTY and froze the engine; main sat ahead:1 of origin for
                // days). Best-effort: no link / no origin → null → the
                // boundary pushes bare `origin` non-interactively and reports
                // push-failed in the RESULT, never fatal to the commit.
                const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
                const repoPath = s?.repoPath ?? cur.path
                const pushUrl = await (async () => {
                  const origin = gw.getOrigin(repoPath)
                  if (!origin || !origin.startsWith('https://')) return null
                  const g = await getGithub().catch(() => null)
                  if (!g) return null
                  const creds = await g.gitCredentials().catch(() => null)
                  return creds ? origin.replace('https://', 'https://' + encodeURIComponent(creds.login) + ':' + creds.token + '@') : null
                })()
                if (pushUrl !== null) {
                  // Linked + credentialed repo → Phase 2 / D107 shape: the PR is
                  // the merge gate. Collapse the session's WIP run on the BRANCH,
                  // gate, push the branch; main is not touched until
                  // `card.pr.merge` (then `reconcileLocalMain` brings it in).
                  // The old shape ran the local boundary here — ff-merge to main
                  // AND push main — so every PR opened against a main that
                  // already held the commit: "No commits between main and
                  // arxa/<identity>" (RESTO #1-#3, 2026-09-03 smoke).
                  const { readySession } = await importPrflow()
                  const attribution = '— written by ' + String(arg?.model ?? 'the session model') + ' in arxa studio'
                  const r = readySession(repoPath, sid, { subject, attribution, origin: pushUrl })
                  if (r.reason === 'gate-red') {
                    // Same promise as the local boundary (D40): red parks, nothing is lost.
                    const parked = gw.parkSession(repoPath, sid, 'gate-red')
                    return { squashed: r.collapsed, sha: r.sha, gate: r.gate, merged: false, parked: true, session: parked, shape: 'prflow' }
                  }
                  return {
                    squashed: r.collapsed, sha: r.sha, gate: r.gate, merged: false, parked: false,
                    reason: r.reason ?? null, branch: r.branch,
                    pushed: r.push ? { ok: r.push.pushed, ...r.push } : { ok: false, reason: r.reason ?? 'not-pushed' },
                    shape: 'prflow',
                  }
                }
                // Unlinked / no credentials: local-only boundary (merge to main here).
                const out = gw.sessionStageBoundary(cur.path, sid, { message: subject, pushUrl })
                // Q6/Q7 (2026-09-03): a GREEN boundary publishes the session
                // branch, which is what makes frame-check run against it on
                // GitHub (ci.yml v4 watches arxa/**). A red boundary
                // parked the work — there is nothing to check, so nothing is
                // pushed. The push is ADVISORY: it never fails the commit, and
                // it never runs for an unlinked or local-only repo, so an
                // offline stage boundary behaves exactly as it did before.
                // Both real returns set `parked` explicitly (green:
                // {parked:false, merged:true}; red: {parked:true}), so test for
                // the exact green value rather than "not true" — a future
                // return that omits the field must not silently start pushing.
                // A merge conflict throws SessionMergeError and never gets here.
                if (out && out.parked === false) {
                  out.pushed = await pushSessionBranch(gw, cur, sid).catch((err) => ({ ok: false, reason: String(err?.message ?? err).slice(0, 120) }))
                }
                return out
              }
              // Org seat: squash on main + the same gate, parked=false only on green.
              // B3: this used to squash onto main and THEN gate, returning
              // `parked: true` on red while the commit sat on main regardless —
              // a gate that reported failure and prevented nothing. The session
              // path avoids it structurally: it squashes on a BRANCH and only
              // merges when green, so main is never touched by a red run.
              //
              // The org seat has no branch, so the equivalent is an explicit
              // rewind: remember where main was, and put it back if the gate
              // reds. `stageBoundarySquash` is commit-tree + update-ref, so
              // resetting to the recorded SHA restores the exact prior state —
              // the WIP run included. Nothing is lost, which is the same
              // promise parkSession makes on the session path (D40).
              const preSha = gw.runGit(['rev-parse', 'HEAD'], { cwd: cur.path, allowFail: true })
              const sq = gw.stageBoundarySquash(cur.path, { message: subject, trailer: 'Arxa-Stage: org' })
              const gate = gw.runGate(cur.path)
              if (!gate.green) {
                if (preSha) gw.runGit(['reset', '--hard', preSha], { cwd: cur.path, allowFail: true })
                return { ...sq, gate, merged: false, parked: true, rewound: Boolean(preSha) }
              }
              return { ...sq, gate, merged: true, parked: false, rewound: false }
            },
            /** Push the session branch for PR purposes ONLY (the D73
             * relaxation, Q2): main pushes ride boundaries/heal. */
            'card.push': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.push serves session seats — the org primary rides its boundaries')
              return pushSessionBranch(gw, cur, sid, { loud: true })
            },
            'card.pr.create': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.pr.create serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              // D98: a project session's branch and remote belong to the
              // PROJECT repo, but the PR below is built from the ORG manifest.
              // Before routing this seat was unreachable for project sessions
              // (the org registry had no such id, so it threw). Keep it loud
              // rather than silently filing an org-scoped PR for project work —
              // choosing the right manifest is Phase 2 (D102/D107).
              if (s.origin === 'project') throw new Error('project-session-pr-pending: PR flow for project repos lands in Phase 2')
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
              if (!manifest.repoOwner || !manifest.repoName) throw new Error('org-not-published')
              const title = String(arg?.title ?? '').trim()
              if (!gw.SUBJECT_RE.test(title)) throw new Error('title-not-conventional: the PR title becomes the squash-merge subject (Q7/Q8)')
              const attribution = '— written by ' + String(arg?.model ?? 'the session model') + ' in arxa studio'
              const body = [String(arg?.problem ?? ''), String(arg?.fix ?? ''), attribution].filter((x) => x !== '').join('\n\n')
              // file-pr rule 1: dedupe — update, never duplicate.
              const existing = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch).catch(() => [])
              if (Array.isArray(existing) && existing.length > 0) return { ok: true, existing: true, pr: { number: existing[0].number, url: existing[0].html_url } }
              const pr = await g.prCreate(manifest.repoOwner, manifest.repoName, { title, body, head: s.branch, base: 'main' })
              return { ok: true, pr: { number: pr.number, url: pr.html_url } }
            },
            'card.pr.status': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.pr.status serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              // D98: same as card.pr.create — the org manifest is the wrong
              // source for a project session's PR. Loud, not silently wrong.
              if (s.origin === 'project') throw new Error('project-session-pr-pending: PR flow for project repos lands in Phase 2')
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
              if (!manifest.repoOwner || !manifest.repoName) throw new Error('org-not-published')
              const prs = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch).catch(() => [])
              // Q8 (2026-09-03): checks are read for the BRANCH whether or not
              // a PR exists. Since ci.yml v4 watches arxa/**, a stage
              // boundary push runs frame-check with no PR attached — the card
              // used to read checks only through the PR head, so that run was
              // invisible and the card looked like nothing was happening.
              // prChecksApi takes any ref, so the branch name works directly.
              const noChecks = { state: 'unknown', asleep: false, runs: [] }
              const runsFor = async () => {
                try { return (await g.workflowRuns({ owner: manifest.repoOwner, name: manifest.repoName, branch: s.branch, perPage: 10 }))?.runs ?? [] } catch { return [] }
              }
              if (!Array.isArray(prs) || prs.length === 0) {
                const checks = await g.prChecks(manifest.repoOwner, manifest.repoName, s.branch).catch(() => noChecks)
                return { ok: true, pr: null, checks, runs: await runsFor(), branch: s.branch }
              }
              const pr = prs[0]
              const checks = await g.prChecks(manifest.repoOwner, manifest.repoName, pr.head?.sha ?? s.branch).catch(() => noChecks)
              return { ok: true, pr: { number: pr.number, url: pr.html_url, state: pr.state }, checks, runs: await runsFor(), branch: s.branch }
            },
            /** Q8: run control from the card. Both take the run id the status
              * call already surfaced, so the UI never has to guess one. */
            'card.ci.rerun': async () => {
              const { g, owner, name, runId } = await ciTarget()
              return g.rerunRun({ owner, name, runId, failedOnly: arg?.failedOnly === true })
            },
            'card.ci.cancel': async () => {
              const { g, owner, name, runId } = await ciTarget()
              return g.cancelRun({ owner, name, runId })
            },
            /** Stage comment on the session's PR (2026-09-03, RESTO 3-PR
              * smoke): `arxa · <stage>` + the engine's own result for that
              * stage, so the PR's comment trail is the evidence. Resolves the
              * PR from the session branch unless `number` is given. */
            'card.pr.comment': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.pr.comment serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch { /* unreadable — fails below as org-not-published */ }
              if (!manifest.repoOwner || !manifest.repoName) throw new Error('org-not-published')
              const stage = String(arg?.stage ?? '').trim()
              if (stage === '') throw new Error('stage-required')
              let number = Number.isInteger(arg?.number) ? arg.number : null
              if (number === null) {
                // Stage comments outlive the PR's open state: the 'merge' and
                // 'cleanup' stages land after the PR is merged/closed, so look
                // across all states and prefer open, then the newest.
                const prs = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch, 'all').catch(() => [])
                if (!Array.isArray(prs) || prs.length === 0) return { ok: false, reason: 'no-pr' }
                number = (prs.find((p) => p.state === 'open') ?? prs[0]).number
              }
              const detail = arg?.detail === undefined ? '' : (typeof arg.detail === 'string' ? arg.detail : '```json\n' + JSON.stringify(arg.detail, null, 2) + '\n```')
              const body = ['**arxa · ' + stage + '**', detail].filter((x) => x !== '').join('\n\n')
              const comment = await g.prComment(manifest.repoOwner, manifest.repoName, { number, body })
              return { ok: true, number, comment }
            },
            /** D116: merge-commit the reviewed PR, pinned to the sha the
              * checks were read from (D107) — never on anything but a fully
              * green run (asleep/pending/red/none all refuse, loud reason). */
            'card.pr.merge': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.pr.merge serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              if (s.origin === 'project') throw new Error('project-session-pr-pending: PR flow for project repos lands in Phase 2')
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
              if (!manifest.repoOwner || !manifest.repoName) throw new Error('org-not-published')
              const prs = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch).catch(() => [])
              if (!Array.isArray(prs) || prs.length === 0) return { ok: false, reason: 'no-pr' }
              const pr = prs[0]
              const checks = await g.prChecks(manifest.repoOwner, manifest.repoName, pr.head?.sha ?? s.branch).catch(() => ({ state: 'unknown', asleep: false, runs: [] }))
              if (checks.state !== 'green') return { ok: false, reason: 'checks-' + checks.state }
              // prflow.js has no other caller yet (D116) — imported directly
              // rather than through the index barrel, which does not re-export it.
              const { mergeSessionPr } = await importPrflow()
              const repoPath = s.repoPath ?? cur.path
              // Token-bearing URL for the post-merge fetch (D107 step 6): a bare
              // https origin would fall back to a TTY password prompt.
              const origin = await (async () => {
                const bare = gw.getOrigin(repoPath)
                if (!bare || !bare.startsWith('https://')) return bare
                const creds = await g.gitCredentials().catch(() => null)
                return creds ? bare.replace('https://', 'https://' + encodeURIComponent(creds.login) + ':' + creds.token + '@') : bare
              })()
              const result = await mergeSessionPr(repoPath, sid, {
                owner: manifest.repoOwner,
                name: manifest.repoName,
                number: pr.number,
                sha: pr.head?.sha ?? null,
                subject: pr.title,
                api: { prMerge: g.prMerge },
                origin,
              })
              return { ok: true, merged: result.merged, mergeSha: result.mergeSha, reconcile: result.reconcile }
            },
            /** D116: human-initiated "publish to client" — mint the next
              * semantic version into the session's own worktree (same target
              * `stageBoundarySquash` already uses inside sessionStageBoundary,
              * sessions.js:423), captured in one clean stage commit. */
            'version.mint': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('version.mint serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              const name = typeof arg?.name === 'string' && arg.name.trim() !== '' ? arg.name.trim() : undefined
              const state = typeof arg?.state === 'string' && arg.state.trim() !== '' ? arg.state.trim() : undefined
              const result = gw.mintAtStageBoundary(s.worktree, { name, state, env: process.env })
              return { ok: true, squashed: result.squashed, sha: result.sha, chip: result.chip }
            },
            /** D116/B8: wake the self-hosted runner for this org's linked
              * repo. A human action (runner.js:10-16) — never throws; the
              * client shows the manual `svc.sh start` instruction on ok:false. */
            'card.runner.wake': async () => {
              const cur = handle()
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
              if (!manifest.repoOwner || !manifest.repoName) return { ok: false, reason: 'unlinked' }
              const g = await getGithub().catch(() => null)
              if (!g) return { ok: false, reason: 'unlinked' }
              return g.ensureRunner(manifest.repoOwner, manifest.repoName)
            },
            /** A3: insight column, right-panel surfaces (D101/D105). Each
              * degrades to an 'unavailable' shape rather than throwing when
              * its backend export has not landed yet — a missing export
              * must never break the whole card. */
            'insight.streak': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('insight.streak serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              if (typeof gw.commitDays !== 'function') return { days: [], current: 0, longest: 0, reason: 'unavailable' }
              const repoPath = s.repoPath ?? cur.path
              return gw.commitDays(repoPath, { since: '90 days', env: process.env })
            },
            'insight.ci': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('insight.ci serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              if (!g || typeof g.workflowRuns !== 'function') return { runs: [], reason: 'unavailable' }
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch {}
              if (!manifest.repoOwner || !manifest.repoName) return { runs: [], reason: 'unavailable' }
              return g.workflowRuns({ owner: manifest.repoOwner, name: manifest.repoName, branch: s.branch, perPage: 20 })
            },
            'insight.sessions': async () => {
              const gw = await importGitWorkspace()
              const cur = arg?.orgId ? await ensureOpen(arg.orgId) : handle()
              return { rows: gw.parkedSessions(cur.path) }
            },
          }
          const fn = table[action]
          if (!fn) return json(res, { ok: false, error: 'unknown-action', action })
          const out = await fn()
          json(res, out !== undefined ? { ok: true, action, result: out } : { ok: true, action })
        } catch (e) {
          json(res, { ok: false, error: String(e?.message ?? e) })
        }
      })
    },
  })
}
