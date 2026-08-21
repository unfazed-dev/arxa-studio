// Host half of arxa-brand. The profile patch sets web-runtime
// surfaceContext: false, which drops BOTH DeepSeek-worded prompt sections
// (harness-source and web-surface) and the DSH_WEB_URL shell variable. This
// plugin restores the one piece worth keeping — the web-surface orientation —
// worded as arxa. Sections register by unique name (duplicates throw), so
// replace-via-disable-then-register is the only path.
//
// Headless safe: no webServer service means empty text, and the renderer
// drops empty sections.
export const name = 'arxa-brand'
export const inject = ['systemPrompt']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'arxa:web-surface',
    order: -98,
    text: () => {
      const port = ctx.get('webServer')?.port
      if (port === undefined) return ''
      return `You are interacting with the user through the arxa studio web GUI `
        + `at http://arxa.studio.local:${String(port)} (an mDNS alias of `
        + `http://127.0.0.1:${String(port)}; arxa.studio also works where that `
        + `name resolves). When the user refers to "this page", `
        + `"this GUI", or "this app" without naming another target, they mean this `
        + `GUI. The browser provides no implicit DOM, route, or screenshot context. `
        + `Changes to the GUI's own code require rebuilding its artifacts and a page `
        + `refresh; starting another server does not update this GUI — do not start `
        + `a replacement server unless the user asks.`
    },
  })
}
