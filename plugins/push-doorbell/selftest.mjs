// arxa-push-doorbell exit checks (arxa/docs/plans/doorbell-decision-2026-08-29.md):
// the gate defaults OFF and means zero traffic; the bearer is the pushd.env
// key SECRET (never the tenant); tokens come from pairing.json re-read per
// send; collapse_key is exactly `approval:<id>`; non-2xx/timeout/missing
// config are counted summaries, never throws into the engine.
// Run: node plugins/push-doorbell/selftest.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import {
  apiKeyFromEnv,
  appDataDir,
  doorbellConfig,
  notifyApprovalRequested,
  notifyTaskFinished,
  parseEnvFile,
  pushTargets,
} from './lib/index.js'

/** A stub cairn-pushd: records /v1/send requests, answers with a queued status. */
async function stubPushd(status = 202) {
  const hits = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      hits.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') })
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(status === 202 ? '{"push_id":"p1","status":"accepted"}' : '{"error":"nope"}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, hits, url: `http://127.0.0.1:${server.address().port}` }
}

function tmpDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-test-'))
  fs.writeFileSync(
    path.join(dir, 'pushd.env'),
    '# operator lines are preserved verbatim\nCAIRN_PUSHD_BIND=127.0.0.1:8090\nCAIRN_PUSHD_API_KEYS=studio:s3cr3t\n',
  )
  fs.writeFileSync(
    path.join(dir, 'pairing.json'),
    JSON.stringify({
      secret_key_hex: 'ab',
      peers: [
        { node_id: 'n1', session_token: 't1', label: 'Phone', created_at: 1, push_platform: 'apns', push_token: 'dev-token-1' },
        { node_id: 'n2', session_token: 't2', label: 'Old phone', created_at: 2 },
        { node_id: 'n3', session_token: 't3', label: 'Tablet', created_at: 3, push_platform: 'fcm', push_token: 'dev-token-2' },
      ],
    }),
  )
  return dir
}

// 1. Gate OFF: the literal 'true' only, and zero traffic either way.
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const off = await notifyApprovalRequested(
    { id: 'a1', title: 'x' },
    { env: { ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.equal(off.gated, true)
  const truthyish = await notifyApprovalRequested(
    { id: 'a1', title: 'x' },
    { env: { ARXA_DOORBELL_PUSH: '1', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.equal(truthyish.gated, true, 'only the literal "true" arms the doorbell')
  assert.equal(hits.length, 0)
  server.close()
}

// 2. Gate ON: two push-capable peers → two POSTs; bearer is the secret;
//    collapse key and payload shape match the cairn-push contract.
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const r = await notifyApprovalRequested(
    { id: '42', title: 'Approve deploy?', body: 'prod deploy waits' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.deepEqual(r, { sent: 2, skipped: 0, failed: 0 })
  assert.equal(hits.length, 2)
  for (const hit of hits) {
    assert.equal(hit.url, '/v1/send')
    assert.equal(hit.auth, 'Bearer s3cr3t')
    assert.equal(hit.body.collapse_key, 'approval:42')
    assert.equal(hit.body.payload.visible.title, 'Approve deploy?')
    assert.equal(hit.body.payload.visible.body, 'prod deploy waits')
    assert.equal(hit.body.payload.visible.category, 'approval')
    assert.equal(hit.body.metadata.approval_id, '42')
  }
  assert.deepEqual(hits.map((h) => h.body.token).sort(), ['dev-token-1', 'dev-token-2'])
  server.close()
}

// 3. Key parsing: first well-formed entry wins; :rail suffix strips; a
//    secret keeps its own colons; garbage entries skip.
assert.equal(apiKeyFromEnv('studio:s3cr3t'), 's3cr3t')
assert.equal(apiKeyFromEnv('studio:s3cr3t:rail'), 's3cr3t')
assert.equal(apiKeyFromEnv('a:b:c:d'), 'b:c:d')
assert.equal(apiKeyFromEnv('garbage, studio:good'), 'good')
assert.equal(apiKeyFromEnv(''), null)

// 4. No paired devices with tokens → counted no-op, zero traffic.
{
  const { server, hits, url } = await stubPushd()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doorbell-empty-'))
  const r = await notifyApprovalRequested(
    { id: 'a1', title: 'x' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url, ARXA_PUSHD_KEY: 'k' } },
  )
  assert.equal(r.sent + r.failed, 0)
  assert.equal(r.reason, 'no paired devices with push tokens')
  assert.equal(hits.length, 0)
  server.close()
}

// 5. Daemon 429 (rate limit) is a counted failure, never a throw.
{
  const { server, url } = await stubPushd(429)
  const dir = tmpDataDir()
  const r = await notifyApprovalRequested(
    { id: 'a1', title: 'x' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url }, log: () => {} },
  )
  assert.deepEqual(r, { sent: 0, skipped: 0, failed: 2 })
  server.close()
}

// 6. Env overrides beat file values (launchd / standalone engine path).
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const r = await notifyApprovalRequested(
    { id: 'a7', title: 'x' },
    {
      env: {
        ARXA_DOORBELL_PUSH: 'true',
        ARXA_APP_DATA_DIR: dir,
        ARXA_PUSHD_URL: url,
        ARXA_PUSHD_KEY: 'override-key',
      },
    },
  )
  assert.equal(r.sent, 2)
  assert.equal(hits[0].auth, 'Bearer override-key')
  server.close()
}

// 7. Config resolution: bind from pushd.env becomes the URL; overrides win;
//    the platform data-dir derivation honors ARXA_APP_DATA_DIR.
{
  const dir = tmpDataDir()
  const cfg = doorbellConfig({ ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir })
  assert.equal(cfg.pushdUrl, 'http://127.0.0.1:8090')
  assert.equal(cfg.apiKey, 's3cr3t')
  assert.equal(cfg.pairingStorePath, path.join(dir, 'pairing.json'))
  assert.equal(appDataDir({ ARXA_APP_DATA_DIR: '/x' }), '/x')
  assert.equal(
    appDataDir({}, 'darwin', '/home/u'),
    path.join('/home/u', 'Library', 'Application Support', 'solutions.arxadigital.arxa'),
  )
  assert.deepEqual(pushTargets(path.join(dir, 'pairing.json')).map((t) => t.token), [
    'dev-token-1',
    'dev-token-2',
  ])
  assert.deepEqual(pushTargets(path.join(dir, 'missing.json')), [])
  assert.deepEqual(parseEnvFile('# c\nA=1\n\nbad\nB = two\n'), { A: '1', B: 'two' })
}

// 8. Task class, gate OFF: the same literal 'true' gate; zero traffic for
//    completions AND failures.
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const off = await notifyTaskFinished(
    { id: 'job-1', outcome: 'completed' },
    { env: { ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.equal(off.gated, true)
  const offFail = await notifyTaskFinished(
    { id: 'job-1', outcome: 'failed' },
    { env: { ARXA_DOORBELL_PUSH: 'yes', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.equal(offFail.gated, true, 'task class rides the same literal-true gate')
  assert.equal(hits.length, 0)
  server.close()
}

// 9. Task class, gate ON: completion AND failure fire with the exact
//    content-free copy, collapse_key task:<id>, category 'task', real job
//    id in metadata — same bearer and /v1/send path as the approval class.
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const done = await notifyTaskFinished(
    { id: 'job-7', outcome: 'completed' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.deepEqual(done, { sent: 2, skipped: 0, failed: 0 })
  const failed = await notifyTaskFinished(
    { id: 'job-8', outcome: 'failed' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url } },
  )
  assert.deepEqual(failed, { sent: 2, skipped: 0, failed: 0 })
  assert.equal(hits.length, 4)
  const doneHits = hits.filter((h) => h.body.collapse_key === 'task:job-7')
  const failHits = hits.filter((h) => h.body.collapse_key === 'task:job-8')
  assert.equal(doneHits.length, 2, 'one POST per paired device, completion')
  assert.equal(failHits.length, 2, 'one POST per paired device, failure')
  for (const hit of hits) {
    assert.equal(hit.url, '/v1/send')
    assert.equal(hit.auth, 'Bearer s3cr3t')
    assert.equal(hit.body.payload.visible.category, 'task')
    assert.equal(hit.body.payload.visible.body, 'Open Arxa Studio to see the result.')
    assert.equal(hit.body.metadata.task_id, hit.body.collapse_key.slice('task:'.length))
  }
  for (const hit of doneHits) {
    assert.equal(hit.body.payload.visible.title, 'Task finished')
    assert.equal(hit.body.metadata.kind, 'task-finished')
  }
  for (const hit of failHits) {
    assert.equal(hit.body.payload.visible.title, 'Task failed')
    assert.equal(hit.body.metadata.kind, 'task-failed')
  }
  server.close()
}

// 10. 'killed' is a failure to the owner: it rings the 'Task failed' title.
{
  const { server, hits, url } = await stubPushd()
  const dir = tmpDataDir()
  const killed = await notifyTaskFinished(
    { id: 'job-9', outcome: 'killed' },
    { env: { ARXA_DOORBELL_PUSH: 'true', ARXA_APP_DATA_DIR: dir, ARXA_PUSHD_URL: url }, log: () => {} },
  )
  assert.equal(killed.sent, 2)
  assert.ok(hits.every((h) => h.body.payload.visible.title === 'Task failed'))
  server.close()
}

console.log('arxa-push-doorbell selftest: all checks passed')
