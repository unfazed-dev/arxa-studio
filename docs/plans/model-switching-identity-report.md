# Model switching + self-reported identity — investigation record

Reported: "switching between Claude models doesn't work — I used opus, switched to
sonnet and haiku, but it was still saying opus", plus "K3 said K1".

## Verdict: the switching pipeline is correct. Nothing was mis-routed. No code change.

Evidence: the real failing session, read off disk —
`~/.arxa/dsh/sessions/--Volumes-…-notes-note-wt-260904-003--/…/session.jsonl.zstd`
(244 KB, last written 23:42, matching the pasted transcript). Multi-frame zstd, so
`zstdcat` is required — node's `zstdDecompress` returns only the first frame (1 event
instead of 553).

For each `request/header`: the routed `config`, the `{{model}}` value interpolated into
the persona line, and the model the Claude child reported at init. The child-reported
column is the load-bearing one — it comes from the CLI process, not from anything the
model said.

| # | routed config | persona line says | claude child ran |
|---|---|---|---|
| 1 | zai/glm-5.3-flash | glm-5.3-flash | — |
| 2 | zai/glm-5.3 | glm-5.3 | — |
| 3 | zai/glm-5.3 (max) | glm-5.3 | — |
| 4 | claude-code/opus | opus | — |
| 5 | claude-code/opus | opus | — |
| 6 | claude-code/opus[1m] (xhigh) | opus[1m] | claude-opus-5[1m] |
| 7 | claude-code/sonnet (high) | sonnet | claude-sonnet-5 |
| 8 | zai/glm-5.3 (max) | glm-5.3 | — |
| 9 | kimi-coding/k3 (max) | **k3** | — |
| 10 | claude-code/opus[1m] (high) | opus[1m] | claude-opus-5[1m] |
| 11 | claude-code/haiku | haiku | claude-haiku-4-5-20251001 |

All three columns agree on every row. Switching worked every time, including
Claude→Claude (#6 opus → #7 sonnet → #10 opus → #11 haiku).

Caveat on scope: rows #4/#5 carry the static `opus` spelling and have no
`claude-code/session` row — they predate the restart that picked up the F16/F12 fixes.
The table spans that restart; rows #6-#11 are the post-fix behaviour.

## The two reported symptoms

**"still saying opus"** — turn #7 was routed to sonnet, and the CLI child confirms
`claude-sonnet-5` actually ran. Its reply to the user was:

> "I'm still the same model — **Claude Opus 5 (1M-token context)** — nothing has
> switched mid-session."

That is Sonnet denying a switch that had already happened. Turn #11 (haiku, child ran
`claude-haiku-4-5-20251001`) likewise opened with "**Claude Opus 5** — same as I just
told you." Both models asserted an identity contradicted by their own persona line.

Why: this conversation is an argument *about* model identity, so every earlier assistant
turn claiming "I am Claude Opus 5" sits in context. A model continuing that transcript
weights its own apparent prior statements above one line of system prompt.

**"K3 said K1"** — turn #9 was routed `kimi-coding/k3` and its persona line said `k3`.
The model invented "k1" *and* invented a citation for it ("the runtime context tells me
k1"). There is no `k1` anywhere: not in settings, not in dsh, not in the prompt. Pure
confabulation. That same turn also said "k3".

## Hypotheses tested and refuted

**H1 — `resume` pins the session's model.** Motivated by sdk.d.ts:2405
(`source: 'resume'` = "model restored while resuming a session"). Measured directly
(`scratchpad/repro-model-switch.mjs`): a fresh haiku session `8f5bce99`, then resumed
with `model: 'sonnet'` → init reported `claude-sonnet-5` on the *same* session id.
An explicit `model` overrides on resume; that doc line describes interactive resume with
no model specified. **Refuted — do not "fix" this.**

**H2 — `{{model}}` is stale.** `dsh-agent-loop:1025` registers it as
`context.agent?.options.model` (the agent's seed, never reassigned), which looks stale.
But `dsh-agent/lib/index.js:262` `installModelSelection` overrides both surfaces from one
snapshot: `system-prompt/assemble` rewrites the `model` variable and `agent/request`
rewrites the routed config, deliberately from the same snapshot so the two cannot
diverge. The table confirms it holds in practice. **Refuted.**

## Why no fix ships

The routing is right, so there is nothing to repair. The real gap is that a user cannot
verify which model answered without trusting the model's own word — the one signal that
is demonstrably unreliable here.

The natural place for an authoritative signal is the per-message footer that renders
`Ran for 23s · TTFT 17s · 189 tok/s` and no model name. **arxa does not own it**:
it lives in `@deepseek-ai/dsh-client-ui-conversation` and `dsh-client-ui-trajectory`.
Adding the routed model there is a dsh change, not an arxa one.

Deliberately not shipped: strengthening the persona line
(`profile/agent-presets/arxa/agent.cordis.yml:48`) to declare itself authoritative.
It is an unverifiable mitigation — there is no test that proves haiku stops
confabulating — and editing a prompt next to a "nothing is broken" finding would imply
a defect that the evidence says does not exist.

## On the research ask

Web research was moot: primary sources settled it — the SDK's own `sdk.d.ts`, the dsh
package source, a live two-turn resume measurement, and the failing session on disk.
No external best-practice guidance could outrank the session record.
