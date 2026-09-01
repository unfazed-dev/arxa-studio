/**
 * A minimal MCP Apps server, used as the FIXTURE the arxa-mcp-apps plugin is
 * tested against. Not shipped to users; it exists so stage 4 is verified
 * against a real server speaking the real protocol rather than a mock of our
 * own assumptions.
 *
 * Implements the SEP-1865 shape:
 *  - a resource under the `ui://` scheme, MIME `text/html;profile=mcp-app`
 *  - a tool whose `_meta.ui.resourceUri` points at it
 *  - `_meta.ui.csp` / `_meta.ui.permissions` so the host's CSP construction
 *    has something real to read
 *
 * Run directly over stdio:  node plugins/mcp-apps/testserver.mjs
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROFILE_SDK_ESM = join(homedir(), '.dsh', 'profiles', 'node_modules',
  '@modelcontextprotocol', 'sdk', 'dist', 'esm')

// Same two-step resolution as lib/index.js's sdk() helper: arxa's own
// install first, else the operator profile install, else throw. The profile
// path alone dangles whenever the engine build it points at has been
// replaced but the profile symlink has not caught up yet.
async function sdk (...segments) {
  try {
    // The package's own exports map already redirects "./*" to
    // "./dist/esm/*" — do not add a "dist/esm" prefix here, or it doubles.
    return await import(join('@modelcontextprotocol/sdk', ...segments))
  } catch { /* not installed here — try the operator profile */ }
  const op = join(PROFILE_SDK_ESM, ...segments)
  if (existsSync(op)) return import(pathToFileURL(op).href)
  throw new Error(`arxa-mcp-apps(testserver): cannot resolve @modelcontextprotocol/sdk/dist/esm/${join(...segments)}`)
}

const { McpServer } = await sdk('server', 'mcp.js')
const { StdioServerTransport } = await sdk('server', 'stdio.js')
// zod ships CJS here (`main: ./index.cjs`); resolve it the standard way,
// relative to this file, rather than reaching into the operator profile
// (which was hitting the same dangling-symlink problem as the SDK above).
const { z } = createRequire(import.meta.url)('zod')

const UI_URI = 'ui://arxa-test/counter'

// Deliberately exercises the parts that matter: it scripts, it calls back into
// the host with tools/call, and it reports its own size.
const UI_HTML = `<!doctype html>
<html><body style="margin:0;font:13px system-ui;padding:12px">
  <h3 id="t">counter</h3>
  <button id="inc">increment via tools/call</button>
  <pre id="out"></pre>
  <script>
    let id = 0
    const rpc = (method, params) => new Promise((resolve) => {
      const rpcId = String(++id)
      const onMsg = (e) => {
        const m = e.data
        if (!m || m.id !== rpcId) return
        window.removeEventListener('message', onMsg)
        resolve(m.result ?? m.error)
      }
      window.addEventListener('message', onMsg)
      parent.postMessage({ jsonrpc: '2.0', id: rpcId, method, params }, '*')
    })
    ;(async () => {
      await rpc('ui/initialize', { appCapabilities: { availableDisplayModes: ['inline'] } })
      parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed',
        params: { width: 320, height: 160 } }, '*')
    })()
    document.getElementById('inc').onclick = async () => {
      const r = await rpc('tools/call', { name: 'bump', arguments: { by: 1 } })
      document.getElementById('out').textContent = JSON.stringify(r)
    }
  </script>
</body></html>`

const server = new McpServer({ name: 'arxa-test-apps', version: '0.1.0' })

server.registerResource('counter-ui', UI_URI, {
  title: 'Counter UI',
  mimeType: 'text/html;profile=mcp-app',
}, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: UI_HTML }],
}))

let count = 0

server.registerTool('show_counter', {
  title: 'Show counter',
  description: 'Render the counter UI.',
  inputSchema: {},
  _meta: {
    ui: {
      resourceUri: UI_URI,
      preferredSize: { width: 320, height: 160 },
      csp: { connectDomains: [], resourceDomains: [] },
      permissions: {},
    },
  },
}, async () => ({
  content: [{ type: 'text', text: `counter is ${count}` }],
  structuredContent: { count },
}))

server.registerTool('bump', {
  title: 'Bump counter',
  description: 'Increment the counter.',
  inputSchema: { by: z.number().optional() },
}, async ({ by }) => {
  count += by ?? 1
  return { content: [{ type: 'text', text: `counter is ${count}` }], structuredContent: { count } }
})

// A tool with NO ui meta, so tests can prove discovery discriminates.
server.registerTool('plain', {
  title: 'Plain tool',
  description: 'No UI.',
  inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: 'plain' }] }))

await server.connect(new StdioServerTransport())
