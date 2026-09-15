#!/usr/bin/env node
// session-format-check — the V3 alarm (grill round 3, 2026-09-14).
//
// Upstream 0.1.5 stamps a NEW session format ("V3" in its release notes) and
// migrates the session home ONE-WAY. arxa's session-reading half (conversation
// rail, exports) rides the engine's own store, so the seam is one constant:
// SESSION_FORMAT_VERSION, exported by @deepseek-ai/dsh-session. A wave that
// moves it rewrites ~/.arxa/dsh on first boot — this gate must go RED in CI
// BEFORE any pnpm install, not after a user's logs are already converted.
// When it fires: docs/research/dsh-0.1.5-upgrade-analysis.md §Runbook —
// backup ~/.arxa/dsh first, adapt the fold/export readers, THEN bump EXPECTED.
//
//   node scripts/session-format-check.mjs
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Resolve inside the PINNED wave (the .pnpm graph via dsh-web-app), never the
// repo root: dsh-session is a hoisted-only transitive, and the root once held
// pre-pnpm leftovers from a dead wave (see scripts/stock-path.mjs).
const webAppDir = dirname(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-app/package.json'))
const require = createRequire(join(webAppDir, 'package.json'))

// The 0.1.5-rc.2 wave stamps 3 (the runbook ran 2026-09-15: ~/.arxa/dsh backed
// up to ~/.arxa/dsh.pre-0.1.5-backup before the one-way migration; the
// conversation fold rides the engine's sessionController RPC, so no file
// reader in arxa parses the v3 layout directly). Upstream release notes call
// the 0.1.5 format "V3"; the on-disk constant is the truth, not the notes.
const EXPECTED = 3

let failed = 0
const ok = (label, cond, note = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
  if (!cond) failed++
}

const { SESSION_FORMAT_VERSION } = require('@deepseek-ai/dsh-session')
ok(`dsh-session stamps the recorded session format ${EXPECTED}`, SESSION_FORMAT_VERSION === EXPECTED,
  SESSION_FORMAT_VERSION === EXPECTED ? `wave ${pkg.dependencies['@deepseek-ai/dsh']}`
    : `wave stamps ${SESSION_FORMAT_VERSION} — session format moved: run the upgrade runbook (backup ~/.arxa/dsh) BEFORE installing`)

console.log(failed === 0 ? `\nsession format: pinned at ${EXPECTED}` : `\nsession format: ${failed} BREAK(S)`)
process.exit(failed === 0 ? 0 : 1)
