// Pins for the Models-page seat: host and client halves must agree on the namespace and the
// channel, and the package must declare the client half so dsh-client-modules serves it.
import { strict as assert } from 'node:assert'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NS } from './index.mjs'
import { ACCOUNT_CHANNEL } from './lib/account.js'
import { PROVIDER_ID, PROVIDER_NAME } from './lib/models.js'

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const here = dirname(fileURLToPath(import.meta.url))
const host = readFileSync(join(here, 'index.mjs'), 'utf8')
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))

assert.equal(NS, 'arxa-claude-code')
assert.ok(host.includes(`ctx.llm.registerConfigurableProviders([{ provider: PROVIDER_ID, displayName: PROVIDER_NAME, settingsNs: NS, settingsPath: [] }])`), 'the row: directory entry under NS')
assert.ok(host.includes('sctx.settings.installSection(ctx, NS, Config,'), 'the row: a settings section under the same NS (the page hides rows without one)')
assert.ok(host.includes("ctx.inject(['connection'], (cctx) => cctx.connection.rpc.handle(ACCOUNT_CHANNEL, account, { authority: 'trusted-host' }))"), 'the wire: account RPC on the trusted-host authority')
ok(`host: ${PROVIDER_ID} is a configurable provider "${PROVIDER_NAME}" with section ${NS} and the account channel`)

assert.ok(client.includes(`const NS = '${NS}'`), 'client NS mirrors index.mjs')
assert.ok(client.includes(`const ACCOUNT_CHANNEL = '${ACCOUNT_CHANNEL}'`), 'client channel mirrors lib/account.js')
assert.ok(client.includes("name: 'settings.models.provider-card',\n        key: NS,"), 'the card registers on the keyed provider-card slot under NS')
for (const ep of ["call('status', { force: force === true })", "call('status', { force: true })", "call('signout')"]) assert.ok(client.includes(ep), `client uses endpoint ${ep}`)
assert.ok(!/auth login['"]?\s*\)|spawn|child_process/.test(client), 'D6: the browser half never starts a login')
assert.ok(client.includes('Your terminal signs out too'), 'sign-out warns about the shared CLI session before acting')
ok('client: keyed card under NS, same channel, status/signout only, sign-out confirmed first')

assert.equal(pkg.exports['./client'], './lib/client.js')
assert.deepEqual(pkg.dsh.client, { inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-settings-models'], platform: 'web' })
ok('package: ./client exported and dsh.client declared (served as arxa-claude-code/client.js by nearestPackage)')

// The card borrows dsh's own row-button classes. They are hashed per build; @deepseek-ai/* is
// pinned exactly, so the hash is stable until a bump — and this is what notices the bump.
const req = createRequire(import.meta.url)
let bundle
try { bundle = req.resolve('@deepseek-ai/dsh-client-ui-settings-models/package.json') } catch {}
if (bundle && existsSync(join(dirname(bundle), 'lib', 'client.js'))) {
  const src = readFileSync(join(dirname(bundle), 'lib', 'client.js'), 'utf8')
  for (const cls of ['zGbnIq_secondaryButton', 'zGbnIq_dangerButton']) {
    assert.ok(client.includes(cls), `client uses ${cls}`)
    assert.ok(src.includes(cls), `${cls} still exists in the installed settings-models bundle`)
  }
  assert.ok(src.includes('"settings.models.provider-card": {\n\t\t\t\t\t\tkind: "keyed"'), 'the slot is still keyed in the installed bundle')
  ok('stock classes and the keyed slot still exist in the installed dsh-client-ui-settings-models')
}

console.log(`selftest.surface: ${n} ok`)
