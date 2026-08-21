# arxa-harness

arxa — Totem Labs' agentic studio harness. **A package that depends on dsh
components, never a fork** (depend-don't-fork amendment): this repo is the
`arxa` npm package plus its plugins, in the separate home decision 5 assigns
it (own release cadence; pins a compatible engine revision).

The decisions record (SSOT) lives with the engine:
`app-box/docs/plans/arxa-harness-and-distribution.md`.

## Layout

arxa owns `~/.arxa` outright and never writes into the operator's `~/.dsh`
or `~/.pi`:

- `~/.arxa/dsh` — DSH_HOME for arxa sessions: `settings.yaml` (seeded once,
  then operator-owned; default zai-coding-cn/glm-5.3/effort max),
  `.credentials.yaml` (seeded by plain file copy from `~/.dsh` if present;
  inherited env still wins per dsh-credentials-local layering),
  `profiles/arxa` (rewritten every launch — a build product).
- `~/.arxa/pi` — PI_CODING_AGENT_DIR for delegated Pi: `models.json`
  (seeded once; `zai-wallet` provider shells the appbox vault at request
  time), `extensions/` (appbox-gate + arxa-memory symlinks, refreshed every
  launch).

- `package.json` — the arxa package: exact-pinned `@deepseek-ai/*` deps
  (a caret on a prerelease moves under you), `bin/arxa.mjs`.
- `bin/arxa.mjs` — materializes both homes above (identity via
  `includeHarnessIdentity: false` + persona, `instructionFileCandidates:
  [AGENTS.md]`, the appbox gate, the plugins below) and execs dsh's own bin
  with `DSH_HOME` + `PI_CODING_AGENT_DIR` pointed at them. `--headless`
  swaps dsh-web-app for dsh-headless (one-shot, no browser). Web mode
  serves on port 7891 as **http://arxa.local:7891** — the launcher
  advertises the name over mDNS (`dns-sd -P`, zero sudo, responder dies
  with the process) and declares it to the /api browser-trust fence.
  `arxa.studio` is also trusted and works wherever it resolves to loopback;
  the product path there is owning the domain and publishing a public
  `A 127.0.0.1` record (localtest.me-style) — zero-config for every
  install, no code change.
- `profile/cordis.patch.yml` — the arxa profile patch (rewritten into the
  profile on every launch; the materialized copy is a build product).
- `bin/arxa-explore.mjs` — decision 17's design exploration on Pi's session
  DAG: one session file, one branch per design option, optional branch
  summaries (`--summarize`), JSON out with each branch's final answer and a
  `pi --session <file>` resume line (then `/tree` to keep exploring).
- `plugins/design-panel/` — H4 viewer: `shell.overlay` dock iframing a live
  `appbox design serve` with the 390×844 / 744×1133 / 1280×832 rung ladder.
- `plugins/memory/` — H5 dsh adapter: injects `appbox memory recall` output
  as a system-prompt section at mount.
- `plugins/pi-delegate/` — decision 3ii: registers the `delegate_pi` tool
  (one-shot `pi -p` in the workspace, default `zai-wallet`/glm-5.3). The
  spawned Pi inherits `PI_CODING_AGENT_DIR=~/.arxa/pi`, so the appbox gate
  extension rides along on every delegated run.
- `pi/arxa-memory.ts` — H5 Pi adapter: injects recall output once per
  session on `before_agent_start`. Symlink into `~/.pi/agent/extensions/`.

## What deliberately stays in app-box

The guard is engine policy: `hooks/appbox-guard.js`, `harness/verdict.sh`,
`harness/dsh-external-gate/`, `harness/pi/appbox-gate.ts` (H1). This repo's
profile references them by absolute path — one policy file, every surface.

## Gating the operator's raw surfaces (decision 12)

arxa gates only its own homes. The operator's daily `~/.dsh` and `~/.pi` are
theirs; wiring the same gate there is the operator's own copy step:

- **raw dsh**: add the appbox-gate insert row (see `profile/cordis.patch.yml`,
  `tools: [write, edit, str_replace_editor, bash]` — dsh-native lowercase
  names) to the profile patch you boot with, e.g.
  `~/.dsh/profiles/web/cordis.patch.yml`.
- **raw Pi**: `ln -s <app-box>/harness/pi/appbox-gate.ts
  ~/.pi/agent/extensions/appbox-gate.ts` — safe as a symlink; the gate
  resolves its guard through realpath and prints "gate INACTIVE" on stderr if
  the guard is unreachable.

Either way, prove it with a booted DENY (see below) — an allow proves nothing.

## Verify without touching any real home

```sh
ARXA_HOME=$(mktemp -d) node bin/arxa.mjs --headless --dump-config
# assert: arxa persona, includeHarnessIdentity: false, appbox-gate row,
# arxa-memory row, arxa-design-panel row, zero "powered by DeepSeek";
# the temp home gains dsh/{settings.yaml,profiles/arxa} + pi/{models.json,
# extensions/}
```

Booted proof (2026-08-21, both harnesses): a using-session write into
`appboxd/` came back with the guard's deny text quoted verbatim — via dsh
(`arxa --headless`) and via Pi (`PI_CODING_AGENT_DIR=~/.arxa/pi pi -p
--provider zai-wallet`). Only a DENY proves the gate is mounted.

`arxa update` = bump the `@deepseek-ai/*` pins, run the checks. That is the
whole upstream story.
