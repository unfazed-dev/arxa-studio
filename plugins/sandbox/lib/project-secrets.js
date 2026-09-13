// arxa project-secrets — per-project encrypted environment handling
// (§7, docs/plans/arxa-isolation-levels.md).
//
// THE DESIGN, verbatim from the plan:
//   * the macOS Keychain holds ONE age key per project, scoped by stable
//     org/project id (service 'arxa-studio', account 'secret-key:<org>/<slug>');
//   * each project commits `.env.sops` — SOPS ciphertext with that project's
//     age key. The ciphertext is what ships; only the local key opens it;
//   * L0/L1 decrypt HOST-SIDE and inject into EXACTLY ONE spawned command —
//     never the engine's or the agent's ambient env.
//
// The keyring is the bounded platform keyring ladder REUSED from
// plugins/github-link/lib/keyring.js (Tauri bridge → /usr/bin/security /
// secret-tool → memory) — the plan names it explicitly; no second ladder.
// Every `security`/`secret-tool` call goes through execFile there, never a
// shell string, and the age identity reaches `sops` only through the SOPS
// CHILD's env — the §7 forbidden list (plaintext .env, `-e`, `--env-file`,
// `--build-arg`, command-line secrets, ambient engine env) is closed by
// construction here.
//
// DISPOSAL: the decrypted plaintext lives in exactly one Buffer, zeroed in a
// finally that runs on the normal exit path AND when the spawned command dies
// to a signal (the awaited spawn rejects, finally still fires). There are NO
// temporary files to remove by design — SIGKILL of this process is the one
// path that skips the zeroing, and only heap memory is at stake then.
//
// NOTHING in this module ever logs or returns secret material: callers get
// the PUBLIC half of the key; the identity stays in the keyring and the
// sops child's env.

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createKeyring } from '../../github-link/lib/keyring.js'

const run = promisify(execFile)

/**
 * The keychain account for one project's age key — stable, scoped, and never
 * shared between projects (§7: the one-global-namespace defect, avoided).
 * @param {string} orgId - the stable org id.
 * @param {string} projectId - the stable project id (slug).
 * @returns {string} the account name.
 */
export function accountFor (orgId, projectId) {
  return `secret-key:${orgId}/${projectId}`
}

/**
 * Parse decrypted `.env` bytes into a record. First `=` wins (values may
 * contain `=`); `#` comments and blank lines are skipped; surrounding quotes
 * are stripped.
 * @param {Buffer | string} bytes - the plaintext env file.
 * @returns {Record<string, string>} the parsed key/values.
 */
export function parseEnvBuffer (bytes) {
  const out = {}
  for (const line of String(bytes).split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Ensure one project's age keypair exists in the keyring, minting it with
 * `age-keygen` when absent.
 * @param {{ orgId: string, projectId: string }} ids - the stable scoping ids.
 * @param {object} [deps] - injection seam (tests): `{ keyring }`.
 * @returns {Promise<{ account: string, publicKey: string, created: boolean,
 *   dispose: () => Promise<void> }>} the PUBLIC half only, plus a disposal
 *   that deletes the keychain item (test cleanup).
 */
export async function ensureProjectAgeKey ({ orgId, projectId }, deps = {}) {
  const keyring = deps.keyring ?? createKeyring()
  const account = accountFor(orgId, projectId)
  const existing = await keyring.getSecret(account)
  if (existing !== null) {
    let parsed
    try { parsed = JSON.parse(existing) } catch { throw new Error(`project-secrets: keychain item for ${account} is not valid JSON — delete it and re-run to re-mint`) }
    if (parsed.k !== 'age' || typeof parsed.secretKey !== 'string' || typeof parsed.publicKey !== 'string') {
      throw new Error(`project-secrets: keychain item for ${account} has an unexpected shape — delete it and re-run to re-mint`)
    }
    return { account, publicKey: parsed.publicKey, created: false, dispose: () => keyring.deleteSecret(account) }
  }
  const keygen = await run('age-keygen')
  const publicKey = /^# public key: (\S+)$/m.exec(keygen.stdout)?.[1]
  const secretKey = /^(AGE-SECRET-KEY-\S+)$/m.exec(keygen.stdout)?.[1]
  if (publicKey === undefined || secretKey === undefined) {
    throw new Error('project-secrets: could not parse age-keygen output — is age-keygen on PATH?')
  }
  await keyring.setSecret(account, JSON.stringify({ k: 'age', publicKey, secretKey }))
  return { account, publicKey, created: true, dispose: () => keyring.deleteSecret(account) }
}

/**
 * Encrypt a project's `.env` into committable `.env.sops` ciphertext.
 * @param {{ dir: string, publicKey: string }} input - the project dir (holding
 *   `.env`) and the project's age PUBLIC key.
 * @returns {Promise<string>} a plaintext-free report line.
 * @throws {Error} 'sops' is not installed or refused — absence of the tool is
 *   the caller's to surface honestly (arxa never fails silently, and never
 *   falls back to plaintext).
 */
export async function encryptEnvFile ({ dir, publicKey }) {
  try {
    await run('sops', ['--encrypt', '--age', publicKey,
      '--in', join(dir, '.env'), '--out', join(dir, '.env.sops')])
    return `encrypted ${join(dir, '.env')} -> .env.sops (age recipient ${publicKey})`
  } catch (err) {
    if (err?.code === 'ENOENT' || /ENOENT/.test(String(err?.message))) {
      throw new Error('project-secrets: sops is not installed — install sops to encrypt .env files (no plaintext fallback will ever be used)')
    }
    throw err
  }
}

/**
 * Decrypt the project's `.env.sops` and run EXACTLY ONE command with the
 * values in ITS environment.
 *
 * Scoping, by construction: the age identity travels only as the sops child's
 * `SOPS_AGE_KEY`; the decrypted values travel only in the final command's
 * `env`; neither ever touches argv, a shell string, a file, or this process's
 * ambient environment. The plaintext Buffer is zeroed when the command is
 * done, however it ends.
 *
 * @param {{ orgId: string, projectId: string, envSopsPath: string,
 *   argv: string[], cwd?: string }} input - the scoping ids, the ciphertext
 *   path, and the ONE command to run (argv form, never a shell string).
 * @param {object} [deps] - injection seam (tests): `{ keyring, sops, spawn, env }`.
 * @returns {Promise<{ code: number | null, signal: string | null }>} how the
 *   command ended.
 */
export async function decryptEnvIntoCommand ({ orgId, projectId, envSopsPath, argv, cwd }, deps = {}) {
  const keyring = deps.keyring ?? createKeyring()
  const sops = deps.sops ?? (async (sargv, opts) => run('sops', sargv, opts))
  const spawnOne = deps.spawn ?? (async (cargv, opts) => {
    const r = await new Promise((resolve) => {
      const child = execFile(cargv[0], cargv.slice(1), { ...opts, cwd }, (err, stdout, stderr) => {
        resolve({ code: err?.code ?? (err ? 1 : 0), signal: err?.signal ?? null, stdout, stderr })
      })
      child.on('error', () => {})
    })
    return r
  })

  const stored = await keyring.getSecret(accountFor(orgId, projectId))
  if (stored === null) throw new Error(`project-secrets: no keychain key for ${orgId}/${projectId} — run ensureProjectAgeKey first`)
  let identity
  try { identity = JSON.parse(stored) } catch { throw new Error('project-secrets: keychain item is not valid JSON') }

  let plaintext = Buffer.alloc(0)
  try {
    // The identity reaches ONLY this child. encoding 'buffer' keeps the
    // plaintext out of string interning; the zeroing below can actually work.
    plaintext = await sops(['--decrypt', envSopsPath], {
      env: { ...process.env, SOPS_AGE_KEY: identity.secretKey },
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024
    })
    const secrets = parseEnvBuffer(plaintext)
    return await spawnOne(argv, { env: { ...(deps.env ?? process.env), ...secrets } })
  } finally {
    plaintext.fill(0)
  }
}
