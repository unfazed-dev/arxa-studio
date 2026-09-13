/**
 * Canonical CLI spellings (task 13 steps 7–8): `arxa-studio workspace
 * export|import`, `arxa-studio provider verify`, `arxa-studio diagnose` are
 * the ONLY spellings, dispatched from bin/arxa-studio.mjs BEFORE normal
 * studio boot (no dsh spawn, no pnpm, no profile writes). provider verify
 * prints every conformance section and exits nonzero on any required red
 * row; diagnose emits a redacted, user-inspectable bundle with no tokens,
 * secrets, or client records. All output strings exist en/pl/fr.
 *
 * Run: node bin/selftest.provider-cli.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LocalWorkspaceProvider } from '../plugins/workspace-provider/lib/local.js'

const here = dirname(fileURLToPath(import.meta.url))
let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }
const scratch = mkdtempSync(join(tmpdir(), 'arxa-ws-cli-'))
const other = mkdtempSync(join(tmpdir(), 'arxa-ws-cli-target-'))

const run = (bin, args, env = {}) => spawnSync(process.execPath, [join(here, bin), ...args], {
  encoding: 'utf8',
  env: { ...process.env, ARXA_HOME: env.ARXA_HOME ?? scratch, ARXA_LOCALE: env.ARXA_LOCALE, ...(env.extra ?? {}) },
})

try {
  // A source org the export command will bundle.
  const provider = new LocalWorkspaceProvider({ home: scratch })
  const org = await provider.createOrg({ name: 'cli-org', kind: 'agency' })
  await provider.putRecord(org.id, 'tickets', 'cli-1', { title: 'from the cli' })

  // ---------------------------------------------- 1. provider verify through the launcher
  {
    const r = run('arxa-studio.mjs', ['provider', 'verify'])
    assert.equal(r.status, 0, 'exit 0 on all-green\n' + r.stdout + r.stderr)
    assert.ok(r.stdout.includes('cross-org-isolation'), 'EVERY section prints, including the n/a one')
    assert.ok(r.stdout.includes('n/a (single-user local store)'), 'the local exemption in its exact words')
    assert.ok(!r.stdout.split('\n').some((l) => /^RED/.test(l)), 'no red row')
    ok('launcher dispatch: `arxa-studio provider verify` exits 0, prints every section, no studio boot')
  }

  // ---------------------------------------------- 2. no profile/dsh writes on the CLI path
  {
    assert.ok(!existsSync(join(scratch, 'dsh', 'profiles', 'arxa', 'package.json')),
      'the CLI dispatch happens BEFORE profile materialization')
    ok('dispatch precedes studio boot: no profile materialized')
  }

  // ---------------------------------------------- 3. workspace export / import (the only spellings)
  {
    const out = join(scratch, 'bundle-out')
    const r = run('arxa-studio.mjs', ['workspace', 'export', '--org', org.id, '--out', out])
    assert.equal(r.status, 0, r.stderr)
    assert.ok(existsSync(join(out, 'manifest.json')), 'bundle written with manifest')

    // The target is a second scratch home: default local provider, zero
    // config (an absolute local.root would be rejected by the frozen D32
    // guard — path-like values never enter workspaceBackend config).
    const r2 = run('arxa-studio.mjs', ['workspace', 'import', out], { ARXA_HOME: other })
    assert.equal(r2.status, 0, r2.stderr)
    const moved = new LocalWorkspaceProvider({ home: other })
    const orgs = await moved.listOrgs()
    assert.ok(orgs.some((o) => o.name === 'cli-org (imported)'), 'org re-created on the target provider')
    ok('`workspace export` / `workspace import`: bundle round-trip through the canonical spellings')
  }

  // ---------------------------------------------- 4. diagnose: redacted, bounded, useful
  {
    // Seed a bounded, SECRET-BEARING engine log — diagnose must tail it redacted.
    const dshDir = join(scratch, 'dsh')
    mkdirSync(dshDir, { recursive: true })
    const secret = 'sk-live-SECRET0123456789abcdefXYZ'
    const bearer = 'Bearer eyJhbGciOiJ9.VERYLONGOPAQUEVALUE.abcdef'
    writeFileSync(join(dshDir, 'engine.log'),
      Array.from({ length: 80 }, (_, i) => `line ${i} fine`).join('\n') + '\nplugin failed token=' + secret + ' auth ' + bearer + '\n')

    const r = run('arxa-studio.mjs', ['diagnose'])
    assert.equal(r.status, 0, r.stderr)
    const out = r.stdout
    for (const needle of ['cross-org-isolation', 'n/a (single-user local store)', 'wire', 'node', 'provider: local'])
      assert.ok(out.includes(needle), 'diagnose carries ' + needle)
    assert.ok(out.includes('line 79 fine') || out.includes('plugin failed'), 'bounded error-log tail included')
    assert.ok(!out.includes(secret), 'no raw secret')
    assert.ok(!out.includes(bearer), 'no raw bearer')
    assert.ok(!out.includes('VERYLONGOPAQUEVALUE'), 'opaque material redacted')
    const r2 = run('arxa-studio.mjs', ['diagnose', '--out', join(scratch, 'diag.txt')])
    assert.equal(r2.status, 0, r2.stderr)
    assert.ok(existsSync(join(scratch, 'diag.txt')), '--out writes the bundle to a file')
    ok('diagnose: versions + config shape + verify results + bounded redacted logs; no tokens/secrets')
  }

  // ---------------------------------------------- 5. exit nonzero on any red row
  {
    // generic-rest pointing at a dead local port: every network section red.
    const deadCfg = join(scratch, 'dead.json')
    writeFileSync(deadCfg, JSON.stringify({ workspaceBackend: { provider: 'generic-rest', 'generic-rest': { baseUrl: 'http://127.0.0.1:9/x' } } }))
    const r = run('arxa-studio.mjs', ['provider', 'verify', '--config', deadCfg])
    assert.notEqual(r.status, 0, 'a red row means a nonzero exit')
    assert.ok(r.stdout.split('\n').some((l) => /^RED/.test(l)), 'the red rows print')
    ok('provider verify: nonzero exit on red, rows printed')
  }

  // ---------------------------------------------- 6. the config guard is enforced at the door
  {
    const badCfg = join(scratch, 'bad.json')
    writeFileSync(badCfg, JSON.stringify({ workspaceBackend: { provider: 'custom', adapter: './x.mjs' } }))
    const r = run('arxa-studio.mjs', ['provider', 'verify', '--config', badCfg])
    assert.notEqual(r.status, 0)
    assert.ok(r.stdout.includes('executable code') || r.stderr.includes('executable code'), 'the D32 reason surfaces')
    ok('config guard: adapter/custom provider rejected by the CLI')
  }

  // ---------------------------------------------- 7. en/pl/fr
  {
    for (const loc of ['en', 'pl', 'fr']) {
      const r = run('arxa-studio.mjs', ['provider', 'verify'], { ARXA_LOCALE: loc })
      assert.equal(r.status, 0, loc + ': ' + r.stderr)
      assert.ok(r.stdout.length > 0, loc + ' prints')
    }
    const en = run('arxa-studio.mjs', ['provider', 'verify'], { ARXA_LOCALE: 'en' }).stdout
    const pl = run('arxa-studio.mjs', ['provider', 'verify'], { ARXA_LOCALE: 'pl' }).stdout
    const fr = run('arxa-studio.mjs', ['provider', 'verify'], { ARXA_LOCALE: 'fr' }).stdout
    assert.ok(en !== pl && en !== fr, 'the locales actually differ (three real tables, not copies)')
    ok('locale: en/pl/fr string tables all render and differ')
  }

  // ---------------------------------------------- 8. only the four spellings dispatch
  {
    // `provider check` is NOT a CLI subcommand: it falls through to studio
    // boot. --materialise-only makes that path exit fast WITHOUT spawning the
    // engine (no port bind inside a test) while still proving the CLI did not
    // swallow the unknown subcommand.
    const r = run('arxa-studio.mjs', ['provider', 'check', '--materialise-only'])
    assert.ok(!r.stdout.includes('conformance'), 'unknown subcommands are not swallowed by the CLI')
    ok('unknown subcommands fall through to normal studio boot')

    // The same run materialized the profile — the plugin must ride it:
    // PROFILE_PLUGINS (profile package.json), the cordis row, and a browser
    // half discoverable through package.json dsh.client.
    const profileDir = join(scratch, 'dsh', 'profiles', 'arxa')
    const deps = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies
    assert.ok(deps['arxa-workspace-provider'], 'profile package.json depends on arxa-workspace-provider')
    const patch = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    assert.ok(patch.includes('arxa-workspace-provider'), 'the cordis patch carries the service row')
    const pkg = JSON.parse(readFileSync(join(here, '..', 'plugins', 'workspace-provider', 'package.json'), 'utf8'))
    assert.ok(pkg.dsh?.client, 'the plugin declares its browser half (dsh.client)')
    assert.ok(existsSync(join(here, '..', 'plugins', 'workspace-provider', 'lib', 'client.js')), 'browser half exists')
    assert.ok(existsSync(join(here, '..', 'plugins', 'workspace-provider', 'lib', 'index.js')), 'host half exists')
    ok('runtime + package inclusion: profile dep, cordis row, host/client halves')
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(other, { recursive: true, force: true })
}

console.log(`workspace-provider CLI: ${n} checks green`)
