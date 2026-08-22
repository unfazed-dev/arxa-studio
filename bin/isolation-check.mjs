#!/usr/bin/env node
// Fails if arxa can reach the operator's dsh install again.
//
// arxa once resolved its dsh binary from ~/.dsh/profiles/node_modules as a
// fallback. arxa-studio/node_modules was never installed, so that fallback
// ALWAYS won: arxa pinned 0.1.0-rc.7 and ran whatever `npx @deepseek-ai/dsh`
// last wrote into the shared npm cache slot. Run this after touching
// bin/arxa.mjs or the dsh pins.
//   node bin/isolation-check.mjs
import { readFileSync, existsSync, readlinkSync, lstatSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fail = []
const ok = []
const skip = []
const check = (name, cond, detail) => (cond ? ok : fail).push(detail ? `${name} — ${detail}` : name)

// 1. the launcher must not resolve an executable out of the operator's home
const launcher = readFileSync(join(root, 'bin', 'arxa.mjs'), 'utf8')
const resolvesOperatorDsh = /['"]\.dsh['"]\s*,\s*['"]profiles['"]\s*,\s*['"]node_modules['"]/.test(launcher)
check('launcher does not resolve dsh from ~/.dsh', !resolvesOperatorDsh,
  resolvesOperatorDsh ? 'the operator-install fallback is BACK in bin/arxa.mjs' : '')

// 2. arxa must have its own dsh, at exactly the pinned version
const pin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh']
const ownPkg = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
if (!existsSync(ownPkg)) {
  check('arxa has its own dsh installed', false, `missing — run: npm install --prefix ${root}`)
} else {
  const got = JSON.parse(readFileSync(ownPkg, 'utf8')).version
  check('own dsh matches the pin', got === pin, got === pin ? `${got}` : `pinned ${pin}, installed ${got}`)
}

// 3. nothing arxa executes may live in the shared npx cache
const npxLinks = (dir, depth = 2) => {
  if (depth < 0 || !existsSync(dir)) return []
  // caller must handle an ABSENT dir separately — see below. An empty result
  // from a directory that does not exist is not evidence of cleanliness.
  let hits = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    let st; try { st = lstatSync(p) } catch { continue }
    if (st.isSymbolicLink()) { try { if (readlinkSync(p).includes('_npx')) hits.push(p) } catch {} }
    else if (st.isDirectory()) hits = hits.concat(npxLinks(p, depth - 1))
  }
  return hits
}
for (const [label, dir] of [
  ['arxa-studio/node_modules', join(root, 'node_modules')],
  ['~/.arxa/dsh/profiles/node_modules', join(homedir(), '.arxa', 'dsh', 'profiles', 'node_modules')],
]) {
  if (!existsSync(dir)) {
    // Absent is NOT clean. It is unscanned. Saying "ok" here would read green on
    // any fresh machine and on the first regression after a profile wipe.
    skip.push(`${label} — not generated yet, nothing scanned (boot arxa once, then re-run)`)
    continue
  }
  const hits = npxLinks(dir)
  check(`no npx-cache links in ${label}`, hits.length === 0,
    hits.length ? `${hits.length} link(s) into ~/.npm/_npx, e.g. ${hits[0]}` : 'clean')
}

// 5. a contaminated launch env must be REFUSED before the first write.
// A shell inside a dsh session exports DSH_HOME=~/.dsh (managed DSH_*
// vars); 2026-08-22 the studio booted that way and listed the operator's
// sessions. os.homedir() honours $HOME on POSIX, so a tmpdir stands in
// for the operator's machine: the launcher must exit 127 with the refusal
// and leave the 'operator home' byte-for-byte untouched.
for (const [label, env] of [
  ['DSH_HOME points at the operator home', { DSH_HOME: 'OPERATOR_DSH' }],
  ['ARXA_HOME points at the operator home', { ARXA_HOME: 'OPERATOR_DSH' }],
]) {
  const fakeHome = mkdtempSync(join(tmpdir(), 'arxa-isolation-'))
  const childEnv = {
    HOME: fakeHome,
    PATH: process.env.PATH,
    DSH_SESSION_ID: 'parent-session', // the realistic shape of the leak
  }
  for (const [k, v] of Object.entries(env)) {
    childEnv[k] = v === 'OPERATOR_DSH' ? join(fakeHome, '.dsh') : v
  }
  const r = spawnSync(process.execPath, [join(root, 'bin', 'arxa.mjs'), '--headless'],
    { env: childEnv, encoding: 'utf8', timeout: 15000 })
  const wrote = readdirSync(fakeHome)
  check(`contaminated ${label} is refused before any write`,
    r.status === 127 && (r.stderr || '').includes('refusing to boot') && wrote.length === 0,
    r.status !== 127 ? `exit ${r.status}, wanted 127`
      : wrote.length ? `wrote into the operator home before refusing: ${wrote[0]}`
        : (r.stderr || '').slice(0, 120))
  rmSync(fakeHome, { recursive: true, force: true })
}

for (const l of ok) console.log('  ok    ' + l)
for (const l of skip) console.log('  SKIP  ' + l)
for (const l of fail) console.error('  FAIL  ' + l)
console.log(`\n${ok.length} passed, ${fail.length} failed, ${skip.length} skipped`)
if (skip.length) console.log('a SKIP is not a pass — the check could not run')
process.exit(fail.length ? 1 : 0)
