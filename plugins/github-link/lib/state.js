/**
 * github-link state — the non-secret half of the link record.
 *
 * { linked, login, scopes, linkedAt } persisted at ~/.arxa/github-link.json
 * (ARXA_HOME overrides, matching workspace/root.js's arxaHome contract).
 *
 * The ACCESS TOKEN never lives here — it goes to the keyring (lib/keyring.js).
 * Local-first: a plain JSON file, no cloud database anywhere (CLAUDE.md
 * ownership boundary; D16 anonymous-until-linked).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const STATE_FILE = 'github-link.json'

/** arxa home dir — same override contract as workspace/lib/root.js. */
export function arxaHome(env = process.env) {
  return env.ARXA_HOME || path.join(os.homedir(), '.arxa')
}

export function statePath(env = process.env) {
  return path.join(arxaHome(env), STATE_FILE)
}

/** Read the link state, or null when unlinked / unreadable.
  * accessExpiresAt (D76) is non-secret — it drives the refresh clock. */
export function readState(env = process.env) {
  try {
    const raw = fs.readFileSync(statePath(env), 'utf8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      linked: parsed.linked === true,
      login: typeof parsed.login === 'string' ? parsed.login : null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      linkedAt: typeof parsed.linkedAt === 'string' ? parsed.linkedAt : null,
      accessExpiresAt: typeof parsed.accessExpiresAt === 'string' ? parsed.accessExpiresAt : null,
      // getToken() writes these when a refresh is refused, and status() spreads
      // readState() — so leaving them off this whitelist made the flag
      // WRITE-ONLY: the file said relinkRequired, every reader saw undefined,
      // and the UI never told the user to re-link. Measured 2026-09-04 on the
      // RESTO smoke, where the flag sat in github-link.json unread while every
      // push failed with a bare 401.
      relinkRequired: parsed.relinkRequired === true,
      relinkReason: typeof parsed.relinkReason === 'string' ? parsed.relinkReason : null,
    }
  } catch {
    return null
  }
}

/**
 * Persist the link state (creates ~/.arxa when missing). Writes are
 * temp-file + rename so a crash never leaves a half-written record.
 */
export function writeState(state, env = process.env) {
  const file = statePath(env)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return state
}

/** Remove the link state entirely (unlink). */
export function clearState(env = process.env) {
  try {
    fs.rmSync(statePath(env), { force: true })
  } catch {
    /* already gone — unlink is idempotent */
  }
}
