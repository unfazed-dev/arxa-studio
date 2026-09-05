// arxa-desktop-session — publish the engine's BrowserAuth launch token where
// the desktop shell can reach it.
//
// WHY THIS EXISTS
// ---------------
// dsh 0.1.2-rc.1 put the web UI behind BrowserAuth (dsh-client-connection):
// GET / answers 401 "dsh web authentication required; reopen the URL printed
// by dsh web." until the browser exchanges the per-boot launch token for a
// signed 30-day cookie. The CLI flow prints `dsh web: <url>?token=...` for a
// human to click — the arxa desktop shell is not a human and cannot click:
// its webview loaded the clean studio URL, got the 401 text, and had no
// programmatic route to the token (packed mode sends engine stdio to the log,
// and a shell that parses logs to log in is one log-rotation away from a
// lockout). Observed 2026-09-05: the first boot of the 0.1.2-rc.1 payload
// platform left the installed desktop app staring at the 401 line.
//
// THE SEAM
// --------
// upstream's own seam is the public one dsh-web-app prints through:
// ctx.connection.authenticatedUrl(base) (dsh-web-app/lib/index.js:206). This
// plugin publishes that URL — and the bare token — to
// $DSH_HOME/desktop-session.json on every engine boot. The desktop shell reads
// the file and navigates its webview to the tokenized URL once; the 303
// exchange mints the durable cookie on the desktop's own authority (the token
// itself is authority-agnostic — dsh-client-connection tokenMatches compares
// only the value; the cookie binds to the request authority at mint). The
// signing secret is durable across engine boots, so one exchange lasts the
// cookie's 30 days, not one engine run.
//
// Write is atomic (tmp + rename) so a reader never sees half a file. A
// missing or stale file degrades to the pre-plugin behaviour — navigate
// clean, see the 401 text — never to something worse.

import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

export const DESKTOP_SESSION_BASENAME = 'desktop-session.json'

export function desktopSessionFile (env = process.env) {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.arxa', 'dsh')
  return join(home, DESKTOP_SESSION_BASENAME)
}

export function publishDesktopSession ({ connection, port, env = process.env, pid = process.pid, at = new Date() }) {
  const url = connection.authenticatedUrl(`http://arxa.studio.localhost:${port}`)
  const token = new URL(url).searchParams.get('token')
  const file = desktopSessionFile(env)
  const tmp = `${file}.tmp-${pid}`
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(tmp, JSON.stringify({ url, token, pid, at: at.toISOString() }) + '\n')
  renameSync(tmp, file)
  return { file, url, token }
}

export default {
  inject: ['connection', 'webServer'],
  apply(ctx) {
    const publish = () => publishDesktopSession({ connection: ctx.connection, port: ctx.webServer.port })
    // Same readiness seam as dsh-web-app's `dsh web:` announce: the port is
    // only meaningful once the loader has settled and the server is bound.
    const settled = ctx.get('loader')?.await()
    if (settled === void 0) publish()
    else settled.then(() => { if (ctx.get('webServer') !== void 0) publish() })
  },
}
