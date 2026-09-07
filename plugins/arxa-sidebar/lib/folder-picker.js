// The native "choose a folder" dialog, per platform.
//
// macOS: osascript `choose folder` — unchanged, it is the system dialog.
//
// Linux: zenity, then kdialog. The XDG portal (org.freedesktop.portal.FileChooser)
// is the "right" answer on Hyprland and it is NOT reachable from a shell-out:
// the portal replies asynchronously on a Request object path derived from the
// CALLER's unique bus name, so a client has to hold one connection across the
// call and the response. `gdbus call` opens a fresh connection per invocation
// and exits, so the reply lands on a path the next invocation cannot subscribe
// to. Driving it properly needs a real D-Bus client in-process — a dependency
// for one dialog. zenity is 200 KB, prints the path on stdout, and Omarchy's
// portal stack answers it anyway; the Linux packaging declares it.
//
// Every branch returns the same shape: { ok: true, path } | { ok: false, canceled, error }.

/** How each tool spells "the user pressed Cancel". */
const CANCEL_EXIT = { osascript: 128, zenity: 1, kdialog: 1 }

/**
 * @param {object} opts
 * @param {string} [opts.title]      dialog prompt
 * @param {string} [opts.platform]   default process.platform
 * @param {(cmd: string, args: string[]) => import('node:child_process').ChildProcess} opts.spawn
 * @param {(path: string) => boolean} opts.exists  which tools are installed
 */
export async function pickFolder ({ title = 'Choose a folder', platform = process.platform, spawn, exists }) {
  const prompt = String(title).replace(/["\\]/g, '')
  const tool = resolveTool(platform, exists)
  if (tool === undefined) {
    return {
      ok: false,
      canceled: false,
      error: platform === 'linux'
        ? 'no folder dialog available — install zenity (pacman -S zenity) or kdialog, or type the path'
        : 'folder picker unsupported on ' + platform,
    }
  }

  const { name, bin, args } = tool(prompt)
  const child = spawn(bin, args)
  let out = ''
  let err = ''
  child.stdout?.on('data', (c) => { out += c })
  child.stderr?.on('data', (c) => { err += c })
  const code = await new Promise((resolve) => child.on('exit', resolve))

  if (code === 0) {
    const picked = out.trim().split('\n')[0].trim()
    if (picked === '') return { ok: false, canceled: true, error: 'canceled' }
    return { ok: true, path: picked.replace(/\/+$/, '') || '/' }
  }
  const canceled = code === CANCEL_EXIT[name] || /User canceled/i.test(err)
  return { ok: false, canceled, error: canceled ? 'canceled' : (err.trim() || `${name} exited ${code}`) }
}

function resolveTool (platform, exists) {
  if (platform === 'darwin') {
    if (!exists('/usr/bin/osascript')) return undefined
    return (prompt) => ({
      name: 'osascript',
      bin: '/usr/bin/osascript',
      args: ['-e', 'POSIX path of (choose folder with prompt "' + prompt + '")'],
    })
  }
  if (platform !== 'linux') return undefined
  for (const bin of ['/usr/bin/zenity', '/usr/local/bin/zenity']) {
    if (exists(bin)) {
      return (prompt) => ({
        name: 'zenity',
        bin,
        // --directory is what makes it a FOLDER chooser; without it zenity
        // returns a file and the org root would be a path that cannot hold one.
        args: ['--file-selection', '--directory', '--title=' + prompt],
      })
    }
  }
  for (const bin of ['/usr/bin/kdialog', '/usr/local/bin/kdialog']) {
    if (exists(bin)) {
      return (prompt) => ({
        name: 'kdialog',
        bin,
        args: ['--getexistingdirectory', process.env.HOME ?? '.', '--title', prompt],
      })
    }
  }
  return undefined
}
