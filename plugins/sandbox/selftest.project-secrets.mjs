// arxa project-secrets selftest — per-project encrypted environment handling
// (§7, docs/plans/arxa-isolation-levels.md). Run:
//   node plugins/sandbox/selftest.project-secrets.mjs
//
// The design under test, from the plan:
//   * ONE keychain key per project (the bounded platform keyring ladder from
//     plugins/github-link/lib/keyring.js is REUSED, never re-invented);
//   * keys scoped by stable org/project ID;
//   * ciphertext committed as .env.sops, decrypted for EXACTLY ONE spawned
//     command — never a plaintext .env, never ambient engine/agent env, never
//     a shell string, never a command-line secret;
//   * temporary material zeroed on the exit path.
//
// SECRETS DISCIPLINE: every assertion is on PRESENCE/SHAPE, never on secret
// VALUES. Nothing here prints key material.
//
// REAL-TOOL ROWS: age/age-keygen and /usr/bin/security exist here, so the
// keygen + keychain round-trip runs against the REAL keychain — through a
// NAMESPACED SCRATCH service prefix (never the 'arxa-studio' production
// namespace, never operator credentials), and it cleans up after itself.
// sops is NOT installed on this machine: those rows SKIP (honestly), and the
// decrypt pipeline is exercised through an injected sops double instead.

import { strict as assert } from 'node:assert'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createKeyring, KEYCHAIN_SERVICE } from '../github-link/lib/keyring.js'

import {
  accountFor,
  decryptEnvIntoCommand,
  encryptEnvFile,
  ensureProjectAgeKey,
  parseEnvBuffer
} from './lib/project-secrets.js'

// The scratch keyring: the production ladder (createKeyring) with every
// `security` call rewritten onto a NAMESPACED SCRATCH service, so the test
// never writes under 'arxa-studio' proper and never touches operator items.
const SCRATCH_SERVICE = KEYCHAIN_SERVICE + '-selftest-scratch'
const scratchRun = async (cmd, args) =>
  promisify(execFile)(cmd, args.map((a) => (a === KEYCHAIN_SERVICE ? SCRATCH_SERVICE : a)))
const scratchProbe = () => {
  const set = spawnSync('/usr/bin/security',
    ['add-generic-password', '-s', SCRATCH_SERVICE, '-a', '__probe__', '-w', 'probe', '-U'],
    { stdio: 'ignore', timeout: 2000, killSignal: 'SIGKILL' })
  if (set.error || set.status !== 0) return false
  spawnSync('/usr/bin/security',
    ['delete-generic-password', '-s', SCRATCH_SERVICE, '-a', '__probe__'],
    { stdio: 'ignore', timeout: 2000, killSignal: 'SIGKILL' })
  return true
}
const SCRATCH_KEYRING = () => createKeyring({ run: scratchRun, probeStore: scratchProbe })

let checks = 0
let skipped = 0
const ok = (name) => { checks += 1; console.log('  ok', name) }
const skip = (name, why) => { skipped += 1; console.log('  SKIP', name, '—', why) }

const has = (tool) => spawnSync('/usr/bin/which', [tool], { stdio: 'ignore' }).status === 0
const AGE = has('age')
const AGE_KEYGEN = has('age-keygen')
const SOPS = has('sops')
const SECURITY = existsSync('/usr/bin/security')

// ---- 1. pure: account scoping by stable org/project id ---------------------
{
  assert.equal(accountFor('acme', 'website'), 'secret-key:acme/website')
  assert.notEqual(accountFor('acme', 'website'), accountFor('acme', 'app'))
  assert.notEqual(accountFor('acme', 'website'), accountFor('other', 'website'))
  ok('account: one keychain account per org/project pair, stable across calls')
}

// ---- 2. pure: env parsing (KEY=VALUE, first '=' wins, comments skipped) ----
{
  const env = parseEnvBuffer(Buffer.from('A=1\n# comment\n\nB=two words\nC=a=b\nD="quoted"\n'))
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'a=b', D: 'quoted' })
  ok('parse: KEY=VALUE with first-= split, comments, blanks, quotes')
}

// ---- 3. the decrypt pipeline through doubles: scoping is the whole point ---
{
  const captured = {}
  const plaintext = Buffer.from('API_TOKEN=shape-only\nDB_URL=postgres://x\n')
  // A double of `sops --decrypt`: receives the age identity ONLY through its
  // own child env and returns the plaintext buffer — the module must zero
  // exactly that buffer once the command is done.
  const fakeSops = async (argv, opts) => {
    captured.sopsArgv = argv
    captured.sopsEnv = opts.env
    return plaintext
  }
  const fakeSpawn = async (argv, opts) => {
    captured.cmdArgv = argv
    captured.cmdEnv = opts.env
    return { code: 0, signal: null }
  }
  const fakeKeyring = {
    backend: 'test-double',
    async getSecret (account) {
      captured.keyAccount = account
      return JSON.stringify({ k: 'age', publicKey: 'age1double', secretKey: 'AGE-SECRET-KEY-1DOUBLE' })
    }
  }

  const r = await decryptEnvIntoCommand({
    orgId: 'acme',
    projectId: 'website',
    envSopsPath: '/x/.env.sops',
    argv: ['npm', 'run', 'build']
  }, { keyring: fakeKeyring, sops: fakeSops, spawn: fakeSpawn, env: { PATH: '/usr/bin' } })
  assert.equal(r.code, 0)
  assert.equal(captured.keyAccount, 'secret-key:acme/website', 'the key is fetched by org/project scope')
  assert.ok(captured.sopsArgv.includes('--decrypt'), 'sops is asked to decrypt')
  assert.equal(captured.sopsEnv.SOPS_AGE_KEY, 'AGE-SECRET-KEY-1DOUBLE',
    'the age identity reaches the sops child through ITS env only')
  assert.equal(captured.cmdEnv.API_TOKEN, 'shape-only', 'decrypted values reach the one spawned command')
  assert.equal(captured.cmdEnv.DB_URL, 'postgres://x')
  assert.equal(captured.cmdEnv.PATH, '/usr/bin', 'the command keeps its base env')
  assert.ok(!('SOPS_AGE_KEY' in captured.cmdEnv), 'the age key itself never leaks into the command env')
  assert.equal(captured.cmdArgv.join(' '), 'npm run build')
  assert.ok(plaintext.every((b) => b === 0), 'the plaintext buffer is zeroed after the command')
  for (const k of ['API_TOKEN', 'DB_URL', 'SOPS_AGE_KEY']) {
    assert.ok(!(k in process.env), `nothing leaks into this process's ambient env: ${k}`)
  }
  ok('decrypt: one spawned command gets the values; the key, the buffer and ambient env stay clean')
}

// ---- 4. LIVE: real age-keygen + the REAL keychain through a scratch service
//      namespace, cleaned up after itself. Skipped (never failed) whenever
//      the tools are absent.
{
  if (!AGE_KEYGEN) {
    skip('live: project age key in the real keychain', 'age-keygen is not on PATH')
  } else if (!SECURITY) {
    skip('live: project age key in the real keychain', '/usr/bin/security is absent (non-darwin)')
  } else {
    const first = await ensureProjectAgeKey({ orgId: 'selftest-org', projectId: `p-${process.pid}` }, { keyring: SCRATCH_KEYRING() })
    try {
      assert.ok(/^age1/.test(first.publicKey), 'the returned half is the PUBLIC key')
      assert.ok(!first.publicKey.includes('SECRET'), 'and never the secret half')
      assert.equal(first.created, true)
      const again = await ensureProjectAgeKey({ orgId: 'selftest-org', projectId: `p-${process.pid}` }, { keyring: SCRATCH_KEYRING() })
      assert.equal(again.created, false, 'the second call finds the key, it does not mint a new one')
      assert.equal(again.publicKey, first.publicKey)
      ok('live: age keypair minted once per org/project, public half only, real keychain round-trip')
    } finally {
      // CLEANUP: the scratch keychain item must not outlive the test, even on
      // a failed assertion.
      await first.dispose()
    }
  }
}

// ---- 5. LIVE-ish: sops encrypt round-trip when sops exists; honest skip ----
{
  if (!SOPS || !AGE_KEYGEN) {
    skip('live: sops encrypt .env -> .env.sops', 'sops/age-keygen not installed')
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'arxa-secrets-'))
    try {
      writeFileSync(join(dir, '.env'), 'A=1\nB=two\n')
      const key = await ensureProjectAgeKey({ orgId: 'selftest-org', projectId: `enc-${process.pid}` }, { keyring: SCRATCH_KEYRING() })
      try {
        const out = await encryptEnvFile({ dir, publicKey: key.publicKey })
        assert.ok(existsSync(join(dir, '.env.sops')), 'the ciphertext lands beside the plaintext')
        assert.ok(!out.includes('A=1'), 'the returned report carries no plaintext')
        ok('live: sops encrypt produces committed .env.sops ciphertext')
      } finally {
        await key.dispose()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

console.log(`arxa project-secrets selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
