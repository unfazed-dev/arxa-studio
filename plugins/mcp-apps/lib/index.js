/**
 * arxa-mcp-apps, host half — stage 4 of
 * arxa/docs/plans/inline-generative-ui-in-dsh.md.
 *
 * Makes arxa an MCP Apps host (SEP-1865, Final 2026-01-26): an MCP server can
 * ship interactive UI with its tools, and arxa renders it inline in the
 * conversation.
 *
 * WHY THIS IS A SIBLING, NOT A PATCH. dsh's own `@deepseek-ai/dsh-mcp-client`
 * bridges MCP tools onto `ctx.tools` but drops `_meta` at the boundary
 * (`lib/index.js:158` passes name/description/inputSchema/outputSchema and
 * nothing else) and never reads resources — so the `_meta.ui.resourceUri`
 * that MCP Apps hangs everything on never survives the crossing. Forking it
 * is barred by the depend-don't-fork law, and load-time patching a React
 * render path is the fragile last resort this plan already rejected. So this
 * plugin opens its OWN read-only MCP connection to the same server, purely to
 * discover UI resources. Tool execution still goes through dsh's bridge; we
 * add UI, we do not replace the tool plane.
 *
 * Config mirrors dsh-mcp-client's so one server is described the same way
 * twice:
 *   { serverName, transport: 'stdio'|'streamable-http',
 *     command?, args?, env?, url?, headers? }
 *
 * SECURITY POSTURE. UI HTML from an MCP server is the one genuinely untrusted
 * input in this whole feature — unlike arxa-gen-ui, whose payload is
 * catalogue-constrained. It is therefore never given `allow-same-origin`
 * (see the client half), and the `tools/call` proxy below is an allowlist:
 * only tools this same server actually advertises, only while the plugin is
 * live. That narrowness IS the control, because a capability bridge is
 * invisible to CSP (plan decision 20).
 */
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROFILE_MODULES = join(homedir(), '.dsh', 'profiles', 'node_modules')
const SDK_ESM = join(PROFILE_MODULES, '@modelcontextprotocol', 'sdk', 'dist', 'esm')

async function sdk (...segments) {
  return import(pathToFileURL(join(SDK_ESM, ...segments)).href)
}

export const name = 'arxa-mcp-apps'
export const inject = ['connection']

const RPC_CHANNEL = '/arxa-mcp-apps'
const UI_MIME_PREFIX = 'text/html'
const UI_SCHEME = 'ui://'

/**
 * Read the MCP Apps UI descriptor off a tool, tolerating the two shapes in
 * the wild: `_meta.ui.resourceUri` (SEP-1865) and the pre-standard MCP-UI
 * `_meta['mcpui.dev/ui-resource-uri']`. Returns undefined for a plain tool.
 * @param {object} tool - one entry from tools/list.
 * @returns {object|undefined} normalized `{ resourceUri, preferredSize, csp, permissions }`.
 */
export function uiDescriptorOf (tool) {
  const meta = tool?._meta
  if (!meta || typeof meta !== 'object') return undefined
  const ui = meta.ui
  if (ui && typeof ui === 'object' && typeof ui.resourceUri === 'string') {
    return {
      resourceUri: ui.resourceUri,
      preferredSize: ui.preferredSize,
      csp: ui.csp,
      permissions: ui.permissions,
    }
  }
  const legacy = meta['mcpui.dev/ui-resource-uri']
  if (typeof legacy === 'string') return { resourceUri: legacy }
  return undefined
}

/**
 * Build the CSP for one UI resource from its declared metadata.
 *
 * The spec's rule, and the one that matters: a host may only ever TIGHTEN.
 * Undeclared domains are not allowed, and a resource that declares no CSP
 * gets the fully restrictive default (`connect-src 'none'`, no external
 * script/style/img origins) rather than a permissive one.
 * @param {object|undefined} csp - the resource's `_meta.ui.csp`, if any.
 * @returns {string} a Content-Security-Policy value.
 */
export function buildCsp (csp) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length > 0) : [])
  const connect = list(csp?.connectDomains)
  const resource = list(csp?.resourceDomains)
  const frame = list(csp?.frameDomains)
  const src = (declared, extra) => (declared.length > 0 ? declared.join(' ') : extra)
  return [
    "default-src 'none'",
    // Inline is unavoidable: an MCP App ships as one self-contained HTML doc.
    "script-src 'unsafe-inline' " + src(resource, "'self'"),
    "style-src 'unsafe-inline' " + src(resource, "'self'"),
    'img-src data: blob: ' + src(resource, "'self'"),
    'font-src data: ' + src(resource, "'self'"),
    'connect-src ' + (connect.length > 0 ? connect.join(' ') : "'none'"),
    'frame-src ' + (frame.length > 0 ? frame.join(' ') : "'none'"),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function apply (ctx, config = {}) {
  const serverName = config.serverName
  if (typeof serverName !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    throw new Error('arxa-mcp-apps: config.serverName must match [A-Za-z0-9_-]{1,32}')
  }

  // toolName (dsh-qualified) -> { resourceUri, html, csp, preferredSize, rawName }
  /** @type {Map<string, object>} */
  const templates = new Map()
  /** @type {Set<string>} */
  const callable = new Set()
  let client = null
  let discovery = null

  const qualified = (rawName) => `mcp__${serverName}__${rawName}`

  async function connect () {
    const { Client } = await sdk('client', 'index.js')
    const c = new Client({ name: `arxa-mcp-apps/${serverName}`, version: '0.1.0' },
      { capabilities: {} })
    if (config.transport === 'stdio') {
      const { StdioClientTransport } = await sdk('client', 'stdio.js')
      await c.connect(new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...config.env ?? {} },
      }))
    } else if (config.transport === 'streamable-http') {
      const { StreamableHTTPClientTransport } = await sdk('client', 'streamableHttp.js')
      await c.connect(new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers ?? {} },
      }))
    } else {
      throw new Error(`arxa-mcp-apps: unsupported transport ${JSON.stringify(config.transport)}`)
    }
    return c
  }

  /** Discover UI-declaring tools and prefetch their templates. */
  async function discover () {
    client = await connect()
    const { tools } = await client.listTools()
    for (const tool of tools ?? []) {
      callable.add(tool.name)
      const ui = uiDescriptorOf(tool)
      if (!ui) continue
      if (!ui.resourceUri.startsWith(UI_SCHEME)) {
        ctx.logger?.warn?.(`arxa-mcp-apps: ${tool.name} declares a non-ui:// resource `
          + `(${ui.resourceUri}); skipping — the spec reserves ui:// for app templates`)
        continue
      }
      let read
      try {
        read = await client.readResource({ uri: ui.resourceUri })
      } catch (error) {
        ctx.logger?.warn?.(`arxa-mcp-apps: could not read ${ui.resourceUri} for ${tool.name}: ${String(error)}`)
        continue
      }
      // MVP is HTML-only; external-URL and remote-DOM content types are
      // explicitly deferred by the spec, so anything else is skipped loudly
      // rather than half-rendered.
      const entry = (read.contents ?? []).find((c) =>
        typeof c.text === 'string' && String(c.mimeType ?? '').startsWith(UI_MIME_PREFIX))
      if (!entry) {
        ctx.logger?.warn?.(`arxa-mcp-apps: ${ui.resourceUri} carries no text/html content; skipping`)
        continue
      }
      templates.set(qualified(tool.name), {
        rawName: tool.name,
        resourceUri: ui.resourceUri,
        html: entry.text,
        csp: buildCsp(ui.csp),
        permissions: ui.permissions ?? {},
        preferredSize: ui.preferredSize ?? null,
      })
    }
    return templates.size
  }

  discovery = discover().catch((error) => {
    ctx.logger?.warn?.(`arxa-mcp-apps(${serverName}): discovery failed — ${String(error)}`)
    return 0
  })

  ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    await discovery
    switch (endpoint) {
      case 'templates': {
        // The browser half asks once at boot for the whole set, so it knows
        // which tool names to claim a toolview for.
        return {
          ok: true,
          value: {
            serverName,
            templates: Object.fromEntries([...templates].map(([toolName, t]) => [toolName, {
              resourceUri: t.resourceUri,
              html: t.html,
              csp: t.csp,
              permissions: t.permissions,
              preferredSize: t.preferredSize,
            }])),
          },
        }
      }
      case 'call': {
        // The UI-initiated `tools/call`. Allowlisted to tools this same server
        // advertised; anything else is refused rather than forwarded.
        const { name: toolName, arguments: args } = payload ?? {}
        if (typeof toolName !== 'string' || !callable.has(toolName)) {
          return { ok: false, error: { message: `arxa-mcp-apps: ${JSON.stringify(toolName)} is not a tool of server ${serverName}` } }
        }
        if (client === null) return { ok: false, error: { message: 'arxa-mcp-apps: not connected' } }
        try {
          const result = await client.callTool({ name: toolName, arguments: args ?? {} })
          return { ok: true, value: result }
        } catch (error) {
          return { ok: false, error: { message: String(error) } }
        }
      }
      default:
        return { ok: false, error: { message: `arxa-mcp-apps: unknown endpoint ${JSON.stringify(endpoint)}` } }
    }
  }, { authority: 'loopback' })

  ctx.effect?.(() => () => { client?.close?.().catch(() => {}) })
}
