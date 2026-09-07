// Selftest: the runner's service layer, per platform.
//
// Two things this pins. First, labels: a Linux runner that advertises
// `macOS,ARM64` gets macOS jobs and fails them. Second, the install path:
// `svc.sh install` is a per-user LaunchAgent on macOS and a sudo-writing SYSTEM
// unit on Linux, so Linux installs a `systemd --user` unit instead — no root
// prompt out of a GUI app, and none of these tests may touch systemd for real.
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installUserService, removeUserService, renderUnit, runnerLabels, unitName } from './lib/service-unit.js'
import { removeRunner } from './lib/runner.js'

let n = 0
const ok = (s) => { n++; console.log(`  ok ${s}`) }

assert.equal(runnerLabels('darwin', 'arm64'), 'macOS,ARM64,arxa')
assert.equal(runnerLabels('linux', 'x64'), 'Linux,X64,arxa')
assert.equal(runnerLabels('linux', 'arm64'), 'Linux,ARM64,arxa')
assert.equal(runnerLabels('win32', 'x64'), 'Windows,X64,arxa')
ok('labels name the real OS and CPU, in GitHub\'s spelling')

assert.equal(unitName('octocat', 'mira'), 'arxa-runner-octocat-mira.service')
{
  const unit = renderUnit({ dir: '/home/evan/.arxa/runners/octocat__mira', owner: 'octocat', name: 'mira' })
  assert.match(unit, /^ExecStart=\/home\/evan\/\.arxa\/runners\/octocat__mira\/run\.sh$/m)
  assert.match(unit, /^WorkingDirectory=\/home\/evan\/\.arxa\/runners\/octocat__mira$/m)
  assert.match(unit, /^Restart=always$/m, 'the runner exits 0 to self-update — without Restart it never comes back')
  assert.match(unit, /^WantedBy=default\.target$/m, 'a USER unit target, not multi-user.target')
  assert.doesNotMatch(unit, /sudo|\/etc\/systemd/, 'nothing system-wide, nothing privileged')
  ok('the unit runs run.sh from the instance dir and restarts after a self-update')
}

// ---- install: writes the unit, reloads, enables, tries linger.
{
  const home = mkdtempSync(join(tmpdir(), 'arxa-runner-svc-'))
  try {
    const calls = []
    const out = await installUserService({
      dir: join(home, '.arxa', 'runners', 'octocat__mira'),
      owner: 'octocat', name: 'mira', home,
      run: async (cmd, args) => { calls.push([cmd, ...args]) },
    })
    assert.equal(out.installed, true)
    assert.equal(out.unit, 'arxa-runner-octocat-mira.service')
    assert.equal(out.lingering, true)
    const file = join(home, '.config', 'systemd', 'user', out.unit)
    assert.ok(existsSync(file), 'unit written under ~/.config/systemd/user')
    assert.match(readFileSync(file, 'utf8'), /octocat__mira\/run\.sh/)
    assert.deepEqual(calls[0], ['systemctl', '--user', 'daemon-reload'])
    assert.deepEqual(calls[1], ['systemctl', '--user', 'enable', '--now', out.unit])
    assert.equal(calls[2][0], 'loginctl', 'linger is what makes it survive logout')
    assert.ok(calls.every((c) => c[0] !== 'sudo'), 'never sudo')
    ok('install writes the user unit, reloads, enables --now, enables linger')

    // linger refused (polkit) is not fatal — the runner still runs while logged in.
    const strict = await installUserService({
      dir: join(home, 'x'), owner: 'octocat', name: 'mira2', home,
      run: async (cmd) => { if (cmd === 'loginctl') throw new Error('Not authorized'); },
    })
    assert.equal(strict.installed, true)
    assert.equal(strict.lingering, false)
    ok('a polkit refusal on linger degrades instead of failing the install')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- remove: disables, deletes, idempotent.
{
  const home = mkdtempSync(join(tmpdir(), 'arxa-runner-svc-'))
  try {
    const dir = join(home, '.config', 'systemd', 'user')
    mkdirSync(dir, { recursive: true })
    const unit = unitName('octocat', 'mira')
    writeFileSync(join(dir, unit), 'stale')
    const calls = []
    const out = await removeUserService({ owner: 'octocat', name: 'mira', home, run: async (cmd, args) => { calls.push([cmd, ...args]) } })
    assert.equal(out.removed, true)
    assert.ok(!existsSync(join(dir, unit)), 'unit file gone')
    assert.deepEqual(calls[0], ['systemctl', '--user', 'disable', '--now', unit])
    const again = await removeUserService({ owner: 'octocat', name: 'mira', home, run: async () => {} })
    assert.equal(again.removed, true, 'removing twice is not an error')
    ok('remove disables, deletes the unit, and is idempotent')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

// ---- removeRunner on linux: systemd, never launchctl, and the dir goes.
{
  const home = mkdtempSync(join(tmpdir(), 'arxa-runner-rm-'))
  try {
    const dir = join(home, '.arxa', 'runners', 'octocat__mira')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '.runner'), '{}')
    const calls = []
    const out = await removeRunner({ owner: 'octocat', name: 'mira', home, platform: 'linux', run: async (cmd, args) => { calls.push([cmd, ...(args ?? [])]) } })
    assert.equal(out.ok, true)
    assert.equal(out.serviceRemoved, true)
    assert.ok(!existsSync(dir), 'the instance directory is removed')
    const flat = calls.map((c) => c.join(' '))
    assert.ok(flat.some((c) => c.startsWith('systemctl --user disable')), 'the user unit is disabled')
    assert.ok(!flat.some((c) => c.includes('launchctl') || c.includes('svc.sh')), 'no launchctl and no sudo-ing svc.sh on Linux')
    ok('removeRunner on linux tears down the user unit, not a LaunchAgent')
  } finally { rmSync(home, { recursive: true, force: true }) }
}

console.log(`selftest.runner-service: ${n} ok`)
