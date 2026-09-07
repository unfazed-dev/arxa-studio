// The self-hosted runner's service, per platform.
//
// macOS: the runner tarball's own `svc.sh install` writes a per-user
// LaunchAgent and needs no sudo — so it stays.
//
// Linux: the SAME `svc.sh install` writes a SYSTEM unit under
// /etc/systemd/system and calls `sudo`. A GUI app that pops a root prompt
// mid-flow is wrong, and in a container or over SSH it simply fails, so Linux
// gets a `systemd --user` unit instead: same per-user semantics the LaunchAgent
// has, no privilege escalation, and `loginctl enable-linger` for the reboot
// survival svc.sh was there to provide.
import fs from 'node:fs'
import path from 'node:path'

/** Unit name for a runner instance. Ours, not GitHub's — svc.sh is not involved. */
export const unitName = (owner, name) => `arxa-runner-${owner}-${name}.service`

const unitDir = (home = process.env.HOME) => path.join(home, '.config', 'systemd', 'user')

/**
 * GitHub's runner labels. The hardcoded macOS,ARM64 set sent every job on a
 * Linux box to a runner that claimed to be a Mac.
 */
export function runnerLabels (platform = process.platform, arch = process.arch) {
  const os = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform === 'win32' ? 'Windows' : platform
  const cpu = arch === 'arm64' ? 'ARM64' : arch === 'x64' ? 'X64' : arch
  return `${os},${cpu},arxa`
}

export function renderUnit ({ dir, owner, name }) {
  return `[Unit]
Description=arxa self-hosted GitHub runner for ${owner}/${name}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${dir}
ExecStart=${dir}/run.sh
# The runner exits 0 when GitHub asks it to update itself; restarting is the
# documented way to come back on the new version.
Restart=always
RestartSec=5
KillMode=process
TimeoutStopSec=30

[Install]
WantedBy=default.target
`
}

/**
 * Install and start the user unit. Best-effort like the macOS path: a runner
 * without a service still works while arxa studio is up.
 * @returns {Promise<{ installed: boolean, unit: string, lingering: boolean }>}
 */
export async function installUserService ({ dir, owner, name, home = process.env.HOME, run, write = fs.writeFileSync, mkdir = fs.mkdirSync }) {
  const unit = unitName(owner, name)
  const file = path.join(unitDir(home), unit)
  mkdir(unitDir(home), { recursive: true })
  write(file, renderUnit({ dir, owner, name }))
  await run('systemctl', ['--user', 'daemon-reload'])
  await run('systemctl', ['--user', 'enable', '--now', unit])
  // Without linger a user unit dies at logout and does not come back on boot —
  // the whole point of installing a service. Not fatal if polkit refuses.
  let lingering = false
  try {
    await run('loginctl', ['enable-linger', process.env.USER ?? ''])
    lingering = true
  } catch { /* the runner still runs while the user is logged in */ }
  return { installed: true, unit, lingering }
}

/** Stop, disable and delete the user unit. Idempotent. */
export async function removeUserService ({ owner, name, home = process.env.HOME, run, exists = fs.existsSync, rm = fs.rmSync }) {
  const unit = unitName(owner, name)
  const file = path.join(unitDir(home), unit)
  let removed = false
  try { await run('systemctl', ['--user', 'disable', '--now', unit]) } catch { /* not installed */ }
  if (exists(file)) {
    try { rm(file, { force: true }) } catch { /* best-effort */ }
  }
  removed = !exists(file)
  try { await run('systemctl', ['--user', 'daemon-reload']) } catch { /* nothing to reload */ }
  return { removed, unit }
}
