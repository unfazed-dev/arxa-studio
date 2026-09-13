/**
 * arxa-workspace-provider — browser half.
 *
 * Hand-written in the __ModuleLoader__ factory shape every dsh client bundle
 * uses (same as arxa-personalisation). No UI yet: this half exposes ONE
 * accessor — window.__arxaWorkspaceProvider.info() — over Connection RPC to
 * the host's read-only status channel, so a later settings panel (§5 "Workspace
 * backend" panel) and T8's locale sweep have a stable seam to build on.
 */
window.__ModuleLoader__.load({
  id: 'arxa-workspace-provider',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Must equal lib/index.js RPC_CHANNEL. One segment only (dsh CHANNEL_PATTERN).
    const RPC_CHANNEL = '/arxa-workspace-provider'

    exports.inject = ['connection']

    exports.apply = (ctx) => {
      // Read-only status: provider name, redacted config shape, local caps.
      // A remote provider's capabilities need a live backend call — the panel
      // gets those from `arxa-studio provider verify` / diagnose, never here.
      window.__arxaWorkspaceProvider = {
        info: () => ctx.connection.rpc.call(RPC_CHANNEL, 'info', {}),
      }
    }
    return module.exports
  },
})
