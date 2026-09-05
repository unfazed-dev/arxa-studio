import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZodError } from 'zod'

// Point the on-disk mirror at a temp dir BEFORE importing the module: statusFile() reads this,
// and a test must never write to (or read from) the developer's real ~/.arxa.
const HOME = mkdtempSync(join(tmpdir(), 'arxa-provider-status-'))
process.env.ARXA_APP_DATA_DIR = HOME

const { PROVIDER_STATUS_SCHEMA, STATUS_VALUE_SCHEMA, formatBadge, bindingStatus } = await import('./lib/status.js')
const { publishProviderStatus, resetProviderStatus, resetProviderStatusWarning, loadProviderStatus, statusesFor, statusFile, RPC_CHANNEL, apply } = await import('./lib/index.js')

let n = 0; const ok = (s) => { n++; console.log(`  ok ${s}`) }
const good = { provider: 'claude-code', kind: 'default', level: 'warn', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9, resetsAt: 1_800_000_000 }
const v = { ...good, at: 123 }
const now = 1_799_990_000 * 1000

assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse(good), good)
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, level: 'loud' }))
// kind defaults, so every existing producer keeps working without naming one.
const { kind, ...noKind } = good
assert.equal(PROVIDER_STATUS_SCHEMA.parse(noKind).kind, 'default'); ok('schema')

// detail: a real JSON-value type, not z.unknown(). `detail` ships verbatim to the browser, so this
// schema IS the security boundary — it stops non-serializable values, raw Error objects, and
// functions. It does not stop a plain string secret; that's valid JSON and stays the producer's job.
assert.doesNotThrow(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: { code: 429, retryable: true, tags: ['rate-limit', null, 3] } }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: new Error('boom') }))
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: () => {} })); ok('detail is a JSON-value type, not unknown')

// The wire schema is what the RPC value is parsed by, so the rejection must hold through it too —
// not only through the standalone schema, which nothing on the wire calls directly.
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(v), v)
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(null), null)
assert.throws(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: new Error('boom') }))
assert.throws(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: () => {} }))
// detail's JsonValue is z.lazy, which memoizes its inner schema on first resolution; this proves
// it resolves through the real wire call shape, not just an ad hoc parse.
const vWithDetail = { ...v, detail: { code: 429 } }
assert.deepEqual(STATUS_VALUE_SCHEMA.parse(vWithDetail), vWithDetail)
ok('status wire schema round-trips and rejects non-JSON detail')

// A circular detail (detail.self = detail) has no finite JSON shape. Before rejectCircular in
// lib/status.js, JsonValue's union recursion had no cycle detection and blew the call stack with a
// bare RangeError — which escapes even .safeParse(). Prove it rejects cleanly, as a real ZodError.
const circularDetail = {}; circularDetail.self = circularDetail
// Positive check, not `!(err instanceof RangeError)`: "not a RangeError" would also pass on a
// TypeError or anything else. A rejection is only correct if it is an actual ZodError with issues.
const rejectsCleanly = (fn) => {
  try { fn(); return false } catch (err) {
    assert.ok(err instanceof ZodError, `must reject as a ZodError, got ${err?.constructor?.name}: ${err?.message}`)
    assert.ok(Array.isArray(err.issues) && err.issues.length > 0, 'the ZodError must carry issues')
    return true
  }
}
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: circularDetail })))
assert.ok(rejectsCleanly(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: circularDetail })))
// and the producer entry point must reject it rather than crash
assert.throws(() => publishProviderStatus({ id: 's1' }, { ...good, detail: circularDetail }))
ok('circular detail rejects cleanly as a ZodError, not a RangeError')

// Depth is the other half of the same crash, and closing cycles did not close it. A deep but
// perfectly ACYCLIC detail has a finite JSON shape, sails past the stringify probe, then overflows
// inside JsonValue's union. Nothing produces this today (Claude's detail is flat); one nested
// array from a future producer would.
const deepDetail = (levels) => { let node = { leaf: true }; for (let i = 0; i < levels; i++) node = { nested: node }; return node }
const deepAcyclic = deepDetail(5000)
assert.equal(JSON.stringify(deepAcyclic).length > 0, true, 'the deep detail is acyclic — it serialises fine, which is the whole problem')
assert.ok(rejectsCleanly(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepAcyclic })))
assert.ok(rejectsCleanly(() => STATUS_VALUE_SCHEMA.parse({ ...v, detail: deepAcyclic })))
// The limit must not be so tight that an ordinary nested detail is rejected.
assert.deepEqual(PROVIDER_STATUS_SCHEMA.parse({ ...good, detail: deepDetail(8) }).detail, deepDetail(8))
ok('a deep acyclic detail is rejected as data, while an ordinary nested detail still parses')

// `utilization` rides through formatBadge because the RING draws its arc from it. Without it the
// badge is text-only and there is nothing to draw — the failure would be a ring stuck at empty.
assert.deepEqual(formatBadge(v, now), { level: 'warn', text: 'Claude 90% · resets in 2h 46m', title: 'weekly limit · max', utilization: 0.9 })
assert.deepEqual(formatBadge({ ...v, level: 'ok' }, now), { level: 'ok', text: 'Claude 90%', title: 'weekly limit · max', utilization: 0.9 })
assert.equal(formatBadge({ ...v, utilization: undefined }, now).utilization, undefined, 'a balance has no utilization and must not gain one')
assert.equal(formatBadge(null, now), undefined); assert.equal(formatBadge(undefined, now), undefined); ok('badge text')

// Staleness: once resetsAt has passed the badge hides rather than freezing on old text. Recomputed
// against `now` on every call, so a reconnect re-renders correctly for free.
assert.equal(formatBadge(v, v.resetsAt * 1000), undefined, 'boundary: exactly at resetsAt counts as stale (<=)')
assert.equal(formatBadge({ ...v, resetsAt: 0 }, now), undefined, 'resetsAt: 0 is stale, not "unset"'); ok('badge hides once stale')

// The reported bug: a Claude usage pill stayed on screen while the user worked in GLM, reading as
// GLM's limit. The badge takes the provider selected RIGHT NOW — in the browser that is the model
// picker's own store, so it reacts to a switch immediately rather than waiting for a turn.
assert.notEqual(formatBadge(v, now, 'claude-code'), undefined, 'visible while claude-code is selected')
assert.equal(formatBadge(v, now, 'zai'), undefined, 'THE BUG: claude usage must not show while GLM is selected')
assert.deepEqual(formatBadge(v, now, 'claude-code'), formatBadge(v, now), 'switching back shows the same pill again')
assert.notEqual(formatBadge(v, now, undefined), undefined, 'no selection known yet -> show it')
ok('the badge follows the selected provider')

// --- two live limits at once (a Claude subscription runs a premium-model weekly allowance
// alongside the all-models one; they arrive as separate events)
{
  const weekly = { ...v, kind: 'seven_day', level: 'warn', text: 'Claude 80%', title: 'Claude weekly limit · 80% used', utilization: 0.8 }
  const premium = { ...v, kind: 'seven_day_opus', level: 'limit', text: 'Claude limit reached', title: 'Claude weekly Opus limit · 100% used', utilization: 1 }
  const bound = bindingStatus([weekly, premium], now)
  assert.equal(bound.level, 'limit', 'the worse of the two limits is the one that binds the user')
  assert.equal(bound.text, 'Claude limit reached')
  assert.ok(bound.title.includes('weekly Opus limit') && bound.title.includes('weekly limit · 80%'), 'both limits must be named in the tooltip — a limit the user is never shown is how they get surprised')
  // ties and single values
  assert.equal(bindingStatus([weekly], now).title, weekly.title, 'one limit keeps its own title, unjoined')
  // The siblings must survive as VALUES, not just as joined title text: the ring is tapped through
  // them, and a string cannot be cycled. This is what the joined title alone could not carry.
  assert.deepEqual(bound.others, [weekly], 'the non-binding windows ride along structurally')
  assert.equal(bindingStatus([weekly], now).others, undefined, 'a lone limit has no siblings to cycle to')
  assert.deepEqual(bindingStatus([weekly, { ...premium, resetsAt: 1 }], now).others, undefined, 'an expired sibling is not offered for cycling')
  assert.equal(bindingStatus([], now), undefined)
  assert.equal(bindingStatus(undefined, now), undefined)
  // a limit whose window already reset must not win the fold
  assert.equal(bindingStatus([{ ...premium, resetsAt: 1 }], now), undefined, 'an expired limit is not live')
  assert.equal(bindingStatus([weekly, { ...premium, resetsAt: 1 }], now).kind, 'seven_day', 'an expired limit must not outrank a live one')
  // same level -> higher utilization binds
  assert.equal(bindingStatus([{ ...weekly, utilization: 0.2, kind: 'a' }, { ...weekly, utilization: 0.7, kind: 'b' }], now).kind, 'b')
  ok('two live limits: the worse one binds, both are named, expired ones drop out')
}

// The producer validates and holds. It must NOT append a session event: `provider/status` is
// outside dsh's known vocabulary, and one such event makes the whole conversation unreadable on
// reopen ("Failed to load history"). scripts/session-event-vocabulary-check.mjs is the standing gate.
resetProviderStatus()
const appended = []
const session = { id: 's1', append: (type, data) => { appended.push([type, data]); return { seq: 0 } } }
assert.deepEqual(publishProviderStatus(session, good), good)
assert.deepEqual(appended, [], 'publishing must not write a session event')
assert.throws(() => publishProviderStatus(session, { provider: 'x' }), /text/); ok('producer validates and never appends')

// text is capped at 80 chars; an overlong status is rejected at the producer.
assert.throws(() => PROVIDER_STATUS_SCHEMA.parse({ ...good, text: 'x'.repeat(81) }))
assert.throws(() => publishProviderStatus(session, { ...good, text: 'x'.repeat(81) })); ok('overlong text is rejected')

// dsh 0.1.2-rc.1 keys the session record by `header.id` (no top-level `id`). The ring went blank
// because the store keyed rows "undefined …" and the RPC lookup by real id never matched. The
// producer must read both shapes and refuse a record with neither.
{
  resetProviderStatus()
  const rc1 = { header: { id: 's-rc1', cwd: '/tmp' } }
  publishProviderStatus(rc1, good)
  assert.equal(statusesFor('s-rc1', good.provider).find((s) => s.kind === good.kind)?.text, good.text)
  assert.deepEqual(statusesFor('undefined', good.provider), [])
  assert.throws(() => publishProviderStatus({ header: {} }, good), /no id/)
  ok('session.header.id (rc.1 shape) keys the store; id-less records are rejected')
}

// --- the store keeps one row per session+provider+kind
{
  resetProviderStatus()
  publishProviderStatus({ id: 's1' }, { ...good, kind: 'seven_day', text: 'Claude 80%' })
  publishProviderStatus({ id: 's1' }, { ...good, kind: 'seven_day_opus', text: 'Claude 95%' })
  assert.equal(statusesFor('s1').length, 2, 'THE TWO-LIMIT BUG: the second limit must not overwrite the first')
  publishProviderStatus({ id: 's1' }, { ...good, kind: 'seven_day', text: 'Claude 85%' })
  assert.equal(statusesFor('s1').length, 2, 'a fresh value of the same kind replaces, it does not accumulate')
  assert.ok(statusesFor('s1').some((s) => s.text === 'Claude 85%'))
  publishProviderStatus({ id: 's1' }, { ...good, provider: 'zai', kind: 'seven_day', text: 'GLM 10%' })
  assert.equal(statusesFor('s1', 'claude-code').length, 2, 'another provider must not leak into the claude filter')
  assert.equal(statusesFor('s1', 'zai').length, 1)
  assert.equal(statusesFor('other').length, 0, "one session's status must never appear in another")
  ok('store keys by session+provider+kind')

  // bindingStatus folds whatever it is handed into ONE pill, so statusesFor must never return a
  // mix of providers: folding across them picks a winner from one provider and mashes another's
  // title into the tooltip — a Claude limit displayed against a GLM turn, the original bug.
  // This is the ordinary path, not an edge case: dsh's picker leaves `current` null until it is
  // opened, so the browser often calls with no provider at all.
  const mixed = statusesFor('s1')
  assert.equal(new Set(mixed.map((s) => s.provider)).size, 1, 'THE FOLD MUST NOT MIX PROVIDERS: a no-provider read returns one provider, never a blend')
  assert.equal(mixed[0].provider, 'zai', 'with no provider named, the most recently updated provider wins')
  assert.ok(!bindingStatus(statusesFor('s1'), now).title.includes('Claude'), "the newest provider's pill must not carry another provider's limit in its tooltip")
  ok('a no-provider read never blends two providers')
}

// --- durability: THE 2026-09-05 regression. Moving off the session log dropped persistence, and
// the SDK emits rate_limit_event only "when rate limit info changes" — not per turn — so a
// process-memory store is empty after every restart and stays empty. The pill vanished entirely.
{
  resetProviderStatus()
  publishProviderStatus({ id: 's1' }, { ...good, kind: 'seven_day' })
  publishProviderStatus({ id: 's1' }, { ...good, kind: 'seven_day_opus' })
  resetProviderStatus() // simulate a host restart: memory gone
  assert.equal(statusesFor('s1').length, 0)
  assert.equal(loadProviderStatus(statusFile()), 2, 'the pill must survive a restart without waiting for a new limit event')
  assert.equal(statusesFor('s1').length, 2, 'both limits come back, not just the last one written')
  ok('status survives a host restart')

  // A corrupt, truncated, or hand-edited file must degrade to "no pill", never throw at boot.
  const f = statusFile()
  writeFileSync(f, '{ this is not json', 'utf8')
  assert.equal(loadProviderStatus(f), 0, 'a corrupt mirror is an empty store, not a crash')
  writeFileSync(f, JSON.stringify({ version: 1, rows: [{ key: 's1 claude-code x', value: { provider: 'p', level: 'nope' } }] }), 'utf8')
  assert.equal(loadProviderStatus(f), 0, 'rows are re-validated on load — a hand-edited file cannot inject an unchecked value')
  assert.equal(loadProviderStatus(join(HOME, 'does-not-exist.json')), 0, 'a missing mirror is an empty store')
  ok('a corrupt or absent mirror degrades to no pill, never a crash')

  // Stale rows expire rather than showing a usage number from last month.
  resetProviderStatus()
  publishProviderStatus({ id: 's1' }, good)
  assert.equal(loadProviderStatus(statusFile(), Date.now() + 8 * 24 * 60 * 60 * 1000), 0, 'a week-old status is dropped on load')
  ok('stale statuses expire on load')

  // A write failure and a status that was never published both show as an empty pill. That
  // ambiguity cost a whole debugging round, so a failed write must SAY so — once per process,
  // since a broken disk would otherwise repeat the line on every turn.
  {
    resetProviderStatusWarning()
    const said = []
    const realWarn = console.warn
    console.warn = (m) => said.push(String(m))
    try {
      // a path whose parent is a FILE, so mkdir/write cannot succeed
      const wedged = join(statusFile(), 'not-a-dir', 'x.json')
      publishProviderStatus({ id: 's1' }, good, wedged)
      publishProviderStatus({ id: 's1' }, good, wedged)
    } finally { console.warn = realWarn }
    assert.equal(said.length, 1, 'a failed write warns exactly once, not once per turn')
    assert.ok(said[0].includes('cannot persist'), 'the warning must name the actual problem')
    assert.equal(statusesFor('s1').length > 0, true, 'a failed write must not lose the in-memory status too')
    ok('a failed write is reported, once, instead of looking like no event')
  }

  // The mirror must never contain a session transcript or anything but validated status rows.
  resetProviderStatus()
  publishProviderStatus({ id: 's1' }, good)
  const onDisk = JSON.parse(readFileSync(statusFile(), 'utf8'))
  assert.deepEqual(Object.keys(onDisk).sort(), ['rows', 'version'])
  assert.deepEqual(Object.keys(onDisk.rows[0]).sort(), ['key', 'value'])
  ok('the mirror holds only validated status rows')
}

// --- replaceProviderStatus: a poll REPLACES its provider's statuses, it does not merge into them
{
  const { replaceProviderStatus } = await import('./lib/index.js')
  resetProviderStatus()
  publishProviderStatus({ id: 's1' }, good)
  replaceProviderStatus('s1', 'zai', [
    { provider: 'zai', kind: 'hour:5', level: 'ok', text: 'GLM 49%', utilization: 0.49 },
    { provider: 'zai', kind: 'week:1', level: 'warn', text: 'GLM 95%', utilization: 0.95 },
  ])
  assert.equal(statusesFor('s1', 'zai').length, 2)
  // THE POINT: a failed read publishes only `?`, and the number it replaces must be GONE. Merging
  // by kind would leave 'GLM 95%' sitting beside the '?' where bindingStatus keeps folding it in —
  // a stale number presented as current, which is the failure the visible-breakage rule forbids.
  replaceProviderStatus('s1', 'zai', [{ provider: 'zai', kind: 'unavailable', level: 'info', text: '?' }])
  assert.deepEqual(statusesFor('s1', 'zai').map((s) => s.kind), ['unavailable'], 'the old windows are erased, not merged with')
  // A provider's poll must never touch another provider's rows, or a Z.ai outage would blank Claude.
  assert.equal(statusesFor('s1', 'claude-code').length, 1, "another provider's statuses are untouched")
  // Nor another session's.
  publishProviderStatus({ id: 's2' }, { ...good, provider: 'zai', text: 'GLM 10%' })
  replaceProviderStatus('s1', 'zai', [])
  assert.equal(statusesFor('s2', 'zai').length, 1, "another session's statuses are untouched")
  assert.deepEqual(statusesFor('s1', 'zai'), [], 'an empty replace clears the provider — an unconfigured vendor shows nothing')
  // Never throws, and one bad row does not cost the good ones: a poll must not be able to kill
  // the RPC that triggered it.
  assert.doesNotThrow(() => replaceProviderStatus('s1', 'zai', [
    { provider: 'zai', kind: 'ok', level: 'ok', text: 'GLM 1%' },
    { provider: 'zai', level: 'nonsense', text: '' },
    { provider: 'claude-code', kind: 'sneaky', level: 'ok', text: 'not mine' },
  ]))
  assert.deepEqual(statusesFor('s1', 'zai').map((s) => s.kind), ['ok'], 'invalid rows are dropped and a foreign provider cannot ride in on another one\'s poll')
  ok('replace: erases the provider it names, and only that provider, in that session')
}

// --- the RPC surface the browser half calls
{
  let handler; let opts
  // Dep-aware on purpose. cordis fires an inject fiber only when its services actually exist, so a
  // stub that hands every fiber the same object is not the runtime: it would have built a quota
  // poller on an undefined `credentials`, and the first RPC would have wiped a real status and
  // replaced it with `?`. Here credentials is absent, which is also the headless case.
  const provided = {}
  const ctx = {
    provide: (name, value) => { provided[name] = value },
    inject: (deps, fn) => { if (deps.includes('connection')) fn({ connection: { rpc: { handle: (_ch, h, o) => { handler = h; opts = o } } } }) },
  }
  apply(ctx)
  assert.equal(typeof handler, 'function'); assert.deepEqual(opts, { authority: 'trusted-host' })
  // The seam other plugins couple through. claude-code registers its reader and publishes turn
  // statuses via this service, NOT via a relative import: the profile loads it by absolute path
  // and this plugin by package name (a copy under the profile's node_modules), so an import bound
  // a second module instance — a READERS map the poller never read. Reader registered, ring never
  // appeared (2026-09-05). Identity matters: `publish` must be THIS instance's producer.
  const seam = provided.providerStatus
  assert.equal(typeof seam?.registerUsageReader, 'function', 'providerStatus.registerUsageReader')
  assert.equal(seam.publish, publishProviderStatus, 'providerStatus.publish is this module\'s producer')
  assert.equal(typeof seam.replace, 'function'); assert.equal(typeof seam.onStatus, 'function')
  assert.ok(Object.isFrozen(seam), 'the seam is not a place to hang state')
  ok('apply provides the providerStatus service')
  resetProviderStatus()
  assert.deepEqual(await handler('current', { sessionId: 's1' }), { ok: true, value: { status: null } })
  publishProviderStatus({ id: 's1' }, good)
  const got = await handler('current', { sessionId: 's1' })
  assert.equal(got.ok, true); assert.deepEqual({ ...got.value.status, at: 0 }, { ...good, at: 0 })
  // one session's status must never leak into another's badge
  assert.deepEqual(await handler('current', { sessionId: 'other' }), { ok: true, value: { status: null } })
  // the provider narrowing the browser sends
  publishProviderStatus({ id: 's1' }, { ...good, provider: 'zai', text: 'GLM 10%' })
  assert.equal((await handler('current', { sessionId: 's1', provider: 'zai' })).value.status.text, 'GLM 10%')
  assert.equal((await handler('current', { sessionId: 's1', provider: 'claude-code' })).value.status.text, good.text)
  // and the no-provider call — the common case, since the picker leaves `current` null until
  // opened — must still resolve to exactly one provider rather than a blend of both.
  const blended = (await handler('current', { sessionId: 's1' })).value.status
  assert.equal(blended.provider, 'zai', 'no provider named -> the newest provider, not a merge')
  assert.equal(blended.title.includes('Claude'), false, "the other provider's limit must not ride along in the tooltip")
  // the endpoint is an explicit allowlist, not a generic bridge
  assert.equal((await handler('anything-else', { sessionId: 's1' })).ok, false)
  assert.equal((await handler('current', {})).ok, false, 'a missing sessionId is refused, not coerced')
  assert.equal((await handler('current', { sessionId: 's1', provider: 7 })).ok, false, 'a non-string provider is refused, not coerced')
  ok('rpc: one allowlisted verb, per-session isolation, validated payload')
}

// --- the wiring rule that made the pill vanish on every provider
{
  const clientSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
  const gate = /exports\.inject\s*=\s*\[([^\]]*)\]/.exec(clientSrc)
  assert.ok(gate, 'client.js must declare its service gate')
  // `exports.inject` is a HARD GATE ("service required before the companion can register").
  // modelDirectories belongs to dsh-client-ui-model-selection — dsh keeps it out of that
  // plugin's own module-level list for this reason. Naming it here makes the entire pill
  // hostage to another plugin's service, which is how it disappeared for every provider.
  assert.equal(gate[1].includes('modelDirectories'), false, 'modelDirectories must NOT gate the plugin — resolve it at render time instead')
  // Reading an undeclared service THROWS in cordis ("cannot get property without inject"), so the
  // directory cannot merely be optional-chained off ctx — the try/catch below would swallow that
  // throw and silently disable the provider filter, putting the GLM bug straight back. It has to
  // arrive through the lazy fiber, which fires if and when model-selection registers.
  assert.ok(/ctx\.inject\(\['modelDirectories'\]/.test(clientSrc), 'modelDirectories must arrive through the lazy fiber, not a bare property read off ctx')
  assert.equal(/ctx\.modelDirectories/.test(clientSrc), false, 'a bare ctx.modelDirectories read throws in cordis and would be swallowed by the guard')
  assert.ok(/try\s*{[\s\S]{0,120}models\?\.directoryFor\(sessionId\)/.test(clientSrc), 'directoryFor throws for a session with no scope — it must be guarded')
  // dsh's picker loads its catalog only when opened, and `current` is null until something loads
  // it. If the pill never triggers a load, it never learns the selected provider and the filter
  // it exists for is inert.
  assert.ok(/d\.load\(\)\.catch/.test(clientSrc), 'the pill must load the directory itself, not wait for the user to open the picker')
  assert.ok(/useEffect\(\(\) => \{ load\?\.\(\) \}/.test(clientSrc), 'load runs on mount, not during render')
  // Props are computed ONCE per mount, and the composer mounts BEFORE model-selection registers.
  // 2026-09-06: every real session's pill resolved `directory` pre-fiber (undefined), so no RPC
  // ever carried a provider and the host skipped the fetch. The pill must re-resolve when the
  // modelDirectories fiber fires, and the host must fetch even when no provider is named.
  assert.ok(/resolveDirectory: \(\) => resolveDirectory\(sessionId\)/.test(clientSrc), 'the pill gets a re-resolver, not a one-shot directory')
  assert.ok(/onModels: \(wake\) => \{ modelsWaiters\.add\(wake\)/.test(clientSrc), 'the modelDirectories fiber wakes mounted pills')
  assert.ok(/for \(const wake of modelsWaiters\) wake\(\)/.test(clientSrc), 'the fiber actually calls the waiters when the service lands')
  const hostSrc = await (await import('node:fs/promises')).readFile(new URL('./lib/index.js', import.meta.url), 'utf8')
  assert.ok(/else await poller\.ensureAny\(sessionId\)/.test(hostSrc), 'a provider-less `current` must still warm the poller — that path was the blank ring')

  // lib/client.js duplicates formatBadge for the browser bundle (no module graph into lib/ from a
  // __ModuleLoader__ factory). Extract it and prove it agrees with the host copy, including the
  // provider-visibility rule — the regression this pair exists to catch.
  // Bounded by a sentinel COMMENT, not by whatever constant happens to come next: the extractor
  // used to stop at `const COLOR`, so renaming that constant (which the ring did) broke the parity
  // test in a way that reads like a real failure.
  const end = clientSrc.indexOf('// PARITY-END')
  assert.ok(end > 0, 'client.js must keep the // PARITY-END sentinel that bounds the shared block')
  const relSrc = clientSrc.slice(clientSrc.indexOf('const relative'), end)
  const clientFormatBadge = new Function(`${relSrc} return formatBadge`)()
  for (const [value, at, active] of [
    [v, now, undefined], [{ ...v, level: 'ok' }, now, undefined], [null, now, undefined],
    [{ ...v, title: '' }, now, undefined], [{ ...v, resetsAt: 0 }, now, undefined],
    [{ ...good, at: 1, resetsAt: undefined }, now, undefined],
    [v, now, 'claude-code'], [v, now, 'zai'],
  ]) {
    assert.deepEqual(clientFormatBadge(value, at, active), formatBadge(value, at, active), `client/host parity for ${JSON.stringify(value)} active=${active}`)
  }
  assert.equal(RPC_CHANNEL, '/arxa-provider-status')
  // dsh-client-connection assertChannel: CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/ and '/api' is
  // reserved. A second segment ('/rpc/…') makes registerRpc throw at activation and the throw is
  // swallowed — the ring simply never appears (2026-09-05). Guard the real rule here.
  assert.ok(/^\/[A-Za-z0-9._~-]+$/.test(RPC_CHANNEL) && RPC_CHANNEL !== '/api', `RPC_CHANNEL ${RPC_CHANNEL} must be one path segment (dsh CHANNEL_PATTERN)`)
  assert.ok(clientSrc.includes(`'${RPC_CHANNEL}'`), 'the client calls the channel the host registers')
  ok('client wiring gate + formatBadge parity + channel agreement')

  // --- the ring. No DOM here, so the colour rule is extracted and exercised directly: it is the
  // one piece of the indicator where a plausible-looking shortcut (colour off `level`) is wrong.
  // Sentinels, like PARITY-END above: this used to slice from `const ACCENT`, and renaming that
  // constant to dsh's own token names (2026-09-05) made indexOf return -1 and the eval fail with
  // "RING_COLOR is not defined" — a failure that reads like a ring bug and is not one.
  const ringStart = clientSrc.indexOf('// RING-COLOR-START'), ringEnd = clientSrc.indexOf('// RING-COLOR-END')
  assert.ok(ringStart > 0 && ringEnd > ringStart, 'client.js must keep the RING-COLOR-START/END sentinels around the colour rule')
  const ringSrc = clientSrc.slice(ringStart, ringEnd)
  const RING_COLOR = new Function(`${ringSrc} return RING_COLOR`)()
  const ACCENT = RING_COLOR(0), AMBER = RING_COLOR(0.75), RED = RING_COLOR(0.95)
  assert.equal(new Set([ACCENT, AMBER, RED]).size, 3, 'the three steps must be three different colours')
  assert.equal(RING_COLOR(0.69), ACCENT, '31% left is still accent')
  // THE BUG THIS CATCHES: levelFor turns warn at 0.8 used (20% left), but the ring is specified to
  // step at 30% left. Colouring off `level` would leave 0.75 accent — ten points late, on a weekly
  // window about a full day of warning lost.
  assert.equal(RING_COLOR(0.75), AMBER, '25% left is amber even though level is still "ok" at 0.75')
  // Boundaries land on the rounded percent, which is also the digit pair the ring prints — so the
  // colour and the number cannot contradict each other, and 1 - 0.7 === 0.30000000000000004 cannot
  // quietly push exactly-30%-left into the accent band.
  assert.equal(RING_COLOR(0.7), AMBER, 'exactly 30% left steps to amber')
  assert.equal(RING_COLOR(0.9), RED, 'exactly 10% left steps to red')
  assert.equal(RING_COLOR(0.895), RED, '10.5% left rounds to 10 and shows red, matching the "10" it prints')
  assert.equal(RING_COLOR(1), RED, 'a spent window is red, not wrapped back to accent')
  assert.equal(/RING_COLOR\(\s*(badge\.)?level/.test(clientSrc), false, 'the ring must colour off utilization, never off level')
  ok('ring colour steps on % LEFT, read from utilization')

  // Structure: the ring is built to dsh's own ContextMeter numbers (dsh-client-ui-conversation
  // 0.1.2-rc.1) so it sits beside the context ring as a sibling — same 14px viewBox, r 5.5, 2px
  // stroke, 28px round trigger, and the arc measures what is USED, the way the context ring fills.
  // A ring that grew as the window EMPTIED next to one that grows as context FILLS would read as
  // two opposite instruments.
  assert.ok(/const SIZE = 14, R = 5\.5/.test(clientSrc), 'ring geometry is ContextMeter\'s: viewBox 14, r 5.5')
  assert.ok(/strokeDasharray:\s*`\$\{\(CIRC \* used\)/.test(clientSrc), 'the arc length is the fraction USED of the circumference, like the context ring')
  assert.ok(/stroke: TRACK/.test(clientSrc) && /--dsw-alias-border-l3/.test(clientSrc), 'the track is dsh\'s border-l3 token, the context ring\'s own track tone')
  assert.ok(/--dsw-alias-label-tertiary/.test(clientSrc), 'the healthy arc is dsh\'s label-tertiary, the context ring\'s own fill tone')
  assert.ok(/strokeDasharray: '2 3'/.test(clientSrc), 'a balance-only status draws a dashed idle track, not a full one')
  assert.equal(/String\(Math\.round\(left \* 100\)\)/.test(clientSrc), false, 'no digits inside a 14px ring — the panel and tooltip carry the number')
  assert.ok(/\.arxa-ps-trigger\{width:28px;height:28px;[^}]*border-radius:999px/.test(clientSrc), 'the trigger is ContextMeter\'s 28px round button')
  assert.ok(/\.arxa-ps-trigger:hover[^{]*\{background:var\(--dsw-alias-interactive-bg-hover\)\}/.test(clientSrc), 'the trigger takes ContextMeter\'s hover wash')
  assert.ok(/h\(P\.Tooltip, \{ label, side: 'top', delayMs: 200, disabled: open \}/.test(clientSrc), 'hover shows dsh\'s own Tooltip, ContextMeter\'s side and delay, muted while the card is open')
  // Balance and breakage both land here: no utilization means no arc, so the text has to carry
  // it or the composer shows a silent empty circle.
  assert.ok(/typeof x\.badge\.utilization !== 'number'/.test(clientSrc) && /h\('span', null, x\.badge\.text\)/.test(clientSrc), 'without a percentage the badge text renders beside a dashed ring')
  ok('ring structure: ContextMeter geometry and tokens, arc = used, dashed idle form, text fallback')

  // ONE ring, for the binding window; the card lists every live window (2026-09-06: two rings
  // beside the context ring read as three limits, and the card already carries both numbers).
  assert.ok(/\[status, \.\.\.\(status\?\.others \?\? \[\]\)\]/.test(clientSrc), 'the rings come from the binding status plus its siblings')
  assert.ok(/h\(Meter, \{ window: focus\.w, badge: focus\.badge, open, onToggle/.test(clientSrc), 'exactly one trigger, for the binding window')
  assert.equal((clientSrc.match(/h\(Meter, /g) ?? []).length, 1, 'no second ring')
  assert.ok(/const focus = numeric\[0\]/.test(clientSrc), 'the ring shows the window the host folded as binding')
  for (const cls of ['panel', 'header', 'percent', 'headline', 'figures', 'bar', 'segment', 'rows', 'row', 'swatch']) {
    assert.ok(clientSrc.includes(`.arxa-ps-${cls}{`), `card CSS mirrors ContextMeter's ${cls} rule`)
  }
  assert.ok(/width:264px;box-shadow:var\(--dsw-elevation-prominent\)/.test(clientSrc) && /border-radius:12px;padding:14px 16px;font-size:12px;line-height:20px/.test(clientSrc), 'the card is ContextMeter\'s 264px / 12px-radius / elevation-prominent card')
  assert.ok(/'aria-haspopup': 'dialog'/.test(clientSrc) && /'aria-expanded': open/.test(clientSrc), 'the trigger announces its panel')
  assert.ok(/role: 'dialog'/.test(clientSrc), 'the panel is a dialog')
  assert.ok(/e\.key === 'Escape'\) onClose\(\)/.test(clientSrc) && /addEventListener\('mousedown', onDown\)/.test(clientSrc), 'the panel closes on Escape and on an outside click')
  assert.ok(/removeEventListener\('keydown', onKey\); document\.removeEventListener\('mousedown', onDown\)/.test(clientSrc), 'the panel\'s document listeners are removed with it')
  assert.ok(/setOpen\(false\) \}, \[activeProvider\]/.test(clientSrc), 'the panel closes on a provider switch — Claude\'s weekly panel means nothing for GLM')
  assert.ok(/position:absolute;bottom:calc\(100% \+ 8px\);right:0/.test(clientSrc), 'the panel opens upward — the composer sits at the bottom of the viewport')
  // formatBadge retires a window once its reset passes and drops another provider's windows;
  // the rings must be derived from what it returns, not from the raw list, or a spent window
  // keeps a ring.
  assert.ok(/\.filter\(\(x\) => x\.badge !== undefined\)/.test(clientSrc), 'only windows formatBadge accepts get a ring')
  ok('one ring for the binding window, ContextMeter card CSS, escape/outside/provider-switch close, expiry drop')
}

rmSync(HOME, { recursive: true, force: true })
console.log(`selftest.provider-status: ${n} ok`)
