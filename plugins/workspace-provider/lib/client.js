/**
 * arxa-workspace-provider — browser half.
 *
 * Hand-written in the __ModuleLoader__ factory shape every dsh client bundle
 * uses (same as arxa-personalisation). Exposes the settings-facing surface
 * (task 14 step 5): `window.__arxaWorkspaceProvider.info()` fetches the
 * read-only status over Connection RPC, and `section(info, locale)` renders
 * the localized "Workspace backend" settings-section model (title, provider
 * label, live/degraded capability badges, the declared sign-in flow, and the
 * verify hint). The panel consumes the model; this half never touches a
 * provider instance itself.
 *
 * All user-facing strings exist in en/pl/fr through the arxa-locale service
 * (pinned by selftest.settings.mjs).
 */
window.__ModuleLoader__.load({
  id: 'arxa-workspace-provider',
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // Must equal lib/index.js RPC_CHANNEL. One segment only (dsh CHANNEL_PATTERN).
    const RPC_CHANNEL = '/arxa-workspace-provider'

    // The arxa-locale namespace this plugin owns.
    const NS = 'workspace-provider'

    // ---- the Workspace-backend settings-section dictionary (en source of truth)
    const DICT = {
      en: {
        sectionTitle: 'Workspace backend',
        provider: 'Provider',
        providerLocal: 'Local (offline, zero config)',
        providerSupabase: 'Supabase (bring your own project)',
        providerGenericRest: 'Generic REST backend (Wire v1)',
        badgeLive: 'live',
        badgeDegraded: 'degraded',
        badgeOff: 'off',
        signInEmailForm: 'Email and password',
        signInToken: 'Access token',
        signInBrowser: 'Browser sign-in',
        signInDeviceCode: 'Device code',
        verifyHint: 'Run `arxa-studio provider verify` to certify this backend',
        licenseLine: 'arxa license: Totem official backend',
      },
      pl: {
        sectionTitle: 'Backend obszaru roboczego',
        provider: 'Dostawca',
        providerLocal: 'Lokalny (offline, bez konfiguracji)',
        providerSupabase: 'Supabase (własny projekt)',
        providerGenericRest: 'Generyczny backend REST (Wire v1)',
        badgeLive: 'na żywo',
        badgeDegraded: 'ograniczony',
        badgeOff: 'wyłączony',
        signInEmailForm: 'E-mail i hasło',
        signInToken: 'Token dostępu',
        signInBrowser: 'Logowanie w przeglądarce',
        signInDeviceCode: 'Kod urządzenia',
        verifyHint: 'Uruchom `arxa-studio provider verify`, aby certyfikować ten backend',
        licenseLine: 'Licencja arxa: oficjalny backend Totemu',
      },
      fr: {
        sectionTitle: 'Backend d’espace de travail',
        provider: 'Fournisseur',
        providerLocal: 'Local (hors ligne, sans configuration)',
        providerSupabase: 'Supabase (votre propre projet)',
        providerGenericRest: 'Backend REST générique (Wire v1)',
        badgeLive: 'en direct',
        badgeDegraded: 'dégradé',
        badgeOff: 'désactivé',
        signInEmailForm: 'E-mail et mot de passe',
        signInToken: 'Jeton d’accès',
        signInBrowser: 'Connexion dans le navigateur',
        signInDeviceCode: 'Code d’appareil',
        verifyHint: 'Lancez `arxa-studio provider verify` pour certifier ce backend',
        licenseLine: 'Licence arxa : backend officiel Totem',
      },
    }

    const table = (locale) => DICT[locale] || DICT.en

    /**
     * Pure section model for the settings panel: { title, provider, badges,
     * signIn, notes }. `info` is the RPC answer; locale picks the table.
     */
    function section (info, locale) {
      const t = table(locale)
      const providerLabels = { local: t.providerLocal, supabase: t.providerSupabase, 'generic-rest': t.providerGenericRest }
      const signInLabels = { 'email-form': t.signInEmailForm, token: t.signInToken, browser: t.signInBrowser, 'device-code': t.signInDeviceCode }
      const caps = info && info.capabilities
      const badges = caps
        ? Object.keys(caps)
            .filter((k) => k !== 'signIn')
            .map((k) => ({ key: k, state: caps[k] === true ? t.badgeLive : t.badgeOff }))
        : []
      const degraded = badges.some((b) => b.state !== t.badgeLive && b.key !== 'analytics')
      return {
        title: t.sectionTitle,
        provider: providerLabels[info?.provider] ?? info?.provider ?? providerLabels.local,
        badges,
        signIn: caps?.signIn ? { kind: caps.signIn.kind, label: signInLabels[caps.signIn.kind] ?? caps.signIn.kind } : null,
        degraded,
        notes: [t.verifyHint, t.licenseLine],
      }
    }

    exports.inject = ['connection', 'locale']

    exports.apply = (ctx) => {
      ctx.effect(() => ctx.locale.register(NS, { en: DICT.en, pl: DICT.pl, fr: DICT.fr }), 'arxa-workspace-provider: dictionary')

      // Read-only status over Connection RPC: provider name, redacted config
      // shape, truthful capability badges. A remote provider's capabilities
      // need a live backend call — the panel gets those from
      // `arxa-studio provider verify` / diagnose, never here.
      // rpc.call resolves the dsh result envelope ({ok:true,value} |
      // {ok:false,error}); info() unwraps it so panel-facing callers (the
      // section model, the evidence gate) get the BARE record or a rejection
      // (E3/L3, closeout 2026-09-14).
      const unwrap = (res) => {
        if (res && res.ok === true) return res.value
        throw new Error((res && res.error && res.error.message) || 'workspace provider info failed')
      }
      window.__arxaWorkspaceProvider = {
        info: () => ctx.connection.rpc.call(RPC_CHANNEL, 'info', {}).then(unwrap),
        section: (info, locale) => section(info, locale),
        namespace: NS,
      }
    }
    return module.exports
  },
})
