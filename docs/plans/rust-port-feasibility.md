# Rust Port Feasibility — arxa studio / dsh / pi

**Date:** 2026-08-29
**Inputs:** 4 subagent research reports (Rust-vs-TS harness perf, pi runtime, dsh, arxa-studio codebase map). Advisor consult skipped (over budget), recorded via `gate decision --skip`.

## Verdict: DO NOT port to Rust

A unified Rust port of arxa/arxa-studio's harness stack is not feasible on the merits and is barred by ratified governance.

## Reasons

### 1. The performance premise is false
- Tokens/sec is set by the **inference server** (GPU memory bandwidth + scheduling), not the client language. Anthropic's and NVIDIA's own latency docs define TTFT/latency as model-side; a measurement-bias study found process-count client bugs (event-loop overload), not a language ceiling — a well-built multi-process TS client showed ~0.63ms overhead regardless of language.
- OpenAI's Codex CLI Rust rewrite never claimed a throughput win — its stated goals were install footprint, startup time, memory, and native sandboxing (GitHub Discussion #1174).
- Rust genuinely moves tokens/sec only for **local inference engines** (mistral.rs, llama.cpp class) — a different layer arxa does not implement.
- Legitimate Rust wins that do exist: startup latency (CI/parallel agent spawn), memory on long sessions, single-binary distribution (drops Node runtime dependency). None require porting the whole stack; napi-rs/WASM for hot paths captures most of it.

### 2. The coupling surface makes a port a full rewrite of two upstreams
- arxa-studio has **zero static `@deepseek-ai` imports** in first-party code. dsh is consumed as 4 exact-pinned npm packages (`0.1.1-rc.2`) expanding to ~190 transitive `dsh-*` packages, composed via profile/bundle lists, subprocess exec, and path resolution.
- pi is not an npm dep at all — it's an external CLI (`pi`) with two symlinked TS extensions (`pi/arxa-memory.ts` here, `arxa/harness/pi/arxa-gate.ts` in the sibling engine repo) hooked on `before_agent_start`.
- A Rust port therefore means reimplementing dsh (~219 packages, ~453K LOC TS, Cordis plugin framework) **and** pi's extension/SDK/RPC surface. First-party arxa code is a thin shim (~650 LOC pi-facing; the dsh-facing code is bin scripts + plugins).

### 3. Governance forbids it
- `arxa/docs/plans/arxa-harness-and-distribution.md` — Amendment 2026-08-21, **"DEPEND, do not fork"** — is ratified and supersedes earlier fork decisions. "Conclusion: zero source edits required." Line 121: "Pi is unaffected: it was never forked. It is a dependency, so its updates are an ordinary version bump."
- A Rust port is a fork by another name: it freezes arxa against both upstreams.

### 4. Upstream velocity makes a frozen port instantly stale
- dsh: created 2026-08-13, "developer preview," breaking changes expected, ~daily releases during launch week, current line is `0.1.1-rc.2`.
- pi: ~weekly/biweekly releases; mid-rename to `earendil-works/pi`. No official Rust roadmap for either. The one third-party pi Rust port (`Dicklesworthstone/pi_agent_rust`) is unofficial with documented functional bugs.

## If performance pain is real, do this instead
1. **Measure first** — identify whether the pain is startup, memory, or perceived throughput (throughput is server-side; fix the provider/inference config, not the client).
2. **Startup:** use the `dsh-headless` bundle / pi `-p` print mode; pi ships Bun-compiled standalone binaries.
3. **Hot paths:** napi-rs native addons or WASM inside the existing TS stack — keeps depend-don't-fork intact.
4. **Distribution:** single-binary packaging of the existing stack (Bun compile) before any rewrite.
5. **Integration from Rust (if arxa ever grows a Rust component):** pi's official RPC mode (LF-delimited JSONL over stdio) and dsh's `dsh-acp-app` (JSON-RPC) are the sanctioned seams — integrate across a process boundary, don't port.

## Open questions for the operator
- What concrete pain motivated the port idea (startup / memory / distribution / perceived tokens-sec)?
- Should this verdict be recorded as an ADR reaffirming the depend-don't-fork amendment?
- Do we want a standing watch on dsh rc-line breaking changes (loopback monkey-patch in `bin/loopback-localhost-patch.mjs` is the known fragile seam)?
