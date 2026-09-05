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

/** The command arxa TELLS the user to run. arxa never runs it (D6): a login arxa
 * launches would own the browser handoff and the token, and arxa deliberately owns
 * neither — the CLI's own session is the credential. Verified against the shipped CLI:
 * `claude auth login` (`claude auth --help`: login / logout / status). */
export const SIGNIN_CMD = 'claude auth login'

/** The context window dsh's context ring divides by. `supportedModels()` carries none; the only
 * live source is `modelUsage[model].contextWindow` on each turn's result, which the adapter
 * learns and passes in as `learned`. Before any turn has run, the CLI's own `[1m]` id suffix
 * marks the 1M rows and everything else gets the 200k default. The old flat 200_000 made a
 * Fable (`claude-fable-5-1[1m]`) ring read five times too full. */
export function contextWindowFor (id, learned = undefined) {
  if (Number.isInteger(learned) && learned > 0) return learned
  return /\[1m\]/i.test(String(id ?? '')) ? 1_000_000 : 200_000
}
/** Where a user with no CLI at all has to start. */
export const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code/setup'
/** Named so the message can point somewhere, not just state a fact (F14). */
export const SIGNIN_SURFACE = 'Settings → Models → Claude Code (your subscription)'

/** Turn a failed probe into a message that says what actually went wrong (F13).
 *
 * The previous single fixed string reported EVERY probe failure — timeout, missing
 * binary, spawn refusal — as "not signed in", which is both wrong and undebuggable:
 * `account.error` held the real cause and was discarded, so a user staring at the
 * banner had no way to tell a stale CLI from a dead sandbox from a genuine sign-out.
 * @param {{error?: string}} account a probe result with `loggedIn` false.
 */
export function signedOutMessage (account = {}) {
  const err = String(account.error ?? '')
  if (/no claude binary/i.test(err)) {
    return `claude-code: Claude Code is not installed. Install it (${INSTALL_URL}), run \`${SIGNIN_CMD}\`, then pick the model again.`
  }
  if (/not logged in|please run \/login|unauthoriz|authentication/i.test(err) || err === '') {
    return `claude-code: not signed in. Run \`${SIGNIN_CMD}\` in a terminal — or start the sign-in from ${SIGNIN_SURFACE}, which waits and picks it up automatically.`
  }
  // Anything else is a probe failure, NOT a sign-out. Say so, and keep the real cause:
  // this is the string that has to survive to the user for the next bug to be findable.
  return `claude-code: could not reach Claude Code (${err}). Your sign-in may be fine — retry, or check \`${SIGNIN_CMD.replace('login', 'status')}\` in a terminal.`
}

/** Find the live model a stored/selected id refers to (F12).
 *
 * The picker's id and the live SDK's id are NOT the same string. The SDK spells Opus
 * `opus[1m]` and Fable `claude-fable-5-1[1m]`, while STATIC_MODELS — what the picker
 * shows whenever the probe is cold — spells them `opus` and `fable`. A stored selection
 * also outlives any single probe. So an `m.id === model` lookup misses for exactly the
 * two reasoning models, resolveModel falls back to a synthetic row with `efforts: []`,
 * omits `reasoning`, and dsh's effort control hides itself for a signed-in user
 * (dsh-client-ui-model-selection/lib/client.js:490 renders that row only when
 * `reasoning !== undefined`). Hence: match by family, not by string equality.
 *
 * Returns undefined rather than a near-miss — silently running a different model than
 * the one the user picked is worse than losing the effort control.
 * @param {{id:string}[]} models live rows, in provider order.
 * @param {string} id the id to resolve, live or static spelling.
 */
export function matchModel (models, id) {
  if (!id) return undefined
  const want = String(id).toLowerCase()
  // `opus[1m]` -> `opus`; a plain id is its own base.
  const baseOf = (s) => String(s).toLowerCase().split('[')[0]
  return models.find((m) => m.id === id) ??
    models.find((m) => String(m.id).toLowerCase() === want) ??
    models.find((m) => baseOf(m.id) === want) ??
    // `fable` -> `claude-fable-5-1[1m]`: the family name is a whole token of the base id,
    // so a version-bumped id keeps resolving without a hand-maintained alias table.
    // Token equality, not substring: `sonnet` must never match `sonnet-thinking-preview`.
    models.find((m) => baseOf(m.id).split(/[-_.]/).includes(want))
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
