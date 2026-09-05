# Claude Code sign-in surface on the Models page

Date: 2026-09-06. Follows `claude-signin-and-effort-selector.md` (F10/F14) and the
locked decisions in `claude-subscription-engine.md` (D1, D5, D6).

## The problem in one line

There is no place in arxa studio to connect or disconnect the Claude Code
subscription: Settings → Models lists DeepSeek, kimi-coding and zai and nothing for
Claude, even though the claude-code plugin is loaded and its models are in the picker.

## What the docs and code actually say (read 2026-09-06)

- **dsh-client-ui-settings-models 0.1.2-rc.1** builds its rows from
  `llm/listProviders` joined with `llm/listConfigurableProviders`
  (`joinProviderDirectory`, client.js:889). A registered adapter with no directory
  entry gets `settingsNs: ""`; the page then filters it out of BOTH lists
  (`configured` needs a namespace view, `addable` needs a non-empty namespace,
  client.js:1930–1931). So an adapter that never calls
  `ctx.llm.registerConfigurableProviders` is invisible on the Models page. That is
  claude-code today.
- **dsh-authorization 0.1.2-rc.1** is a host-only flow registry. Its README says a
  "configuration UI or another surface runs an attempt" — the package ships no
  surface, and no client bundle in this build calls it (grep: zero
  `remote.authorization` uses). F10 mounted the service; the flow claude-code
  registers on it (`claudeAuthFlow`) is therefore never rendered anywhere.
- **The Models page has a per-provider slot**: `settings.models.provider-card`,
  `kind: "keyed"`, keyed by the row's `settingsNs`, rendered inside each provider
  card with props `{ provider, configured, keyConfigured }` (client.js:2040, 2913).
  A plugin registers into it with `slots.register({ name, key: <settingsNs> })`.
- **dsh-client-modules** serves a client half for a plugin loaded by absolute path:
  `locatePkgJson` walks up from the module URL to the nearest `package.json`
  (`nearestPackage`, index.js:660–700), so claude-code's `package.json` can declare
  `exports["./client"]` + `dsh.client` and be served as `arxa-claude-code/client.js`.
- **Claude Code CLI 2.1.261** (`claude auth --help`): `login` (browser sign-in,
  `--claudeai` default), `logout` (non-interactive, verified in a temp
  `CLAUDE_CONFIG_DIR`: prints "Successfully logged out", exit 0), `status --json`
  (`loggedIn, authMethod, apiProvider, email, orgName, subscriptionType`).
- **D6 stands**: Anthropic forbids third-party Claude.ai login, so arxa never starts
  `claude auth login`. The surface shows the state, the copyable command, checks
  again, and can sign the CLI out. `CLAUDE_CONFIG_DIR` is not relocated
  (`lib/spawn.js`), so the terminal's sign-in is the one arxa sees, and arxa's
  sign-out signs the terminal out too — the card says so before it does it.

## The fix

1. **Row.** `index.mjs` registers a configurable provider
   `{ provider: 'claude-code', displayName: 'Claude Code (your subscription)', settingsNs: 'arxa-claude-code', settingsPath: [] }`
   and installs a settings section for that namespace with one real field,
   `binary` (path to the `claude` binary; empty = PATH or bundled). The stock
   "Edit" on the row edits that. `onChange` rebinds the probe and adapter binary.
2. **Account RPC.** `lib/account.js`: Connection RPC channel `/arxa-claude-account`,
   endpoints `status { force? }` and `signout`. `status` returns
   `{ loggedIn, email, subscriptionType, version, error, signinCommand, installUrl }`
   from `probe.current(force)` and keeps the `claude-code/account` credential record
   in step (grant on sign-in, deleted on sign-out; written only on transitions).
   `signout` runs `claude auth logout` through the same confining spawner every
   Claude child uses (D5), deletes the record, and re-probes forced.
3. **Card.** `lib/client.js` registers on `settings.models.provider-card` keyed
   `arxa-claude-code`. Signed in: "Signed in as <email> · <tier> · Claude Code
   <version>", buttons Check again / Sign out (two-step inline confirm naming the
   terminal consequence). Signed out: the copyable `claude auth login` command,
   an install-docs link, Check again, and a 3 s poll while the card is open so the
   sign-in is picked up without a click. Errors from the probe are shown as-is.
4. **Package.** `package.json` gains `exports["./client"]` and
   `dsh.client { inject: [dsh-client-runtime, dsh-client-ui-settings-models], platform: web }`.

Kept: the `authorization` flow registration (harmless; becomes live if a future dsh
ships a surface). Not done: a Connect button that launches login (D6 / Anthropic
policy).

## Tests

- `selftest.account.mjs`: status shape; record written on sign-in and deleted on
  sign-out only on transitions; signout runs `auth logout` through the injected
  spawner, deletes the record, re-probes forced; non-zero exit surfaces the stderr;
  unknown endpoint refused; no binary refused.
- `selftest.surface.mjs`: pins — the directory entry and section share the
  namespace, the client registers the keyed card under that namespace, client and
  host agree on the channel and endpoint names, package.json declares the client.

## Verification (live, 2026-09-06)

See the closing note appended after the relaunch.

### Closing note (2026-09-06)

- Boot clean after the relaunch (no plugin-tree errors); the served index lists
  `arxa-claude-code/client.js` and the bundle carries the keyed card.
- Settings → Models now shows a fourth row, "Claude Code (your subscription)", with
  the card reading "Signed in as <email> · Claude Max · Claude Code 2.1.261" and the
  Check again / Sign out buttons (screenshot taken, dialog closed).
- NOT exercised live: Sign out. It runs `claude auth logout` against the shared
  config dir, which would sign out the Claude Code CLI session this work was done
  from. `selftest.account.mjs` covers the path with a fake spawner; the CLI command
  itself was verified non-interactive in a temp `CLAUDE_CONFIG_DIR`.
- NOT exercised live: the stock Edit form for the `binary` field.
- Tests: selftest.account 6 ok, selftest.surface 4 ok; auth-flow/models/probe unchanged.

### Follow-up (2026-09-06): same grammar as the other rows

- User direction: colour indicator like the other providers, no Edit, no "Check again",
  laid out like the other cards. No cordis skill is installed on this machine; the
  reference used is dsh's own ModelsSection markup and CSS (the stock `rowHead /
  rowIdentity / rowName / credentialDot / rowActions` classes).
- The card now renders its own head in those classes — name + dot (green signed in,
  red signed out) left, Sign out right (danger, where the others have Delete) — and
  hides the stock head of its row on mount with an inline `display:none` (the
  `hidden` attribute lost to `.rowHead{display:flex}`; a `:has(>…)` selector never
  matched because the slot renders inside a wrapper). One secondary line carries
  email · tier · CLI version. Signed out: the copyable command and install link on
  that line; polling every 3 s replaces the button.
- Verified on screen after relaunch: four identical-looking rows, Claude's with
  the green dot and Sign out. The settings section (binary field) still seats the
  row; its stock Edit is hidden, not removed.
