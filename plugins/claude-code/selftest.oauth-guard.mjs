// Tripwire: the hide in lib/auth-flow.js relies on four unpublished facts about the installed
// dsh + pi-ai. If an upgrade changes any of them the spoofed Claude.ai login silently returns to
// arxa's login list. Fail RED naming the fact. Fail RED too — never silently pass — if a
// dependency can't even be found, since that means this tripwire is no longer pointed at
// anything and needs re-pointing before it can vouch for the hide again.
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let passed = 0
const ok = (msg) => { passed++; console.log(`ok ${passed} - ${msg}`) }

const readInstalled = (pkg) => {
  let path
  try {
    path = require.resolve(pkg)
  } catch {
    assert.fail(`${pkg} is not installed where expected — selftest.oauth-guard needs re-pointing at its new location`)
  }
  return readFileSync(path, 'utf8')
}

// @earendil-works/pi-ai ships ESM-only (an "import"-only exports map, no "require" condition),
// so require.resolve can't reach it — and its wildcard "./providers/*" export resolves a path
// string without checking the file exists, so the failure only shows up at the read. Both paths
// land on the same re-pointing message: either way this tripwire can no longer vouch for the fact.
const readInstalledEsm = (specifier, label) => {
  try {
    return readFileSync(new URL(import.meta.resolve(specifier)), 'utf8')
  } catch {
    assert.fail(`${label} is not installed where expected — selftest.oauth-guard needs re-pointing at its new location`)
  }
}

const piai = readInstalled('@deepseek-ai/dsh-llm-pi-ai')
const auth = readInstalled('@deepseek-ai/dsh-authorization')
const anthropicProvider = readInstalledEsm('@earendil-works/pi-ai/providers/anthropic', '@earendil-works/pi-ai/providers/anthropic')

// The installed source wraps this object literal across lines:
//   methods.push({
//     id: "oauth",
//     label: ...
//   })
// \s* tolerates that formatting without loosening the check — rename the id (e.g. to "sso")
// and this still fails, because the string "oauth" is gone, not just the spacing.
assert.match(piai, /methods\.push\(\{\s*id:\s*"oauth"/, 'pi-ai no longer labels its OAuth login method "oauth"')
ok('pi-ai still labels its OAuth login method "oauth"')

assert.match(piai, /const RECORD_SCOPE = "llm-pi-ai"/, 'pi-ai credential scope changed; update ANTHROPIC_PIAI_KEY')
ok('pi-ai credential scope is still "llm-pi-ai"')

assert.match(auth, /this\.flows\.set\(flow\.key, flow\)/, 'AuthorizationService no longer keeps flows in this.flows')
ok('AuthorizationService still keeps flows in this.flows')

// The fact ANTHROPIC_PIAI_KEY depends on but the other three don't check: pi-ai's catalog
// provider id is still "anthropic". If this is ever renamed, ANTHROPIC_PIAI_KEY stops matching
// the real flow's key, hideAnthropicOauth becomes a silent no-op, and the other three assertions
// above stay green throughout — this is the only check that catches that failure.
assert.match(anthropicProvider, /createProvider\(\{\s*id:\s*"anthropic"/, 'pi-ai renamed its catalog Anthropic provider id away from "anthropic" — update ANTHROPIC_PIAI_KEY in lib/auth-flow.js to match, or the hide silently stops working')
ok('pi-ai catalog Anthropic provider id is still "anthropic"')

console.log(`# ${passed} ok`)
