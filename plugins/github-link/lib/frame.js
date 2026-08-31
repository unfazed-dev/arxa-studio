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
  if (!res.ok) throw new Error('github-link: PR create failed (' + res.status + ')')
  return res.json()
}

/** List PRs for a head branch (dedupe before creating — file-pr rule 1). */
export async function prListForHeadApi({ owner, name, head, accessToken, fetch, apiBase }) {
  const res = await fetch(new URL('/repos/' + owner + '/' + name + '/pulls?head=' + owner + ':' + head + '&state=open', apiBase), {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + accessToken,
      'user-agent': 'arxa-studio',
    },
  })
  if (!res.ok) throw new Error('github-link: PR list failed (' + res.status + ')')
  return res.json()
}

/** Squash-merge a PR (Q8; the repo is settings-locked to squash-only). */
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
