/**
 * arxa-mcp-apps self-check. `node plugins/mcp-apps/selftest.mjs`.
 *
 * Runs the host half against the REAL MCP server in testserver.mjs over a
 * real stdio transport — not a mock — so the parts that would otherwise only
 * be verified by hope are exercised: `_meta` survives, `ui://` resources read
 * back, discovery discriminates UI tools from plain ones, the CSP is built
 * deny-by-default, and the tools/call proxy allowlist actually refuses.
 */
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { apply, buildCsp, uiDescriptorOf } from './lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))

let passed = 0
const checkAsync = async (label, fn) => {
  try { await fn(); console.log(`  ok  ${label}`); passed++ } catch (e) {
    console.error(`  FAIL ${label}\n       ${e.message}`); process.exitCode = 1
  }
}

console.log('arxa-mcp-apps selftest')

// --- pure units first ----------------------------------------------------
await checkAsync('uiDescriptorOf reads SEP-1865 and the legacy MCP-UI key', async () => {
  assert.equal(uiDescriptorOf({ _meta: { ui: { resourceUri: 'ui://a/b' } } }).resourceUri, 'ui://a/b')
  assert.equal(uiDescriptorOf({ _meta: { 'mcpui.dev/ui-resource-uri': 'ui://c/d' } }).resourceUri, 'ui://c/d')
  assert.equal(uiDescriptorOf({}), undefined)
  assert.equal(uiDescriptorOf({ _meta: { ui: {} } }), undefined)
})

await checkAsync('buildCsp is deny-by-default and only tightens', async () => {
  const bare = buildCsp(undefined)
  assert.match(bare, /default-src 'none'/)
  assert.match(bare, /connect-src 'none'/)
  assert.match(bare, /frame-src 'none'/)
  const declared = buildCsp({ connectDomains: ['https://api.example.com'] })
  assert.match(declared, /connect-src https:\/\/api\.example\.com/)
  // A declared domain must not silently unlock the others.
  assert.match(declared, /frame-src 'none'/)
})

// --- against the real server --------------------------------------------
let rpcHandler = null
// discover() swallows every failure into logger.warn and returns 0 templates,
// so a discarded warning turns a real connect/spawn error into a bare
// "got (none)" with no cause. Keep them and put them in the failure message.
const warnings = []
const ctx = {
  logger: { warn: (m) => { warnings.push(String(m)) } },
  connection: { rpc: { handle: (_c, handler) => { rpcHandler = handler; return () => {} } } },
  effect: () => {},
}

apply(ctx, {
  serverName: 'arxatest',
  transport: 'stdio',
  command: process.execPath,
  args: [join(here, 'testserver.mjs')],
})

await checkAsync('discovers only the UI-declaring tool, over real stdio MCP', async () => {
  const res = await rpcHandler('templates', {})
  assert.equal(res.ok, true, 'templates call failed')
  const names = Object.keys(res.value.templates)
  assert.deepEqual(names, ['mcp__arxatest__show_counter'],
    `expected only the UI tool, got ${names.join(', ') || '(none)'}`
    + (warnings.length ? ` | discovery warned: ${warnings.join(' ; ')}` : ' | discovery reported no error'))
  const t = res.value.templates['mcp__arxatest__show_counter']
  assert.equal(t.resourceUri, 'ui://arxa-test/counter')
  assert.match(t.html, /<button id="inc">/, 'template HTML did not come through')
  assert.match(t.csp, /default-src 'none'/)
  assert.deepEqual(t.preferredSize, { width: 320, height: 160 })
})

await checkAsync('tools/call proxy forwards an advertised tool', async () => {
  const first = await rpcHandler('call', { name: 'bump', arguments: { by: 2 } })
  assert.equal(first.ok, true, JSON.stringify(first)
    + (warnings.length ? ` | discovery warned: ${warnings.join(' ; ')}` : ''))
  const text = (first.value.content ?? []).map((c) => c.text).join('')
  assert.match(text, /counter is 2/)
  const second = await rpcHandler('call', { name: 'bump', arguments: { by: 3 } })
  assert.match((second.value.content ?? []).map((c) => c.text).join(''), /counter is 5/)
})

await checkAsync('proxy refuses a tool the server never advertised', async () => {
  const res = await rpcHandler('call', { name: 'rm_rf', arguments: {} })
  assert.equal(res.ok, false)
  assert.match(res.error.message, /is not a tool of server/)
})

await checkAsync('unknown endpoints are refused', async () => {
  assert.equal((await rpcHandler('whatever', {})).ok, false)
})

console.log(process.exitCode ? 'FAILED' : `all ${passed} checks passed`)
process.exit(process.exitCode ?? 0)
