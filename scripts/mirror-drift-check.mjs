/**
 * Mirror drift gate (F6).
 *
 * MIRROR_TOOL_NAMES is what arxa passes as the SDK's `tools` option, and `tools`
 * is the RESTRICTION knob: a live built-in missing from the list is simply not
 * offered to the model. So drift is not a security hole in either direction —
 * it is a silent mismatch between what the pinned CLI ships and what arxa chose
 * to expose, and until 2026-09-04 the only way to see it was to read a live
 * init message by hand.
 *
 * Two diffs, and they are NOT symmetric in how much they prove:
 *
 *   missing  Live built-ins arxa does not offer. This signal is sound — the CLI
 *            advertised them. Adding any WIDENS what the model can reach inside
 *            the sandbox, so it is a product decision, never something this
 *            script or a passing suite decides quietly.
 *
 *   phantom  Mirror rows the CLI does not advertise UP FRONT. This is NOT proof
 *            the tool is gone: the captured init carries ToolSearch, and under
 *            tool-search the CLI defers most built-ins rather than listing them
 *            — Glob, Grep and TodoWrite all exist but do not appear. Since
 *            `tools` is the restriction knob, keeping a deferred name is
 *            CORRECT. Verify against the real CLI before removing any.
 *
 * The gate fails on CHANGE, not on the standing diff. The current diff is a
 * known, unruled baseline; failing on it would hold CI hostage to a decision
 * nobody has made. A name that ENTERS or LEAVES either diff after the fixture
 * was written is new drift and wants a human.
 *
 * Offline by default — never launches the binary, safe inside `npm test`.
 * Refresh when the pinned CLI moves:
 *
 *     node scripts/mirror-drift-check.mjs --capture --yes
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MIRROR_TOOL_NAMES } from '../plugins/claude-code/lib/mirror-tools.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(here, '..', 'plugins', 'claude-code', 'live-tools.json')
const diff = (a, b) => a.filter((x) => !b.includes(x))

function checkOffline () {
  if (!existsSync(FIXTURE)) {
    console.log('FAIL  mirror drift gate: no captured tool list at plugins/claude-code/live-tools.json')
    console.log('      capture one:  node scripts/mirror-drift-check.mjs --capture --yes')
    return 1
  }
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const live = fx.tools ?? []
  const missing = diff(live, MIRROR_TOOL_NAMES)
  const phantom = diff(MIRROR_TOOL_NAMES, live)
  const ack = fx.acknowledged ?? { missing: [], phantom: [] }

  console.log('mirror drift gate — CLI ' + (fx.cliVersion ?? '?') + ' captured ' + (fx.capturedAt ?? '?'))
  console.log('  live built-ins advertised: ' + live.length + '   MIRROR_TOOL_NAMES: ' + MIRROR_TOOL_NAMES.length)

  if (!missing.length && !phantom.length) {
    console.log('PASS  mirror drift gate: MIRROR_TOOL_NAMES matches the captured CLI list exactly')
    return 0
  }
  if (missing.length) {
    console.log('  missing (' + missing.length + ') — live built-ins arxa does NOT offer the model:')
    console.log('      ' + missing.join(', '))
    console.log('      Adding any of these widens what the model can reach. Product decision.')
  }
  if (phantom.length) {
    console.log('  phantom (' + phantom.length + ') — mirror rows the CLI does not advertise up front:')
    console.log('      ' + phantom.join(', '))
    console.log('      NOT proof they are gone — ToolSearch defers most built-ins (Glob, Grep and')
    console.log('      TodoWrite all exist but are absent here). Verify before removing any.')
  }

  const newMissing = diff(missing, ack.missing ?? [])
  const newPhantom = diff(phantom, ack.phantom ?? [])
  const goneMissing = diff(ack.missing ?? [], missing)
  const gonePhantom = diff(ack.phantom ?? [], phantom)
  const changed = [...newMissing, ...newPhantom, ...goneMissing, ...gonePhantom]

  if (!changed.length) {
    console.log('PASS  mirror drift gate: the diff matches the acknowledged baseline — no NEW drift.')
    if (fx.ruling) {
      console.log('      Ruled ' + fx.ruling.decided + ': ' + fx.ruling.outcome + '. ' + (fx.ruling.overturn ?? ''))
    } else {
      console.log('      The names above are an UNRULED decision, not a regression.')
    }
    return 0
  }
  if (newMissing.length) console.log('  NEW missing since the baseline: ' + newMissing.join(', '))
  if (newPhantom.length) console.log('  NEW phantom since the baseline: ' + newPhantom.join(', '))
  if (goneMissing.length) console.log('  no longer missing: ' + goneMissing.join(', '))
  if (gonePhantom.length) console.log('  no longer phantom: ' + gonePhantom.join(', '))
  console.log('FAIL  mirror drift gate: the mirror/CLI diff CHANGED. Either the pinned CLI moved')
  console.log('      (re-capture: node scripts/mirror-drift-check.mjs --capture --yes) or someone')
  console.log('      edited MIRROR_TOOL_NAMES. Rule on the names, then update `acknowledged`.')
  return 1
}

/** Live half: one real turn, purely to read init.tools. */
async function capture () {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { createRequire } = await import('node:module')
  const { Context } = await import('@deepseek-ai/cordis')
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const { resolveClaudeBinary } = await import('../plugins/claude-code/lib/probe.js')
  const { scrubEnv } = await import('../plugins/claude-code/lib/env.js')
  const { makeSpawner } = await import('../plugins/claude-code/lib/spawn.js')
  const require = createRequire(import.meta.url)
  // The SDK's exports map has no './package.json' (0.3.259) — resolve the entry, take its dir.
  const sdkRoot = dirname(require.resolve('@anthropic-ai/claude-agent-sdk'))
  const ws = mkdtempSync(join(tmpdir(), 'arxa-mirror-capture-'))

  const { default: ArxaSandboxProvider } = await import('../plugins/sandbox/lib/index.js')
  const sandbox = new ArxaSandboxProvider(new Context(), { runnerCommand: [], runnerFailureSignatures: [], probeTimeoutMs: 5000 })
  const policy = { mode: 'workspace-write', workspaceRoot: ws, sessionId: 'mirror-capture' }
  const env = scrubEnv(process.env, { version: 'mirror-capture' })
  const binary = resolveClaudeBinary({ env: process.env, platform: process.platform, arch: process.arch, sdkRoot })
  if (!binary) { console.log('capture: no claude binary on PATH and none bundled'); return 1 }

  const abort = new AbortController()
  // A real prompt on purpose: the CLI emits NO system/init until a prompt
  // actually yields, so a never-yielding one would hang and then die.
  const q = query({
    prompt: 'hi',
    options: {
      pathToClaudeCodeExecutable: binary, env, settingSources: [], persistSession: false,
      abortController: abort, cwd: ws,
      spawnClaudeCodeProcess: makeSpawner({ confine: (argv, p) => sandbox.confine(argv, p), policy }),
      systemPrompt: { type: 'custom', prompt: 'capture' }, permissionMode: 'default',
    },
  })
  const timer = setTimeout(() => abort.abort(), 30_000)
  let init
  try {
    ;({ value: init } = await q[Symbol.asyncIterator]().next())
  } finally { clearTimeout(timer); abort.abort(); try { await q.close?.() } catch { /* already down */ } }

  if (!init || init.type !== 'system' || init.subtype !== 'init') { console.log('capture: no init message'); return 1 }
  // Never record identity — only the tool list and the CLI version.
  if (init.apiKeySource !== 'none') { console.log('capture: refusing — apiKeySource=' + init.apiKeySource + ', expected a subscription turn'); return 1 }

  const tools = [...(init.tools ?? [])].sort()
  // Preserved across re-captures: wiping the baseline on every capture would
  // turn the gate green by forgetting, which is the opposite of its purpose.
  const prior = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')).acknowledged : null
  const acknowledged = prior ?? { missing: diff(tools, MIRROR_TOOL_NAMES), phantom: diff(MIRROR_TOOL_NAMES, tools) }
  if (!prior) console.log('capture: no prior baseline — recording the current diff as the acknowledged F6 baseline')

  writeFileSync(FIXTURE, JSON.stringify({
    cliVersion: init.claude_code_version ?? null,
    capturedAt: new Date().toISOString().slice(0, 10),
    note: 'Advertised init tool list. ToolSearch defers most built-ins, so this is NOT the full universe. Refresh: node scripts/mirror-drift-check.mjs --capture --yes',
    tools,
    acknowledged,
  }, null, 2) + '\n')
  console.log('capture: wrote ' + tools.length + ' advertised tool names for CLI ' + (init.claude_code_version ?? '?'))
  return 0
}

const wantCapture = process.argv.includes('--capture')
if (wantCapture && !process.argv.includes('--yes')) {
  console.log('capture starts ONE real turn against your Claude subscription — pass --yes')
  process.exit(0)
}
process.exit(wantCapture ? await capture() : checkOffline())
