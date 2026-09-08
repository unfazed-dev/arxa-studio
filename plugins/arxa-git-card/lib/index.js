/**
 * arxa-git-card — host half (docs/plans/git-card-stock-dock-rebuild.md, A2).
 *
 * The Git card's engine actions, MOVED verbatim out of arxa-sidebar's action
 * table (2026-09-02): card.status / card.commit.draft / card.commit /
 * card.push / card.pr.create / card.pr.status / card.pr.merge /
 * version.mint / card.runner.wake / insight.streak / insight.review /
 * insight.sessions, plus insight.reply / insight.resolve. (`insight.ci` was
 * RETIRED by D4 — the review surface absorbed it; see that handler.)
 * One route on the same webServer pattern:
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

/* ---------------------------------------------------------------------------
 * The review surface (docs/plans/github-conversations-in-the-insight-panel.md)
 * ------------------------------------------------------------------------- */

/** D7: every comment the panel posts carries this, and only this, to say which
  * session wrote it. An HTML comment is invisible on github.com, so a reviewer
  * reads the human's words with no tooling chrome, while arxa can still thread
  * a comment back to its session — the same job the visible `Arxa-Session:`
  * trailer does on commits (git-workspace/lib/ledger.js). Authorship is NOT
  * disguised: the comment posts as the linked user, because the linked user
  * typed it. */
// The id class must allow `-`: every session id is hyphenated
// (`arxa-note-wt-260903-001`). An earlier `[^\s>-]+` here excluded it and
// silently matched nothing — caught by the selftest, not by reading.
const MARKER_RE = /\n*<!--\s*arxa-session:\s*([^\s>]+)\s*-->\s*$/
const sessionMarker = (sid) => '<!-- arxa-session: ' + sid + ' -->'
/** Strip the marker for display and report the session it named. */
export function readMarker(body) {
  const text = typeof body === 'string' ? body : ''
  const m = MARKER_RE.exec(text)
  return { body: m ? text.slice(0, m.index) : text, session: m ? m[1] : null }
}

const EMPTY_REVIEW = Object.freeze({
  pr: null, needs: [], reviews: [], threads: [], comments: [], issues: [], commitNotes: [], ci: [],
})

/** D5: fetch on open, reuse for 60s, manual refresh bypasses. Module scope and
  * deliberately unbounded in age but bounded in size — D101's rule is live from
  * the provider, never a persisted index. A write invalidates its own session's
  * entry so the repaint after a reply shows the reply. */
const REVIEW_TTL_MS = 60_000
const reviewCache = new Map()
/** Keyed by REPO + session, never the session alone. Session ids are minted per
  * workspace per day, so two organisations routinely hold the same id on the
  * same day — measured live on 2026-09-03, where `note-wt-260903-001` existed in
  * both RESTO and TESTO at once and took the engine down. A session-only key
  * would serve one org's pull-request conversation to the other for 60s. */
const reviewKey = (owner, name, sid) => owner + '/' + name + '#' + sid
/** A write knows its session but not always its repo (`insight.resolve` holds
  * only a thread id), so drop every repo's entry for that session rather than
  * guess one. Over-invalidating costs one refetch; under-invalidating shows a
  * reply that is not there. */
function invalidateReview(sid) {
  const suffix = '#' + sid
  for (const k of reviewCache.keys()) if (k.endsWith(suffix)) reviewCache.delete(k)
}

/** D3: what earns the top band. Everything here is something a person must act
  * on; everything else is history and falls through to its group. */
function needsYou(conv, ci, login) {
  const out = []
  const mention = login ? new RegExp('(^|[^\\w])@' + login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') : null
  for (const r of conv.reviews) {
    if (r.state === 'CHANGES_REQUESTED') out.push({ kind: 'changes-requested', by: r.login, url: r.url, at: r.createdAt })
  }
  for (const t of conv.threads) {
    if (!t.resolved && !t.outdated) {
      out.push({ kind: 'unresolved-thread', threadId: t.id, path: t.path, line: t.line, by: t.comments[0]?.login ?? null, url: t.comments[0]?.url ?? null, at: t.comments[0]?.createdAt ?? null })
    }
  }
  if (mention) {
    const every = [...conv.comments, ...conv.threads.flatMap((t) => t.comments), ...conv.issues.flatMap((i) => i.comments), ...conv.commitNotes]
    for (const c of every) {
      // Never flag the user's own words back at them.
      if (c.login !== login && mention.test(c.body)) out.push({ kind: 'mention', by: c.login, url: c.url, at: c.createdAt })
    }
  }
  for (const run of ci) {
    for (const j of run.jobs ?? []) {
      if (j.conclusion === 'failure') out.push({ kind: 'ci-failed', job: j.name, steps: j.failedSteps, url: j.url, at: run.createdAt })
    }
  }
  // Newest first inside the band; a null stamp sorts last rather than throwing.
  return out.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
}

/** The whole surface for one session: one GraphQL call for the conversation,
  * one REST call for the runs, one more for the newest run's jobs. Every leg is
  * allSettled — an org with no linked issues, no commit comments or no Actions
  * must render, not blank (plan: Degradation). */
async function reviewFor({ g, gw, owner, name, branch, sid, fresh }) {
  const key = reviewKey(owner, name, sid)
  const hit = reviewCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < REVIEW_TTL_MS) return hit.value
  const prs = await g.prListForHead(owner, name, branch, 'all').catch(() => [])
  const pr = Array.isArray(prs) ? (prs.find((p) => p.state === 'open') ?? prs[0]) : null
  if (!pr) {
    // Not an error: the session simply has no PR yet. The panel renders the
    // empty state that carries Create PR (D6 opens one on first push anyway).
    const value = { ...EMPTY_REVIEW, reason: 'no-pr' }
    reviewCache.set(key, { at: Date.now(), value })
    return value
  }
  const [conv, runs, who] = await Promise.allSettled([
    g.prConversation({ owner, name, number: pr.number }),
    typeof g.workflowRuns === 'function' ? g.workflowRuns({ owner, name, branch, perPage: 10 }) : Promise.resolve({ runs: [] }),
    typeof g.status === 'function' ? g.status() : Promise.resolve(null),
  ])
  const conversation = conv.status === 'fulfilled' && conv.value ? conv.value : { comments: [], reviews: [], threads: [], issues: [], commitNotes: [], number: pr.number, url: pr.html_url ?? null, title: null, state: null }
  const runList = (runs.status === 'fulfilled' ? runs.value?.runs : null) ?? []
  const login = (who.status === 'fulfilled' ? who.value?.login : null) ?? null
  // Only the newest run's jobs: older runs' step detail is history nobody acts
  // on, and each one is another request against the same rate limit.
  const newest = runList[0]
  const jobs = newest && typeof g.runJobs === 'function'
    ? await g.runJobs({ owner, name, runId: newest.id }).then((r) => r?.jobs ?? [], () => [])
    : []
  const ci = runList.map((r, i) => ({ ...r, jobs: i === 0 ? jobs : [] }))
  // D7: the marker is bookkeeping, never something a reader should see.
  const clean = (c) => { const { body, session } = readMarker(c.body); return { ...c, body, session } }
  const value = {
    pr: { number: conversation.number ?? pr.number, url: conversation.url ?? pr.html_url ?? null, title: conversation.title ?? pr.title ?? null, state: conversation.state ?? pr.state ?? null },
    login,
    reviews: conversation.reviews.map(clean),
    threads: conversation.threads.map((t) => ({ ...t, comments: t.comments.map(clean) })),
    comments: conversation.comments.map(clean),
    issues: conversation.issues.map((i) => ({ ...i, comments: i.comments.map(clean) })),
    commitNotes: conversation.commitNotes.map(clean),
    ci,
    needs: needsYou(conversation, ci, login),
    degraded: conv.status === 'rejected' ? 'conversation' : runs.status === 'rejected' ? 'ci' : null,
  }
  reviewCache.set(key, { at: Date.now(), value })
  return value
}

export function apply(ctx) {
  /** The in-flight device flow, or null. Plugin scope on purpose: the action
   * table below is rebuilt per REQUEST, so a per-table variable would dedupe
   * nothing. A second concurrent flow is not merely untidy — GitHub answers
   * competing polls on one client id with `slow_down` and caps verification
   * submissions at 50/hour/app, and github-link keeps exactly ONE
   * `lastDeviceCode` slot, so flow B would overwrite the code flow A is
   * showing on screen. */
  let linkInFlight = null

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
              const manifest = await repoFor(s)
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
            /* Publishedness is checked BEFORE the runId. A local-only org has
             * no runs to name, so demanding a runId first answered
             * 'runId-required' — true, and useless: it blames the caller for
             * omitting something that cannot exist. Resolving the repo first
             * reports 'project-not-published' / 'org-not-published', the same
             * strings repoFor already uses, so the surface says the one thing
             * a user can act on. */
            const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
            if (sid) {
              // A run belongs to the repo the SESSION lives in. Re-running or
              // cancelling against the org for a project seat would act on a
              // different repository's runs entirely.
              const gw = await importGitWorkspace()
              const s = gw.parkedSessions(handle().path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              const m = await repoFor(s)
              if (runId === undefined || runId === null || runId === '') throw new Error('runId-required')
              return { g, owner: m.repoOwner, name: m.repoName, runId }
            }
            const { owner, name } = await orgRepoFor(handle())
            if (runId === undefined || runId === null || runId === '') throw new Error('runId-required')
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
            if (out === null) return fail('push-failed')
            // D6: the push landed, so the branch exists on the remote and a PR
            // can reference it. Best-effort by construction — a refused PR is
            // reported alongside a push that genuinely succeeded, never raised
            // as a push failure.
            const opened = await autoOpenPr(gw, cur, sid)
            return { ok: true, branch: s.branch, pr: opened.ok ? opened.pr : null, prReason: opened.ok ? null : opened.reason }
          }

          /**
           * Record one stage of the session's life, then publish that record.
           *
           * Q14. Order matters: the REGISTRY write comes first and is the
           * thing that must not fail, because it is the record. The GitHub
           * half — refreshing the ledger table in the PR body and posting the
           * stage comment — is a rendering of it and is best-effort, so an
           * offline org, an unlinked repo, or a dead token still keeps a
           * complete history locally (CLAUDE.md: no feature may REQUIRE the
           * remote to work).
           */
          /**
           * Build and file the session's PR. ONE place does this, called by the
           * manual `card.pr.create` and by the D6 auto-open below — two code
           * paths producing subtly different PRs (a body without the ledger
           * fence, say) is exactly the drift this plan set out to remove.
           *
           * `title` must be conventional because it BECOMES the squash-merge
           * subject (Q7/Q8), and file-pr rule 1 is dedupe: an existing PR for
           * this head is returned, never duplicated. No `draft` — the recorded
           * t3ci rule is "no drafts" (git-card-sessions-worktree-rewire.md:585);
           * the ledger fenced into the body is what declares the stage instead,
           * and index.js re-renders it at every transition.
           */
          const openPr = async (gw, g, cur, s, sid, { title, problem, fix, model, effort }) => {
            const manifest = await repoFor(s)
            if (!gw.SUBJECT_RE.test(title)) throw new Error('title-not-conventional: the PR title becomes the squash-merge subject (Q7/Q8)')
            const attribution = '— written by ' + String(model ?? 'the session model') + ' in arxa studio'
            const actor = await authorLogin(s.repoPath ?? cur.path)
            const collaborator = gw.agentCollaborator(model, effort)
            // The ledger is fenced into the body at creation so every later
            // stage can rewrite that block in place instead of appending.
            const ledgerTable = gw.renderLedger(gw.readLedger(s.repoPath ?? cur.path, sid), { sessionId: sid, container: s.workspace, next: 'review' })
            const body = gw.withLedger(
              [String(problem ?? ''), String(fix ?? ''), attribution].filter((x) => x !== '').join('\n\n'),
              ledgerTable,
            )
            // file-pr rule 1: dedupe — update, never duplicate.
            const existing = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch).catch(() => [])
            if (Array.isArray(existing) && existing.length > 0) return { ok: true, existing: true, pr: { number: existing[0].number, url: existing[0].html_url } }
            const pr = await g.prCreate(manifest.repoOwner, manifest.repoName, { title, body, head: s.branch, base: 'main' })
            await noteStage(s.repoPath ?? cur.path, sid, { stage: 'review', author: actor, collaborator, detail: 'PR #' + pr.number + ' opened' }, { next: 'a human reviewer' })
            return { ok: true, pr: { number: pr.number, url: pr.html_url } }
          }

          /**
           * D6 — the session's PR opens on its FIRST push, not on demand.
           *
           * Called from the tail of pushSessionBranch and ONLY after it reports
           * ok:true, so the auth-retry path never reaches GitHub twice (that
           * path has a measured six-minute freeze on a rejected token). The
           * dedupe inside openPr makes it once-per-session: every later push
           * finds the PR and returns it untouched.
           *
           * The title is the branch's newest commit subject — the same string
           * that would become the squash subject anyway. A non-conventional
           * subject is NOT an error here: it means this session is not ready to
           * be titled automatically, so the auto-open declines and the card's
           * Create PR button stays the way in. Nothing this function does may
           * fail a push; the caller swallows the reason into the push result.
           */
          const autoOpenPr = async (gw, cur, sid) => {
            const g = await getGithub().catch(() => null)
            if (!g) return { ok: false, reason: 'unlinked' }
            const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
            if (!s) return { ok: false, reason: 'session-not-found' }
            const repoPath = s.repoPath ?? cur.path
            let subject = ''
            try {
              subject = String(gw.runGit(['log', '-1', '--pretty=%s', s.branch], { cwd: repoPath, allowFail: true }) ?? '').trim()
            } catch { return { ok: false, reason: 'no-commits' } }
            if (subject === '') return { ok: false, reason: 'no-commits' }
            if (!gw.SUBJECT_RE.test(subject)) return { ok: false, reason: 'title-not-conventional' }
            try {
              return await openPr(gw, g, cur, s, sid, { title: subject, problem: '', fix: '' })
            } catch (err) { return { ok: false, reason: String(err?.message ?? err).slice(0, 120) } }
          }

          /**
           * The GitHub repo a session's pull request belongs to.
           *
           * A PROJECT session's branch exists only in the project repo, and
           * that repo is where its ci.yml and its runner are wired — so its PR,
           * checks, comments and merge all belong there, not on the org. Every
           * caller used to read the ORG manifest unconditionally, which is why
           * project sessions were fenced off behind `project-session-pr-pending`
           * instead of simply working: the plumbing below is repo-agnostic, only
           * the lookup was wrong.
           */
          const repoFor = async (s) => {
            const fsm = await import('node:fs')
            const isProject = s?.origin === 'project' && typeof s?.repoPath === 'string'
            const file = isProject ? s.repoPath + '/project.json' : handle().path + '/org.json'
            let m = {}
            try { m = JSON.parse(fsm.readFileSync(file, 'utf8')) } catch { /* unreadable — fails just below */ }
            if (!m.repoOwner || !m.repoName) {
              throw new Error(isProject
                ? 'project-not-published: this project has no GitHub repo yet'
                : 'org-not-published')
            }
            return m
          }

          /** The acting identity as a GITHUB USERNAME (grilled 2026-09-03) —
            * `unfazed-dev`, never `Evan F Pierre Louis`. Read from the link's
            * own persisted login, NOT from org.json's `repoOwner`: on an
            * org-owned repo the owner is the organisation, not the person
            * acting.
            *
            * Falls back to the machine's user when there is no link at all, so
            * a local-only org still records who did the work — the CLAUDE.md
            * contract that every feature keeps full capability without a
            * remote. */
          const authorLogin = async (repoPath) => {
            const g = await getGithub().catch(() => null)
            const st = g && typeof g.status === 'function' ? await g.status().catch(() => null) : null
            if (st?.login) return st.login
            const gw = await importGitWorkspace()
            const cfg = gw.runGit(['config', 'user.name'], { cwd: repoPath, allowFail: true })
            if (cfg) return cfg
            try { return (await import('node:os')).userInfo().username } catch { return 'local' }
          }

          const noteStage = async (repoPath, sid, entry, { next } = {}) => {
            const gw = await importGitWorkspace()
            let ledger
            try {
              ledger = gw.recordStage(repoPath, sid, entry)
            } catch {
              return { recorded: false } // unknown session — never fail the caller's action
            }
            const published = await (async () => {
              try {
                const g = await getGithub().catch(() => null)
                if (!g) return false
                const cur = handle()
                const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
                if (!s) return false
                // Follows the SESSION's repo: a project session's PR lives in
                // the project, so its ledger must be published there too.
                const manifest = await repoFor(s).catch(() => null)
                if (!manifest) return false
                const prs = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch, 'all').catch(() => [])
                if (!Array.isArray(prs) || prs.length === 0) return false
                const pr = prs.find((p) => p.state === 'open') ?? prs[0]
                const table = gw.renderLedger(ledger, { sessionId: sid, container: s.workspace, next })
                await g.prUpdate(manifest.repoOwner, manifest.repoName, pr.number, { body: gw.withLedger(pr.body, table) }).catch(() => null)
                // The RECORDED row, not the entry handed in. `recordStage`
                // fills an absent result with 'ok' and stamps the time, so
                // building from the raw entry published a comment that was
                // missing both — the table said `ok`, the comment said nothing
                // (observed on RESTO #5, fixed 2026-09-03).
                const row = ledger[ledger.length - 1]
                await g.prComment(manifest.repoOwner, manifest.repoName, { number: pr.number, body: gw.stageComment(row) }).catch(() => null)
                return true
              } catch { return false }
            })()
            return { recorded: true, published, stages: ledger.length }
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
              // The fetch that makes "{n} behind" true (grilled 2026-09-03).
              // `aheadBehind` below reads `origin/main`, a ref that only moves
              // on a fetch — and the ONLY fetch in the tree ran after an in-app
              // merge. So a PR merged on github.com, or from another machine,
              // left this card claiming 0 behind indefinitely. Reconciling here
              // also fast-forwards LOCAL main, which the collapse in
              // `readySession` needs: it computes merge-base against local main.
              if (health === 'ok' && sessionRow) {
                const { reconcileLocalMain } = await importPrflow()
                try { await reconcileLocalMain(sessionRow.repoPath ?? cur.path) } catch { /* offline is not an error — the counts below just stay as they were */ }
              }
              let aheadBehind = null
              if (health === 'ok' && gw.runGit(['rev-parse', '-q', '--verify', 'origin/main'], { cwd: cur.path, allowFail: true }) !== null) {
                const c = gw.runGit(['rev-list', '--left-right', '--count', 'origin/main...HEAD'], { cwd: repoPath, allowFail: true })
                if (c) { const [behind, ahead] = c.split(/\s+/).map(Number); aheadBehind = { ahead, behind } }
              }
              // Would integrating conflict? Computed in memory, touching no
              // file — the automatic half of the integrate feature. `conflicts`
              // comes back null (never false) when git could not answer, and
              // the card shows no badge rather than a clean one: "we did not
              // check" and "there is no conflict" are different claims.
              let integrate = null
              if (health === 'ok' && sessionRow) {
                const repo = sessionRow.repoPath ?? cur.path
                const preview = gw.mergePreview(repo, sessionRow.branch)
                integrate = {
                  behind: preview.behind,
                  conflicts: preview.conflicts,
                  files: preview.files,
                  mode: preview.mode,
                  integrating: gw.isIntegrating(repoPath),
                }
              }
              let manifest = {}
              try { manifest = JSON.parse((await import('node:fs')).readFileSync(cur.path + '/org.json', 'utf8')) } catch { /* unreadable — plain status */ }
              /* D98/D99: an org and a project each own a repo, and a project
               * seat's link state lives in its OWN project.json — the same
               * selection repoFor() makes for the actions. card.status read
               * org.json unconditionally, so it described the WRONG repo for
               * every project session: a published project inside a local-only
               * org came back linked:false / localOnly:true, and the client
               * hides the whole PR + CI section on `linked && !localOnly`.
               * Status and the actions disagreed — repoFor would find the
               * project's repo for a button the card never drew.
               * D91: a project with no link of its own INHERITS the org's
               * local-only flag; reading project.json alone would drop the
               * badge for the ordinary local-only project, which has neither
               * field set. Inherit only when the project is genuinely
               * unlinked — a published project is not local-only whatever its
               * org says. */
              const seatIsProject = sessionRow?.origin === 'project' && typeof sessionRow.repoPath === 'string'
              const seatRepoPath = seatIsProject ? sessionRow.repoPath : cur.path
              const seatKind = seatIsProject ? 'project' : 'org'
              let seatManifest = manifest
              if (seatIsProject) {
                seatManifest = {}
                try { seatManifest = JSON.parse((await import('node:fs')).readFileSync(sessionRow.repoPath + '/project.json', 'utf8')) } catch { /* unreadable — unlinked, and it inherits below */ }
              }
              const seatLinked = Boolean(seatManifest.repoUrl)
              const seatLocalOnly = seatManifest.localOnly === true || (!seatLinked && manifest.localOnly === true)
              const g = await getGithub().catch(() => null)
              // Checks belong to the seat's OWN repo: for a project session
              // the org's main-branch checks describe a different repository.
              const mainChecks = await mainChecksFor(seatRepoPath, seatManifest, g, gw).catch(() => null)
              // F8 (2026-09-04): when GitHub revokes the grant, every push and
              // PR on this card fails with a bare 401 and nothing says why or
              // what to do. github-link records relinkRequired; the card is the
              // surface where the user actually meets the failure, so the flag
              // has to reach here — the sidebar's org modal is not where anyone
              // is standing when a push dies.
              const ghState = await (g ? g.status().catch(() => null) : null)
              // D113: whether Finish would be accepted, answered by
              // finishSession's OWN dryRun rather than a second opinion. A
              // separately computed gate can drift from what the action does;
              // this cannot, and its `reason` ('not-merged' | 'worktree-dirty')
              // is what the dark button says instead of going mute.
              // D40: a parked session is never deleted, so Finish is not
              // offered on one at all — not merely disabled.
              let finish = null
              if (sessionRow && sessionRow.state !== 'parked' && health === 'ok') {
                try {
                  const dry = gw.finishSession(cur.path, sessionRow.id, { env: process.env, dryRun: true })
                  finish = { can: dry.wouldFinish === true, reason: dry.reason ?? null }
                } catch (err) { finish = { can: false, reason: String(err?.message ?? err) } }
              }
              return {
                finish,
                seat: { kind: sid ? 'session' : 'org', sessionId: sid, branch },
                github: { relinkRequired: ghState?.relinkRequired === true },
                // `health` is what the card must read before any count. When it
                // is not 'ok' the counts were never measured, so they are null
                // rather than zero — zero is a claim, and it would be a lie.
                health,
                dirty: health === 'ok' ? { staged, unstaged, untracked } : null,
                aheadBehind,
                integrate,
                // wipRun throws outright on a missing worktree, which used to
                // reject the whole card.status call; the client swallows that
                // and leaves stale numbers on screen.
                wipRun: health === 'ok' ? gw.wipRun(repoPath).length : null,
                chip: health === 'ok' ? gw.versionChip(repoPath) : null,
                linked: seatLinked,
                localOnly: seatLocalOnly,
                // `files` is the per-file state of the GENERATED frame. openOrg
                // upgrades a stale file on its own, but one a human edited comes
                // back `modified` and is deliberately left alone — without this
                // nobody could ever say so, and that repo would keep an old gate
                // forever while looking fine.
                // Same seat rule as linked/localOnly: a project session's
                // frame is the PROJECT's (frameStatus has taken a 'project'
                // kind all along — only this call never passed it).
                frame: { wired: seatManifest.frameWired === true ? 'ok' : (seatManifest.frameWired ?? null), protection: seatManifest.frameProtection ?? null, runner: seatManifest.frameRunner ?? null, files: (() => { try { return gw.frameStatus(seatRepoPath, seatKind, { includeCiYml: true }) } catch { return null } })() },
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
                  const model = String(arg?.model ?? 'the session model')
                  const actor = await authorLogin(repoPath)
                  const collaborator = gw.agentCollaborator(model, arg?.effort)
                  const attribution = '— written by ' + model + ' in arxa studio'
                  // Q14: the author and the collaborator ride the commit itself,
                  // so the record survives without GitHub, the PR, or this tool.
                  const r = readySession(repoPath, sid, {
                    subject, attribution, author: actor, collaborator, origin: pushUrl,
                  })
                  if (r.reason === 'integrate-conflict') {
                    // main was brought in first and it conflicted. The merge is
                    // LEFT OPEN for the agent in that worktree to resolve; the
                    // branch was neither collapsed nor pushed.
                    return { squashed: false, sha: null, gate: r.gate, merged: false, conflicted: true, files: r.files ?? [], onto: r.onto ?? null, reason: 'integrate-conflict', shape: 'prflow' }
                  }
                  if (r.reason === 'gate-red') {
                    // Same promise as the local boundary (D40): red parks, nothing is lost.
                    const parked = gw.parkSession(repoPath, sid, 'gate-red')
                    await noteStage(repoPath, sid, { stage: 'gate', author: actor, collaborator, result: 'red', sha: r.sha, detail: 'parked — nothing is lost, the collapsed commit stays on the branch' }, { next: actor + ' — fix the gate and re-commit' })
                    return { squashed: r.collapsed, sha: r.sha, gate: r.gate, merged: false, parked: true, session: parked, shape: 'prflow' }
                  }
                  if (r.sha) {
                    await noteStage(repoPath, sid, { stage: 'committed', author: actor, collaborator, sha: r.sha, detail: subject })
                    await noteStage(repoPath, sid, { stage: 'gate', author: actor, collaborator, result: r.gate?.green ? 'green' : 'skipped', sha: r.sha })
                    if (r.push?.pushed) await noteStage(repoPath, sid, { stage: 'pushed', author: actor, collaborator, sha: r.sha, detail: r.branch }, { next: 'CI on ' + r.branch })
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
              return openPr(gw, g, cur, s, sid, {
                title: String(arg?.title ?? '').trim(),
                problem: arg?.problem, fix: arg?.fix, model: arg?.model, effort: arg?.effort,
              })
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
              const manifest = await repoFor(s)
              // 'all', not the default 'open' (2026-09-06, found by the live
              // card smoke). The approve row has THREE states — an open PR
              // shows Merge, a MERGED one shows Mint, neither shows Create
              // PR — but listing only open PRs meant the row went straight
              // from Merge to "no PR" the instant a merge landed. The Mint
              // branch could therefore never render at all. card.pr.comment
              // already reasons this way, for the same reason ("stage
              // comments outlive the PR's open state").
              const prs = await g.prListForHead(manifest.repoOwner, manifest.repoName, s.branch, 'all').catch(() => [])
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
              const pr = prs.find((p) => p.state === 'open') ?? prs[0]
              const checks = await g.prChecks(manifest.repoOwner, manifest.repoName, pr.head?.sha ?? s.branch).catch(() => noChecks)
              // Record a SETTLED result only, and only when it differs from the
              // last one recorded. card.pr.status is polled — every 15s in the
              // smoke — so recording each call would bury the ledger under
              // forty identical "pending" rows and post forty comments.
              if (checks?.state === 'green' || checks?.state === 'red') {
                const gwl = await importGitWorkspace()
                const seen = gwl.readLedger(s.repoPath ?? cur.path, sid).filter((e) => e.stage === 'checks')
                if (seen[seen.length - 1]?.result !== checks.state) {
                  await noteStage(s.repoPath ?? cur.path, sid, {
                    stage: 'checks', author: 'github-actions[bot]', result: checks.state, sha: pr.head?.sha ?? null,
                  }, { next: checks.state === 'green' ? 'merge when reviewed' : 'fix the failing check' })
                }
              }
              // GitHub's PR state is only open|closed — never 'merged' — so
              // the merged signal has to be carried explicitly or the client's
              // prMerged branch (and with it Mint) stays dead.
              return { ok: true, merged: Boolean(pr.merged_at), pr: { number: pr.number, url: pr.html_url, state: pr.state }, checks, runs: await runsFor(), branch: s.branch }
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
            /** Bring main into the session's worktree (grilled 2026-09-03).
              * The MANUAL half — nothing calls this on its own. A conflict is
              * left open on purpose: the agent working in that worktree is what
              * resolves it, and aborting would put the user back exactly where
              * they started. */
            'card.integrate': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.integrate serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              const repoPath = s.repoPath ?? cur.path
              return gw.integrateMain(s, {
                author: await authorLogin(repoPath),
                collaborator: gw.agentCollaborator(arg?.model, arg?.effort),
                origin: gw.getOrigin(repoPath) ?? undefined,
              })
            },
            /** Conclude a merge whose conflicts have been resolved. Refuses
              * while a tracked file still carries a marker — git alone commits
              * a staged `<<<<<<<` without complaint, and the breakage would
              * resurface later as a baffling gate failure. */
            /** D113: end of life for a session — remove the worktree, delete
              * the branch, keep the record. finishSession refuses unless the
              * branch is merged into main AND the worktree is clean, so this
              * route adds no gate of its own: it calls the same function the
              * card's dark/enabled state was computed from. D40 keeps parked
              * sessions out (the card never offers the button there). */
            'card.finish': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.finish serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid || x.dshSessionId === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              if (s.state === 'parked') throw new Error('parked-never-deleted: ' + sid)
              return gw.finishSession(cur.path, s.id, { env: process.env })
            },
            'card.integrate.finish': async () => {
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('card.integrate.finish serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              return gw.finishIntegrate(s, {
                author: await authorLogin(s.repoPath ?? cur.path),
                collaborator: gw.agentCollaborator(arg?.model, arg?.effort),
              })
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
              const manifest = await repoFor(s)
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
              // ONE builder, shared with the automatic path. Before this the
              // manual action emitted stage + detail only, so a hand-triggered
              // comment silently lost author, result, sha and the timestamp
              // that its automatic twin carried.
              const body = gw.stageComment({
                stage,
                author: arg?.author ?? await authorLogin(s.repoPath ?? cur.path),
                collaborator: gw.agentCollaborator(arg?.model, arg?.effort),
                result: arg?.result ?? null,
                sha: arg?.sha ?? null,
                detail: detail === '' ? null : detail,
                ...gw.stageTime(),
              })
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
              const manifest = await repoFor(s)
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
              if (result.merged) {
                await noteStage(repoPath, sid, {
                  stage: 'merged', author: await authorLogin(s.repoPath ?? cur.path), sha: result.mergeSha,
                  detail: 'PR #' + pr.number + ' merged with --no-ff onto the reviewed sha',
                }, { next: 'archive the session' })
              }
              if (!result.merged) {
                // Same vocabulary as the `checks-*` and `no-pr` refusals above:
                // a conflict is a "not yet, and here is why", not an error.
                return { ok: false, merged: false, reason: result.reason ?? 'not-merged', message: result.message ?? '' }
              }
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
            /** G6 (grilled 2026-09-06): the card's own re-link door. When
              * GitHub revokes the grant, every push, PR and merge here dies
              * with `github-unavailable` — and the card is the surface the
              * user is standing on when it happens, so the recovery has to be
              * reachable from it rather than only from the sidebar's org
              * modal. Same pair the sidebar serves at account level, on the
              * card's one route: `link` LONG-POLLS until GitHub confirms the
              * device flow (no timeout on this route — the sidebar's identical
              * call has always worked this way), and `device` is polled
              * meanwhile for the one-time code to put on screen. No early
              * placement needed, unlike the sidebar's: the card renders
              * nothing without an open org, so the guard above is never in
              * the way. */
            'card.github.link': async () => {
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              // A second caller JOINS the running flow instead of starting a
              // competing one (see linkInFlight above).
              if (linkInFlight === null) {
                linkInFlight = Promise.resolve(g.link()).finally(() => { linkInFlight = null })
              }
              return linkInFlight
            },
            'card.github.device': async () => {
              const g = await getGithub().catch(() => null)
              if (!g) throw new Error('github-unavailable')
              return typeof g.deviceCode === 'function' ? g.deviceCode() : null
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
            /** D4: the review surface ABSORBED the retired `insight.ci` view.
              * There is no `insight.ci` action any more — its workflow-run read
              * lives in the `ci` group below, so two surfaces can never disagree
              * about the same runs. The CI *verbs* were never here: `ci-rerun` /
              * `ci-cancel` / `ci-open` sit on the card header
              * (`client.js:511-513` → `card.ci.rerun` / `card.ci.cancel`), so
              * retiring the view removed a reader and no verb. */
            'insight.review': async () => {
              const gw = await importGitWorkspace()
              const g = await getGithub().catch(() => null)
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) throw new Error('insight.review serves session seats')
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) throw new Error('session-not-found: ' + sid)
              if (!g || typeof g.prConversation !== 'function') return { ...EMPTY_REVIEW, reason: 'unavailable' }
              const manifest = await repoFor(s).catch(() => null)
              if (!manifest?.repoOwner || !manifest?.repoName) return { ...EMPTY_REVIEW, reason: 'unavailable' }
              return reviewFor({ g, gw, owner: manifest.repoOwner, name: manifest.repoName, branch: s.branch, sid, fresh: arg?.fresh === true })
            },
            /** D1 + D3: the human's own words, never the card's.
              *
              * Named `insight.*`, not `review.*`, because the action PREFIX is
              * the route: the selftest harness dispatches
              * /^(card|insight|version)\./ to this host and everything else to
              * the sidebar's. The viewer's own router disagrees (it sends all
              * but `agent.*` here), and a verb that only works through one of
              * two routers is a bug waiting for whichever caller comes second. Both write
              * verbs refuse rather than guess, and the panel repaints from the
              * refetch they force — a reply that appears without having landed
              * is worse than a slow one. */
            'insight.reply': async () => {
              const g = await getGithub().catch(() => null)
              if (!g) return { ok: false, reason: 'unlinked' }
              const gw = await importGitWorkspace()
              const cur = handle()
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              if (!sid) return { ok: false, reason: 'session-required' }
              const s = gw.parkedSessions(cur.path).find((x) => x.id === sid)
              if (!s) return { ok: false, reason: 'session-not-found' }
              const text = typeof arg?.text === 'string' ? arg.text.trim() : ''
              if (text === '') return { ok: false, reason: 'message-required' }
              const manifest = await repoFor(s).catch(() => null)
              if (!manifest?.repoOwner || !manifest?.repoName) return { ok: false, reason: 'unlinked' }
              const number = Number(arg?.number)
              if (!Number.isFinite(number)) return { ok: false, reason: 'pr-required' }
              const body = text + '\n\n' + sessionMarker(sid)
              const owner = manifest.repoOwner
              const name = manifest.repoName
              let out
              try {
                // A thread reply is addressed to the thread's FIRST comment;
                // a bare PR comment has no parent. Two endpoints, one verb.
                // NB the two call shapes differ — `prComment` takes owner/name
                // POSITIONALLY (github-link/lib/index.js:349) while the newer
                // `prThreadReply` is a single options object.
                out = arg?.commentId
                  ? await g.prThreadReply({ owner, name, number, commentId: arg.commentId, body })
                  : await g.prComment(owner, name, { number, body })
              } catch (err) { return { ok: false, reason: String(err?.message ?? err).slice(0, 160) } }
              invalidateReview(sid)
              return { ok: true, id: out?.id ?? null, url: out?.url ?? null }
            },
            'insight.resolve': async () => {
              const g = await getGithub().catch(() => null)
              if (!g || typeof g.setThreadResolved !== 'function') return { ok: false, reason: 'unlinked' }
              const threadId = typeof arg?.threadId === 'string' && arg.threadId !== '' ? arg.threadId : null
              if (!threadId) return { ok: false, reason: 'thread-required' }
              const sid = typeof arg?.sessionId === 'string' && arg.sessionId !== '' ? arg.sessionId : null
              let out
              try { out = await g.setThreadResolved({ threadId, resolved: arg?.resolved !== false }) }
              catch (err) { return { ok: false, reason: String(err?.message ?? err).slice(0, 160) } }
              if (sid) invalidateReview(sid)
              return { ok: true, resolved: out?.resolved === true }
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
