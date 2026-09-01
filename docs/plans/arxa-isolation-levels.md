# Project isolation levels — L0 / L1 / L2

Status: **research + grill in progress.** Nothing here is settled law yet.
Companion to `git-card-sessions-worktree-rewire.md` (the CI/CD plan this must not break).

## The ask

- **Level 0** — today: no isolation. arxa + CI/CD as they exist.
- **Level 1** — Docker container per project.
- **Level 2** — stronger sandbox.
- Self-contained `.env` and database (Supabase) per project.
- **Optional**, offered at org creation and at project creation.
- **Inheritance:** org takes L1 or L2 → its projects inherit it. Org takes none →
  a project may still choose L1 or L2 independently.
- arxa must spin up the container/sandbox itself for either level.
- Must keep working with the CI/CD flow settled in D107–D114.

## 1. Host constraints — measured 2026-09-01, before any research landed

These bind harder than anything the research can recommend.

### 1a. BLOCKER — the internal disk is 99% full

```
/System/Volumes/Data   228Gi total   3.4Gi avail   99%   <- Docker's VM disk lives here
/Volumes/developer_ssd 238Gi total    11Gi avail         <- repos
/Volumes/business_ssd  238Gi total   184Gi avail         <- orgs + projects
```

Docker Desktop's disk is `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`
(sparse, 238 G max) on the internal volume. Current usage is trivial — 2 images /
597 MB, 1 container, 1 volume, 1.02 GB build cache — so nothing has been pulled yet
and **there is no headroom to pull anything**.

Against 3.4 GiB free: `devcontainers/base` ~1 GB · Dart SDK ~1–2 GB ·
Flutter + Android ~3–5 GB+ · Supabase local stack (~10 containers) several GB.
**A single Flutter dev container alone exceeds free space.**

**Prerequisite, user action, outside the code** — same class as the GitHub
`workflow`-scope re-link:
1. Relocate Docker Desktop's disk image onto `business_ssd` (184 GiB free), or
2. use `colima` (already installed) with its VM disk there, or
3. reclaim internal disk space.

Nothing at L1 or L2 can be built or tested until one of these is done.

### 1b. Memory

Host 16 GB (Apple M4, 10 cores, macOS 26.6.2); Docker Desktop VM allocated 8.3 GB.
Simultaneously in play at L1/L2: arxa engine (node), Tauri app, Claude Code, a dev
container per active session, plus ~10 containers per local Supabase stack.
**Multiple concurrent project Supabase stacks are not realistic.** Design assumption:
one local stack at a time, started on demand, stopped at session end.

### 1c. What is installed

| Tool | Status |
|---|---|
| `docker` | present — Docker Desktop, server 29.7.2, overlayfs |
| `colima` | present — alternative runtime, supports a custom disk location |
| `lima` | present |
| `supabase` | present — CLI 2.67.1 |
| `devcontainer` | **absent** — would need installing |
| `podman` / `orbstack` / `nerdctl` | absent |

### 1d. Prior art and greenfield

- `arxa` (Dart) has `deploy/remote/docker-compose.yml` — **not greenfield**.
- `arxa-studio` (Node) has nothing container-related at all.
- No `supabase/config.toml` anywhere under `/Volumes/business_ssd` — per-project
  database is greenfield, nothing to migrate.

## 2. Research findings

### 2a. Dev Containers as the L1 vehicle — CONFIRMED VIABLE

**The CLI is headless and permissively licensed.** `@devcontainers/cli` is the
MIT-licensed reference implementation of the open spec at containers.dev; VS Code and
Codespaces are *consumers* of it, not the other way round. Commands: `up`, `build`,
`exec`, `read-configuration`, `run-user-commands`, `features`, `templates`,
`stop`/`down`. Requires Node ≥ 20. Latest 0.88.0.
**So a Tauri app can shell out to it — this is not a blocker.**
⚠️ Do not confuse it with the older `@vscode/dev-container-cli`, which carries a
Microsoft product licence and was last published ~3 years ago.

`read-configuration` returns resolved config as JSON — the natural feed for UI state.

**What the spec gives free:** image / Dockerfile / compose build, composable
`features`, `mounts` / `workspaceMount`, ordered lifecycle hooks
(`initializeCommand` on host → `onCreateCommand` → `updateContentCommand` →
`postCreateCommand` once → `postStartCommand` every start → `postAttachCommand`),
`remoteUser` / `containerUser`, `forwardPorts`, and a `customizations.<namespace>`
escape hatch usable as `customizations.arxaStudio` for per-stage metadata.

**The real gap, and it is unavoidable: there is no official Dart or Flutter image or
Feature.** `mcr.microsoft.com/devcontainers` ships base/cpp/dotnet/go/python/java/
node/ruby/rust/php/anaconda — no Dart. The official Features collection has none
either. Only a community Feature (`ghcr.io/devcontainers-community/features/dart-sdk`)
installs the bare Dart SDK — no Flutter, no Android SDK. **We hand-write and maintain
a Dockerfile for the `application/` target regardless of approach**, so this is not a
reason to skip the spec. The `website/` target is covered by the official node image.

Also ours regardless: rendering `read-configuration` in the Tauri UI, and
orchestrating ten stage containers — the spec covers one container's lifecycle, not
fleet orchestration.

**Recommendation from the research:** devcontainer.json + the CLI over hand-rolled
compose. Plain compose only wins for one fixed shape with no interest in
features/hooks. Nix/devbox is a different axis — toolchain pinning without isolation;
a possible L0 complement, not an L1 substitute.

**Secrets (per this agent):** never bake into the image. `containerEnv`/`remoteEnv`,
or `--env-file` via `runArgs` / compose `env_file:`. The CLI's `--secrets-file` is
applied like `remoteEnv` — visible to processes the tool attaches to, not guaranteed
container-wide unless also threaded through `containerEnv`. Cross-check against the
dedicated secrets research before adopting.

### ⚠️ 2b. Conflict to resolve — the macOS performance fix collides with the disk blocker

Official guidance for large repos on macOS is the **Clone Repository in Container
Volume** pattern: put the source in a *named Docker volume* rather than a host bind
mount, because bind mounts are slow through the VM boundary.

But a named volume lives inside `Docker.raw`, **on the 99 %-full internal disk** —
while the projects currently live on `business_ssd`, the volume with 184 GiB free.
So the recommended performance pattern would move client source code from the roomy
disk onto the full one, and does so invisibly.

This is not a reason to reject the pattern; it is a reason §1a must be resolved
*first*, and resolved by relocating the Docker disk to `business_ssd` specifically —
not merely by freeing a few GB internally. **Record as a hard ordering constraint.**

## Sources

- [@devcontainers/cli — npm](https://www.npmjs.com/package/@devcontainers/cli)
- [devcontainers/cli — GitHub](https://github.com/devcontainers/cli)
- [cli/package.json — license: MIT](https://github.com/devcontainers/cli/blob/main/package.json)
- [@vscode/dev-container-cli — npm (the one to avoid)](https://www.npmjs.com/package/@vscode/dev-container-cli)
- [AUR devcontainer-cli PKGBUILD — license MIT](https://aur.archlinux.org/packages/devcontainer-cli)
