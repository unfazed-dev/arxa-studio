# GitHub-first auth for arxa studio (Tauri/macOS, local git engine) — research report

## 1. Desktop/native auth flow — GitHub's current guidance

- **GitHub officially prefers GitHub Apps over OAuth apps.** Docs say "Consider building a GitHub App instead of an OAuth app"; GitHub Apps get fine-grained permissions, repo-scoped installs, and short-lived tokens. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps , https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app
- **Which flow for native/desktop:** docs map device flow to "headless apps, such as CLI tools"; the GitHub App CLI tutorial states **"desktop applications should use the device flow"**. Web application flow (authorization code) is for apps "in the browser". https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app
- **⚠️ PKCE status — the task's premise is OUTDATED:** as of **July 14, 2025, GitHub supports and recommends PKCE for BOTH OAuth apps and GitHub Apps** in the authorization-code flow (S256 only; plain rejected; docs mark code_challenge/code_verifier "strongly recommended"). "GitHub is not requiring PKCE … GitHub does not distinguish between public and confidential clients." https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/ (confirmed in param tables at the authorizing-oauth-apps doc)
- **Device flow and installation-token flow do not use PKCE** (same changelog). OAuth-app best practices: a public client (native app/CLI) "cannot secure a client secret … you should use PKCE to better secure the authentication flow". https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app
- **Device flow rate limit — nuance vs "50/hour per IP":** current docs: **50 user-code submissions per hour per application**; poll no faster than the returned `interval` or you get `slow_down` (adds 5s); codes expire after 900s. Also: 10 sign-ins/user/hour, 2,000 token requests/hour per OAuth app. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps ("Rate limits for the device flow") , https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps
- **GitHub App token model:** user access tokens (ghu_) expire after 8h, refreshable via refresh tokens (6 months); install tokens are short-lived with fine-grained permissions; revocation fires a mandatory `github_app_authorization` webhook. https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app

## 2. Token storage on macOS for Tauri

- **No first-party `tauri-plugin-keychain` exists** in Tauri's official plugin set; the community pattern is the `keyring` crate (wraps macOS Keychain via Security.framework) used directly from Rust, or community plugins: `charlesportwoodii/tauri-plugin-keyring` (Tauri v2, over keyring-core) and `s00d/tauri-plugin-keyring-store`. https://github.com/charlesportwoodii/tauri-plugin-keyring , https://github.com/s00d/tauri-plugin-keyring-store
- GitHub's own guidance is platform-generic: "use a storage mechanism that is intended to store sensitive data on the platform that you are using" — on macOS that is Keychain. (best-practices doc above)
- Tauri community write-ups converge on: never localStorage/plain JSON config; use Keychain/keyring on macOS (secondary, non-official): https://dev.to/hiyoyok/storing-api-keys-safely-in-a-tauri-app-dont-just-use-localstorage-2i71 , https://dev.to/jorrygo_dev/building-a-jira-time-tracker-with-tauri-how-i-stored-api-tokens-securely-46aj

## 3. Scopes / token type for "scaffold repo locally + push + create org repos"

- **Classic OAuth `repo` scope is maximally broad**: "full access to public and private repositories… [and] organization-owned resources including projects, invitations, team memberships and webhooks." GitHub advises "Use minimal scopes". https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps , best-practices doc above
- **GitHub Apps / installation tokens are GitHub's recommended alternative**: fine-grained permissions, per-install repo selection, short-lived tokens, API rate limits that scale with repos/org users (OAuth apps "have lower rate limits and do not scale"). https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/rate-limits-for-oauth-apps
- **Fine-grained PATs are GA** with repo-level selection + per-permission grants, but are user-bound personal tokens — awkward as the identity of a distributed desktop app. https://github.blog/changelog/2025-03-18-fine-grained-pats-are-now-generally-available/
- Git push/pull over HTTPS accepts any of these (token as password). For a tool that also *creates* org repos via API, a GitHub App installation token with Administration:write + Contents:write on selected repos is the least-privilege fit; classic `repo` is the simplest-but-broadest single scope.

## 4. Prior art — "session = git worktree" tools

- **Graphite** ("Work In Multiple Git Worktrees"): one branch ↔ one worktree; refuses to mutate branches checked out elsewhere; `gt undo` is per-worktree; explicit multi-agent framing ("an agent working in one worktree should not change file contents being used by another agent"). No documented worktree-location/naming scheme of its own. https://graphite.com/docs/multiple-worktrees
- **xlaude** (Xuanwo): exactly the "worktree = AI coding session" model — "turning every git worktree into its own agent playground"; worktrees live at **`../<repo>-<branch>`-style sibling paths** (README: `../-`, branch-name-derived, sanitized); state keyed `repo/branch` in JSON (macOS: `~/Library/Application Support/com.xuanwo.xlaude/state.json`); maps Claude (`~/.claude/projects`) and Codex (`~/.codex/sessions`) session logs to worktrees. https://github.com/Xuanwo/xlaude/blob/main/README.md
- **jujutsu (jj)**: `jj workspace add <path>` creates sibling-directory workspaces; the "colocated repo" concept was renamed **"colocated workspace"** (jj PR #7915). https://app.semanticdiff.com/gh/jj-vcs/jj/pull/7915/overview , https://deepwiki.com/jj-vcs/jj/4.2-colocated-repositories
- **vercel portless** auto-detects jj workspaces to derive per-worktree subdomains — ecosystem convention: one workspace/worktree per parallel session. https://github.com/vercel-labs/portless/pull/86
- Common pattern: worktrees live **outside the main working copy** (sibling dirs or a dot-dir), named from the branch/session id; no universal standard location — each tool invents its own convention.

## 5. Device flow vs embedded webview

- **No current GitHub doc found that explicitly bans embedded webviews** (unlike Google, which blocks them — "OAuth 2.0 embedded browsers will be blocked"; Microsoft documents the same for WebView2). GitHub docs simply assume a browser: web flow "runs in the browser", device flow for headless/desktop with the user entering the code at github.com/login/device. Absence of a doc is not endorsement — flagged as a docs gap. Google: https://github.com/googlesamples/google-services/issues/292 ; Microsoft: https://github.com/MicrosoftEdge/WebView2Feedback/discussions/3828 ; GitHub flows: https://docs.github.com/en/apps/creating-github-apps/writing-code-for-a-github-app/building-a-cli-with-a-github-app
- GitHub's own desktop client (GitHub Desktop) and Git Credential Manager (cited by GitHub docs as a device-flow user) authenticate via system browser / device flow, not embedded webviews. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps

## Contradiction flags

1. **"OAuth apps don't support PKCE yet" — false since 2025-07-14**; PKCE (S256 only) is supported AND recommended for both OAuth apps and GitHub Apps.
2. **Device-flow limit is 50 submissions/hour per application**, not per IP, per current docs; per-IP wording appears in older/third-party texts.
3. GitHub's desktop guidance (device flow) sits awkwardly next to its July-2025 "use PKCE with the authorization code flow" push; a Tauri app *can* open the system browser with authorization-code + PKCE via a loopback redirect, but GitHub docs do not document that hybrid case — device flow is the only flow officially mapped to desktop.
