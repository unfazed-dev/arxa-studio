import { strict as assert } from 'node:assert'
import { BLOCKED_ENV, scrubEnv } from './lib/env.js'

let n = 0; const ok = (name) => { n++; console.log(`  ok ${name}`) }

const input = {
  PATH: '/usr/bin', HOME: '/Users/x',
  ANTHROPIC_API_KEY: 'sk-ant-FAKE-FOR-TEST', ANTHROPIC_AUTH_TOKEN: 'tok-FAKE',
  ANTHROPIC_BASE_URL: 'http://example.com', CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1',
  CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', KEEP_ME: 'y', UNDEF: undefined,
}

const out = scrubEnv(input, { version: '0.1.0' })

for (const k of BLOCKED_ENV) assert.equal(k in out, false, `${k} must be stripped`); ok('all blocked vars stripped')
assert.equal(out.PATH, '/usr/bin'); ok('PATH preserved')
assert.equal(out.KEEP_ME, 'y'); ok('unrelated vars preserved')
assert.equal('UNDEF' in out, false); ok('undefined values filtered')
assert.equal(out.CLAUDE_AGENT_SDK_CLIENT_APP, 'arxa-studio/0.1.0'); ok('client app set')
assert.notEqual(out, input); ok('output is new object')

console.log(`\n# ${n} ok`)
