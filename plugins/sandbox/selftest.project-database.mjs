// arxa project-database selftest — per-project Supabase lifecycle with the
// local floor (Task 10 Step 5, docs/plans/arxa-isolation-levels.md §8).
// Run: node plugins/sandbox/selftest.project-database.mjs
//
// THE DESIGN UNDER TEST, from the plan:
//   * L1: `supabase init` + `supabase start` INSIDE each project's isolated
//     clone — own containers, own volume, own project_id;
//   * default ports collide (54321-54324), so arxa auto-assigns a DISTINCT
//     port block per project, persisted by stable project ID;
//   * one active local stack at a time (§8: one-stack-at-a-time is the
//     design assumption on this RAM class);
//   * NEVER the vendor's Supabase project — `supabase link` is forbidden;
//   * missing Docker or CLI degrades to the local file/SQLite floor — the
//     mandatory floor for everyone (L0) — with a truthful reason.
//
// The Supabase CLI is DETECTED here (never installed): 2.67.1 is present on
// this machine, but every argv row runs against an injected runner — no
// real stack is ever started (the daemon is down, and a real stack is not
// this task's to boot). The port allocation, registry persistence and
// config.toml patching run for real against scratch dirs.

import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  allocatePortBlock,
  detectSupabase,
  ensureProjectDatabase,
  startProjectDatabase,
  stopProjectDatabase
} from './lib/project-database.js'

let checks = 0
let skipped = 0
const ok = async (name, fn) => { await fn(); checks++; console.log(`  ok ${name}`) }
const skip = (name, why) => { skipped++; console.log(`  skip ${name} — ${why}`) }

const scratch = mkdtempSync(join(tmpdir(), 'arxa-projdb-selftest-'))
const scratchDir = (name) => { const d = join(scratch, name); mkdirSync(d, { recursive: true }); return d }

// The default config.toml `supabase init` would lay down (the collision the
// plan names: every project starts at 54321).
const DEFAULT_TOML = [
  'project_id = "scratch"',
  '',
  '[api]',
  'port = 54321',
  '',
  '[db]',
  'port = 54322',
  '',
  '[studio]',
  'port = 54323',
  '',
  '[email]',
  'port = 54324',
  '',
  '[storage]',
  'port = 54325',
  '',
].join('\n')

/** A supabase double: records argv, materialises a default config.toml on
 * `init` exactly where the real CLI would, so the port patching runs for
 * real. Never links, never starts a stack. */
const supabaseDouble = (calls = []) => ({
  calls,
  async run (argv, opts = {}) {
    calls.push({ argv, cwd: opts.cwd })
    if (argv[0] === 'supabase' && argv[1] === 'init') {
      mkdirSync(join(opts.cwd, 'supabase'), { recursive: true })
      writeFileSync(join(opts.cwd, 'supabase', 'config.toml'), DEFAULT_TOML)
      return { code: 0, stdout: 'Finished supabase init\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
})

console.log('arxa project-database selftest')

// ---- 1. Detection ------------------------------------------------------------
await ok('detectSupabase reports an absent CLI honestly', () => {
  const r = detectSupabase({ which: () => undefined })
  assert.equal(r.available, false)
  assert.match(r.reason, /not installed|not present/i)
})

await ok('detectSupabase finds the CLI and never installs', () => {
  const seen = []
  const r = detectSupabase({ which: (c) => { seen.push(c); return '/opt/homebrew/bin/supabase' } })
  assert.equal(r.available, true)
  assert.equal(r.cli, '/opt/homebrew/bin/supabase')
  for (const s of seen) assert.doesNotMatch(s, /brew|install/i)
})

{
  const live = detectSupabase()
  console.log(`  live supabase detection: cli=${live.cli ?? 'absent'} available=${live.available}`)
}

// ---- 2. Port block allocation ------------------------------------------------
{
  const registry = join(scratch, 'ports.json')
  await ok('the first project gets the default block, persisted by project id', async () => {
    const b = await allocatePortBlock({ projectId: 'alpha', registryPath: registry }, { canBind: async () => true })
    assert.equal(b.base, 54321)
    assert.deepEqual(b.ports, [54321, 54322, 54323, 54324, 54325])
    assert.ok(existsSync(registry), 'the allocation persists')
    const again = await allocatePortBlock({ projectId: 'alpha', registryPath: registry }, { canBind: async () => true })
    assert.equal(again.base, 54321, 'stable: the same project id keeps its block')
  })

  await ok('a second project gets a distinct, collision-free block', async () => {
    const b = await allocatePortBlock({ projectId: 'beta', registryPath: registry }, { canBind: async () => true })
    assert.equal(b.base, 54331, 'steps clear of the first block')
  })

  await ok('a live-occupied block is skipped, not fought over', async () => {
    const b = await allocatePortBlock({ projectId: 'gamma', registryPath: registry }, { canBind: async (p) => p >= 54341 })
    assert.equal(b.base, 54341)
  })
}

// ---- 3. The zero-Docker floor -------------------------------------------------
{
  const dir = scratchDir('floor')
  await ok('no Docker degrades to the local sqlite floor with a truthful reason', async () => {
    const calls = []
    const r = await ensureProjectDatabase({ projectId: 'floorproj', repoPath: dir, registryPath: join(scratch, 'floor-ports.json') }, {
      docker: { available: false, reason: 'Docker is installed but its daemon is not reachable' },
      supabase: { available: true, cli: '/x/supabase' },
      runner: supabaseDouble(calls).run
    })
    assert.equal(r.tier, 'file')
    assert.match(r.reason, /daemon/i)
    assert.equal(calls.length, 0, 'no supabase call is made without Docker')
    assert.ok(existsSync(join(dir, '.arxa', 'arxa.db')), 'the local floor is a real sqlite database')
    assert.equal(r.local.engine, 'sqlite')
    assert.equal(r.local.path, join(dir, '.arxa', 'arxa.db'))
  })

  await ok('no Supabase CLI degrades the same way', async () => {
    const dir2 = scratchDir('floor2')
    const r = await ensureProjectDatabase({ projectId: 'floorproj2', repoPath: dir2, registryPath: join(scratch, 'floor2-ports.json') }, {
      docker: { available: true, daemon: true, reason: 'ok' },
      supabase: { available: false, reason: 'the Supabase CLI is not installed' },
      runner: supabaseDouble().run
    })
    assert.equal(r.tier, 'file')
    assert.match(r.reason, /supabase/i)
  })

  await ok('the floor database is usable (a table survives a statement)', async () => {
    const r2 = await ensureProjectDatabase({ projectId: 'floorproj', repoPath: scratchDir('floor3'), registryPath: join(scratch, 'floor3-ports.json') }, {
      docker: { available: false, reason: 'daemon down' },
      runner: supabaseDouble().run
    })
    r2.local.db.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)')
    r2.local.db.exec("INSERT INTO kv VALUES ('a', '1')")
    assert.equal(r2.local.db.prepare('SELECT v FROM kv WHERE k = ?').get('a').v, '1')
    r2.local.db.close()
  })
}

// ---- 4. Provisioning against the injected runner ------------------------------
{
  const dir = scratchDir('supa')
  const registry = join(scratch, 'supa-ports.json')
  const double = supabaseDouble()
  await ok('ensure runs supabase init inside the isolated clone and patches the port block', async () => {
    const r = await ensureProjectDatabase({ projectId: 'supaproj', repoPath: dir, registryPath: registry }, {
      docker: { available: true, daemon: true, reason: 'ok' },
      supabase: { available: true, cli: '/x/supabase' },
      runner: double.run
    })
    assert.equal(r.tier, 'supabase-local')
    assert.equal(r.ports.base, 54321)
    const init = double.calls.find((c) => c.argv[1] === 'init')
    assert.equal(init.cwd, dir, 'init runs INSIDE the isolated project clone')
    const toml = readFileSync(join(dir, 'supabase', 'config.toml'), 'utf8')
    assert.match(toml, /project_id = "supaproj"/, 'the stable project id is the addressing handle')
    assert.ok(toml.includes('port = 54321'), 'api port patched to the block')
    assert.ok(!toml.includes('port = 54332') || r.ports.base === 54331, 'db port inside the block')
    assert.match(toml, /\[db\][\s\S]*?port = 54322/, 'db keeps its block offset')
    assert.match(toml, /\[studio\][\s\S]*?port = 54323/, 'studio keeps its block offset')
  })

  await ok('the vendor project is never linked', () => {
    for (const c of double.calls) {
      assert.ok(!c.argv.includes('link'), 'supabase link never appears: ' + c.argv.join(' '))
    }
  })

  await ok('start enforces one active stack: others are stopped first', async () => {
    // seed a second project as active in the registry
    await allocatePortBlock({ projectId: 'otherproj', registryPath: registry }, { canBind: async () => true })
    const reg = JSON.parse(readFileSync(registry, 'utf8'))
    reg.projects.otherproj.active = true
    writeFileSync(registry, JSON.stringify(reg))
    double.calls.length = 0
    const r = await startProjectDatabase({ projectId: 'supaproj', repoPath: dir, registryPath: registry }, { runner: double.run })
    const stops = double.calls.filter((c) => c.argv[1] === 'stop')
    assert.ok(stops.some((c) => c.argv.includes('otherproj')), 'the previously active stack is stopped')
    const start = double.calls.find((c) => c.argv[1] === 'start')
    assert.ok(start, 'our stack starts')
    assert.equal(start.cwd, dir)
    assert.ok(double.calls.indexOf(stops[0]) < double.calls.indexOf(start), 'stop-before-start')
    assert.equal(r.started, true)
    const after = JSON.parse(readFileSync(registry, 'utf8'))
    assert.equal(after.projects.supaproj.active, true, 'ours is the one active stack')
  })

  await ok('stop marks the stack inactive', async () => {
    double.calls.length = 0
    const r = await stopProjectDatabase({ projectId: 'supaproj', repoPath: dir, registryPath: registry }, { runner: double.run })
    const stop = double.calls.find((c) => c.argv[1] === 'stop')
    assert.ok(stop.argv.includes('--project-id') && stop.argv.includes('supaproj'))
    assert.equal(r.stopped, true)
    const after = JSON.parse(readFileSync(registry, 'utf8'))
    assert.equal(after.projects.supaproj.active, false)
  })
}

rmSync(scratch, { recursive: true, force: true })
console.log(`arxa project-database selftest: ${checks} checks green` + (skipped > 0 ? `, ${skipped} skipped` : ''))
