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

### 1a. NOT a blocker — Docker's disk is already on the roomy volume (corrected)

**An earlier reading of this was wrong and is retracted.** I saw a 238 G `Docker.raw`
under `~/Library/Containers/com.docker.docker/Data/vms/0/data/` and concluded Docker
was writing to the 99 %-full boot disk. It is not.

```
~/Library/.../Data/vms/0/data  ->  /Volumes/business_ssd/docker/DockerDesktop   (SYMLINK, since Jun 3)
```

Proof, three independent ways: both paths report the **same dev+inode**
(`dev=16777246 ino=6908`); `dev=16777246` maps to `/Volumes/business_ssd`
(boot disk is `16777234`); and `lsof` shows the live `com.docker` process holding
`/Volumes/business_ssd/docker/DockerDesktop/Docker.raw`.

**Actual headroom is ample:**

```
/Volumes/business_ssd          238Gi total   184Gi free   23% used
in-VM rootfs (docker's view)   233.7G total  218.8G free
current usage: 3 images/597MB · 1 container · 1 volume/254MB · 1.02GB build cache
```

A Flutter image, a Dart image and a Supabase stack all fit comfortably. **No
prerequisite, no user action, nothing gated on disk.**

**Separately true, and not a Docker problem:** the boot disk is at
`3.4Gi free / 99% capacity`. That is real machine-health debt and will bite Xcode,
system updates and caches — worth clearing, but it does **not** block L1 or L2.

### 1a-bis. Docker Sandboxes — L2 has a concrete product, and it is not installed

- `docker sandbox` (the old subcommand) is **deprecated and removed**; the CLI now
  says *"Please migrate to Docker Sandboxes"*.
- The successor ships as a separate `sbx` CLI. **`sbx` is ABSENT here**, as is
  `cagent`. Installing it is a prerequisite for evaluating L2 — a small one.
- **Docker Desktop is 4.88.1**, comfortably past the 4.60 threshold at which
  sandboxes run in dedicated microVMs rather than plain containers. So the
  L1-vs-L2 distinction has a real mechanism available on this machine.

### 1a-ter. Docker plugins already present that bear on this design

`docker --help` lists, among others:

| Plugin | Why it matters here |
|---|---|
| `pass` | **Docker Pass Secrets Manager (beta)** — cross-check against the secrets research before inventing our own. |
| `dhi` | **Docker Hardened Images** — directly relevant to what "hardened container" means at L1. |
| `agent`, `mcp`, `model` | Docker's own agent-runner surface; relevant to the agent threat model. |
| `offload`, `buildx`, `compose` | build/run plumbing. |

### 1a-quater. Open perf question — the VM is not using Apple's Virtualization framework

`settings-store.json` reports `UseVirtualizationFramework: False` (and
`UseVirtualizationFrameworkRosetta: False`) on an Apple M4. This matters because
**VirtioFS — the fast bind-mount path — requires the Apple Virtualization
framework**. On the older sharing backend, bind mounts are markedly slower.

Given projects live on an external SSD and would be bind-mounted into containers,
this is a live performance question, not a footnote. Verify what backend is actually
in force and whether enabling VZ + VirtioFS is safe here, **before** concluding that
the named-volume clone pattern (§2b) is required — it may be a workaround for a
setting we can simply turn on.

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

But a named volume lives inside `Docker.raw` — which §1a now shows is on `business_ssd`, not the boot disk —
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

---

## 3. The finding that outranks the rest — the sandbox is already here, and it is switched off

dsh ships a complete process sandbox. It is mounted, it is running, and **one line
disables it**. I verified every step of this myself rather than relaying it.

```
~/.arxa/dsh/settings.yaml:37-38
  permission:
    defaultPreset: danger-full-access      <-- LIVE, right now
```

Verified chain, each read directly:

| # | Claim | Evidence |
|---|---|---|
| 1 | The setting is live | `~/.arxa/dsh/settings.yaml:38` |
| 2 | The sandbox stack is mounted | `dsh-base/cordis.patch.yml:169-185` — `dsh-sandbox-local`, `dsh-sandbox-policy`, `dsh-bash-sandbox`, `dsh-pwsh-sandbox`; presets at `:198-204` map `read-only` / `workspace-write` / `danger-full-access` |
| 3 | The preset really sets sandbox mode (not just the prompt) | `dsh-permission-presets/lib/index.js` `pinInitialPermission()` → `setSandboxMode(session, spec.sandbox)` |
| 4 | That mode skips confinement entirely | `dsh-bash-sandbox/lib/index.js:146` — `if (mode === "danger-full-access") return {... denied: false}`, returns before the wrap |
| 5 | The profile covers writes only | `dsh-sandbox-local/lib/index.js:68-69` — `(allow default)` `(deny file-write*)` |

**What this means today.** The agent runs as the engine user with no filesystem
confinement, on a machine holding several clients' code. Nothing prevents a session
for project A writing to project B, to the org's `account/` dir, or to another org
entirely. That is not a gap in the design — the mechanism exists and is disabled.

**The cheapest possible fix is one line.** Because the policy's writable root
resolves from `session.header.cwd`, and that cwd is the session worktree, changing
`danger-full-access` → `workspace-write` yields a Seatbelt-enforced per-worktree
write boundary with **zero code**.

**What the flip does NOT give**, and why Docker is still needed for a real L2:
row 5 is the whole profile. `(allow default)` means **reads and network egress are
unrestricted in every mode**. Cross-project *reads* stay open, and an agent can still
exfiltrate. Egress is not expressible in this seam at all.

**There is no agent child process to containerise.** `agents.create()`
(`plugins/arxa-sidebar/lib/index.js:152`) runs in-process in the engine; the worktree
is a `meta.cwd` annotation. Confinement is per tool call. So L1 attaches as a
`SandboxProvider` swap at one profile row, not as a process wrapper.

## 4. Tier definitions, settled by research

**The L1→L2 delta that matters for our threat is network egress, not kernel
isolation.** On macOS this is the decisive correction: Docker Desktop already runs
containers in a Linux VM, so an L1 escape lands in that VM rather than on macOS —
which narrows the host-compromise gap — but that VM has ordinary network access, so
it does nothing for exfiltration.

**Ruled out on Apple Silicon:** gVisor (Linux 5.6+), Kata (nested virt/bare metal),
Firecracker (Linux + `/dev/kvm`) — all Linux-host/KVM technologies. Enhanced
Container Isolation (Sysbox) is Docker Business subscription only, so it cannot be a
default tier.

### L1 — hardened container
`--read-only` + tmpfs for writable paths · `--cap-drop=ALL` ·
`--security-opt=no-new-privileges` · non-root `USER` · **keep the default seccomp
profile** (Docker's own advice) · cpu/mem/pids limits · bind-mount **only** the
project · never mount `docker.sock` · an explicit network decision.
Stops: careless host-filesystem damage, in-container privesc.
Does not stop: egress, or full RW on whatever was mounted.

### L2 — Docker Sandboxes (`sbx`), created with `--clone`
Own Linux kernel per sandbox, own private Docker daemon, own isolated network,
**default-deny outbound TCP with UDP/ICMP blocked**, policy-enforcing internal DNS,
and host-side credential injection so raw secrets never enter the VM.
Free including commercial use; macOS Sonoma 14+ / Apple Silicon.
Installs via `brew install docker/tap/sbx` and needs neither Docker Desktop nor
Engine — **so L1 and L2 are independent installs, not an upgrade path.**

> ⚠️ **`--clone` is non-negotiable and is the trap.** The default workspace mount is
> a direct **read-write** mount of the working tree — the agent can edit hidden
> files, configs, build scripts and git hooks. The microVM does not protect client
> source. `--clone` (read-only source + private clone) fixes it, but must be set at
> sandbox **creation** and has no global default. Adopt "level 2" without it and you
> silently get the weaker posture.

Two documented holes to know: the shared agent-skills store is read-write across
sandboxes by default (`--no-share-skills` opts out), and local stdio MCP servers run
**on the host**, outside the VM.

**Status on this machine:** `sbx` and `cagent` are ABSENT. Docker Desktop is 4.88.1,
past the 4.60 gate where sandboxes run in dedicated microVMs.

## 5. CI — the constraint that reshapes the design

**`container:` and `services:` require a Linux runner. Confirmed, stated three times
in current GitHub docs.** Not available on our self-hosted macOS runner.

It is wider than it looks: the same note covers **Docker container actions**, so
`uses: docker://...` and any action whose `action.yml` says `runs: using: docker` are
also unavailable — that constrains *every* workflow arxa generates, not just
isolation.

| Level | How the gate runs |
|---|---|
| **L0** | today — `sh check.sh` directly on the macOS runner |
| **L1** | a plain `run:` step: `docker run --rm -v "$PWD":/w -w /w <dev-image@sha256:...> ./check.sh`. Same image as dev, so *local green = CI green* holds. Pin by digest. Never mount `docker.sock`, never `--privileged`. |
| **L2** | move the runner agent **inside** the Linux VM; `container:`/`services:` then become legal natively and the macOS constraint dissolves. Consequence: **`runs-on` labels must differ per level** — wrong labels leave the job queued and GitHub fails it after 24 h (which is exactly the D109 asleep-trap). |

**Socket framing, corrected for macOS:** the Linux "socket == host root" line does not
transfer cleanly. Docker Desktop runs a Linux VM, so the socket is root *in that VM*;
the reach to the Mac is via Docker Desktop file sharing — a socket holder can
bind-mount any shared path. Still game-over on a solo machine; treat it as such.

**Ephemeral runners** buy process freshness, not a clean environment, on one Mac —
overhead at L0/L1, worthwhile only at L2 with a fresh VM per job. ARC is
Kubernetes-only, N/A.

**Two flagged risks:** macOS ARM64 self-hosted is documented as **public preview, not
GA** — exactly our platform. And since arxa ships this workflow into *every* repo it
creates, GitHub's "self-hosted runners should almost never be used for public
repositories" becomes a **distribution-level** concern, not a personal one. This is
the same finding as the CI/CD plan's fork-guard item, arriving from a second
direction — make the generated workflow visibility-aware, and never emit
`pull_request_target` / `workflow_run`.

**Unverified, do not build on it:** `devcontainers/ci` on a macOS runner is
plausible (JS action, CLI installs on macOS arm64) but no doc states a runner-OS
matrix and every example uses `ubuntu-latest`.

## 6. The structural collision — worktrees vs containers

**`git worktree` checkouts are not self-contained.** A worktree's `.git` is a pointer
file into `<repo>/.git/worktrees/<id>`. The session registry and the
`refs/arxa/session-base/<id>` squash base also live in the shared common git dir.

**So containerising one project forces mounting the whole parent repo — which
re-exposes every sibling project and the org's `account/` dir. The isolation is spent
on the mount.** Stage-boundary merges also need the primary worktree, for git's own
lock to serialise concurrent sessions.

This collides directly with D110 (projects stay gitignored inside the org repo) and
must be resolved before L1 is built. It is the single hardest problem in this plan.

## 7. Secrets — recommended design

Root of trust is local; nothing depends on any hosted service.

- **Keychain holds one age key per project.** arxa already has this exact pattern:
  `plugins/github-link/lib/keyring.js` uses `/usr/bin/security` via `execFile`
  (never a shell string). Reuse it — service `arxa-studio`, account
  `secret-key:<org>/<slug>`.
- **Each project commits `.env.sops`**, SOPS-encrypted with that project's age key.
  Safe to commit: the ciphertext is what ships, and only the local Keychain key opens
  it. This is what makes "self-contained `.env` per project" actually work.
- **L0/L1:** decrypt host-side, inject into **only the one spawned command** — never
  into the engine's or the agent's ambient env.
- **L2:** decrypt host-side, pass as a Compose **file-based secret**
  (`secrets: file:`) mounted at `/run/secrets/<name>` — **not** `-e` / `--env-file`,
  so `docker inspect` never shows it. Works without Swarm.
- **CI:** the self-hosted runner on the same Mac decrypts identically — **zero secrets
  ever pushed to GitHub.**

**Ranked failure modes:** plaintext `.env` committed (why GitHub built push
protection) · `docker inspect` exposes any `-e`/`--env-file` value in plain text
(Docker's own compose docs warn of this) · every forked process inherits env vars ·
secrets leaking into crash reports · **on a self-hosted runner, secrets passed as
command-line args are visible to other jobs via `ps x -w`** — GitHub says so
explicitly, and "destroy after each job" is not a fix.

**Forbid explicitly:** plaintext `.env` in git; secrets via `-e` / `--env-file` /
`--build-arg`; decrypted values in ambient env beyond one command; shell-string
`security` calls; "destroy after job" as a boundary; any dependency on the Arxa
Digital Solutions Supabase project.

## 8. Database — per-project, local-first

| Level | Shape |
|---|---|
| **L0** | no database — local file / SQLite. **The mandatory floor for everyone.** |
| **L1** | `supabase init` + `supabase start` **inside each project's folder** — a real Postgres + Auth + Storage + Realtime + Edge Functions stack in Docker, separate per project (own containers, own volume, own `project_id`). The CLI supports several at once (`supabase stop --project-id` / `--all`). **Default ports collide (54321-54324), so arxa must auto-assign a distinct port block per project at scaffold.** |
| **L2** | the **user's own** hosted Supabase project via `supabase link` — never the vendor's. One account holding several arxa projects → schema-per-project plus RLS keyed on a claim in **`app_metadata`** (never `user_metadata`, which is user-editable and unsafe for auth). Sync via `db diff` / `db reset` / `db push`. |

**Keys, current state:** two systems run in parallel — new `sb_publishable_…` /
`sb_secret_…`, and legacy `anon` / `service_role` JWTs (legacy dies end of 2026;
creating new keys does not revoke old ones). Publishable/anon are safe client-side;
secret/service_role are server-only and bypass row security. Scaffolded code should
target the new names.

**No official RAM figure exists for `supabase start`.** The nearest official number is
the *self-hosted production* stack: 4 GB / 2 CPU / 40 GB minimum. Treat as a ceiling.
Against §1b's 8.3 GB VM allocation, **one stack at a time remains the design
assumption.**

**Vendor-database rule — four things to never do:** bake a project ref/URL/key into a
scaffolded template; silently host client projects as schemas inside the ADS Supabase
project; make a shipped project depend on branching (billed to the vendor's account);
or use this session's `mcp__supabase__*` tools — wired to the ADS instance — to
provision anything for an end user.
