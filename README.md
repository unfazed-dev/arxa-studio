# arxa-harness

arxa — Totem Labs' agentic studio harness. **A package that depends on dsh
components, never a fork** (depend-don't-fork amendment): this repo is the
`arxa` npm package plus its plugins, in the separate home decision 5 assigns
it (own release cadence; pins a compatible engine revision).

The decisions record (SSOT) lives with the engine:
`app-box/docs/plans/arxa-harness-and-distribution.md`.

## Layout

- `package.json` — the arxa package: exact-pinned `@deepseek-ai/*` deps
  (a caret on a prerelease moves under you), `bin/arxa.mjs`.
- `bin/arxa.mjs` — materializes the arxa profile into
  `$DSH_HOME/profiles/arxa` (identity via `includeHarnessIdentity: false` +
  persona, `instructionFileCandidates: [AGENTS.md]`, the appbox gate, the
  plugins below) and execs dsh's own bin. `--headless` swaps dsh-web-app for
  dsh-headless (one-shot, no browser).
- `profile/cordis.patch.yml` — the arxa profile patch (rewritten into the
  profile on every launch; the materialized copy is a build product).
- `plugins/design-panel/` — H4 viewer: `shell.overlay` dock iframing a live
  `appbox design serve` with the 390×844 / 744×1133 / 1280×832 rung ladder.
- `plugins/memory/` — H5 dsh adapter: injects `appbox memory recall` output
  as a system-prompt section at mount.
- `pi/arxa-memory.ts` — H5 Pi adapter: injects recall output once per
  session on `before_agent_start`. Symlink into `~/.pi/agent/extensions/`.

## What deliberately stays in app-box

The guard is engine policy: `hooks/appbox-guard.js`, `harness/verdict.sh`,
`harness/dsh-external-gate/`, `harness/pi/appbox-gate.ts` (H1). This repo's
profile references them by absolute path — one policy file, every surface.

## Verify without touching the operator home

```sh
DSH_HOME=$(mktemp -d) node bin/arxa.mjs --headless --dump-config
# assert: arxa persona, includeHarnessIdentity: false, appbox-gate row,
# arxa-memory row, arxa-design-panel row, zero "powered by DeepSeek"
```

`arxa update` = bump the `@deepseek-ai/*` pins, run the checks. That is the
whole upstream story.
