// Pure model-catalog helpers for the claude-code provider. No I/O.
export const PROVIDER_ID = 'claude-code'
export const PROVIDER_NAME = 'Claude Code (your subscription)'
export const FABLE_MIN_VERSION = '2.1.255'

const row = (id, name, description) => ({ provider: PROVIDER_ID, id, name, description, efforts: [] })
// ponytail: static fallback only when the SDK probe fails; the probe list wins.
export const STATIC_MODELS = [
  row('fable', 'Fable', 'Most capable Claude model'),
  row('opus', 'Opus', 'Strong general model'),
  row('sonnet', 'Sonnet', 'Fast, balanced'),
  row('haiku', 'Haiku', 'Fastest, cheapest'),
]

/** @param {{value:string,displayName:string,description:string,supportedEffortLevels?:string[]}[]} sdkModels */
export function modelsFromSdk (sdkModels) {
  return sdkModels.map((m) => ({
    provider: PROVIDER_ID,
    id: m.value,
    name: m.displayName,
    description: m.description,
    efforts: m.supportedEffortLevels ?? [],
  }))
}

export function versionAtLeast (actual, min) {
  const a = String(actual).split('.').map(Number), b = String(min).split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) }
  return true
}

const isFable = (model) => /fable/i.test(model.id) || /fable/i.test(model.name)

/** Picker description: base description plus the Fable tier/version note (D9). */
export function describeModel (model, account) {
  if (!isFable(model)) return model.description
  const base = model.description
  if (!account?.loggedIn) return `${base} — sign in with \`claude auth login\` first`
  if (!versionAtLeast(account.version, FABLE_MIN_VERSION)) return `${base} — needs Claude Code ≥ ${FABLE_MIN_VERSION}, you have ${account.version}`
  if (account.subscriptionType === 'max') return `${base} — included on Max, up to 50% of your weekly limit`
  return `${base} — on Pro this uses usage credits`
}
