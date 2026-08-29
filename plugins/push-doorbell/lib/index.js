// arxa-push-doorbell — the engine-side push caller (option B1 of
// arxa/docs/plans/doorbell-decision-2026-08-29.md).
//
// ONE event class is wired: approval-requested. When the engine raises an
// approval that needs the owner on the phone, `notifyApprovalRequested`
// POSTs a Visible payload to the desktop's cairn-pushd loopback bind
// (`POST /v1/send`, cairn-push contract) once per paired device, with
// `collapse_key = approval:<id>` so resends coalesce instead of stacking.
//
// Boundaries (deliberate, do not relax):
// - OFF by default. The gate is the literal env `ARXA_DOORBELL_PUSH=true`
//   (the atlet dart-define convention). Everything is a counted no-op
//   without it.
// - Never throws into the engine. Push is best-effort doorbell, not a data
//   path: every failure (pushd down, rail unconfigured, bad key, timeout)
//   lands in the returned summary and a debug log, never in the agent loop.
// - No state. The desktop's pairing.json is the durable source of truth for
//   device tokens (pushd.rs) and is re-read per send; the bearer comes from
//   pushd.env. Both have env overrides so the engine works when it runs
//   outside the desktop shell (launchd, dev server).
// - The daemon owns rate discipline (per-tenant 429) and platform
//   resolution (registry wins); the caller sends the token and lets pushd
//   decide the rail.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Tauri bundle identifier (desktop/src-tauri/tauri.conf.json) — the
 *  app-local-data dir leaf that holds pushd.env and pairing.json. */
const BUNDLE_ID = 'solutions.arxadigital.arxa'
/** cairn-pushd's own default bind (pushd.rs DEFAULT_BIND). */
const DEFAULT_PUSHD_BIND = '127.0.0.1:8090'
/** One doorbell must never stall the agent loop. */
const SEND_TIMEOUT_MS = 2000

/** The tauri v2 app_local_data_dir for the desktop shell, per platform.
 *  `ARXA_APP_DATA_DIR` wins when set (dev rigs, launchd units, tests). */
export function appDataDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.ARXA_APP_DATA_DIR && env.ARXA_APP_DATA_DIR.trim()) return env.ARXA_APP_DATA_DIR.trim()
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', BUNDLE_ID)
    case 'win32':
      return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), BUNDLE_ID)
    default: // linux and friends: tauri uses XDG_DATA_HOME or ~/.local/share
      return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), BUNDLE_ID)
  }
}

/** Parse KEY=VALUE lines (pushd.rs owns three keys and preserves the rest
 *  verbatim — comments and blank lines appear). Malformed lines are skipped. */
export function parseEnvFile(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

/** The /v1/send bearer is the SECRET of the first well-formed
 *  `tenant:secret[:rail]` entry in CAIRN_PUSHD_API_KEYS (the tenant is
 *  stamped daemon-side — ADR-0018 discipline; cairn-push auth.rs). A secret
 *  may contain colons but never ends with the reserved `:rail` suffix. */
export function apiKeyFromEnv(entries) {
  if (!entries) return null
  for (const raw of entries.split(',')) {
    const entry = raw.trim()
    const firstColon = entry.indexOf(':')
    if (firstColon < 1) continue
    let secret = entry.slice(firstColon + 1)
    if (secret.endsWith(':rail')) secret = secret.slice(0, -':rail'.length)
    if (secret) return secret
  }
  return null
}

/** Resolve the doorbell's runtime config. Reads pushd.env unless the env
 *  overrides speak first. Pure resolution — no network, no throwing. */
export function doorbellConfig(env = process.env, readFile = fs.readFileSync) {
  const enabled = env.ARXA_DOORBELL_PUSH === 'true'
  const dataDir = appDataDir(env)
  let fileEnv = {}
  try {
    fileEnv = parseEnvFile(readFile(path.join(dataDir, 'pushd.env'), 'utf8'))
  } catch {
    // pushd.env absent (push never set up on this machine) — overrides may
    // still complete the config; otherwise every send is a skipped no-op.
  }
  const bind = fileEnv.CAIRN_PUSHD_BIND || DEFAULT_PUSHD_BIND
  return {
    enabled,
    pushdUrl: (env.ARXA_PUSHD_URL && env.ARXA_PUSHD_URL.trim()) || `http://${bind}`,
    apiKey: (env.ARXA_PUSHD_KEY && env.ARXA_PUSHD_KEY.trim()) || apiKeyFromEnv(fileEnv.CAIRN_PUSHD_API_KEYS),
    pairingStorePath:
      (env.ARXA_PAIRING_STORE && env.ARXA_PAIRING_STORE.trim()) ||
      path.join(dataDir, 'pairing.json'),
  }
}

/** Paired devices that can receive a push: pairing.json peers carrying a
 *  push token (M7 registration at pair time). Absent/corrupt store → []. */
export function pushTargets(storePath, readFile = fs.readFileSync) {
  let parsed
  try {
    parsed = JSON.parse(readFile(storePath, 'utf8'))
  } catch {
    return []
  }
  if (!parsed || !Array.isArray(parsed.peers)) return []
  return parsed.peers
    .filter((p) => p && typeof p.push_token === 'string' && p.push_token)
    .map((p) => ({ token: p.push_token, platform: p.push_platform ?? null, label: p.label ?? '' }))
}

/** POST one Visible push. Returns {ok, status?, error?}; NEVER throws —
 *  non-2xx, timeouts, and connection failures are all return values. */
export async function sendDoorbell(cfg, { token, title, body, collapseKey, category = 'approval', metadata }, fetchImpl = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${cfg.pushdUrl}/v1/send`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        token,
        payload: { visible: { title, body, category } },
        collapse_key: collapseKey,
        ...(metadata ? { metadata } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  } finally {
    clearTimeout(timer)
  }
}

/** Shared fan-out: one Visible push per paired device, one counted
 *  summary, never a throw. Both event classes ride this. */
async function notifyClass(
  { title, body, collapseKey, category, metadata, logId },
  { env, fetchImpl, readFile, log },
) {
  const cfg = doorbellConfig(env, readFile)
  if (!cfg.enabled) return { sent: 0, skipped: 0, failed: 0, gated: true }
  if (!cfg.apiKey) return { sent: 0, skipped: 0, failed: 0, reason: 'no pushd api key' }
  const targets = pushTargets(cfg.pairingStorePath, readFile)
  if (targets.length === 0) return { sent: 0, skipped: 0, failed: 0, reason: 'no paired devices with push tokens' }
  const summary = { sent: 0, skipped: 0, failed: 0 }
  await Promise.all(
    targets.map(async (t) => {
      const r = await sendDoorbell(
        cfg,
        { token: t.token, title, body, collapseKey, category, metadata },
        fetchImpl,
      )
      if (r.ok) summary.sent += 1
      else {
        summary.failed += 1
        log(`[arxa-push-doorbell] ${logId} → ${t.label || 'device'} failed: ${r.status || r.error}`)
      }
    }),
  )
  return summary
}

/** Event class 1: an approval needs the owner on the phone. Content-free
 *  copy (D60–D68); collapse_key = approval:<id> coalesces resends per
 *  device. Returns a counted summary; safe to fire-and-forget. */
export async function notifyApprovalRequested(
  { id, title, body },
  { env = process.env, fetchImpl = fetch, readFile = fs.readFileSync, log = console.debug } = {},
) {
  return notifyClass(
    {
      title: String(title ?? 'Approval needed'),
      body: String(body ?? 'Open Arxa Studio on your phone to review.'),
      collapseKey: `approval:${id}`,
      category: 'approval',
      metadata: { kind: 'approval-requested', approval_id: String(id) },
      logId: `approval ${id}`,
    },
    { env, fetchImpl, readFile, log },
  )
}

/** Event class 2: a background task/job reached a terminal status. Copy is
 *  content-free exactly like the approval class (D60–D68 discipline): the
 *  outcome picks the title, the body never names the task. collapse_key =
 *  task:<id> with the real job id. 'failed' covers both the 'failed' and
 *  'killed' wire statuses (any non-success terminal rings as a failure).
 *  Same gate (ARXA_DOORBELL_PUSH=true), same POST path/auth, same counted
 *  no-op contract. */
export async function notifyTaskFinished(
  { id, outcome },
  { env = process.env, fetchImpl = fetch, readFile = fs.readFileSync, log = console.debug } = {},
) {
  const failed = outcome !== 'completed'
  return notifyClass(
    {
      title: failed ? 'Task failed' : 'Task finished',
      body: 'Open Arxa Studio to see the result.',
      collapseKey: `task:${id}`,
      category: 'task',
      metadata: { kind: failed ? 'task-failed' : 'task-finished', task_id: String(id) },
      logId: `task ${id} (${outcome})`,
    },
    { env, fetchImpl, readFile, log },
  )
}
