/**
 * github-link frame API (Part B S1) — the REST half of the arxa CI frame:
 * squash-only repo settings, branch protection (with the measured
 * free-plan 403 classified as plan-limited, S0 V1), runner registration
 * tokens, and the latest actions/runner release asset for bootstrapping a
 * self-hosted runner (Q5 canon labels).
 *
 * Pure functions over injectable fetch — the service in index.js adds the
 * token + 401-refresh-retry wrapper, exactly like createPrivateRepo.
 */

/** Lock the repo to squash-merge only (Q8 — policy made structural). */
export async function settingsApi({ owner, name, payload, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name, apiBase), {
    method: 'PATCH',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('github-link: settings PATCH failed (' + res.status + ')')
  return res.json()
}

/** Protect main: strict, required frame checks. A 403 whose body names the
 * plan upgrade is NOT an error — it is the measured free-plan state
 * (S0 V1); returned as { planLimited: true } so callers record it. */
export async function protectionApi({ owner, name, payload, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/branches/main/protection', apiBase), {
    method: 'PUT',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(payload),
  })
  if (res.status === 403) {
    const body = await res.json().catch(() => ({}))
    const msg = String(body.message ?? '')
    if (msg.includes('GitHub Pro') || msg.includes('make this repository public')) {
      return { planLimited: true }
    }
  }
  if (!res.ok) throw new Error('github-link: protection PUT failed (' + res.status + ')')
  return { planLimited: false }
}

/** Short-lived runner registration token (S0 V1: 201 under plain repo scope). */
export async function registrationTokenApi({ owner, name, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/actions/runners/registration-token', apiBase), {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error('github-link: runner registration-token failed (' + res.status + ')')
  const body = await res.json()
  return body.token
}

/** Open a PR (Q1 v1). head = the session branch, base = main. Returns PR json. */
export async function prCreateApi({ owner, name, title, body, head, base = 'main', accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls', apiBase), {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ title, body, head, base, draft: false }),
  })
  if (!res.ok) {
    // Surface GitHub's own reason (e.g. "No commits between main and <head>")
    // — the bare status hid the 2026-09-03 RESTO smoke failure for an hour.
    let detail = ''
    try {
      const j = await res.json()
      const errs = Array.isArray(j.errors) ? j.errors.map((e) => e?.message ?? e?.code).filter(Boolean).join('; ') : ''
      detail = [j.message, errs].filter(Boolean).join(': ')
    } catch { /* non-JSON body — status alone */ }
    throw new Error('github-link: PR create failed (' + res.status + (detail ? ': ' + detail : '') + ')')
  }
  return res.json()
}

/**
 * List PRs for a head branch (dedupe before creating — file-pr rule 1).
 * `state` defaults to 'open' (create-time dedupe must ignore merged/closed
 * PRs); stage comments after merge/close pass 'all' so the trail still
 * lands on the PR the session actually shipped through. Newest first.
 */
export async function prListForHeadApi({ owner, name, head, accessToken, fetch, apiBase, state = 'open' }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls?head=' + owner + ':' + head + '&state=' + state + '&sort=created&direction=desc', apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
    },
  })
  if (!res.ok) throw new Error('github-link: PR list failed (' + res.status + ')')
  return res.json()
}

/**
 * Merge a PR with a real merge commit (D107 — SUPERSEDES prSquashMergeApi).
 *
 * The session branch is already collapsed to ONE commit before the human
 * reviews, so a plain merge lands clean history AND real ancestry:
 * `branch --merged` lists it, `--is-ancestor` is true, ahead/behind counts
 * tell the truth, and a revived session no longer re-proposes its own
 * landed work. GitHub's own docs: the default merge option merges with
 * `--no-ff`.
 *
 * Body fields per the official reference — "Merge a pull request",
 * PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge:
 * https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
 *   - `merge_method`: 'merge' | 'squash' | 'rebase' (defaults to 'merge')
 *   - `sha`: SHA that the PR head MUST match for the merge to proceed —
 *     GitHub answers 409 if the head moved since the human reviewed it.
 *     This is the whole point of sending it: review and merge are pinned
 *     to the same commit.
 *   - `commit_title` / `commit_message`: the merge commit's message.
 *
 * NOTE the response `sha` is the MERGE commit, not the head we sent.
 *
 * @returns {{ merged: boolean, sha: string|null, message: string }}
 */
export async function prMergeApi({ owner, name, number, sha, subject, message, accessToken, fetch, apiBase }) {
  const body = { merge_method: 'merge' }
  if (sha) body.sha = sha
  if (subject) body.commit_title = subject
  if (message) body.commit_message = message
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls/' + number + '/merge', apiBase), {
    method: 'PUT',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(body),
  })
  // 409 is the head-moved guard firing — name it, do not swallow it as a
  // generic failure: the caller must re-ready and re-review, not retry.
  if (res.status === 409) throw new Error('github-link: PR merge refused — the head moved since review (409)')
  // 405 is GitHub's "Pull Request is not mergeable" — in practice a conflict
  // with the base branch (also draft, or blocked). It is an ordinary,
  // actionable state, not a crash: another session landed first and this
  // branch has to take main in before it can go. Returning a named reason
  // rather than throwing keeps it in the same vocabulary the caller already
  // uses for "not yet" (`checks-red`, `no-pr`) — measured 2026-09-03 on
  // kitchen-project #3, where it surfaced to the user as the bare string
  // "PR merge failed (405)".
  if (res.status === 405) {
    const out = await res.json().catch(() => ({}))
    return { merged: false, sha: null, message: out.message ?? '', reason: 'not-mergeable' }
  }
  if (!res.ok) throw new Error('github-link: PR merge failed (' + res.status + ')')
  const out = await res.json().catch(() => ({}))
  return { merged: out.merged === true, sha: out.sha ?? null, message: out.message ?? '' }
}

/**
 * Post a stage comment on a PR (2026-09-03, RESTO 3-PR smoke). PRs are
 * issues for comment purposes — "Create an issue comment",
 * POST /repos/{owner}/{repo}/issues/{issue_number}/comments:
 * https://docs.github.com/en/rest/issues/comments#create-an-issue-comment
 * The card posts one per arxa stage (commit / ci / merge / cleanup) so the
 * PR's comment trail is the engine's own evidence of what happened.
 *
 * @returns {{ id: number|null, url: string|null }}
 */
/**
 * Rewrite a pull request's body (Q14 ledger refresh).
 *
 * PATCH, not POST: the ledger is re-rendered at every stage, and appending a
 * fresh copy as a comment each time would bury the conversation under nine
 * near-identical tables by the time the PR merges.
 */
export async function prUpdateApi({ owner, name, number, body, accessToken, fetch, apiBase }) {
  if (typeof body !== 'string') throw new Error('github-link: PR body must be a string')
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls/' + number, apiBase), {
    method: 'PATCH',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('github-link: PR update failed (' + res.status + ')')
  const out = await res.json().catch(() => ({}))
  return { number: out.number ?? number, url: out.html_url ?? null }
}

export async function prCommentApi({ owner, name, number, body, accessToken, fetch, apiBase }) {
  if (typeof body !== 'string' || body.trim() === '') throw new Error('github-link: PR comment body is required')
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/issues/' + number + '/comments', apiBase), {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) throw new Error('github-link: PR comment failed (' + res.status + ')')
  const out = await res.json().catch(() => ({}))
  return { id: out.id ?? null, url: out.html_url ?? null }
}

/**
 * Read a PR's live state (D107 — Finish/Sweep and the card read this).
 * GET /repos/{owner}/{repo}/pulls/{pull_number}
 * https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
 *
 * `head.sha` is nested in the payload; it is flattened to `head_sha` here
 * so callers never reach through a possibly-absent `head` object.
 *
 * @returns {{ merged: boolean, state: string|null, mergeable_state: string|null, head_sha: string|null, number: number|null }}
 */
export async function prStateApi({ owner, name, number, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls/' + number, apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error('github-link: PR read failed (' + res.status + ')')
  const pr = await res.json()
  return {
    merged: pr.merged === true,
    state: pr.state ?? null,
    mergeable_state: pr.mergeable_state ?? null,
    head_sha: pr.head?.sha ?? null,
    number: pr.number ?? null,
  }
}

/**
 * DEPRECATED (D107): squash-merge leaves the branch's commits out of
 * main's ancestry, which breaks `branch --merged`, `branch -d`,
 * `--is-ancestor`, ahead/behind counts, and makes a revived session
 * conflict against its own landed work. Use `prMergeApi` — the branch is
 * collapsed locally before review, so a plain merge gives clean history
 * without losing ancestry. Kept exported only so no import breaks; it has
 * no callers and must not gain one.
 */
export async function prSquashMergeApi({ owner, name, number, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls/' + number + '/merge', apiBase), {
    method: 'PUT',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'content-type': 'application/json',
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ merge_method: 'squash' }),
  })
  if (!res.ok) throw new Error('github-link: PR squash merge failed (' + res.status + ')')
  return res.json().catch(() => ({}))
}

/** Combined checks for a ref, with queued-not-running classified as
 *  runner-asleep (the canon: wake it, never fix code). */
export async function prChecksApi({ owner, name, ref, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/commits/' + encodeURIComponent(ref) + '/check-runs', apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error('github-link: check-runs failed (' + res.status + ')')
  const body = await res.json()
  const runs = (body.check_runs ?? []).map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion ?? null,
    asleep: r.status === 'queued',
  }))
  const state = runs.length === 0 ? 'none' : runs.some((r) => r.conclusion === 'failure') ? 'red' : runs.every((r) => r.conclusion === 'success') ? 'green' : 'pending'
  return { state, asleep: runs.some((r) => r.asleep), runs }
}

/**
 * Recent workflow runs for a branch (phase 4 A3 insight surface, D101 —
 * live from the provider, no persisted history). GitHub REST "List
 * workflow runs for a repository":
 * https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-repository
 * GET /repos/{owner}/{repo}/actions/runs?branch=&per_page=
 *
 * Mirrors prChecksApi's url/header/error shape. `asleep` reuses the same
 * queued-not-running classification as prChecksApi (S0 V1 canon: wake it,
 * never fix code).
 *
 * @returns {{ runs: {id:number, name:string, status:string, conclusion:string|null, createdAt:string, url:string, headSha:string, asleep:boolean}[] }}
 */
export async function workflowRunsApi({ owner, name, branch, perPage = 20, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/actions/runs?branch=' + encodeURIComponent(branch) + '&per_page=' + perPage, apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error('github-link: workflow runs failed (' + res.status + ')')
  const body = await res.json()
  const runs = (body.workflow_runs ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion ?? null,
    createdAt: r.created_at,
    url: r.html_url,
    headSha: r.head_sha,
    asleep: r.status === 'queued',
  }))
  return { runs }
}

/**
 * Q8 (2026-09-03): run control from the git card — re-run and cancel.
 * Both are plain POSTs that return 201/202 with an EMPTY body, so success is
 * the status alone; there is nothing to parse.
 * https://docs.github.com/en/rest/actions/workflow-runs
 *
 * `rerunFailedOnly` targets /rerun-failed-jobs, which re-runs just the failed
 * jobs of a run rather than the whole thing — cheaper on a self-hosted runner.
 */
export async function rerunRunApi({ owner, name, runId, failedOnly = false, accessToken, fetch, apiBase }) {
  const leaf = failedOnly ? 'rerun-failed-jobs' : 'rerun'
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/actions/runs/' + encodeURIComponent(runId) + '/' + leaf, apiBase), {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  // 403 here is usually "this run is not re-runnable yet" (still in progress),
  // which is a state answer, not an auth problem — say so rather than sending
  // the user to re-link.
  if (!res.ok) throw new Error('github-link: workflow rerun failed (' + res.status + ')')
  return { ok: true, runId, failedOnly }
}

/** Request cancellation of an in-flight run. 202 = accepted; the run settles
 *  as `cancelled` once the runner actually stops. */
export async function cancelRunApi({ owner, name, runId, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/actions/runs/' + encodeURIComponent(runId) + '/cancel', apiBase), {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  // 409 = already finished; that is not an error the user can act on.
  if (res.status === 409) return { ok: true, runId, outcome: 'already-finished' }
  if (!res.ok) throw new Error('github-link: workflow cancel failed (' + res.status + ')')
  return { ok: true, runId, outcome: 'cancellation-requested' }
}

/** The osx-arm64 tarball URL of the latest actions/runner release. */
export async function latestRunnerTarballApi({ accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/actions/runner/releases/latest', apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
    },
  })
  if (!res.ok) throw new Error('github-link: runner releases/latest failed (' + res.status + ')')
  const rel = await res.json()
  const asset = (rel.assets ?? []).find((a) => /^actions-runner-osx-arm64-.*\.tar\.gz$/.test(a.name))
  if (!asset) throw new Error('github-link: no osx-arm64 runner asset in the latest release')
  return { url: asset.browser_download_url, version: rel.tag_name }
}
