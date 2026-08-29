# Draft issue — deepseek-harness: bump llm-pi-ai to ^0.84

**Where:** github.com/deepseek-ai/deepseek-harness — issue against
`packages/llm/llm-pi-ai` (dsh 0.1.1-rc.2). Drafted 2026-08-29; file as-is
or edit freely.

---

**Title:** llm-pi-ai: bump @earendil-works/pi-ai to ^0.84 — the zai catalog
now carries glm-5.3/glm-5.3-flash (zaiToolStream, maxTokensField)

**Body:**

dsh-llm-pi-ai 0.1.1-rc.2 pins `@earendil-works/pi-ai`: `^0.82.1``. On a
0.x version that range caps at 0.82.x, so downstream dependents cannot
reach pi-ai 0.84.x without an override.

pi-ai 0.84.4's zai catalog adds the models the 0.82 catalog lacks:

```
glm-5.3         input [text]        ctx 1,000,000  max 131,072
glm-5.3-flash   input [text,image]  ctx 1,000,000  max 131,072
glm-5.3-highspeed, glm-5.2-highspeed
```

with compat `{ zaiToolStream: true, maxTokensField: "max_tokens",
thinkingFormat: "zai", supportsReasoningEffort: true }`.

Two concrete consequences at the installed pins:

1. **The catalog owns zaiToolStream, so settings cannot route it.**
   `COMPLETIONS_COMPAT_GATE` withholds the key (correct design — the error
   text says to name the catalog provider as the route), but the pinned
   catalog has no glm-5.3 entries, so a deployment that wants streamed tool
   arguments on GLM-5.3 has no legal route at all. It must either
   hand-write the model (and lose the flag) or override the dependency.

2. **maxTokensField regression surface.** Hand-written glm-5.3 entries
   without `maxTokensField` make dsh send `max_completion_tokens`, which
   Z.ai ignores (its cap is `max_tokens`, 131072 for the series) — the
   configured output cap silently does not apply. The 0.84 catalog entry
   fixes this for catalog-served models.

**Ask:** bump the llm-pi-ai dependency to `^0.84.4`` in a 0.1.1-rc.3/0.1.2
release. We have been running dsh 0.1.1-rc.2 forced onto pi-ai 0.84.4
(npm overrides) with a real config: route validation, a wire-capture check
(`tool_stream: true`, `max_tokens`, `thinking`/`reasoning_effort` per the
zai format), and a full web boot all pass — no behavior change observed
outside the intended one. Happy to share the harness or open a PR.

**Environment:** dsh 0.1.1-rc.2, pi-ai 0.82.1 → 0.84.4, Node 24, macOS.
