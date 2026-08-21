// Load-time patch for dsh-client-connection's loopback classifier.
//
// dsh pins the privileged /api plane (settings.*, credentials.*,
// agentPreset.*, host.*, llm.discoverModels) to LOOPBACK hostnames — by
// design, and rightly. But its classifier accepts only the exact strings
// "localhost" / "[::1]" / 127.x.x.x, while RFC 6761 and the WHATWG URL spec
// define every *.localhost name as loopback (OS resolvers and browsers both
// send arxa.studio.localhost to 127.0.0.1 — verified 2026-08-21). Without
// this, the Models/Plugins/Settings pages 403 under arxa's named surface.
//
// This is a semantic correction of one predicate, applied to the exact file
// at load time — not a fork: arxa pins @deepseek-ai/* exactly, and if a dep
// bump rewrites the needle this throws at boot instead of silently shipping
// a broken (or worse, silently widened) fence.
import { registerHooks } from 'node:module'

const NEEDLE = 'if (hostname === "localhost" || hostname === "[::1]") return true;'
const PATCH = 'if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]") return true;'

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.includes('dsh-client-connection/lib/index.js')) return result
    const source = result.source?.toString()
    if (source === undefined || !source.includes(NEEDLE)) {
      throw new Error('arxa: loopback-localhost patch needle missing — '
        + 'dsh-client-connection changed shape; re-verify the /api fence '
        + 'before bumping the pin')
    }
    return { ...result, source: source.replaceAll(NEEDLE, PATCH) }
  },
})
