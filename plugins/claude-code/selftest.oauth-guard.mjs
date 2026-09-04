// Tripwire: the hide in lib/auth-flow.js relies on three unpublished facts about the installed
// dsh. If a dsh upgrade changes any of them the spoofed Claude.ai login silently returns to
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

const piai = readInstalled('@deepseek-ai/dsh-llm-pi-ai')
const auth = readInstalled('@deepseek-ai/dsh-authorization')

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

console.log(`# ${passed} ok`)
