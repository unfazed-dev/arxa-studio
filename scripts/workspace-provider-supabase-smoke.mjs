#!/usr/bin/env node
/**
 * The disposable local-Supabase harness (task 14 steps 2+3+6).
 *
 * Two legs, one honest banner each:
 *
 *   --real (the dedicated CI job runs this): a THROWAWAY local Supabase stack
 *     on pinned reserved ports, started from a SCRATCH COPY of
 *     plugins/workspace-provider/supabase (state never touches the operator's
 *     own supabase home), stopped and wiped on success, failure, and signal.
 *     It applies the shipped migrations to the empty stack, applies them
 *     twice (idempotent), exercises rows through two real users / two real
 *     orgs, replays raw authenticated requests proving user A cannot
 *     list/read/write org B (RLS/IDOR — the kit's cross-org section must be
 *     GREEN), runs the FULL conformance kit, migrates local → supabase →
 *     local with hash-equal portable data, then reverses the migration
 *     (`supabase migration down --last 1`) and resets only this disposable
 *     database.
 *
 *   default (npm test): ALWAYS the injected-protocol-fake leg — exactly the
 *     offline selftest.supabase.mjs (no ports, no daemon, no machine-state
 *     probing: ordinary `npm test` is deterministic on every machine). The
 *     real stack is opt-in ONLY — --real or ARXA_SUPABASE_REAL_SMOKE=1 (the
 *     repo's gated-leg convention, cf. ARXA_A5_REAL_SMOKE); the dedicated CI
 *     job passes --real. The banner says which leg ran — never silently fake.
 *
 * Supabase CLI version is PINNED below; the script detects and refuses
 * (deterministic CI) instead of installing anything.
 *
 * Run: node scripts/workspace-provider-supabase-smoke.mjs [--real | --fake]
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUPABASE_CLI_PIN = '2.67.1'
const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const pluginDir = join(root, 'plugins', 'workspace-provider')

const { SupabaseWorkspaceProvider } = await import(join(pluginDir, 'lib', 'supabase.js'))
const { runConformance } = await import(join(pluginDir, 'lib', 'conformance.js'))
const { exportBundle, importBundle } = await import(join(pluginDir, 'lib', 'export-bundle.js'))
const { LocalWorkspaceProvider } = await import(join(pluginDir, 'lib', 'local.js'))

// Deterministic leg selection: the real stack NEVER runs by probing machine
// state. --fake forces offline; otherwise the real leg needs an explicit
// opt-in — --real (the CI job's spelling) or ARXA_SUPABASE_REAL_SMOKE=1.
const mode = process.argv.includes('--fake') ? 'fake'
  : process.argv.includes('--real') || process.env.ARXA_SUPABASE_REAL_SMOKE === '1' ? 'real'
  : 'fake'

const fail = (msg) => { console.error('::error::' + msg); process.exit(1) }
const ok = (s) => console.log('  ok ' + s)
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

// ============================================================== the fake leg
async function fakeLeg () {
  console.log('workspace-provider supabase smoke — FAKE LEG (injected protocol fake, offline, no ports)')
  console.log('OFFLINE BY DEFAULT: the real local-Supabase stack leg is opt-in (--real / ARXA_SUPABASE_REAL_SMOKE=1); CI job "supabase-conformance" runs it with --real.')
  const r = spawnSync(process.execPath, [join(pluginDir, 'selftest.supabase.mjs')], {
    cwd: root, stdio: 'inherit', timeout: 5 * 60 * 1000,
  })
  if (r.status !== 0) fail('fake leg red — selftest.supabase.mjs failed')
  ok('conformance + RLS/IDOR + local→supabase→local equivalence GREEN through the protocol fake')
}

// ============================================================== the real leg
let scratch = null // the scratch workdir; cleanup runs on every exit path

function cleanup () {
  if (!scratch) return
  try { spawnSync('supabase', ['stop', '--workdir', scratch, '--no-backup'], { timeout: 120_000 }) } catch { /* best effort */ }
  try { rmSync(scratch, { recursive: true, force: true }) } catch { /* best effort */ }
  scratch = null
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143) })

const supabase = (args, opts = {}) => {
  const r = spawnSync('supabase', args, { ...opts, encoding: 'utf8', timeout: opts.timeout ?? 120_000 })
  if (r.status !== 0) {
    console.error((r.stdout ?? '') + (r.stderr ?? ''))
    fail('supabase ' + args.join(' ') + ' failed')
  }
  return r.stdout
}

/** PostgREST/GoTrue call with the anon key and an optional user/service bearer. */
async function api (url, path, { method = 'GET', body, bearer, prefer } = {}) {
  const headers = { apikey: url.anonKey, 'content-type': 'application/json' }
  if (bearer) headers.Authorization = 'Bearer ' + bearer
  if (prefer) headers.Prefer = prefer
  const res = await fetch(url.url + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function realLeg () {
  console.log('workspace-provider supabase smoke — REAL LEG (disposable local Supabase stack)')

  // ---- requirements: pinned CLI, docker daemon. Never install anything.
  const version = supabase(['--version']).match(/([\d.]+)\s*$/)?.[1]
  if (version !== SUPABASE_CLI_PIN)
    fail(`supabase CLI ${version ?? 'not found'} ≠ pinned ${SUPABASE_CLI_PIN} — install the pinned version (never auto-installed)`)
  const docker = spawnSync('docker', ['info'], { encoding: 'utf8' })
  if (docker.status !== 0) fail('the docker daemon is unreachable — the real leg needs it (run the fake leg, or start Docker)')

  // ---- scratch workdir: a COPY of the harness config + migrations. The
  // operator's own supabase state is never touched; the scratch dir is wiped
  // on every exit path (success, failure, signal).
  scratch = mkdtempSync(join(tmpdir(), 'arxa-ws-sb-smoke-'))
  mkdirSync(join(scratch, 'supabase', 'migrations'), { recursive: true })
  cpSync(join(pluginDir, 'supabase', 'config.toml'), join(scratch, 'supabase', 'config.toml'))
  const migrations = readdirSync(join(pluginDir, 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  if (!migrations.length) fail('plugins/workspace-provider/migrations has no *.sql')
  for (const f of migrations) cpSync(join(pluginDir, 'migrations', f), join(scratch, 'supabase', 'migrations', f))
  console.log('migrations: ' + migrations.join(', '))

  // ---- start (heavy services excluded: studio, inbucket, imgproxy,
  // edge-runtime, vector) — the first run pulls images; give it room.
  supabase(['start', '--workdir', scratch, '-x', 'studio,inbucket,imgproxy,edge-runtime,vector'],
    { timeout: 15 * 60 * 1000 })
  ok('disposable stack started on pinned reserved ports (api 54921, db 54922) from a scratch workdir')

  const env = {}
  for (const line of supabase(['status', '--workdir', scratch, '-o', 'env']).split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m) env[m[1]] = m[2]
  }
  const url = { url: env.SUPABASE_URL ?? 'http://127.0.0.1:54921', anonKey: env.SUPABASE_ANON_KEY ?? env.ANON_KEY ?? '' }
  if (!/^http/.test(url.url) || !url.anonKey) fail('could not read SUPABASE_URL/SUPABASE_ANON_KEY from `supabase status -o env`')

  // ---- migrations: apply to the empty stack, apply twice, then list
  supabase(['db', 'reset', '--workdir', scratch], { timeout: 5 * 60 * 1000 })
  const again = spawnSync('supabase', ['migration', 'up', '--workdir', scratch], { encoding: 'utf8' })
  if (again.status !== 0) fail('second migration apply failed:\n' + again.stdout + again.stderr)
  const list = supabase(['migration', 'list', '--workdir', scratch, '-o', 'json'])
  const applied = JSON.parse(list).filter((row) => String(row.status).toLowerCase() === 'applied').length
  if (applied !== migrations.length) fail(`expected ${migrations.length} applied migrations, list shows ${applied}`)
  ok(`migrations applied to the empty stack; re-apply is a no-op; ${applied} applied`)

  // ---- two users (admin API, service key — server-side only, never in the adapter)
  const mkUser = async (email) => {
    const r = await api(url, '/auth/v1/admin/users', {
      method: 'POST', bearer: env.SUPABASE_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY,
      body: { email, password: 'smoke-' + email, email_confirm: true },
    })
    if (r.status >= 300 || !r.body?.id) fail('could not create harness user ' + email + ': ' + JSON.stringify(r.body))
    const t = await api(url, '/auth/v1/token?grant_type=password', {
      method: 'POST', body: { email, password: 'smoke-' + email },
    })
    if (t.status >= 300 || !t.body?.access_token) fail('password grant failed for ' + email)
    return { id: r.body.id, email, token: t.body.access_token }
  }
  const userA = await mkUser('smoke-a@example.test')
  const userB = await mkUser('smoke-b@example.test')

  // ---- two orgs (one per user, through the real API as each user)
  const mkOrg = async (user, name) => {
    const r = await api(url, '/rest/v1/orgs', { method: 'POST', bearer: user.token, prefer: 'return=representation', body: { name, kind: 'studio' } }) // PostgREST's insert default hands back no row
    if (r.status >= 300 || !r.body?.[0]?.id) fail('org create failed for ' + name + ': ' + JSON.stringify(r.body))
    return r.body[0].id
  }
  const orgA = await mkOrg(userA, 'smoke-org-a')
  const orgB = await mkOrg(userB, 'smoke-org-b')
  await api(url, '/rest/v1/rpc/put_record', {
    method: 'POST', bearer: userB.token,
    body: { p_org: orgB, p_collection: 'tickets', p_id: 'b-1', p_doc: JSON.stringify({ secret: 'belongs-to-b' }) },
  })
  ok('two users / two orgs exist with real rows')

  // ---- RLS/IDOR replay: A's token against B's org — every path refused
  const rawGet = await api(url, `/rest/v1/records?org_id=eq.${orgB}&collection=eq.tickets&id=eq.b-1&select=*`, { bearer: userA.token })
  if (rawGet.status === 200 && (rawGet.body ?? []).length > 0) fail('IDOR: user A read org B record ' + JSON.stringify(rawGet.body))
  const rawPut = await api(url, '/rest/v1/rpc/put_record', {
    method: 'POST', bearer: userA.token,
    body: { p_org: orgB, p_collection: 'tickets', p_id: 'idor-probe', p_doc: '{"x":1}' },
  })
  if (rawPut.status === 200) fail('IDOR: user A wrote into org B')
  const rawList = await api(url, '/rest/v1/rpc/list_records', {
    method: 'POST', bearer: userA.token, body: { p_org: orgB, p_collection: 'tickets' },
  })
  if (rawList.status === 200) fail('IDOR: user A listed org B records')
  const rawAudit = await api(url, '/rest/v1/rpc/read_audit', {
    method: 'POST', bearer: userA.token, body: { p_org: orgB },
  })
  if (rawAudit.status === 200) fail('IDOR: user A read org B audit')
  ok('raw authenticated replay: A cannot list/read/write org B (RLS refuses; audit too)')

  // ---- FULL conformance kit through the adapter, cross-org included
  const credStore = () => {
    const map = new Map()
    return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v) }, delete: async (k) => { map.delete(k) } }
  }
  const A = new SupabaseWorkspaceProvider({ url: url.url, anonKey: url.anonKey, credentialStore: credStore(), fetch })
  const B = new SupabaseWorkspaceProvider({ url: url.url, anonKey: url.anonKey, credentialStore: credStore(), fetch })
  await A.signIn('email-form', { email: userA.email, password: 'smoke-' + userA.email })
  await B.signIn('email-form', { email: userB.email, password: 'smoke-' + userB.email })
  const report = await runConformance(A, { crossOrg: { provider: B, orgId: orgB, recordId: 'b-1' } })
  for (const s of report.sections) {
    const row = s.status.toUpperCase().padEnd(6) + s.id + (s.details.length ? ' — ' + s.details.join(' | ') : '')
    console.log(row)
    if (s.status === 'red') fail('conformance section red: ' + s.id)
  }
  if (!report.ok) fail('conformance report not ok')
  ok('FULL conformance kit green against the REAL stack — RLS/IDOR section included')

  // ---- migration local → supabase → local, portable hashes equal
  const tmp = mkdtempSync(join(tmpdir(), 'arxa-ws-sb-real-'))
  try {
    const src = new LocalWorkspaceProvider({ home: join(tmp, 'src') })
    const srcOrg = await src.createOrg({ name: 'smoke-migrate', kind: 'agency' })
    await src.putRecord(srcOrg.id, 'tickets', 'm-1', { title: 'one', zeta: 1, alpha: 2 })
    await src.putRecord(srcOrg.id, 'chat_messages', 'm-2', { text: 'two' })
    await src.addMember(srcOrg.id, { email: 'mate@example.test', role: 'member' })
    await src.appendAudit(srcOrg.id, { action: 'smoke-migrated' })
    await src.putBlob(srcOrg.id, ['m', 'b.bin'], Buffer.from('real-blob-bytes'))
    await exportBundle(src, srcOrg.id, join(tmp, 'b1'))
    const { orgId: sbOrg } = await importBundle(A, join(tmp, 'b1'))
    const back = new LocalWorkspaceProvider({ home: join(tmp, 'back') })
    await exportBundle(A, sbOrg, join(tmp, 'b2'))
    const { orgId: backOrg } = await importBundle(back, join(tmp, 'b2'))
    const h1 = await portableHash(src, srcOrg.id)
    const h2 = await portableHash(back, backOrg)
    if (h1 !== h2) fail(`portable-data hashes differ across local → supabase → local: ${h1} ≠ ${h2}`)
    ok('export local → supabase → local: hash-equivalent portable data; identities re-invited')
  } finally { rmSync(tmp, { recursive: true, force: true }) }

  // ---- reversibility: un-apply the last migration (resets ONLY this
  // disposable database), prove it, re-apply for a clean teardown.
  supabase(['migration', 'down', '--workdir', scratch, '--last', String(migrations.length)], { timeout: 5 * 60 * 1000 })
  const afterDown = JSON.parse(supabase(['migration', 'list', '--workdir', scratch, '-o', 'json']))
    .filter((row) => String(row.status).toLowerCase() === 'applied').length
  if (afterDown !== 0) fail(`migration down left ${afterDown} applied`)
  supabase(['db', 'reset', '--workdir', scratch], { timeout: 5 * 60 * 1000 })
  ok('migration reversed on the disposable database, then re-applied clean')

  console.log('workspace-provider supabase smoke: REAL leg green')
}

/** Same portable-data definition as selftest.supabase.mjs §16. */
async function portableHash (p, orgId) {
  const readAll = async (c) => {
    const out = []; let cursor
    do { const page = await p.listRecords(orgId, c, { cursor }); out.push(...page.records); cursor = page.nextCursor } while (cursor)
    return out
  }
  const collections = {}
  for (const c of ['tickets', 'ticket_messages', 'chat_conversations', 'chat_messages', 'feedback', 'requirements', 'user_prefs'])
    collections[c] = (await readAll(c)).map((r) => ({ id: r.id, doc: r.doc })).sort((a, b) => a.id.localeCompare(b.id))
  const members = (await p.listMembers(orgId)).filter((m) => m.role !== 'owner')
    .map((m) => ({ email: m.email, role: m.role })).sort((a, b) => a.email.localeCompare(b.email))
  const audit = (await p.readAudit(orgId)).map((r) => r.action).sort()
  const blobs = {}
  for (const path of await p.listBlobs(orgId)) blobs[path] = sha256(await p.getBlob(orgId, path))
  return sha256(JSON.stringify({ collections, members, audit, blobs }))
}

// ============================================================== dispatch
if (mode === 'real') {
  await realLeg().catch((e) => { console.error(e); process.exit(1) })
} else {
  // fake (default and --fake): deterministically OFFLINE. The real leg runs
  // only on explicit opt-in above; npm test never spins docker on any machine.
  await fakeLeg()
}
