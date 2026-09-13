#!/usr/bin/env node
// Narrow-width evidence capture (task 8, capture half) — the CONTROLLER-run
// driver. Prior capture workers died to OOM inside live browser sessions, so
// this script owns the whole ladder with zero agent interaction: it boots the
// studio against a scratch ARXA_HOME (the engine-boot-smoke pattern), seeds a
// scratch org, then runs scripts/evidence-gate.mjs ONE (width × surface) pair
// at a time. The gate already does the browser half per pair — one headless
// Chrome at the real window size (task 7 proved emulated resizes never mount
// the viewer sheet), the product's real selectors/flows, PNGs into
// designs/evidence/studio-closeout/<width>/<name>-<width>.png, and the named
// IGNORED console/page-error filter. The filter list stays SINGLE-SOURCED in
// the gate: this driver reuses it by executing the gate and reading its
// verdict, never by copying patterns (importing the gate is impossible — it
// is a top-level CLI that spawns Chrome at import time).
//
// After every pair the gate child is dead and this driver additionally sweeps
// its pid-tagged Chromium (--user-data-dir arxa-evidence-chrome-<w>-<pid>)
// TERM→KILL until pgrep is empty, so no browser survives into the next pair.
// A surface that fails to mount at a width is a RECORDED row (JSON log +
// table), never an abort; the exit code is nonzero only when a surface with
// 1280 provenance HARD-fails (unfiltered console/page errors, crash, timeout)
// — missing-at-width is evidence, not failure.
//
//   node scripts/evidence-capture-narrow.mjs        # plain node, no args
//   ARXA_PORT=7897 node scripts/evidence-capture-narrow.mjs   # default port
//   node scripts/evidence-capture-narrow.mjs --width 1280 --surface finish   # 1280 control lane
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import http from 'node:http'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const GATE = join(here, 'evidence-gate.mjs')
const EVIDENCE = join(repo, 'designs', 'evidence', 'studio-closeout')
const LOGS = join(EVIDENCE, 'narrow-capture-logs')
const RUNLOG = join(EVIDENCE, 'narrow-capture-log.json')
const PORT = process.env.ARXA_PORT || '7897'
const BOOT_BUDGET_MS = Number(process.env.T8C_BOOT_MS || 120_000)
const PAIR_BUDGET_MS = Number(process.env.T8C_PAIR_MS || 480_000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// --width W (repeatable, default 390+744 — 1280 runs are the review-mandated
// controls for surfaces the narrow lane missed) and --surface NAME (repeatable,
// task or gate key — filters the ladder for diagnosis). Everything the gate
// needs is per-pair, so any subset runs standalone.
const args = process.argv.slice(2)
const flagVals = (name) => args.flatMap((a, i) => (args[i - 1] === name ? [a] : []))
const WIDTHS = flagVals('--width').map(Number).filter(Boolean).length ? flagVals('--width').map(Number) : [390, 744]
const onlySurfaces = flagVals('--surface')

// The dispatch's ladder, exact order. `gate` = the surface key in
// scripts/evidence-gate.mjs's S map; `shots` = the PNG basenames that gate
// surface produces (the gate's shot() appends `-<width>.png`, the naming of
// every existing file in 1280/ and 390/). Two ladder rows share one gate run
// when a single run produces both shot families: trash (view+confirm pairs)
// and viewer-strip (the install strip IS the dart-absent strip — the strip
// is what "dart SDK missing" looks like in the viewer).
export const LADDER = [
  { task: 'finish', gate: 'finish', shots: ['finish-dialog-light', 'finish-dialog-dark'] },
  { task: 'sweep-modal', gate: 'sweep', shots: ['sweep-modal-light', 'sweep-modal-dark'] },
  { task: 'checks-red-disclosure', gate: 'checksred', shots: ['checks-red-light', 'checks-red-dark'] },
  { task: 'project-preparation', gate: 'preparation', shots: ['project-preparation-light', 'project-preparation-dark'] },
  { task: 'trash-confirm', gate: 'trash', shots: ['trash-confirm-light', 'trash-confirm-dark'] },
  { task: 'trash-recover', gate: 'trash', shots: ['trash-view-light', 'trash-view-dark'] },
  { task: 'viewer-install-strip', gate: 'viewer-strip', shots: ['viewer-install-strip-light', 'viewer-install-strip-dark'] },
  { task: 'confinement-configured-effective', gate: 'confine', shots: ['confinement-tier-light', 'confinement-tier-dark'] },
  { task: 'workspace-backend-local', gate: 'backend', shots: ['workspace-backend-model-light', 'workspace-backend-model-dark'] },
  { task: 'workspace-signin', gate: 'signin', shots: [] }, // no gate surface exists — recorded row, no browser spent
  { task: 'personalisation-tab', gate: 'personalisation', shots: ['personalisation-tab-light', 'personalisation-tab-dark'] },
  { task: 'viewer-langstrip', gate: 'langstrip', shots: ['langstrip-ts', 'langstrip-css', 'langstrip-json', 'langstrip-html-preview'] },
  { task: 'viewer-dart-absent', gate: 'viewer-strip', shots: ['viewer-install-strip-light', 'viewer-install-strip-dark'] },
]

// Surfaces with committed 1280 provenance (designs/evidence/studio-closeout/
// 1280/): personalisation-tab-*, sweep-modal-*, langstrip-*, dart-absent-strip.
// Only a HARD failure on one of these exits nonzero.
export const PROVEN_1280 = {
  'personalisation-tab': true,
  'sweep-modal': true,
  'viewer-langstrip': true,
  'viewer-dart-absent': true,
}

// Surface keys derived from the gate SOURCE (never duplicated here) — lets a
// row for a surface this checkout's gate lacks be recorded without a spawn.
export const gateSurfaces = (src = readFileSync(GATE, 'utf8')) =>
  new Set([...src.matchAll(/async '?([a-zA-Z][\w-]*)'?\(\)/g)].map((m) => m[1]))

// ---- scratch seeding ------------------------------------------------------
// The org shape T8B proved against (org.json + generated frame check.sh +
// langstrip fixtures + empty session registry); check.sh comes from the SSOT
// (plugins/git-workspace/lib/frame.js), never hand-copied.
const seedOrg = async (org) => {
  const docks = ['projects', 'notes', 'meetings', 'account', 'communications']
  for (const d of docks) { mkdirSync(join(org, d), { recursive: true }); writeFileSync(join(org, d, '.gitkeep'), '') }
  writeFileSync(join(org, 'org.json'), JSON.stringify({ id: 't8close-scratch', name: 'T8CLOSE', createdAt: '2026-09-13T00:00:00.000Z', formatStamp: 'arxa-tree/4', githubStatus: 'not-linked' }, null, 2) + '\n')
  const { projectCheckSh } = await import(pathToFileURL(join(repo, 'plugins', 'git-workspace', 'lib', 'frame.js')).href)
  writeFileSync(join(org, 'check.sh'), projectCheckSh())
  chmodSync(join(org, 'check.sh'), 0o755)
  writeFileSync(join(org, 'main.dart'), 'void main() {}\n')
  writeFileSync(join(org, 'langstrip.ts'), 'const n: number = "no"\n')
  writeFileSync(join(org, 'langstrip.css'), '.a { colr: red; }\n')
  writeFileSync(join(org, 'langstrip.json'), '{"a": 1,}\n')
  writeFileSync(join(org, 'langstrip.html'), '<a href="x>unclosed</a>\n')
  const g = (a) => spawnSync('git', ['-C', org, '-c', 'user.email=wip@arxa.invalid', '-c', 'user.name=arxa scratch', ...a], { encoding: 'utf8' })
  g(['init', '-q', '-b', 'main']); g(['add', '-A']); g(['commit', '-qm', 'chore: seed the scratch evidence org'])
  mkdirSync(join(org, '.git', 'arxa'), { recursive: true })
  writeFileSync(join(org, '.git', 'arxa', 'sessions.json'), JSON.stringify({ sessions: [] }, null, 2) + '\n') // what openFreshSession diffs against
  mkdirSync(join(org, '.arxa'), { recursive: true }) // engine worktrees + trash land here
}

// ---- studio boot (engine-boot-smoke pattern) -------------------------------
let studio = null
let scratch = null
const chromeTags = new Set()

// The desktop-session.json contract walk: exchange the one-time token (303 →
// cookie, authority-bound — dial loopback, ride the URL's host as Host) then
// expect 200 HTML. Mirrors scripts/engine-boot-smoke.mjs.
const fetch200 = (tokenUrl) => {
  const u = new URL(tokenUrl)
  return new Promise((resolve) => {
    const ex = http.request({ host: '127.0.0.1', port: u.port || PORT, path: u.pathname + u.search, headers: { host: u.host }, timeout: 5000 }, (res) => {
      res.resume(); res.on('end', () => resolve((res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') || null))
    })
    ex.on('timeout', () => { ex.destroy(); resolve(null) }); ex.on('error', () => resolve(null)); ex.end()
  }).then((cookie) => !cookie ? null : new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: u.port || PORT, path: '/', headers: { host: u.host, cookie }, timeout: 5000 }, (res) => {
      let body = ''; res.on('data', (d) => { body += d }); res.on('end', () => resolve(res.statusCode === 200 && /<html/i.test(body) ? cookie : null))
    })
    req.on('timeout', () => { req.destroy(); resolve(null) }); req.on('error', () => resolve(null)); req.end()
  }))
}

let studioLog = '' // the booted studio's stdout/stderr — printed on any miss so driver/product blame is visible
const bootStudio = async (home) => {
  // HOME DISCIPLINE (bin/arxa-studio.mjs): the whole studio points at the
  // scratch dir, parent DSH_* identity stripped. PATH drops fvm so the
  // artifact-viewer's Dart resolution (studio-process env, not the capture
  // child's) sees NO SDK — the dart-absent lane needs the studio itself to
  // live in the SDK-absent world.
  const env = {
    ...process.env,
    ARXA_HOME: home, ARXA_PORT: PORT, HOME: home,
    PATH: process.env.PATH.split(':').filter((p) => !/\/fvm\//.test(p)).join(':'),
    ...Object.fromEntries(Object.keys(process.env).filter((k) => k.startsWith('DSH_')).map((k) => [k, undefined])),
  }
  studio = spawn(process.execPath, [join(repo, 'bin', 'arxa-studio.mjs'), '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  studio.stdout.on('data', (d) => { log += d; studioLog += d }); studio.stderr.on('data', (d) => { log += d; studioLog += d })
  const deadline = Date.now() + BOOT_BUDGET_MS
  while (Date.now() < deadline) {
    if (studio.exitCode !== null) throw new Error(`studio exited ${studio.exitCode} before serving — last output: ${log.trim().split('\n').slice(-3).join(' / ')}`)
    try {
      const s = JSON.parse(readFileSync(join(home, 'dsh', 'desktop-session.json'), 'utf8'))
      if (s.token && s.url && await fetch200(s.url)) {
        return { studioUrl: new URL(s.url).origin, token: s.token } // matched pair: the cookie binds to THIS url's authority
      }
    } catch {}
    await sleep(1000)
  }
  throw new Error('studio never served within the boot budget — last output: ' + log.trim().split('\n').slice(-5).join(' / '))
}

// ---- process lifecycle -----------------------------------------------------
const treeOf = (pid) => {
  const tree = []; const q = [pid]
  while (q.length) {
    const out = spawnSync('pgrep', ['-P', String(q.pop())], { encoding: 'utf8' })
    for (const l of (out.stdout || '').split('\n')) { const c = Number(l.trim()); if (c > 0) { tree.push(c); q.push(c) } }
  }
  return tree
}
const killTree = (pid, immediate = false) => {
  if (!pid) return
  const tree = [pid, ...treeOf(pid)]
  for (const p of tree) { try { process.kill(p, 'SIGTERM') } catch {} }
  if (immediate) { for (const p of tree) { try { process.kill(p, 'SIGKILL') } catch {} }; return }
  setTimeout(() => { for (const p of tree) { try { process.kill(p, 'SIGKILL') } catch {} } }, 1500).unref()
}

// Sweep the gate child's pid-tagged Chromium until pgrep is empty: the gate
// kills its launcher PID, but a leaked renderer must not survive the pair.
const sweepChromium = async (tag) => {
  chromeTags.add(tag)
  const pids = () => (spawnSync('pgrep', ['-f', `arxa-evidence-chrome-${tag}`], { encoding: 'utf8' }).stdout || '').split('\n').map((s) => Number(s.trim())).filter(Boolean)
  for (const sig of [null, 'SIGTERM', 'SIGKILL']) {
    for (let i = 0; i < 8; i++) {
      const live = pids()
      if (!live.length) return true
      if (sig) for (const p of live) { try { process.kill(p, sig) } catch {} }
      await sleep(500)
    }
  }
  return pids().length === 0
}

// ---- one (width × gate-surface) pair ---------------------------------------
const runGate = (width, surface, ctx) => new Promise((res) => {
  const start = Date.now()
  const child = spawn(process.execPath, [GATE, String(width), surface], {
    cwd: repo,
    env: { ...process.env, STUDIO_URL: ctx.studioUrl, STUDIO_TOKEN: ctx.token, ARXA_ORG: ctx.org },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
  child.on('error', (e) => { out += `\nSPAWN ERROR: ${e.message}\n` }) // resolve via exit below if it ever fires; never hang
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; killTree(child.pid, true) }, PAIR_BUDGET_MS)
  child.on('close', async (code, signal) => { // 'close', not 'exit': fires even after a spawn 'error', and only with stdio fully drained
    clearTimeout(timer)
    const gone = await sweepChromium(`${width}-${child.pid}`) // browser tree fully dead before the next pair
    mkdirSync(LOGS, { recursive: true })
    writeFileSync(join(LOGS, `${width}-${surface}.log`), out.replace(/token=[^&\s"']+/g, 'token=REDACTED')) // never persist secrets
    if (!gone) console.error(`  WARN: chromium remnants for arxa-evidence-chrome-${width}-${child.pid} survived the sweep`)
    res({ surface, width, code, signal, timedOut, start, out })
  })
})

// Mount-shaped die reasons are "missing at width" (recorded rows); everything
// else the gate can say (unfiltered console/page errors, non-mount die,
// crash, timeout) is a hard failure.
const MOUNTLESS = /never (mounted|showed|rendered|listed|became reachable|fired|expanded)|NOT FOUND|NO NEW-SESSION BUTTON|MOUNT ERR|no (diagnostic|preview iframe|new registry row|Delete forever|header toggle|purge confirm)|did not (render|survive)|unknown surface|theme did not/i
const classify = (run) => {
  const errs = Number((run.out.match(/GATE ERRORS \((\d+)\)/) || [])[1] || 0)
  const fi = run.out.indexOf('FILTERED (pre-existing')
  const filtered = fi < 0 ? 0 : run.out.slice(fi).split('\n').slice(1).filter((l) => /^ {2}\S/.test(l)).length // the gate's own IGNORED list applied these
  const fail = (run.out.match(/EVIDENCE FAIL: (.*)/) || [])[1]
  if (errs) return { kind: 'hard', filtered, errs, error: `GATE ERRORS (${errs}) — first: ${(run.out.match(/GATE ERRORS \(\d+\):[\s\S]*?\n {2}(.*)/) || [])[1] || ''}`.trim(), cause: 'unfiltered console/page errors during capture' }
  if (fail) return MOUNTLESS.test(fail)
    ? { kind: 'missing', filtered, errs: 0, error: fail, cause: 'surface did not mount/render at this width — recorded, not a failure (dispatch semantics)' }
    : { kind: 'hard', filtered, errs: 0, error: fail, cause: 'gate died on a non-mount condition' }
  if (run.timedOut) return { kind: 'hard', filtered, errs: 0, error: `pair exceeded the ${PAIR_BUDGET_MS / 1000}s budget`, cause: 'hung surface or flow — see the pair log' }
  if (run.code === 0) return { kind: 'ok', filtered, errs: 0, error: null, cause: null }
  return { kind: 'hard', filtered, errs: 0, error: `gate exited ${run.code}${run.signal ? ' on ' + run.signal : ''} without a verdict`, cause: 'process-level failure — see the pair log' }
}

const shotFile = (width, name) => join(EVIDENCE, String(width), `${name}-${width}.png`)
// Failure-state shot families (gate surfaces that cannot mount shoot the pane
// as <name>-failed-<theme> instead — the honest evidence for the New
// findings). Recorded per row; they never flip a row to ok.
const FAIL_SHOTS = {
  'finish': ['finish-failed-light', 'finish-failed-dark'],
  'checks-red-disclosure': ['checks-red-failed-light', 'checks-red-failed-dark'],
  'project-preparation': ['project-preparation-failed-light', 'project-preparation-failed-dark'],
  'confinement-configured-effective': ['confinement-failed-light', 'confinement-failed-dark'],
  'trash-confirm': ['trash-confirm-failed-light', 'trash-confirm-failed-dark'],
  'trash-recover': ['trash-view-failed-light', 'trash-view-failed-dark'],
}
const evaluate = (entry, width, run, known) => {
  const base = { surface: entry.task, width, gate: entry.gate }
  if (!known.has(entry.gate)) {
    return { ...base, status: 'missing', error: `no surface "${entry.gate}" in scripts/evidence-gate.mjs`, cause: entry.task === 'workspace-signin' ? 'workspace sign-in has no mounted studio UI — the backend renders as a settings-section model and signIn requires a configured remote provider, unreachable on a credential-free scratch boot' : 'not implemented in this checkout of the gate', shots: [], consoleFiltered: 0, gateErrors: 0 }
  }
  const cls = classify(run)
  const shots = entry.shots.map((n) => { const f = shotFile(width, n); let ok = false; try { ok = statSync(f).mtimeMs > run.start } catch {} return { shot: `${n}-${width}.png`, ok } })
  let { kind: status, cause, error } = cls // classify() keys the verdict `kind`; rows carry `status`
  const failShots = (FAIL_SHOTS[entry.task] || []).map((n) => { const f = shotFile(width, n); let ok = false; try { ok = statSync(f).mtimeMs > run.start } catch {} return ok ? `${n}-${width}.png` : null }).filter(Boolean)
  if (failShots.length) base.failShots = failShots
  if (status === 'ok' && shots.some((s) => !s.ok)) { status = 'missing'; error = 'gate exited clean but an expected PNG is missing or stale'; cause = 'see the pair log' }
  const failLine = (run.out.match(/FAILURE STATE: (.*)/) || [])[1]
  if (failLine && status !== 'ok') cause = (cause ? cause + ' — ' : '') + failLine // the surface's own verdict line survives the stale-PNG wording
  // the install-strip lane must have rendered the STRIP (not a mounted editor)
  if (entry.gate === 'viewer-strip' && status === 'ok') {
    const st = (run.out.match(/dart state: (\{[^\n]*\})/) || [])[1] || ''
    if (!/"strip":\s*true/.test(st)) { status = 'missing'; error = 'dart state ' + (st || 'absent from log'); cause = 'the SDK-absent install strip did not render — the viewer mounts the editor and the LSP status/strip path does not engage on fresh scratch boots (identical at 1280; see task-8-report Part B limitations)' }
  }
  // backend L3: shots captured as the honest FAILURE-STATE card (wp.info()
  // rejects at every width on fresh boots) — ok, but the row says so
  if (entry.gate === 'backend' && status === 'ok' && /mounted-error:/.test(run.out || '')) {
    cause = 'L3 New finding: wp.info() rejects (connection: invalid server-response) at every width on fresh boots — shots are the failure-state card, not the live section model'
  }
  return { ...base, status, error, cause, shots, consoleFiltered: cls.filtered, gateErrors: cls.errs }
}

// ---- teardown ---------------------------------------------------------------
let tornDown = false
const teardown = () => {
  if (tornDown) return
  tornDown = true
  if (studio?.pid) killTree(studio.pid, true)
  for (const tag of chromeTags) { // SIGINT mid-pair: the gate child died with us; sweep its browser synchronously
    const live = (spawnSync('pgrep', ['-f', `arxa-evidence-chrome-${tag}`], { encoding: 'utf8' }).stdout || '').split('\n').map(Number).filter(Boolean)
    for (const p of live) { try { process.kill(p, 'SIGKILL') } catch {} }
  }
  if (scratch) { try { rmSync(scratch, { recursive: true, force: true }) } catch {} }
}
process.on('exit', teardown)
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { console.error(`\n${s} — tearing down scratch ${scratch || ''}`); teardown(); process.exit(s === 'SIGINT' ? 130 : 143) })

// ---- main -------------------------------------------------------------------
const main = async () => {
  const known = gateSurfaces()
  const ladder = onlySurfaces.length ? LADDER.filter((l) => onlySurfaces.includes(l.task) || onlySurfaces.includes(l.gate)) : LADDER
  console.log(`narrow capture: gate surfaces present in this checkout: ${[...known].join(', ')}`)
  scratch = mkdtempSync(join(tmpdir(), 'arxa-t8c-narrow-'))
  const home = join(scratch, 'home')
  const org = join(scratch, 'org', 'T8CLOSE')
  mkdirSync(home, { recursive: true })
  await seedOrg(org)
  // org registration = the home's organisation.json (the shape T7/T8B used)
  writeFileSync(join(home, 'organisation.json'), JSON.stringify({ orgs: [org], names: { t8close: org } }, null, 2) + '\n')

  const rows = []
  let ctx = null
  try {
    ctx = { ...(await bootStudio(home)), org }
    console.log(`studio up: ${ctx.studioUrl} (scratch ${scratch})`)
  } catch (e) {
    console.error('BOOT FAILED: ' + e.message)
    for (const width of WIDTHS) for (const entry of ladder) rows.push({ surface: entry.task, width, gate: entry.gate, status: 'hard', error: 'studio boot failed: ' + String(e.message).slice(0, 200), cause: 'environment/boot — see console above', shots: [], consoleFiltered: 0, gateErrors: 0 })
  }

  if (ctx) for (const width of WIDTHS) {
    const ran = new Map() // one gate run per (width × gate surface); ladder rows sharing a gate credit its shots
    for (const entry of ladder) {
      if (!ran.has(entry.gate)) {
        if (!known.has(entry.gate)) { // e.g. workspace-signin: no gate surface exists — recorded row, no browser spent
          console.log(`[${width}] ${entry.gate} — not a surface in this checkout's gate; recording row`)
          ran.set(entry.gate, null)
        } else {
          process.stdout.write(`[${width}] ${entry.gate} … `)
          const run = await runGate(width, entry.gate, ctx)
          ran.set(entry.gate, run)
          console.log(`exit ${run.code}${run.signal ? '/' + run.signal : ''} in ${Math.round((Date.now() - run.start) / 1000)}s`)
        }
      }
      rows.push(evaluate(entry, width, ran.get(entry.gate), known))
    }
  }

  mkdirSync(EVIDENCE, { recursive: true })
  if (studioLog) writeFileSync(join(LOGS, 'studio-boot.log'), studioLog.replace(/token=[^&\s"']+/g, 'token=REDACTED'))
  if (rows.some((r) => r.status !== 'ok')) console.log('\nstudio log tail (full copy: ' + relative(repo, join(LOGS, 'studio-boot.log')) + '):\n' + studioLog.trim().split('\n').slice(-14).join('\n'))
  writeFileSync(RUNLOG, JSON.stringify({ startedAt: new Date().toISOString(), widths: WIDTHS, ladder: ladder.map((l) => l.task), proven1280: Object.keys(PROVEN_1280), rows }, null, 2) + '\n')
  console.log(`\nstructured rows: ${relative(repo, RUNLOG)} · pair logs: ${relative(repo, LOGS)}/`)
  console.log('\nshot                                             width  result    errs(filtered)')
  console.log('-'.repeat(78))
  let okCount = 0
  const lines = []
  for (const r of rows) {
    if (!r.shots.length) lines.push([`(${r.gate})`, r.width, r.status, r.consoleFiltered])
    for (const s of r.shots) lines.push([s.shot, r.width, r.status === 'ok' && s.ok ? 'ok' : r.status === 'ok' ? 'missing' : r.status, r.consoleFiltered])
  }
  for (const [shot, width, result, errs] of lines) { if (result === 'ok') okCount++; console.log(`${shot.padEnd(48)} ${String(width).padEnd(6)} ${result.padEnd(9)} ${errs}`) }
  const hard = rows.filter((r) => r.status === 'hard')
  const provenHard = hard.filter((r) => PROVEN_1280[r.surface])
  const missing = lines.length - okCount
  console.log(`\n${okCount} shot(s) ok · ${missing} missing-at-width or failed (rows recorded) · ${hard.length} hard failure(s)`)
  if (provenHard.length) {
    for (const r of provenHard) console.error(`HARD FAIL on 1280-proven surface ${r.surface} @${r.width}: ${r.error}`)
    process.exitCode = 1
  } else {
    console.log('no 1280-proven surface hard-failed — exit 0 (missing-at-width rows are recorded evidence, not failures)')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(() => teardown()).catch((e) => { console.error('CAPTURE DRIVER FAILED: ' + (e?.stack || e)); teardown(); process.exitCode = 1 })
}
