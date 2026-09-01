/**
 * arxa-locale (host half) — en/pl/fr locale world
 * (docs/plans/dsh-plugin-ui-conformance.md, Phase 0).
 *
 * Byte-close mirror of the stock @deepseek-ai/dsh-client-locale host half
 * (26 lines, dsh 0.1.1-rc.2) with ONE delta: the durable preference schema
 * validates en/pl/fr instead of zh/en. Everything else — namespace "locale",
 * field "preference", absence-delegates-to-browser — is the stock contract,
 * so a stock client and an arxa client read each other's settings doc
 * without migration.
 *
 * Revert shape: delete the locale disable-row + the arxa-locale insert in
 * profile/cordis.patch.yml; the stock package in node_modules is untouched.
 *
 * Resolution: bare @deepseek-ai/schemastery resolves through the engine's
 * own node_modules in every deployment shape (repo checkout AND the packed
 * sidecar's flat copies) — same probe-free bare-import convention as the
 * arxa-sidebar zero-dep packages; no dependency is declared here.
 *
 * NOTE: a settings doc that carries the retired "zh" preference now fails
 * validation; the client's adopt() then falls back to the browser-derived
 * locale (one-time, acceptable).
 */
import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the locale plugin (stock contract). */
const LOCALE_SETTINGS_NAMESPACE = 'locale'
/** Field carrying an explicit locale selection; absence delegates to the browser. */
const LOCALE_PREFERENCE_FIELD = 'preference'
/** Locale identifiers shipped by the arxa browser client (zh dropped). */
const LOCALE_IDS = ['en', 'pl', 'fr']
/** Durable locale schema; also the wire envelope the browser scope validates against. */
const LocaleSettingsSchema = z.object({ [LOCALE_PREFERENCE_FIELD]: z.union([...LOCALE_IDS]).required(false) })

export function apply(ctx) {
  ctx.inject(['settings'], (settingsCtx) => {
    // settingsNamespace() is a kebab-case brand that returns its input —
    // the literal is already conformant, so the brand call is inlined.
    settingsCtx.settings.register('locale', LocaleSettingsSchema)
  })
}

export { LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE }
