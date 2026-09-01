// Host half of arxa-personalisation. The Personalisation settings tab is
// entirely browser-side (one section registration + one stylesheet — see
// lib/client.js); the host half exists only so the composition row has a
// plugin to load. Headless safe: apply is a no-op and nothing here touches
// a web surface.
export const name = 'arxa-personalisation'
export const inject = []

export function apply(ctx) {}
