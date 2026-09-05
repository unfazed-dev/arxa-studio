# Rust Agent Harness Landscape — Research Notes

Purpose: inform the decision between (a) keep tracking upstream `dsh` (DeepSeek Harness) releases and re-adapting plugins, (b) hard-fork `dsh`, or (c) write a Rust harness in-house for arxa studio.

Research date: 2026-09-05. All facts are web-search-derived (no repo access) and dated where the source is dated; several sources are 2026 blog/analysis posts rather than primary docs, so treat star counts and some architecture claims as approximate. Uncertain/unverified items are flagged explicitly rather than guessed.

---

## 0. The incumbent: `dsh` (DeepSeek Harness) itself

- Repo: `deepseek-ai/deepseek-harness`, npm package `@deepseek-ai/dsh`, went public MIT-licensed on 2026-08-13. — [GitHub](https://github.com/deepseek-ai/deepseek-harness), [Digital Applied writeup](https://www.digitalapplied.com/blog/deepseek-harness-open-source-agent-framework-2026)
- Architecture tagline "Everything is a Plugin," built on **Cordis**, a plugin meta-framework extracted from the Koishi bot ecosystem. Cordis only loads/unloads/resolves plugin dependencies; it carries none of the agent capability itself — all tool/session/provider logic lives in plugins. — [DeepSeek Harness site](https://deepseekharness.io/), [Digital Applied](https://www.digitalapplied.com/blog/deepseek-harness-open-source-agent-framework-2026)
- Explicitly labeled "developer preview... iterating rapidly," with compatibility-breaking changes expected between rc releases (npm version seen: `0.1.0-rc.6`; this repo's own git log references adapting to `0.1.2-rc.1`). This confirms the "living on an upstream rc" pain is not hypothetical — it's the project's stated posture.
- Community plugin ecosystem exists (`dsh-plugin` GitHub topic, `0xsline/awesome-deepseek-harness` curated list) but is explicitly unaudited: "Neither DeepSeek nor SpringBrand has reviewed this code for security." — [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
- Naming collision risk: an unrelated `deepseek-harness-cli` (Python) exists alongside the official Node one — worth confirming arxa's dependency is the official `@deepseek-ai/dsh`, not a lookalike.

**Implication:** dsh being MIT and in active rc churn is exactly the "moving target" pattern that makes plugin-overlay maintenance costly (see §3). A hard fork is legally unencumbered (MIT), but forking a Cordis-based plugin architecture inherits Cordis's own churn risk too, since Cordis is a separate upstream dependency.

---

## 1. Existing open-source Rust AI coding-agent harnesses

| Project | Maturity (2026) | Architecture notes | License | Claude subscription/OAuth login? |
|---|---|---|---|---|
| **OpenAI Codex CLI** (`openai/codex`, `codex-rs`) | Rewritten TS→Rust starting mid-2025; ~95% Rust by early 2026; 65-member Cargo workspace; ~10-15 commits/day; star counts vary 67k-120k across sources (treat as approximate) | Layered workspace: entry points → shared core engine → platform/protocol layers. JSON-RPC app-server interface; MCP client **and** server (`codex mcp-server`). Sandboxing is OS-kernel level: macOS Seatbelt (`sandbox-exec`), Linux Landlock/seccomp/bubblewrap — "the only major AI coding agent that enforces security at the kernel level rather than app-layer hooks." `SandboxPolicy` enum: ReadOnly/WorkspaceWrite/DangerFullAccess/ExternalSandbox. | Apache-2.0 | No native Claude OAuth; it's a ChatGPT/OpenAI-account/API-key tool. Device-code sign-in added ~March 2026 for headless use (ChatGPT auth only). |
| **goose** (Block → now Linux Foundation "Agentic AI Foundation," repo moved `block/goose`→`aaif-goose/goose`) | Since Jan 2025; 29k-50k+ stars depending on source snapshot, 368 contributors; donated to Linux Foundation for vendor-neutral governance in 2026 | Rust workspace: `goose` (core: agents, providers, config, session, OAuth, security, telemetry), `goose-cli`, `goose-server` (`goosed`, REST/WS), `goose-mcp`, `goose-acp` (Agent Client Protocol server), Electron desktop UI. Agent loop in `agent.rs` (~2500 lines) holds a `SharedProvider = Arc<Mutex<Option<Arc<dyn Provider>>>>`. Tool calls pass a stacked `ToolInspectionManager`: Security→Egress→Adversary→Permission→Repetition inspectors. Session store: SQLite. Sandboxing is opt-in on macOS (Seatbelt + local egress proxy) — off by default, flagged as a real gap by a third-party sandbox audit. | Apache-2.0 | **Not native OAuth.** Since ~March 2026, goose supports "using your subscription" for Claude only indirectly, via the Agent Client Protocol (ACP) shelling out to the official **Claude Code CLI** as the actual agent (Codex/ChatGPT and Gemini get more direct OAuth). See §4. |
| **CodeWhale** (started as "DeepSeek-TUI") | ~41k stars per one source | Rust TUI + `codewhale exec` for CI/scripting; multi-provider, open-model-first | MIT | Unknown — not verified in search |
| **Grok Build** (xAI) | Closed beta May 2026 → Apache-2.0 open-source mid-July 2026 → v1.0 Aug 7 2026; ~26k stars | Rust TUI; agent loop, tool layer, extension system (skills/plugins/hooks/MCP) | Apache-2.0 | Unknown/unlikely — xAI-account focused |
| **Forge** | Independent, model-agnostic | Three-agent split: `forge` (implements), `sage` (read-only research), `muse` (plans); BYOK across 300+ models | Apache-2.0 | Unknown |
| **jcode** | ~9,163 stars / 1,056 forks (July 2026 snapshot) | MIT, Rust-primary; supplies terminal UI, tools, sessions, memory, provider connections, permissions, multi-agent coordination. "Login or provider paths" listed for Claude, OpenAI, Gemini, Copilot, Azure OpenAI | MIT | Claimed to support a "login path" for Claude — **not independently verified**; given the Feb–Apr 2026 Anthropic crackdown (§4), any such flow is at risk of being blocked server-side regardless of what the client claims to support. |
| **Orca** | ~494 stars | DeepSeek-native terminal agent; OS-level sandboxing (Seatbelt/bwrap/Landlock+seccomp, fail-closed); 1M-context auto-compaction; single binary | MIT | Unknown |
| **pi_agent_rust**, **g3**, **zot**, **kasetto** | Small (130-519 stars) | Native single-binary rewrites of existing agents (e.g. Pi Agent) emphasizing zero unsafe code, bounded-resource long sessions, capability-gated tool security | Mixed/unverified | Unknown |
| **Claw Code** | Claimed ~195k stars, "fastest repo to 100k stars in GitHub history" | Clean-room Python/Rust rewrite of Claude Code, born from a March 2026 Claude Code source leak | MIT | Not verified — treat star/provenance claims with skepticism, this smells like hype-driven reporting |

Sources: [Techzine](https://www.techzine.eu/news/devops/131954/openai-rewrites-ai-coding-tool-in-rust/), [Codex "Going Native" discussion](https://github.com/openai/codex/discussions/1174), [Zylos Research architecture deep-dive](https://zylos.ai/research/2026-03-26-openai-codex-cli-architecture-multi-runtime-patterns/), [Daniel Vaughan Codex KB](https://codex.danielvaughan.com/2026/05/28/codex-cli-rust-development-codex-rs-cargo-mcp-systems-programming-agent-workflows/), [Agent Safehouse — Codex sandbox report](https://agent-safehouse.dev/docs/agent-investigations/codex), [Agent Safehouse — goose sandbox report](https://agent-safehouse.dev/docs/agent-investigations/goose), [goose macOS sandbox docs](https://goose-docs.ai/docs/guides/sandbox/), [goose permission modes](https://instagit.com/block/goose/goose-tool-permissions-modes/), [Agent Harness Field Guide — goose](https://wuu73.org/aiguide/infoblogs/coding_agents/goose.html), [bradAGI/awesome-cli-coding-agents](https://github.com/bradagi/awesome-cli-coding-agents), [Pinggy — Best Open Source CLI Coding Agents 2026](https://pinggy.io/blog/best_open_source_cli_coding_agents/), [jcode.sh](https://jcode.sh/), [CoddyKit jcode writeup](https://www.coddykit.com/pages/blog-detail?id=512943&slug=jcode-the-open-source-rust-coding-agent-that-s-245-faster-than-claude-code-9-163).

**Uncertainty flag:** Star counts are inconsistent across sources for the same project (e.g. Codex CLI cited at both 67k and 120k) and several of these projects/blog posts read as SEO/hype content rather than primary documentation. Treat headcounts, "Nx faster than Claude Code" claims, and exact star figures as unverified until checked directly against GitHub.

---

## 2. TS/Go harnesses — common architecture patterns

**Claude Code** (TS, Bun-compiled single binary):
- Layers: Setup (hooks/plugins/watchers) → UI (Ink/React) → `QueryEngine` (send→stream→tool-exec→repeat loop) → Tool System (50+ tools, per-tool permission logic) → Services/State (API clients, MCP, memory, history).
- Sessions: JSONL transcript per session under `~/.claude/`, treated as the "recovery core" — everything (user input, model output, tool progress, system events) is a `Message`. Compaction boundaries and incremental recovery are built around this log.
- Extension model: "four-layer" — Command + Skill + Plugin + MCP coexist. Hooks fire on lifecycle events (SessionStart, Setup, SubagentStart, PermissionDenied, etc.).
- Permission model: cascading — rules → tool logic → mode → classifier → user; read-only tools auto-approve, others prompt per mode (`default`/`acceptEdits`/`plan`/`bypassPermissions`).
- Notable perf trick: agent list sent as a separate "attachment message" rather than embedded in the tools block, specifically to avoid busting Anthropic's prompt cache when agents/MCP servers change.
— [DEV Community architecture explainer](https://dev.to/brooks_wilson_36fbefbbae4/claude-code-architecture-explained-agent-loop-tool-system-and-permission-model-rust-rewrite-41b2), [DeepWiki system architecture](https://deepwiki.com/anthropics/claude-code/1.1-system-architecture), [Zain Hasan deep dive](https://zainhas.github.io/blog/2026/inside-claude-code-architecture/), [Wayland Z diagrams](https://www.waylandz.com/diagrams/claude-code-architecture.html)

**OpenCode** — naming caution: two unrelated projects share the name.
- The **current, actively-developed** OpenCode (by Anomaly, formerly SST) is a client-server split: TypeScript+Bun HTTP server (talks to providers, runs tools, owns state, OpenAPI 3.1 spec generating `@opencode-ai/sdk`) + a Go TUI client (Bubble Tea). Multiple frontends (TUI, desktop, IDE ext, web) can attach to one server; sessions persist through SSH drops/sleep because they live server-side. State: SQLite. Provider layer: Models.dev registry, 75+ providers. MCP + LSP + custom commands for extensibility; git-based snapshots give `/undo`/`/redo`. ~160k GitHub stars claimed (unverified against source).
- The **archived original** `opencode-ai/opencode` was pure Go with a Bubble Tea TUI and its own provider list.
— [OpenReplay blog](https://blog.openreplay.com/opencode-ai-coding-agent/), [DataCamp](https://www.datacamp.com/blog/what-is-opencode), [Developers Digest](https://www.developersdigest.tech/blog/opencode-developer-guide-2026), [OpenAIToolsHub](https://www.openaitoolshub.org/en/blog/opencode-review-terminal-ai-coding)

**Aider** (Python, included for pattern comparison since it's the canonical provider-agnostic harness):
- Single Python process, no daemon. `Model` class wraps **LiteLLM** for provider abstraction (Anthropic/OpenAI/DeepSeek/Ollama/etc., switchable mid-session with `/model`). `Coder` subclasses implement different edit strategies (search/replace vs whole-file). `RepoMap` uses tree-sitter + ranked tags to fit codebase structure into a token budget (~1/8 of context by default) without loading all files. `GitRepo` auto-commits with AI-authored messages.
— [aider repomap docs](https://aider.chat/docs/repomap.html), [DeepWiki](https://deepwiki.com/Aider-AI/aider)

**Cline** (TS, VS Code extension, originally "Claude Dev"):
- Not a separate app — runs inside VS Code's extension host, 30+ provider support via API keys/OpenRouter. Plan/Act mode split (explore+question vs. execute). Plugin SDK for registering tools/lifecycle hooks (logging, audit, policy). MCP config lives in its own `cline_mcp_settings.json`, separate from `.mcp.json` — cross-tool config sharing (Claude Code/Cursor/Cline) requires symlinking/templating by convention, not a standard.
- Permission model: human-in-the-loop by default, per-category auto-approve (read-only, file writes, terminal, browser, MCP tools). **Known bug** (Feb 2026, v3.63.0): the global "use MCP servers" auto-approve toggle appears to override per-tool MCP approval settings — a caution for anyone copying this pattern.
— [Cline GitHub](https://github.com/cline/cline), [Fastio guide](https://fast.io/resources/cline-vscode-extension-guide/), [issue #9357](https://github.com/cline/cline/issues/9357)

**Cross-cutting patterns observed across all of these:**
1. **Event-sourced session logs** are close to universal in spirit — even SQLite-backed systems (goose, OpenCode, Codex's Rust port) model sessions as an append-only sequence of typed events (`session_id, seq, type, time, data`), just persisted differently.
2. **Provider abstraction is a thin trait/interface** (Provider trait in goose, LiteLLM in Aider, Models.dev + AI SDK in OpenCode) — none of the mature harnesses hardcode a single vendor's API shape into the agent loop.
3. **MCP is the shared "extends everything" layer** across virtually all of them (Claude Code, goose, Codex, OpenCode, Cline) — it has become the de facto plugin protocol for *tools*, separate from each project's own plugin/extension mechanism for *harness behavior*.
4. **Permission/approval models converge on graded trust tiers** (read-only auto-approve → prompt → full-auto), usually configurable per tool-category, with sandboxing (OS-level or None) as an orthogonal, often-optional layer.

---

## 3. Cost of "living on an upstream + patch/plugin overlay" — lessons from browser/editor forks

**Cursor (VS Code fork):**
- Cursor's own docs: "We regularly rebase Cursor onto the latest VS Code version... To ensure stability, Cursor often uses slightly older VS Code versions." A dedicated internal team handles this rebase as ongoing work, not a one-off.
- Documented lag on their community forum: 2+ versions behind (Nov 2024), frozen at 1.96.2 while upstream reached 1.100+ (mid-2025), "stuck on VS Code 1.105, now roughly 5 months old" (June 2026 forum post). Extension incompatibility is the recurring user-visible symptom.
- No public headcount for the rebase team specifically; company-wide engineering is cited around ~100 people for a $1B ARR business.
— [Cursor VS Code Migration docs](https://cursor.com/docs/configuration/migrations/vscode), [forum: 1.105 base 5 months old](https://forum.cursor.com/t/urgent-the-1-105-vs-code-base-is-now-5-months-old-we-need-a-modern-upstream-sync/164204), [Eclipse Foundation "Is forking VS Code a good idea?"](https://eclipsesource.com/blogs/2024/12/17/is-it-a-good-idea-to-fork-vs-code/) (note: Eclipse sells Theia as the alternative, so has a commercial incentive to make forking look bad)

**VSCodium (VS Code, config/branding-level fork):**
- Deliberately **not** a source fork — a build pipeline that clones the official `microsoft/vscode` repo, applies patches (telemetry/branding/marketplace removal), and rebuilds. Version tracking is file-based (JSON files pin the exact upstream commit/tag per release channel).
- Because the delta is narrow (5 categories: telemetry, branding, marketplace, AI features, licensing), the recurring cost per release is small: a routine "update patches" PR per monthly VS Code release, mostly CI/multi-arch work rather than patch conflicts.
- Team size: effectively 1-2 core maintainers (daiyam does most releases) plus scattered platform-specific volunteer packagers.
— [VSCodium DeepWiki — version management](https://deepwiki.com/VSCodium/vscodium/3.3-version-management), [VSCodium DeepWiki — source prep](https://deepwiki.com/VSCodium/vscodium/2.1-source-preparation), [release 1.126.04524](https://github.com/VSCodium/vscodium/releases/tag/1.126.04524)

**Brave (Chromium, deep-integration fork):**
- Explicit engineering philosophy to *minimize* fork cost: prefer subclassing Chromium classes and code in `src/brave/` over direct patches; direct patching to `src/` is last resort; **never** wholesale-copy files (cited as a mistake other Chromium-based browsers made, because copied files silently go stale across rebases).
- Even so, rebases require patch conflict resolution, string/localization regen, watching for new entitlements/permissions per Chromium version, and even keeping their Rust toolchain in lockstep with Chromium's pinned Clang/Rust revisions.
- Heavily automated via an internal tool ("Brockit") and CI bots that flag PRs behind the Chromium target version. Cadence: frequent minor bumps, roughly weekly-to-biweekly stable releases.
- Team: a named "rebase team" exists internally; no public headcount for it specifically. Company-wide, ~150-360 employees depending on source, engineering ~40-44% of headcount.
— [Brave wiki — Chromium rebases](https://github.com/brave/brave-browser/wiki/Chromium-rebases), [brave-core chromium_version_upgrade.md](https://github.com/brave/brave-core/blob/master/docs/chromium_version_upgrade.md), [Brave wiki — deviations from Chromium](https://github.com/brave/brave-browser/wiki/Deviations-from-Chromium-(features-we-disable-or-remove)), [Revelio Labs headcount](https://www.reveliolabs.com/companies/brave-software/employees)

**Synthesis for arxa's decision:**
- The cost of tracking upstream scales with **how deep your integration goes**, not with upstream's size alone. VSCodium (shallow delta) stays cheap with ~1-2 maintainers. Cursor and Brave (deep, product-differentiating integration) both need dedicated ongoing rebase teams and both still fall behind anyway.
- If arxa's plugin overlay on `dsh` is closer to "config + a few extension points" (VSCodium-shaped), continued tracking is plausible with a small team. If it's "deep behavioral changes to the harness core" (Cursor/Brave-shaped), expect either a standing rebase team or chronic version lag — and `dsh` is explicitly pre-1.0 and "iterating rapidly," which is a worse starting position than VS Code's comparatively stable monthly cadence.
- No source gave a hard "typical team size" number in FTEs for any of these; the qualitative signal is: shallow delta ≈ 1-2 people, deep delta ≈ a dedicated sub-team within a much larger org. arxa should size against the *depth of dsh customization*, not against dsh's own team size.

---

## 4. Anthropic's stance on Claude subscription OAuth in third-party tools (2025-2026)

Timeline (from Anthropic's own Legal & Compliance page, The Register, and multiple secondary sources):
- **Jan 5-9, 2026:** Reports of OAuth logins inside third-party tools (OpenCode, Crush, others) failing/triggering bans. Crush maintainer removed Claude Code support "at Anthropic's request." An Anthropic staffer (@trq212) confirmed: third-party harnesses using Claude subscriptions are prohibited; the supported path for third-party tools is the **API**.
- **Feb 20, 2026:** Legal terms updated to state explicitly: *"Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any other product, tool, or service — including the Agent SDK — is not permitted and constitutes a violation of the Consumer Terms of Service."* — [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)
- **Feb-Mar 2026:** Server-side enforcement rolled out quietly — non-official clients presenting subscription OAuth tokens get rejected with errors like "This credential is only authorized for use with Claude Code." On **March 19, 2026**, OpenCode's upstream merged a "legal compliance" PR removing built-in Anthropic auth support entirely.
- **April 4, 2026, 12pm PT:** Per Boris Cherny (Head of Claude Code), Claude subscriptions stopped covering usage through third-party tools entirely; Anthropic gave a one-time one-month credit plus optional discounted "extra usage bundles" as compensation.
- **Current official policy** (code.claude.com/docs/en/legal-and-compliance): OAuth is exclusively for Claude Free/Pro/Max/Team/Enterprise subscribers using it for "ordinary use" of Claude Code and native Anthropic apps. Third-party developers (including Agent SDK users) must use **API key** auth via Claude Console or a supported cloud provider. Running the official `claude` CLI yourself (even on a remote server you control, via SSH) is fine — the line is about *who holds the credential and issues the request*, not where it runs.

**How Codex/goose/OpenCode actually handle it today:**
- **Codex CLI:** Native ChatGPT-account OAuth (not Claude). No Claude subscription path — API key only for non-OpenAI models.
- **goose:** No native "sign in with Claude." Since ~March 2026 it supports using a Claude *subscription* only indirectly — by shelling out to the official **Claude Code CLI** as a subprocess via the Agent Client Protocol (ACP), passing goose's MCP extensions through to it. Codex/ChatGPT and Gemini get more direct OAuth inside goose itself; Claude does not. — [goose blog: "Use Goose with Your AI Subscription"](https://goose-docs.ai/blog/2026/03/19/use-goose-with-your-ai-subscription/)
- **OpenCode:** Had built-in Anthropic OAuth; removed it in the March 19, 2026 compliance PR in response to Anthropic's policy enforcement.

**Implication for arxa:** any Rust-native harness (in-house or dsh-based) that wants "sign in with your Claude Pro/Max plan" as a first-class feature is now against Anthropic's explicit ToS and technically blocked server-side for non-official clients. The only compliant pattern observed in the wild is goose's: shell out to Anthropic's own official `claude` binary as a subprocess/agent rather than reimplementing the OAuth flow. Building your own OAuth capture (as OpenCode/Crush originally did) is a dead end — Anthropic already killed it once and enforces at the server.

---

## 5. Best practices for a Rust agent core (if arxa builds its own)

- **Async runtime:** Tokio is the de facto standard across every Rust harness found (Codex, goose, rmcp, async-openai, anthropic-rs, ai-sandbox) — no credible alternative runtime showed up in this research.
- **MCP client/server:** `rmcp` (`modelcontextprotocol/rust-sdk`, crates.io `rmcp`) is now the **official** Rust SDK, having absorbed an independent community crate (originally by "4t145," which itself started because the first official SDK was "originally built for goose rather than general-purpose use" and had too many limits). Supports MCP spec 2026-07-28 with backward compat to 2025-11-25; pluggable transports (stdio, child-process, Streamable HTTP, SSE); feature-flagged server/client/macros/OAuth. — [rmcp GitHub](https://github.com/modelcontextprotocol/rust-sdk), [crates.io](https://crates.io/crates/rmcp)
- **macOS sandboxing:** `sandbox-exec` (Seatbelt) is the mechanism every Rust agent uses, despite Apple marking it deprecated (still functional). Two purpose-built crates surfaced: `ai-sandbox` (cross-platform: Seatbelt/macOS, bubblewrap+seccomp+Landlock/Linux, Restricted Token/Windows, Capsicum/FreeBSD, pledge/OpenBSD) and `wardstone` (Seatbelt-focused, auto-generates `.sbpl` policies). Codex CLI's `codex-rs` sandbox module is the most battle-tested reference implementation to study directly. **Known gotcha:** Seatbelt blocks `com.apple.SystemConfiguration.configd` Mach lookups by default, which crashes any Rust binary using `reqwest`'s default system-proxy feature (via the `system-configuration` crate) — either allow that `mach-lookup` in the sandbox policy or disable reqwest's system-proxy feature. — [ai-sandbox](https://crates.io/crates/ai-sandbox), [wardstone](https://crates.io/crates/wardstone), [Claude Code sandbox-runtime issue writeup](https://github.com/anthropics/claude-code/issues/42857)
- **Streaming SSE clients:** Two viable layers —
  - Hand-rolled: `reqwest` + `reqwest-sse` (lighter, no built-in reconnect — good, since blind-retrying a POST with a full prompt on drop is usually wrong for LLM APIs) or `reqwest-eventsource` (has built-in reconnect, less ideal for this use case) + `serde_json`, handling OpenAI's `data: [DONE]` sentinel and Anthropic's named SSE events yourself.
  - Ready-made SDKs: `async-openai` (mature, SSE streaming, tower middleware, Azure support) for OpenAI-compatible providers; `anthropic-rs` or `threatflux-anthropic-sdk` (unofficial, community) for Anthropic, both typed and Tokio/reqwest-based with a `StreamAccumulator`-style helper for reassembling `content_block_delta`/`thinking_delta`/tool-use JSON deltas.
  — [reqwest-sse docs](https://docs.rs/reqwest-sse/latest/reqwest_sse/), [async-openai](https://crates.io/crates/async-openai), [anthropic-rs](https://github.com/AbdelStark/anthropic-rs)
- **Session persistence — JSONL vs SQLite:** No universal winner; the field has split, and several projects (Hermes Agent, picoclaw) migrated **from** JSONL **to** SQLite specifically to fix race conditions and enable cross-session queries, while others (an arXiv "Resilient Write" paper, a terminal-agent paper) deliberately kept JSONL/plain files for human-readability, git-diffability, and zero external dependencies at small (tens-to-hundreds of rows) scale. The pattern that generalizes best: **model sessions as an event-sourced log** `(session_id, seq, type, time, data)` behind one storage-agnostic interface, with JSONL and SQLite as interchangeable backends passing the same read/replay contract test suite (this is literally how DeepSeek's own harness architecture notes describe doing it). Rule of thumb from the research: JSONL wins for small, single-writer, inspectable transcripts; SQLite (WAL mode, `BEGIN IMMEDIATE` + jittered retry to avoid the "convoy effect") wins once you need concurrent writers, cross-session queries, expiry/compaction, or shared multi-agent state. — [Hermes Agent session storage docs](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage/), [picoclaw issue #711](https://github.com/sipeed/picoclaw/issues/711), [arXiv 2604.10842 "Resilient Write"](https://arxiv.org/pdf/2604.10842), [arXiv 2603.05344 terminal-agent paper](https://arxiv.org/pdf/2603.05344), [DeepSeek harness session-persistence note](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)

---

## Uncertain / not independently verified

- Exact GitHub star counts for Codex CLI, OpenCode, jcode, Claw Code, Grok Build (sources conflict; likely inflated/stale in some blog posts).
- Whether jcode's claimed "Claude login path" actually works given Anthropic's Feb-Apr 2026 server-side enforcement — plausible it is broken or API-key-only in practice.
- Precise FTE headcounts for Cursor's or Brave's upstream-rebase teams — not published anywhere found.
- CodeWhale's, Orca's, Forge's, and Grok Build's Claude-OAuth support — no search result addressed this directly; treat as "no Claude subscription login" until confirmed otherwise, consistent with the pattern seen everywhere else.
