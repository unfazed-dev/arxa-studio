// Selftest: the folder dialog, per platform. Nothing here opens a window —
// the spawner and the "is it installed" check are injected.
//
// The Linux half matters because the org root is chosen with this dialog: with
// no picker, first run on Omarchy dead-ends unless the user types a path.
import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { pickFolder } from './lib/folder-picker.js'

let n = 0
const ok = (s) => { n++; console.log(`  ok ${s}`) }

/** A child that prints `out`/`err` and exits with `code` on the next tick. */
const fakeSpawn = (calls, { out = '', err = '', code = 0 }) => (bin, args) => {
  calls.push({ bin, args })
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  setTimeout(() => {
    if (out) child.stdout.emit('data', out)
    if (err) child.stderr.emit('data', err)
    child.emit('exit', code)
  }, 0)
  return child
}
const have = (...paths) => (p) => paths.includes(p)

// ---- Linux: zenity is the first choice.
{
  const calls = []
  const r = await pickFolder({
    title: 'Choose a folder', platform: 'linux',
    spawn: fakeSpawn(calls, { out: '/home/evan/work/\n' }),
    exists: have('/usr/bin/zenity', '/usr/bin/kdialog'),
  })
  assert.deepEqual(r, { ok: true, path: '/home/evan/work' }, 'trailing slash trimmed')
  assert.equal(calls[0].bin, '/usr/bin/zenity')
  assert.deepEqual(calls[0].args, ['--file-selection', '--directory', '--title=Choose a folder'])
  ok('linux: zenity wins, and --directory is passed (a file would not hold an org)')
}

// ---- Linux: kdialog when zenity is absent.
{
  const calls = []
  const r = await pickFolder({ platform: 'linux', spawn: fakeSpawn(calls, { out: '/srv/orgs\n' }), exists: have('/usr/bin/kdialog') })
  assert.deepEqual(r, { ok: true, path: '/srv/orgs' })
  assert.equal(calls[0].bin, '/usr/bin/kdialog')
  assert.equal(calls[0].args[0], '--getexistingdirectory')
  ok('linux: kdialog is the fallback')
}

// ---- Linux: cancel is not an error the UI should shout about.
{
  const r = await pickFolder({ platform: 'linux', spawn: fakeSpawn([], { code: 1 }), exists: have('/usr/bin/zenity') })
  assert.deepEqual(r, { ok: false, canceled: true, error: 'canceled' })
  ok('linux: exit 1 with no output reads as cancel')
}

// ---- Linux: a real failure keeps its words.
{
  const r = await pickFolder({ platform: 'linux', spawn: fakeSpawn([], { code: 5, err: 'cannot open display\n' }), exists: have('/usr/bin/zenity') })
  assert.equal(r.ok, false)
  assert.equal(r.canceled, false)
  assert.match(r.error, /cannot open display/)
  ok('linux: a genuine failure surfaces the tool\'s stderr, not "canceled"')
}

// ---- Linux with nothing installed: say what to install.
{
  const r = await pickFolder({ platform: 'linux', spawn: () => { throw new Error('must not spawn') }, exists: () => false })
  assert.equal(r.ok, false)
  assert.match(r.error, /install zenity/)
  ok('linux: no dialog installed → an actionable message, no spawn')
}

// ---- macOS is unchanged.
{
  const calls = []
  const r = await pickFolder({ title: 'Pick "the" \\ root', platform: 'darwin', spawn: fakeSpawn(calls, { out: '/Users/evan/Documents/\n' }), exists: have('/usr/bin/osascript') })
  assert.deepEqual(r, { ok: true, path: '/Users/evan/Documents' })
  assert.equal(calls[0].bin, '/usr/bin/osascript')
  assert.match(calls[0].args[1], /^POSIX path of \(choose folder with prompt "Pick the  root"\)$/, 'quotes and backslashes are stripped out of the AppleScript string')
  ok('darwin: osascript, with the prompt sanitised')
}

// ---- macOS cancel keeps its own exit code.
{
  const r = await pickFolder({ platform: 'darwin', spawn: fakeSpawn([], { code: 128, err: 'User canceled.\n' }), exists: have('/usr/bin/osascript') })
  assert.deepEqual(r, { ok: false, canceled: true, error: 'canceled' })
  ok('darwin: exit 128 is a cancel')
}

// ---- Anything else refuses without spawning.
{
  const r = await pickFolder({ platform: 'win32', spawn: () => { throw new Error('must not spawn') }, exists: () => true })
  assert.equal(r.ok, false)
  assert.match(r.error, /unsupported on win32/)
  ok('an unported platform refuses cleanly')
}

console.log(`selftest.folder-picker: ${n} ok`)
