// Host half of arxa-prism. The prism background is entirely browser-side
// (one owned stylesheet + two pick timers — see lib/client.js); the host half
// exists only so the composition row has a plugin to load. Headless safe:
// apply is a no-op and nothing here touches a web surface.
export const name = 'arxa-prism'
export const inject = []

export function apply(ctx) {}
