# Z.ai latency bench report — 2026-08-29

Investigated: arxa studio TTFT avg 7.7s / 40 tok/s vs stock dsh 5.5s / 62
tok/s, both nominally zai glm-5.3-flash @ max; arxa historically 100+ tok/s.

## Verdict

**Model tier, not harness.** glm-5.3-flash is currently Z.ai's slow tier;
glm-5.3 (non-flash) is ~2.5× faster to first token with tools and ~2× faster
at decode. The studio's request path added nothing measurable. Remediation:
default flipped to glm-5.3 @ max (D56), `low` effort exposed as the speed
lever (D57), endpoint pinned (D58).

## Method

`scripts/zai-ab-bench.mjs` — direct SSE calls to
`https://api.z.ai/api/coding/paas/v4/chat/completions` with the studio's
stored key, mirroring the dsh UI's formulas exactly
(dsh-client-ui-conversation/lib/client.js):

- **TTFT** = request dispatch → first token-delta event
  (`reasoning_content`, `content`, or `tool_calls` — reasoning counts)
- **tok/s** = `usage.completion_tokens` (thinking included) ÷ decode wall
  (done − first token)

22 runs (2 reps × 11 combos), max_tokens 4096, sequential, 400 ms gaps.
Body always carried `thinking {type: enabled, clear_thinking: false}`,
`stream_options {include_usage: true}`, and the combo's
`reasoning_effort`; tools combos added one `get_weather` tool with
`tool_stream` toggled. Raw JSON: `/tmp/zai-ab-bench-results.json`
(ephemeral; re-run the script to regenerate).

## Medians

| combo | TTFT | tok/s | decode s | out tok | think tok |
|---|---|---|---|---|---|
| glm-5.3-flash @ max plain | 5.59 | 37.5 | 35.4 | 1324 | 1010 |
| glm-5.3-flash @ high plain | 1.66 | 41.3 | 42.5 | 1734 | 1428 |
| glm-5.3-flash @ low plain | 2.45 | 29.3 | 11.1 | 324 | **0** |
| glm-5.3 @ max plain | 1.19 | 68.0 | 16.4 | 1242 | 914 |
| glm-5.3 @ high plain | 1.41 | 64.9 | 17.1 | 1132 | 816 |
| glm-5.3 @ low plain | 0.96 | 58.0 | 5.8 | 337 | **0** |
| **flash @ max + tools, tool_stream true** | **7.43** | 26.5 | 1.5 | 38 | 26 |
| **flash @ max + tools, tool_stream false** | **7.28** | 50.1 | 0.9 | 47 | 30 |
| **glm-5.3 @ max + tools, tool_stream true** | **2.88** | **89.2** | 0.6 | 49 | 26 |
| glm-5.3 @ max + tools, tool_stream false | 2.31 | 84.6 | 0.4 | 36 | 24 |
| flash @ max, GENERAL endpoint | — | — | — | HTTP 429 (coding-plan key) | — |

## Findings

1. arxa's 7.7s / 40 reproduces as flash+tools @ max (7.3–7.4s, 26–50 tok/s
   at a one-tool prefill). Stock's 5.5s / 62 reproduces as glm-5.3 with
   dsh's full tool schema on top of the 2.3–2.9s / 85–89 base.
2. `tool_stream`: no consistent TTFT or throughput effect (7.43 vs 7.28s;
   decode deltas flip sign across reps). Run-to-run variance is large
   (same config swung 1.9s → 9.3s TTFT) — provider-side queueing dominates.
   Kept: Z.ai docs recommend it and dsh's UI counts toolcall deltas either way.
3. `reasoning_effort: low` eliminates thinking entirely (0 thinking tokens,
   first delta = content) and cuts total response time ~3×. `max` vs
   `high` barely moves TTFT/tok-s (thinking tokens arrive early and count
   in the tok/s numerator) — effort choice is a *total-time* lever, not a
   TTFT lever.
4. The stored key is coding-plan scoped: general endpoint → 429
   "Insufficient balance or no resource package". Endpoint must match the
   key's purchase type.
5. Implicit prefix caching works: `cached_tokens: 128` on repeated prefixes.
   Stable system prompt + append-only history keep it hitting.
6. glm-5.3-highspeed no longer exists on the open API (GLM-4-era SKU).
7. Thinking cannot be disabled on the 5.3 series (`thinking.type:
   "disabled"` errors); only `low|high|max` efforts are valid.

## Ruled out (evidence in grill transcript, 2026-08-29)

System prompt size (arxa's is smaller than stock's), plugins/middleware
(nothing on the stream path; arxa-gate shells only on mutating tool calls),
credential resolution (env-resolved once; the `!arxa credentials exec` shim
rides the studio's exported env), context accumulation (fresh sessions both
sides), endpoint divergence (both installs resolve to the coding endpoint),
pi-ai version (0.84.4 vs 0.82.1 — same wire shape apart from tool_stream,
which showed no effect).

## Follow-ups

- Restart the studio to load the new default (running instance booted
  before the settings edit).
- `~/.arxa/engine` launcher copy carries the old seed until the next
  engine build — no live impact (seeds fire only on fresh homes).
- Wallet-funded key, if ever: flip the pinned baseURL to
  `https://api.z.ai/api/paas/v4`.
