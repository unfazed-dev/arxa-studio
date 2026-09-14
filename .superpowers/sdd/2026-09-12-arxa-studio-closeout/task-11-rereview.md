⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY or another auth source is set and takes precedence over your claude.ai login · Unset it to load your organization's connectors
[claude-code:unrecognized_model] {"model":"glm-5.3[1m]","query_source":"sdk"}
**Finding 1: ADDRESSED** — `plugins/sandbox/selftest.sbx.mjs:551-559`: the §6 live probe (`sbx version/status/ls`) now runs only under `ARXA_A5_REAL_SMOKE === '1'`; the else branch prints an honest `skip('live sbx detection', 'ARXA_A5_REAL_SMOKE unset — the probe runs real sbx commands (sbx ls auto-starts a stopped daemon)…')`, and line 552 is the only real (undeps'd) `sbxStatus()` call in the file — all others (§1:165-210, :572) are injected, so the default path runs zero real sbx commands; block comment no longer claims "read-only".

**Minor 5 comment fix: yes** — `plugins/sandbox/lib/sbx.js:90-92`: "never starts the daemon itself" replaced with "the one measured side effect: `sbx ls` auto-starts a stopped daemon."

**Verification:**
- `node plugins/sandbox/selftest.sbx.mjs` (env unset): `32 checks green, 1 skipped`, skip line visible, no `live sbx detection:` row ✓
- `npm test`: exit 0, `arxa-studio CI: ALL GREEN`, **119 green suites**, 0 red ✓

**New breakage:** none.

**Deferred minors observed:** the CI runner captures suite stdout, so the skip line isn't visible in aggregated `npm test` output (pre-existing runner behavior, outside this diff).

Verdict: all findings addressed
