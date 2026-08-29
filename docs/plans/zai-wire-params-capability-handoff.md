# Handoff — giving arxa studio the missing Z.ai wire params

**Status:** IMPLEMENTED 2026-08-29 — see §10 for the grill outcome and
evidence. §4B (override) was chosen; §5 closed as a non-issue (Q4).
**Date:** 2026-08-29.
**Scope:** three Z.ai-recommended request parameters that arxa studio / dsh
currently cannot put on the wire — `tool_stream`, `temperature`, `top_p` —
plus one latent bug found during the research.

Everything below is verified against installed source and published
packages, not from memory. File:line references are to
`arxa-studio/node_modules/…` at the pinned versions in §2.

---

## 1. TL;DR

- **`tool_stream` is already solved upstream.** pi-ai **0.84.4** ships a zai
  catalog entry for `glm-5.3` and `glm-5.3-flash` carrying
  `zaiToolStream: true`. We cannot reach it because dsh pins pi-ai
  `^0.82.1`, and on a `0.x` version that caret means `>=0.82.1 <0.83.0`.
  **This is a dependency-range problem, not a missing capability.**
- **`temperature` is not settable anywhere in dsh.** No settings schema in
  any `@deepseek-ai/dsh-*` package declares it; it arrives as a per-request
  option from the caller.
- **`top_p` is never emitted at all** by pi-ai's `openai-completions` API
  implementation. It is not a config gap — the code path does not exist.
- **Bonus bug (act on this regardless):** our hand-written model entries
  omit `maxTokensField`, so dsh sends `max_completion_tokens`. The 0.84.4
  catalog sets `max_tokens` for every zai model, which means our
  `maxTokens: 131072` is very likely being **ignored by Z.ai today**.
  `maxTokensField` **is** settable in `settings.yaml` right now. See §6.

---

## 2. Ground truth (versions, licenses, paths)

| Thing | Value |
|---|---|
| `@deepseek-ai/dsh` installed **and latest published** | `0.1.1-rc.2` — there is no newer dsh to upgrade to |
| `@deepseek-ai/dsh-llm-pi-ai` dependency range | `"@earendil-works/pi-ai": "^0.82.1"` |
| `@earendil-works/pi-ai` installed | `0.82.1` |
| `@earendil-works/pi-ai` latest published | `0.84.4` |
| dsh license / repo | MIT — `github.com/deepseek-ai/deepseek-harness`, `packages/llm/llm-pi-ai` |
| pi-ai license / repo | MIT — `github.com/earendil-works/pi`, `packages/ai` |

Both upstreams are MIT and accept contributions. Neither is a fork risk.

**arxa constraint:** `arxa-studio/package.json` describes itself as *"A
package that DEPENDS on dsh components (depend-don't-fork); never a fork,
never a rebase"* and pins dsh versions **exactly**. Every option in §4–§5
is judged against that rule.

---

## 3. Why each parameter is blocked (with evidence)

### 3a. `tool_stream` — blocked by a gate, unblocked by a catalog

pi-ai emits it only from a compat flag:

> `openai-completions.js:546` — `if (compat.zaiToolStream) { params.tool_stream = true; }`

dsh explicitly refuses to let a settings profile set that flag:

> `dsh-llm-pi-ai/lib/index.js:382` — inside `COMPLETIONS_COMPAT_GATE`:
> `zaiToolStream: "withhold"`

Withheld fields are a **hard boot error**, not a silent ignore
(`assertOfferedCompatFields`, `:494–502`). The error text names the
intended path itself:

> *"…which is not configurable here: pi-ai's installed catalog sets it for
> the vendors that need it, so name that provider as the route instead"*

So dsh's designed answer is **"the catalog owns this"**. And the catalog
now has it — confirmed by reading the published artifact:

`pi-ai@0.84.4/dist/providers/data/zai.json` →
```
glm-5.3        compat: {..., supportsReasoningEffort: true, maxTokensField: "max_tokens",
                        thinkingFormat: "zai", zaiToolStream: true}   input: ["text"]
glm-5.3-flash  compat: { …identical… }                                input: ["text","image"]
both: contextWindow 1000000, maxTokens 131072
```

The installed 0.82.1 catalog knows only
`glm-4.5-air, glm-4.7, glm-5-turbo, glm-5.1, glm-5.2, glm-5v-turbo` —
neither 5.3 model — which is exactly why we had to hand-write them.

**Consequence worth stating plainly:** once pi-ai ≥0.84.4 is reachable, the
correct config is to **delete our hand-written `glm-5.3*` entries entirely**
and let the catalog serve them. Our hand-rolled entries would then be
strictly worse than the upstream ones.

### 3b. `temperature` — no configuration surface exists

> `openai-completions.js:539` — `if (options?.temperature !== undefined) { params.temperature = options.temperature; }`

It comes from the **request options**, not model config. Confirmed absent
from every dsh settings schema (no `temperature: z.…` in any
`@deepseek-ai/dsh-*/lib/*.js`). It is carried in dsh's request config
(`dsh-llm/lib/index.js:69`) and invariant-checked by the agent loop
(`dsh-agent-loop/lib/invariant.js:28`), but nothing lets an operator
*choose* it.

Note `supportsTemperature` exists as a compat switch but only on the
`anthropic-messages` gate — and it is a boolean ("may I send it"), never a
value. It does not help the zai path.

### 3c. `top_p` — the code path does not exist

`top_p` appears **nowhere** in
`pi-ai/dist/api/openai-completions.js`. There is no flag, no option, no
passthrough. Any fix is necessarily an upstream pi-ai change (or a shim
that rewrites the request off-process).

---

## 4. Options for `tool_stream` (the one worth deciding first)

| # | Option | What it costs | Risk |
|---|---|---|---|
| **A** | **Wait for / request a dsh release that bumps pi-ai to `^0.84`** | An upstream issue or PR against `deepseek-harness`. Zero arxa code. | Timeline not ours. dsh is `0.1.1-rc.2`, moving fast, so a bump is plausible soon. |
| **B** | **Force the resolution locally** (`pnpm.overrides` / npm `overrides` pinning pi-ai `0.84.4`) | One line in `arxa-studio/package.json`. Then delete our hand-written entries. | pi-ai `0.82 → 0.84` crosses two **minor** versions of a `0.x` package: breaking changes are allowed and likely. dsh `0.1.1-rc.2` was built and tested against `0.82`. **Must be validated, not assumed.** |
| **C** | **Upstream PR to dsh reclassifying `zaiToolStream` from `"withhold"` to `"offer"`** | Small, surgical PR (one line in `COMPLETIONS_COMPAT_GATE`) + justification. | Contradicts dsh's stated design ("the catalog owns vendor flags"), so it may be rejected on principle. Weaker than A. |
| **D** | **Do nothing; accept no `tool_stream`** | Free. | We lose streamed tool-call args — latency and UX only, not correctness. |

**Note on B:** the override affects arxa's *own* `node_modules`. The
operator's personal `~/.dsh` runs `npx @deepseek-ai/dsh`, which resolves its
own tree — an arxa-side override does **not** fix their standalone dsh.
Two different surfaces; decide whether both matter.

## 5. Options for `temperature` / `top_p`

| # | Option | Notes |
|---|---|---|
| **A** | **Upstream pi-ai PR** adding `top_p` passthrough (+ a settings-visible temperature in dsh) | MIT, contributions plausible. Two repos, two review cycles. Slowest but the only *clean* answer. |
| **B** | **arxa-owned LLM adapter plugin** — dsh is "everything is a plugin"; register an alternative provider that speaks openai-completions and sets whatever body params we want | Fits dsh's architecture and respects depend-don't-fork. **But** it means owning a wire implementation we currently get free, including its future maintenance. Large. |
| **C** | **Local proxy** between dsh and Z.ai that injects `temperature`/`top_p`/`tool_stream` | Works for *every* blocked param at once, no upstream dependency. Adds a hop, a process to supervise, and a place for bugs to hide. Precedent exists — the engine already supervises sidecars (`cairn-pushd`). |
| **D** | **Accept the defaults** | Honest question: what does Z.ai actually default to? The docs *recommend* `temperature: 1`/`top_p: 0.95` but do not say the defaults differ. **If the server defaults already match, this is a non-issue** — see §7 Q4. |

---

## 6. Immediate, zero-risk item (independent of the grill)

`maxTokensField` **is** in the offered gate — settable today in
`~/.dsh/settings.yaml` and in any arxa profile.

- **Now:** our `glm-5.3` / `glm-5.3-flash` entries omit it → dsh takes the
  `else` branch and sends **`max_completion_tokens`**
  (`openai-completions.js:531–537`).
- **Upstream catalog:** every zai model sets `maxTokensField: "max_tokens"`.
- **Therefore:** Z.ai is being sent a field it very likely ignores, so our
  `maxTokens: 131072` may not be in effect at all.

Adding `maxTokensField: max_tokens` to both entries is a one-line,
boot-validated change that needs no grill. **Not applied — this handoff is
doc-only by request.**

---

## 7. Questions for the grill

1. **Which surface are we fixing?** arxa studio's bundled engine only, the
   operator's personal `~/.dsh` too, or both? They resolve dependencies
   independently and option B only fixes the first.
2. **Do we take the pi-ai override (4B) before upstream ships (4A)?** If
   yes, what is the acceptance test that proves `0.84.4` does not break dsh
   `0.1.1-rc.2` — full plugin selftest sweep, or something narrower?
3. **Is `tool_stream` worth any of this?** It is a latency/UX win on
   streamed tool arguments, not a correctness fix. Does that clear the bar
   for a forced dependency override?
4. **Do `temperature`/`top_p` actually differ from Z.ai's server defaults?**
   This is the cheapest question to answer and it may close §5 entirely.
   Nobody has measured it — the docs recommend values without stating
   defaults.
5. **If we do want them: adapter plugin (5B) or proxy (5C)?** Both are real
   builds. The proxy solves all three params at once; the plugin is more
   architecturally native to dsh but larger and permanent.
6. **How much upstream do we want to own?** Filing dsh + pi-ai PRs (4A/5A)
   is the cleanest long-term answer and costs us review latency, not
   architecture. Do we want to be an upstream contributor here?
7. **Should arxa pin its own vendored catalog?** A general question this
   research raises: any model newer than the pinned pi-ai catalog has to be
   hand-written, and hand-written entries silently miss compat fields
   (`maxTokensField` and `zaiToolStream` both bit us). Is a checked-in
   catalog overlay a capability arxa studio wants in its own right?

---

## 8. How to re-verify any claim here

- **Catalog contents of a published pi-ai:** fetch
  `https://cdn.jsdelivr.net/npm/@earendil-works/pi-ai@<ver>/dist/providers/data/zai.json`
  and read `openai-completions`.
- **What dsh will let settings set:** `COMPLETIONS_COMPAT_GATE` in
  `dsh-llm-pi-ai/lib/index.js` (~:365) — `"offer"` vs `"withhold"`.
- **What actually reaches the wire:** `buildParams` in
  `pi-ai/dist/api/openai-completions.js` (~:520–640).
- **Whether a config is legal:** boot it. dsh validates compat strictly and
  fails loudly with the offending key named.

## 9. Sources

- Z.ai GLM-5.3-Flash — https://docs.z.ai/guides/vlm/glm-5.3-flash
- Z.ai GLM-5.3 — https://docs.z.ai/guides/llm/glm-5.3
- Z.ai Tool Streaming Output — https://docs.z.ai/guides/capabilities/stream-tool
  (`stream=true` **and** `tool_stream=true`; tool-calling models only)
- DeepSeek Harness — https://github.com/deepseek-ai/deepseek-harness (MIT)
- pi — https://github.com/earendil-works/pi (MIT)

---

## 10. Outcome — grill 2026-08-29 (decisions D48–D54)

**Q4 (defaults) closed with primary evidence.** Z.ai's OpenAPI spec
(docs.z.ai/api-reference/llm/chat-completion) states server defaults
`temperature: 1`, `top_p: 0.95` for the GLM-5.3 series — identical to the
recommendations. §5 (adapter plugin / proxy / upstream PR) closed; both
params are omitted from the wire and the defaults apply.

**A live bug this doc missed: the seed template was a boot landmine.**
`bin/arxa-studio.mjs` seeded `zaiToolStream: true` into a settings compat
block; dsh withholds that key and hard-errors at route resolution.
Empirically proven: red on the old template seed, green without it. Every
fresh install since 2026-08-21 would fail to boot. No release ever shipped
with it (repo has no version tags; the one live home predates the line).

**What shipped (D48–D54 in arxa-studio-grill-decisions.md):**
- npm `overrides` pinning pi-ai **0.84.4** — temporary until a dsh release
  bumps llm-pi-ai (draft: `docs/upstream/dsh-llm-pi-ai-bump-request.md`).
- Template + live `settings.yaml`: landmine removed; 5.3 entries kept as
  MINIMAL entries (effort maps only, zero compat keys) so the catalog owns
  `zaiToolStream`/`maxTokensField`/`thinkingFormat`. This supersedes §3a's
  "delete the entries" advice, forced by glm-4.6v retention + dsh's merge
  semantics (`resolveRouteModels`: a models list replaces the catalog; a
  configured entry merges over its catalog id and inherits compat).
- Default model flipped to **zai / glm-5.3-flash / effort max** (Z.ai's
  recommended settings) in template + live file.
- Delegated Pi: flash added to `~/.arxa/pi/models.json` (first position),
  pi-delegate default flipped. Personal `~/.dsh` untouched (D52).

**Acceptance evidence:**
- Route validation (installed dsh code, scratch seed): red → green.
- Wire capture through pi-ai 0.84.4's real `stream` path, glm-5.3-flash:
  8/8 — `tool_stream: true`, `max_tokens: 131072` (not
  `max_completion_tokens`), `thinking: {type: "enabled", clear_thinking:
  false}` + `reasoning_effort: max`, temperature/top_p omitted, stream on.
- Full web boot on the new template config: HTTP 200, plugins active.
- Live authenticated smoke: run `scripts/zai-live-smoke.mjs` from a shell
  where the Z.ai credential resolves (blocked in the grill sandbox).
