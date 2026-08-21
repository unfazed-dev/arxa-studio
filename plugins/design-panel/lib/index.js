// Host half of arxa-design-panel. Pure UI plugin: the empty apply exists so
// the plugin appears in the host Loader; the browser half ships via
// exports['./client'], discovered through the package.json dsh.client
// declaration (same shape as @deepseek-ai/dsh-client-ui-jobs).
export const name = 'arxa-design-panel'
export function apply() {}
