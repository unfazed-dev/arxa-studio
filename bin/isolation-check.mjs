#!/usr/bin/env node
// Fails if arxa can reach the operator's dsh install again.
//
// arxa once resolved its dsh binary from ~/.dsh/profiles/node_modules as a
// fallback. arxa-studio/node_modules was never installed, so that fallback
// ALWAYS won: arxa pinned 0.1.0-rc.7 and ran whatever `npx @deepseek-ai/dsh`
// last wrote into the shared npm cache slot. Run this after touching
// bin/arxa.mjs or the dsh pins.
//   node bin/isolation-check.mjs
import { readFileSync, existsSync, readlinkSync, lstatSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

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

for (const l of ok) console.log('  ok    ' + l)
for (const l of skip) console.log('  SKIP  ' + l)
for (const l of fail) console.error('  FAIL  ' + l)
console.log(`\n${ok.length} passed, ${fail.length} failed, ${skip.length} skipped`)
if (skip.length) console.log('a SKIP is not a pass — the check could not run')
process.exit(fail.length ? 1 : 0)
