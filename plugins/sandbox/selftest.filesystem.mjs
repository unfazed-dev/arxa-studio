// arxa-filesystem selftest — the in-process read/write fence (S1/§20,
// docs/plans/arxa-isolation-levels.md). Pure node, network-free.
// Run: node plugins/sandbox/selftest.filesystem.mjs
//
// §20 measured that dsh's SandboxedFileSystem fences ONLY the two mutations:
// there is no readText/streamText override, so the agent's own file tools can
// read a sibling project straight through in every mode. This selftest pins
// the arxa provider that closes exactly that: reads AND writes resolve/
// realpath through the active session root, reject sibling-project and symlink
// escapes, and reject reserved .git/.arxa control paths on mutation.
//
// The arena mirrors the real layout the fence is keyed on:
//
//   <arena>/org/                     ← the org root (the read-deny scope)
//     .arxa/worktrees/ws/            ← the session worktree (THE root)
//     .arxa/registry.json            ← reserved: never readable in-session
//     .git/HEAD                      ← org git plumbing: READABLE (git status)
//     projects/sibling/secret.env    ← a sibling project: never readable
//   <arena>/outside/sentinel.txt     ← outside the org entirely: readable
//                                      (mirrors the Seatbelt A2 profile, which
//                                      denies reads only under the org root)

import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'

import { canonicalPath } from '@deepseek-ai/dsh-sandbox'

import ArxaFileSystem from './lib/filesystem.js'

let checks = 0
const ok = (name) => { checks += 1; console.log('  ok', name) }

// The arena lives under the REPO, deliberately, and NOT under `os.tmpdir()`:
// dsh grants `/tmp` and `os.tmpdir()` outright under `workspace-write`, so a
// "sibling project" carved out of the temp dir is inside a granted root and
// the denial rows would pass for the wrong reason (the same trap
// scripts/s1-sandbox-verify.mjs documents). Here the worktree is writable
// only because it IS the session root; the sibling is reachable by no grant.
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const arena = mkdtempSync(join(repoRoot, '.fs-fence-arena-'))
const org = join(arena, 'org')
const ws = join(org, '.arxa', 'worktrees', 'ws')
const sibling = join(org, 'projects', 'sibling')
const orgGit = join(org, '.git')
const outside = join(arena, 'outside')
mkdirSync(ws, { recursive: true })
mkdirSync(join(sibling), { recursive: true })
mkdirSync(orgGit, { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(ws, 'inside.txt'), 'inside-workspace\n')
writeFileSync(join(sibling, 'secret.env'), 'TOKEN=shape-only\n')
writeFileSync(join(orgGit, 'HEAD'), 'ref: refs/heads/main\n')
writeFileSync(join(org, 'org.json'), '{}\n')
writeFileSync(join(outside, 'sentinel.txt'), 'outside-the-org\n')
// A symlink INSIDE the workspace pointing at the sibling — the classic
// escape. resolveLocalTarget realpaths the deepest existing ancestor, so the
// fence must see through it.
symlinkSync(join(sibling, 'secret.env'), join(ws, 'escape-link'))
process.on('exit', () => rmSync(arena, { recursive: true, force: true }))

/** Build the provider stack the cordis row mounts: policy service, then fs. */
function makeFs (mode = 'workspace-write', root = ws) {
  const ctx = new Context()
  // SandboxPolicyService injects sessionProjections (a dsh-base service a
  // bare Context lacks); stub the one face its constructor touches.
  ctx.reflect.provide('sessionProjections', { register () {} })
  new SandboxPolicyService(ctx, { mode, workspaceRoot: root })
  new ArxaFileSystem(ctx, {})
  return ctx.fs
}

/** @returns {string} the FsError code, or '' when the call did not throw. */
async function denial (promise) {
  try { await promise } catch (err) {
    if (err instanceof FsError && err.code === 'FS_SANDBOX_DENIED') return 'FS_SANDBOX_DENIED'
    throw err
  }
  return ''
}

// ---- 1. reads inside the session root work; everything the fence exists for
//      is denied, through the cordis service proxy (ctx.fs) exactly as the
//      model-facing tools reach it.
{
  const fs = makeFs()
  const t = (p) => fs.resolve(p, { cwd: ws })

  assert.equal((await fs.readText(await t('inside.txt'))).trim(), 'inside-workspace')
  ok('read: inside the session root')

  assert.equal(await denial(fs.readText(await t('../../../projects/sibling/secret.env'))), 'FS_SANDBOX_DENIED')
  assert.equal(await denial(fs.readText(await fs.resolve(sibling + '/secret.env', { cwd: ws }))), 'FS_SANDBOX_DENIED',
    'an absolute path to the sibling is denied too, not just the relative spelling')
  ok('read: sibling project denied (relative AND absolute)')

  assert.equal(await denial(fs.readText(await t('../../../org.json'))), 'FS_SANDBOX_DENIED')
  ok('read: parent (org root) denied')

  assert.equal(await denial(fs.readText(await t('escape-link'))), 'FS_SANDBOX_DENIED',
    'the symlink resolves to the REAL sibling file before the fence judges it')
  ok('read: symlink escape into the sibling denied')

  assert.equal(await denial(fs.readText(await t('../../registry.json'))), 'FS_SANDBOX_DENIED')
  assert.equal(await denial(fs.readText(await t('../registry.json'))), 'FS_SANDBOX_DENIED',
    'the reserved .arxa registry beside the worktree')
  ok('read: reserved .arxa root denied')

  // The deliberate carve-outs, pinned so they cannot drift:
  assert.equal((await fs.readText(await t('../../../.git/HEAD'))).trim(), 'ref: refs/heads/main',
    'git plumbing reads still work — git status/diff/log run through here')
  assert.equal((await fs.readText(await t('../../../../outside/sentinel.txt'))).trim(), 'outside-the-org',
    'outside the org entirely: readable, mirroring the Seatbelt A2 scope')
  ok('read: org .git plumbing and outside-the-org reads stay open (documented carve-outs)')
}

// ---- 2. streamText carries the same fence as readText.
{
  const fs = makeFs()
  const streamAll = async (p) => {
    let text = ''
    for await (const chunk of await fs.streamText(await p)) text += chunk
    return text
  }
  assert.equal((await streamAll(fs.resolve('inside.txt', { cwd: ws }))).trim(), 'inside-workspace')
  assert.equal(await denial(streamAll(fs.resolve('escape-link', { cwd: ws }))), 'FS_SANDBOX_DENIED')
  ok('stream: inside works, symlink escape denied')
}

// ---- 3. writes and edits: the stock mutation fence PLUS the reserved-path
//      rejection. The agent's file tools must not author git control state
//      (§11: a poisoned hook the host later executes) or the .arxa registry.
{
  const fs = makeFs()
  const policy = { mode: 'workspace-write', workspaceRoot: ws }
  const t = (p) => fs.resolve(p, { cwd: ws })

  const w = await fs.writeText(await t('written.txt'), 'x\n', undefined, undefined, policy)
  assert.equal(w.operation, 'create')
  ok('write: inside the session root')

  assert.equal(await denial(fs.writeText(await t('../../../projects/sibling/escape.txt'), 'x\n', undefined, undefined, policy)), 'FS_SANDBOX_DENIED')
  ok('write: sibling project denied (stock fence, unchanged)')

  for (const reserved of ['.git/hooks/pre-commit', '.git/config', 'sub/.git/objects/x', '.arxa/registry.json']) {
    assert.equal(await denial(fs.writeText(await t(reserved), 'x\n', undefined, undefined, policy)), 'FS_SANDBOX_DENIED',
      `reserved control path must be denied: ${reserved}`)
  }
  assert.equal(await denial(fs.editText(await t('.git/hooks/pre-commit'), { oldString: 'a', newString: 'b' }, undefined, undefined, policy)), 'FS_SANDBOX_DENIED')
  ok('write/edit: reserved .git and .arxa paths denied in-process (hooks stay the host\'s to run)')

  // .gitignore is NOT .git — a plain file with a dotted name stays writable.
  const gi = await fs.writeText(await t('.gitignore'), '.env\n', undefined, undefined, policy)
  assert.equal(gi.operation, 'create')
  ok('write: .gitignore (a lookalike name) is not reserved')
}

// ---- 4. mode behaviour: danger-full-access leaves reads open (A0 — the
//      tier the operator explicitly chose); read-only keeps the read fence
//      and denies every mutation.
{
  const open = makeFs('danger-full-access')
  assert.equal((await open.readText(await open.resolve('../../../projects/sibling/secret.env', { cwd: ws }))).trim(), 'TOKEN=shape-only')
  ok('read: danger-full-access (A0) leaves reads open — the operator\'s explicit choice')

  const ro = makeFs('read-only')
  assert.equal(await denial(ro.writeText(await ro.resolve('no.txt', { cwd: ws }), 'x\n', undefined, undefined, { mode: 'read-only', workspaceRoot: ws })), 'FS_SANDBOX_DENIED')
  assert.equal(await denial(ro.readText(await ro.resolve('../../../projects/sibling/secret.env', { cwd: ws }))), 'FS_SANDBOX_DENIED')
  ok('read-only: mutations denied, read isolation still on')
}

// ---- 5. honesty row: read isolation is keyed on the arxa worktree layout.
//      A session rooted somewhere else (a freestyle folder) gets NO in-process
//      read fence — exactly like the Seatbelt side, which can only scope a
//      read-deny around a known org root. Pinned so the limitation is a
//      documented behaviour, not a surprise.
{
  const plain = join(arena, 'plain-root')
  mkdirSync(plain)
  writeFileSync(join(plain, 'a.txt'), 'a\n')
  const ctx = new Context()
  ctx.reflect.provide('sessionProjections', { register () {} })
  new SandboxPolicyService(ctx, { mode: 'workspace-write', workspaceRoot: plain })
  new ArxaFileSystem(ctx, {})
  assert.equal((await ctx.fs.readText(await ctx.fs.resolve('../org/projects/sibling/secret.env', { cwd: plain }))).trim(), 'TOKEN=shape-only')
  ok('honesty: a non-arxa root has no read fence (mirrors the Seatbelt side) — pinned, not hidden')
}

// ---- 6. the resolve() annotation that carries the session root to the read
//      fence: present when a cwd rides the options, absent otherwise.
{
  const fs = makeFs()
  const withCwd = await fs.resolve('inside.txt', { cwd: ws })
  assert.equal(withCwd.arxaRoot, canonicalPath(ws), 'the session cwd is stamped on the target (canonical)')
  const withoutCwd = await fs.resolve(join(ws, 'inside.txt'))
  assert.equal(withoutCwd.arxaRoot, undefined, 'agentless resolves carry no stamp — the policy fallback governs')
  ok('resolve: session-root annotation rides the target, agentless resolves do not')
}

console.log(`arxa-filesystem selftest: ${checks} checks green`)
