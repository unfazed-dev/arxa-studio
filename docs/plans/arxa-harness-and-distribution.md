# arxa on the DeepSeek Harness: the two-plane rule and distribution

arxa is distributed software: users (including free ones) get no access to
Arxa Digital Solutions' own infrastructure, and arxa studio hosts nothing for
them (yet). Every Cordis row lands on the plane matching its lifetime and
audience, so a `@deepseek-ai/dsh` engine upgrade never deletes arxa's work.

## The two planes

- **HOST composition** — `profile/cordis.patch.yml`, copied byte-for-byte by
  `bin/arxa-studio.mjs` into `${DSH_HOME}/profiles/arxa/cordis.patch.yml` on
  every launch, applied after the `dsh-base`/`dsh-web-app` bundle layers. It
  owns what every session shares: registries, the sandbox/approval stack,
  model routing, UI surfaces, webServer routes. A row belongs here when it
  injects a service other sessions read, or patches a host entry.

- **AGENT PRESET** — `profile/agent-presets/arxa/`, copied the same way into
  `${DSH_HOME}/.agent-presets/arxa/`. It owns what one session contributes
  *to* those registries: persona, tools, prompt sections. A row belongs here
  when it is model-facing or produces a `systemPrompt` section for the
  session that mounts it, with nothing else reading it.

Both destinations are build products, never hand-edited — every launch
overwrites them from the checked-in source.

## What moved, and why

Three rows moved from the host patch to
`profile/agent-presets/arxa/agent.cordis.yml`, `name:`/`config:` unchanged:
`arxa-memory` (a systemPrompt section, not a registry), `arxa-pi-delegate`
(a tool), `arxa-gen-ui` (a tool — its browser half is still discovered via
package.json `dsh.client` regardless of which file declares the row). No
`name:` rewriting was needed: an absolute path resolves identically either
way, and a bare package name in a preset resolves against the HOST
composition's `node_modules`, not the preset's own directory
(`@deepseek-ai/dsh-agent-presets/lib/index.js`, `PresetTree.import`). Only a
*relative* specifier into a preset's own bundled subdirectory needs the
`!!js … fileURLToPath(new URL(…, baseUrl))` idiom `cordis` uses for
`customSkillDirs` — none of these three rows are that shape.

The preset otherwise mirrors shipped `standard`'s row set with shipped
`cordis`'s structure/comments, deliberately **without** `tool-cordis` or the
composition-authoring skill: self-modifying the harness a session runs on
is not a default capability for distributed software.

## Materialise mechanism

`bin/arxa-studio.mjs` copies the preset into `${DSH_HOME}/.agent-presets/arxa/`
every launch (`materialisePreset`, `bin/materialise-preset.mjs`) — same
treatment as the profile patch. `settings.yaml` seeds once; on a later launch,
if `agent-presets.default` already names a shipped preset (`code`, `cordis`,
`ptc`, `standard`, `minimal` — gated against the installed wave by
`scripts/preset-names-check.mjs`; `code` kept for homes seeded before upstream
renamed it to `ptc`), that key alone rewrites to `arxa`, notice printed,
everything else byte-untouched. `--materialise-only` runs the profile/preset
copy and settings/credential seed, then exits — no pnpm install, no dsh exec.

## Never edit the shipped install

`~/.arxa/engine/<hash>/.../node_modules/@deepseek-ai/dsh/config/agent-presets/`
belongs to the installed package; an engine upgrade overwrites it. Read it as
reference only. To change what arxa ships, edit `profile/agent-presets/arxa/`.

## Fork triggers (decided 2026-09-14)

Depend-don't-fork stands (round 3 of the 0.1.5 grill,
`docs/research/dsh-0.1.5-upgrade-analysis.md`): a fork trades an afternoon of
seam-adaptation per wave for permanent merge debt against a 0.x upstream that
breaks by design. Revisit — and only then fork — if any trigger fires:

- upstream dies or locks outside contribution (the Gogs→Gitea case),
- the license flips away from MIT (the Elasticsearch→OpenSearch case),
- dsh reaches 1.0 AND arxa needs engine-core changes no plugin can express,
- a routine wave regenerates more than half of the stock surfaces arxa
  replaces (frame, sidebar, locale, workspace, git-card, conversation).

Until then: exact pins, replacement plugins, drift gates
(`dsh-contract-check`, `preset-names-check`, `session-format-check`), the
bump-trigger rule in the upgrade analysis doc, and the registry radar
`scripts/dsh-wave-latest-check.mjs` (hand-run or cron — network, never in ci).

