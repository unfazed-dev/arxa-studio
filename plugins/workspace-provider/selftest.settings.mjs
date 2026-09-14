/**
 * The Workspace-backend settings section (task 14 step 5): the browser half
 * carries its EN/PL/FR dictionary through the arxa-locale service, the host
 * half answers the panel's info RPC with truthful capability badges, and the
 * settings may only ever select `local`, `supabase`, or `generic-rest` (D32).
 *
 * client.js is a browser-half __ModuleLoader__ factory (window at top level),
 * so its dictionary is checked statically; the host half (lib/index.js) is
 * node-importable and driven for real, RPC handler included.
 *
 * Run: node plugins/workspace-provider/selftest.settings.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { capabilitiesFor, configShape, default as hostPlugin, RPC_CHANNEL } from './lib/index.js'
import { SUPABASE_CAPABILITIES } from './lib/supabase.js'
import { LOCAL_CAPABILITIES } from './lib/capabilities.js'

const here = dirname(fileURLToPath(import.meta.url))
let n = 0
const ok = (s) => { n++; console.log('  ok ' + s) }

// drive the host RPC handler exactly as the dsh connection would
async function rpcCall (endpoint = 'info') {
  let handler = null
  const ctx = {
    inject (deps, cb) {
      assert.deepEqual(deps, ['connection'], 'the host half injects only the connection')
      cb({
        connection: { rpc: { handle: (channel, fn) => { handler = fn } } },
      })
    },
  }
  hostPlugin.apply(ctx)
  assert.equal(typeof handler, 'function', 'the RPC channel was registered')
  return handler(endpoint)
}

// The dsh Connection RPC wire law, mirrored from the transport pair so this
// suite fails if the host half drifts off it again (E3/L3, closeout 2026-09-14):
// the engine hands the handler's return to the browser VERBATIM as the
// server-response `result` (dsh-client-connection rpcFetchHandler → fullResponse),
// and the browser's parseConnectionResponse accepts only {ok:true, value} or
// {ok:false, error:{code,message,details}} — a bare record reads as
// "connection: invalid server-response result" and wp.info() rejects.
const lawfulResult = (result) => {
  const rec = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!rec(result)) return false
  if (result.ok === true) return true
  if (result.ok !== false) return false
  return typeof result.error?.code === 'string' && typeof result.error?.message === 'string' && rec(result.error?.details)
}

const scratch = mkdtempSync(join(tmpdir(), 'arxa-ws-settings-'))
const prevHome = process.env.ARXA_HOME
process.env.ARXA_HOME = scratch

try {
  // ---------------------------------------------- 1. capability badges are truthful per provider
  {
    const local = capabilitiesFor({})
    assert.equal(local.auth, true)
    assert.equal(local.realtime, true, 'local advertises its in-process realtime')

    const sb = capabilitiesFor({ provider: 'supabase' })
    assert.equal(sb.auth && sb.orgs && sb.records && sb.audit && sb.storage, true)
    assert.equal(sb.realtime, false, 'supabase honestly declares realtime ABSENT (polling degradation)')
    assert.equal(sb.analytics, false)
    assert.equal(sb.signIn.kind, 'email-form', 'the declared sign-in flow is the reference email form')
    assert.deepEqual(sb.signIn, (await import('./lib/supabase.js')).SIGN_IN, 'the badge and the adapter agree on the flow')

    assert.equal(capabilitiesFor({ provider: 'generic-rest' }), null,
      'generic-rest capabilities need a live fetch — the panel never gets a stale guess')
    ok('capabilitiesFor: local full, supabase truthful (realtime off, email-form), generic-rest deferred to a live call')
  }

  // ---------------------------------------------- 2. the host RPC answers for the panel
  // E3/L3 (closeout 2026-09-14): the result envelope IS the wire contract —
  // a bare record made wp.info() reject on every fresh boot.
  {
    const result = await rpcCall('info')
    assert.ok(lawfulResult(result), 'task 13 step 9 / E3: the info RPC result is a lawful dsh server-response result (ok/value or ok/error), never a bare record')
    assert.equal(result.ok, true)
    const info = result.value
    assert.equal(info.provider, 'local', 'zero-config default is local (local-first parity)')
    assert.equal(info.capabilities.realtime, true)
    assert.deepEqual(info.config, configShape({}), 'the config shape rides along, values never do')

    writeFileSync(join(scratch, 'studio.json'), JSON.stringify({
      workspaceBackend: { provider: 'supabase', supabase: { url: 'https://proj.example.supabase.test', anonKey: 'anon-test' } },
    }))
    const sbResult = await rpcCall('info')
    assert.ok(lawfulResult(sbResult), 'the supabase-configured answer is lawful too')
    assert.equal(sbResult.value.provider, 'supabase')
    assert.equal(sbResult.value.capabilities.realtime, false, 'the badge is degraded, honestly')
    assert.equal(sbResult.value.capabilities.signIn.kind, 'email-form')
    assert.deepEqual(sbResult.value.config.sections, ['supabase'], 'config shape: section keys only')

    // an unknown endpoint answers INSIDE the envelope (code/message/details),
    // never a thrown string — the engine turns throws into opaque 500s.
    const bad = await rpcCall('nope')
    assert.ok(lawfulResult(bad) && bad.ok === false && /unknown endpoint/.test(bad.error.message),
      'unknown endpoint: lawful {ok:false, error:{code,message,details}} (code from the frozen ERROR_CODES set)')
    ok('RPC info: lawful envelope every answer — zero-config local; supabase → truthful badges + declared sign-in; unknown endpoint errors inside the envelope')
  }

  // ---------------------------------------------- 3. the browser half registers its dictionary with arxa-locale
  {
    const src = readFileSyncText()
    assert.ok(src.includes("ctx.locale.register(") || src.includes('.locale.register('),
      'client.js registers its dictionary through the arxa-locale service')
    assert.ok(/inject\s*=?\s*\[?['"]connection['"],\s*['"]locale['"]/.test(src)
      || src.includes("['connection', 'locale']"), 'locale is an injected dependency')

    // E3/L3: rpc.call resolves the dsh result envelope; info() must unwrap it
    // (resolve value, reject on error) — the section model and the evidence
    // gate consume the BARE record, not the envelope.
    assert.ok(src.includes('const unwrap = (res) =>'),
      'client.js declares the envelope unwrap for rpc.call results')
    assert.ok(/info:\s*\(\)\s*=>\s*ctx\.connection\.rpc\.call\(RPC_CHANNEL,\s*'info',\s*\{\}\)\.then\(unwrap\)/.test(src),
      'info() unwraps the envelope — panel-facing callers get the bare record or a rejection')

    // the three tables: extract, compare key sets, and demand they differ
    const tables = extractLocaleTables(src)
    assert.deepEqual([...new Set(['en', 'pl', 'fr'].filter((l) => tables[l]))].sort(), ['en', 'fr', 'pl'],
      'en/pl/fr tables all present')
    const keys = {}
    for (const loc of ['en', 'pl', 'fr']) {
      assert.ok(Object.keys(tables[loc]).length >= 6, loc + ' covers the section vocabulary')
      keys[loc] = Object.keys(tables[loc]).sort().join()
    }
    assert.equal(keys.en, keys.pl, 'en and pl cover the same keys')
    assert.equal(keys.en, keys.fr, 'en and fr cover the same keys')
    assert.notEqual(JSON.stringify(tables.en), JSON.stringify(tables.pl), 'pl is a real translation, not a copy')
    assert.notEqual(JSON.stringify(tables.en), JSON.stringify(tables.fr), 'fr is a real translation, not a copy')

    const en = tables.en
    for (const needle of ['sectionTitle', 'badgeLive', 'badgeDegraded', 'verifyHint'])
      assert.ok(needle in en, 'the dictionary carries ' + needle)
    for (const provider of ['providerLocal', 'providerSupabase', 'providerGenericRest'])
      assert.ok(provider in en, 'all three D32 providers have a label')
    for (const kind of ['signInEmailForm', 'signInToken', 'signInBrowser', 'signInDeviceCode'])
      assert.ok(kind in en, 'the sign-in kind vocabulary has a label')
    ok('client.js: arxa-locale registration, en/pl/fr with identical key sets, real translations, badge + provider + sign-in vocabulary')
  }

  // ---------------------------------------------- 4. the package exports the adapter
  {
    const pkg = JSON.parse(readFileSyncText(join(here, 'package.json')))
    assert.equal(pkg.exports['./supabase'], './lib/supabase.js', 'the supabase adapter is a first-party export')
    assert.ok(existsSync(join(here, 'lib', 'supabase.js')))
    ok('package.json: ./supabase exported for first-party consumers (D32: no third-party JS)')
  }

} catch (e) {
  console.error(e)
  process.exitCode = 1
  throw e
} finally {
  if (prevHome !== undefined) process.env.ARXA_HOME = prevHome; else delete process.env.ARXA_HOME
  rmSync(scratch, { recursive: true, force: true })
}

console.log(`workspace-provider settings: ${n} checks green`)

// ---------------------------------------------------------------- helpers
import { readFileSync as rf } from 'node:fs'
function readFileSyncText (file = join(here, 'lib', 'client.js')) { return rf(file, 'utf8') }

/** Pull the three locale tables out of client.js's `const DICT = { en: {...}, pl: {...}, fr: {...} }`. */
function extractLocaleTables (src) {
  // find `= {` after a DICT-ish declaration, then balance braces to the close
  const marker = src.match(/(?:DICT(?:IONARIES)?|STRINGS|LOCALES)\s*=\s*\{/)
  assert.ok(marker, 'client.js declares a locale dictionary constant')
  const start = marker.index + marker[0].length - 1 // at '{'
  let depth = 0, end = -1
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  assert.ok(end > 0, 'the dictionary closes')
  return (0, eval)('(' + src.slice(start, end + 1) + ')')
}
