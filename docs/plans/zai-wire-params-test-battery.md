# Z.ai wire-params implementation — smoke/pressure/stress battery results

**Date:** 2026-08-29. Target: D48–D54 implementation (pi-ai 0.84.4 override,
minimal 5.3 entries, flash default). Harness scripts live in /tmp during the
session; the durable live smoke is scripts/zai-live-smoke.mjs.

| # | Test | Verdict |
|---|---|---|
| T1 | Statics: syntax (launcher, plugin, models.json); lockfile pins pi-ai 0.84.4; in-tree bare-specifier resolution from dsh-llm-pi-ai loads 0.84.4; no nested copies | **PASS** |
| T2 | Seed-once: launcher rerun against an operator-owned settings.yaml — md5 identical, no stomp | **PASS** |
| T3 | Deep materialization: live settings through dsh's own apply → config.profiles() → piProvider.getModels() — all 5.3 models carry full catalog compat (zaiToolStream: true, maxTokensField: "max_tokens", thinkingFormat: "zai"); reasoning: true derived from effort maps; effort maps transform into the full thinkingLevelMap vocabulary (undeclared levels → null, by design); flash keeps text+image input; kimi-coding route gained 4 catalog models free | **PASS** (5 "fails" were wrong harness assumptions — see notes) |
| T4 | Wire variants: A baseline 8/8; B legal override (maxTokensField: "max_completion_tokens") flows to wire while catalog's zaiToolStream still applies; C pi-ai has NO catalog fallback for compat-less models — the dsh-layer merge proven in T3 is the load-bearing mechanism | **PASS** (C informative-by-design) |
| T5 | Adversarial config battery — 8 malformed variants (withheld key true/false, other catalog-owned key, case-misspelled key, empty efforts, duplicate ids, models+overrides conflict, null compat value): every one throws loud, provider+key named; zero silent accepts | **PASS 8/8** |
| T6 | Pressure: 200 sequential streams (~0.2ms each) all wire-correct; 25/25 concurrent with 25 distinct sessions; 300KB message preserved byte-intact on wire (307,200 chars); heap delta 2.7MB after GC over 226 streams — no leak, no cross-talk, no drift | **PASS** |
| T7 | Live transport: real api.z.ai call with dummy key — clean structured "401 token expired or incorrect" as a stream error event; endpoint reachable, request shape accepted by gateway (auth evaluated post-parse), graceful degradation, no crash | **PASS** |

## Notes

- **npm does not annotate overrides into package-lock.json** (npm 11.17).
  Not a regression path: npm ci installs the lock verbatim (0.84.4), and
  any re-resolve re-derives the pin from the committed package.json.
- **pi-ai emits no tool_stream for a compat-less model object** (T4-C) —
  harmless because dsh always attaches catalog compat at materialization;
  this is exactly why D50 keeps settings entries compat-clean rather than
  deleting catalog contact entirely.
- **Live authenticated smoke remains the one open item** — run
  scripts/zai-live-smoke.mjs from a shell where ZAI_API_KEY resolves.
  T7 proves everything short of the token.
- Unrelated working-tree changes observed (mobile-flutter docs, an unrelated
  HANDOFF edit) — not touched by this battery.
