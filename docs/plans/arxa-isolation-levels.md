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

---

## 9. Measured myself: Seatbelt already does most of L1 — including egress

Tested directly with `sandbox-exec` on this machine, not researched. This reframes
the ladder, so the evidence is recorded in full.

### 9a. The current profile, read from source

`dsh-sandbox-local/lib/index.js` `seatbeltProfileArgs()` emits exactly:

```
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (literal "/dev/null"))
(allow file-write* (subpath "<workspaceRoot>") ...)
```

Well-formed and minimal. Note what is **absent**: no `deny file-read*`, no
`deny network*`. That is why reads and egress are open in every mode — not a
limitation of Seatbelt, **a limitation of this profile**.

### 9b. Both missing controls work. Measured.

Baseline (current profile) — the vulnerability, confirmed:

```
read sibling secret : SECRET-FROM-B          <- reads straight through
write to sibling    : Operation not permitted <- writes already blocked
```

Candidate profile adding a scoped read-deny and re-allowing the worktree:

```
(deny file-read*  (subpath "<orgRoot>"))
(allow file-read* (subpath "<worktree>"))
```

Result — **cross-project isolation with no container at all**:

| Check | Result |
|---|---|
| read sibling secret | **Operation not permitted** |
| list sibling dir | **Operation not permitted** |
| write to sibling | **Operation not permitted** |
| read own worktree | ok |
| write own worktree | `WROTE-OK` |
| `git --version` | 2.51.0 |
| `node -e …` | ok |
| **`git add` + `git commit`** | **`COMMIT-OK`** ← sessions still commit |

Adding `(deny network*)` on top:

```
network with profile A : 200
network with profile B : 000  BLOCKED
```

**Egress denial works in Seatbelt.** The earlier conclusion that "network is not
expressible in the current seam" is true of the *profile as written*, not of the
mechanism. This matters because the tier research concluded egress — not kernel
isolation — is the real L1→L2 delta on macOS.

### 9c. One real breakage found: Flutter writes into its own SDK

```
dart --version -> /Volumes/developer_ssd/dev/fvm/versions/stable/bin/
                  internal/update_engine_version.sh: cache/engine.stamp.tmp.NNNNN:
                  Operation not permitted
```

The `dart`/`flutter` wrapper writes to its **own SDK cache** outside the worktree.
Not a security problem — a writable-roots omission. Any profile must add the fvm/
Flutter SDK cache as a writable root. `git` and `node` need nothing beyond
`/dev/null`, which dsh already grants.

Worth flagging generally: **toolchains that self-update will fight a write-deny
profile**, and Flutter is the one arxa actually ships. Find these per toolchain
rather than assuming.

### 9d. Consequence for the ladder

A large fraction of L1's value is reachable **without Docker at all** — no image
builds, no bind-mount performance question, and critically **no collision with the
worktree/common-git-dir problem in §6**, because nothing is being mounted anywhere.

This does not remove the case for containers. Seatbelt gives **no** kernel
isolation, no reproducible toolchain, no dependency hermeticity, and dsh applies it
**per tool call**, not to a whole process tree. But it changes what each tier is
*for*, and it means the cheapest rung is far stronger than assumed.

**Proposed re-cut, to be settled in the grill:**

| Tier | Mechanism | Buys |
|---|---|---|
| **L0** | today: `danger-full-access` | nothing |
| **L0.5** | preset → `workspace-write` | per-worktree **write** boundary. One line, zero code. |
| **L1** | extend the profile: scoped read-deny + writable-roots fix | **cross-project read isolation** — measured working |
| **L1.5** | add `(deny network*)` or an allowlist | **egress control** — measured working |
| **L2** | hardened Docker container | reproducible toolchain, dependency hermeticity, process-tree confinement |
| **L3** | `sbx` microVM + `--clone` | separate kernel, default-deny egress, read-only source |
| **L4** | *pending research* | see §10 |

**Caveat, stated plainly:** `sandbox-exec` is deprecated by Apple, though present and
functional (`/usr/bin/sandbox-exec`, dated Aug 13). arxa's exposure does not change —
dsh already depends on it — but a tier built on it inherits that risk.

---

## 10. arxa (Dart) — audited: no sandbox of any kind

Exhaustive sweep of the Dart repo. No seccomp, AppArmor, Seatbelt, chroot,
namespaces, cgroups, capability dropping, user separation, or egress control. One
grep hit, a false positive (the string `over_cap_dropped` in an archived plan). The
only Docker present is `deploy/remote` (headscale + Caddy VPS) and a test Postgres —
neither is isolation.

**Note a terminology trap:** "isolation" in arxa's docs means *install* isolation —
not executing the operator's dsh binary — **not** sandboxing. Searching the docs for
the word will mislead.

### What exists and is worth preserving

- **Tauri v2 capability scoping** — `desktop/src-tauri/capabilities/default.json`
  allows exactly two sidecars; `remote-studio.json` denies shell/sidecar to remote
  origins. Constrains the webview, not the engine.
- **`gateway.dart`** — loopback LLM gateway with per-consumer scoped tokens; raw
  provider keys never leave the daemon. **This is the only real capability boundary
  in the engine, and it is the precedent to copy for everything else.**
- **Secrets at rest are genuinely good** — macOS Keychain plus XChaCha20-Poly1305
  sealed files, failing closed rather than writing plaintext.

### Attack paths, ranked

1. **Generated code runs unconfined with every secret in scope.** Two sites execute
   agent-generated code by design: `gate_tests.dart:287` (runs generated test suites)
   and `emit_htmx.dart:269` (runs a generated `server.js`). **Zero
   `includeParentEnvironment` hits codebase-wide**, so every child inherits the full
   parent environment — `~/.ssh`, `~/.aws`, other projects, every provider key.
2. **One global credential namespace.** `vault.dart:61` hardcodes `service: 'arxa'`;
   `credentials.dart:43-45` has no project dimension. **Project A's stage can read
   project B's keys.** Clearest business impact for an agency on one machine.
3. **`arxa-guard.js` defaults to allow-all** (line 39, mode `dev`), fails open on bad
   input, and ignores everything outside the arxa checkout. The docs call it "the ONE
   per-tool-call policy"; the code says otherwise, and its documented escape hatch is
   already known-broken (`docs/guard-findings-2026-08-26.md` F2).
4. **No enforced project boundary** — `project.dart` is string concatenation and
   `$ARXA_HOME` repoints it. One enforced check exists, at `design_server.dart:1221`,
   guarding a single HTTP handler.
5. **Shared npx cache slot** — arxa's own docs measured 1039 symlinks from both
   `~/.dsh` and `~/.arxa` profile trees into ONE `_npx` slot; the version pin "has
   never once been honoured."

### Where to spend the effort — and the ordering matters

`process.dart`'s `ProcessRunner` seam is the right chokepoint **and already exists**,
but **23 files bypass it**, including the generated-code sites. **Step 1 is finishing
the seam, not adding a sandbox** — once every spawn goes through it, a
`SandboxedProcessRunner` is a drop-in with zero caller changes.

Then: `gate_runner.dart` (one dispatch = a per-gate boundary), `project.dart`'s path
resolvers (already the natural per-project mount root), and `vault.dart`'s `service`
field → `arxa:<project>`. **`CredentialStore` already takes a `keyPrefix` parameter
that nothing ever populates** — the credential half is close to free.

**One-line supply-chain fix found:** `design_tools.dart:1486` is a bare unpinned
`npx esbuild`, twelve hundred lines above `_esbuildCmd()` (`:1800-1807`) which exists
precisely to prevent that and is used correctly at both eject sites.

## 11. Agent-sandboxing research — and one correction in arxa's favour

### Threat ranking (solo agency, client work, one Mac)

The top two involve **no attacker at all**:

1. Agent runs a destructive command or writes wrong code — base rate, highest likelihood.
2. **Cross-client contamination** — agent on Client A reads Client B's source and `.env`. No adversary needed; a contractual problem, not merely technical.
3. Indirect prompt injection via repo, dependency or fetched page.
4. Secret exfiltration — requires #3 to land first.
5. Supply-chain package install script running as your user.
6. Sandbox escape — real, but requires a targeting adversary.

### What converged across Anthropic, OpenAI and Docker

Deny-by-default egress through a **host-side** allowlisting proxy · capability
boundary kept **separate** from approval policy (nobody ships an on/off switch) ·
macOS Seatbelt as the shared substrate, with containers as the *next* rung rather
than the first · credentials injected out-of-band so the agent never sees raw values ·
and every vendor publishing what their isolation does **not** stop.

Docker chose **microVM-per-session, not container-per-session**, explicitly because
containers share the host kernel.

### ✅ Correction — the "tool-shaped gap" does NOT apply to arxa

The research flagged that Claude Code's Bash sandbox restricts only Bash and its
children, leaving file tools, MCP servers and hooks on the host — and argued that if
arxa's agent edits via file tools, L1 would constrain far less than it appears.

**Verified false for dsh.** `dsh-fs-sandbox` ships `SandboxedFileSystem.checkedTarget()`,
a second, in-process fence on the file tools themselves:

- `danger-full-access` → returns the target unfenced (today's state)
- `workspace-write` → the resolved path must be contained under a writable root, else `FS_SANDBOX_DENIED`
- `read-only` → refuses outright

It is also **TOCTOU-hardened**: it re-canonicalizes at check time, realpath'ing the
deepest existing ancestor so a concurrently swapped symlink is reflected, and returns
*that* fresh target. Good engineering.

So arxa fences **both** Bash and the file tools. The gap is not tool-shaped — it is
that both fences are switched off by one preset, and that **neither covers reads or
egress**. That is precisely what §9 measured and can fix.

### What NEITHER level stops — state this in the UI, do not oversell

- Injection-authored bad code getting committed. **Review is the control; a container is the wrong tool.**
- Agent-written `.github/workflows`, `Makefile`, `package.json` scripts.
- **Exfiltration through an allowed domain** such as `github.com`.
- Anything sent to the model provider.
- Egress allowlists police **subprocesses, not the agent's own tool calls** (WebFetch, MCP, web search, model requests). Both Anthropic and OpenAI state this explicitly.

### A rung where L1 beats a naive L2

Claude Code hard-protects `.git/hooks`, `.git/config`, `.vscode`, `.idea`, `.zshrc`
and `.gitconfig` **inside** the working directory, unexemptable by any allow rule.
Docker documents that a plain workspace mount does **not** stop an agent writing a git
hook the host later executes. **An L2 that fails to reproduce that protected list is
a regression against L1.** Carry the list forward explicitly.

---

## 12. L3/L4 candidate — remote execution. Verdict: only the self-hosted form survives.

### Both vendor options are disqualified, and not primarily on price

**Docker Offload — no longer free, and the plugin's presence is misleading.**
`docker offload` appears in this machine's plugin list, but as of GA (Apr 2026) it is
a **paid add-on to Docker Business (~$24/user/month), sold only through Docker
sales** — no self-serve price, no free tier. The "300 free GPU minutes" figure that
circulates was a mid-2025 beta promotion and is gone.

**GitHub Codespaces — free tier is real but thin.** GitHub Free (personal) gives
15 GB-month storage and 120 core-hours/month — roughly 60 real hours on a 2-core
box. An always-on agent loop burns that in days.

**The disqualifier is data residency, not cost.** Both ship **client source code to a
third party to be executed**, not merely stored. For agency work under NDA/MSA,
"client source processed on a named third-party vendor" is typically exactly the
clause that blocks it — and it is a per-client contractual question a solo shop
cannot waive unilaterally. **This rules them out even if they were free.**

### Self-hosted remote — the one that works, and it is genuinely free

`DOCKER_HOST=ssh://user@host` (or a Docker context) pointed at a spare machine or a
genuine free-tier VM. Docker's context/SSH tooling costs nothing. You provision and
control the box, so no third party is *processing* the code — the contract problem
disappears.

**Ergonomics: naive setup is slow, and the fix is configuration, not architecture.**
Roughly 3–4 s per docker command without connection reuse; `docker context ls` on a
remote SSH context takes ~2.5 s versus ~0.026 s for the local default, because it
probes the endpoint. Fix with SSH connection multiplexing in `~/.ssh/config`:

```
Host <remote>
  ControlMaster auto
  ControlPath ~/.ssh/cm-%C      # %C hashes host/port/user — avoids macOS path-length limits
  ControlPersist 600
```

Verify by opening a second terminal and SSH-ing to the same host: it should connect
without re-authenticating. Tuned, it is close to native.

**Gotchas worth writing down now:**
- **Keys + ssh-agent only.** Password auth is not supported by Docker and is not possible with a `DOCKER_HOST` configuration.
- **Pre-populate `known_hosts`** — connect once manually and approve the key.
- **Host aliases are not universally honoured.** The plain `docker` CLI respects `~/.ssh/config` aliases, but some tooling requires `ssh://user@host:port` to be a globally resolvable DNS name or IP.
- **Known connection leak** — the local client can open a new connection every 15 minutes without closing it, spawning a process on the remote each time. Check with `pgrep -c sshd` on the remote if memory creeps.
- **Use Compose v2.** Compose v1 had a pathological bug: `docker-compose up` on a single-service file taking 5+ minutes on macOS against a remote host that responded in seconds from Linux. v2 shares the CLI's `commandconn` path.

### What physical separation actually buys over L2

Removes shared-hardware exposure: no side-channel risk, no shared-hypervisor blast
radius, and independence from the Mac's own security state. It protects **the
developer's machine and the other clients' projects not loaded onto that box.**

**It does not protect the current client's own code and secrets in that session.** A
compromised agent on the remote box can still exfiltrate that client's IP unless
egress is locked down exactly as L2 locks it down. **Remote is additive to egress
control, not a substitute for it.**

### A local-VM-as-Docker-host variant is NOT a new tier

Running a second local VM as the Docker host (free, no residency question) buys
**organizational containment** — a daemon crash or compromise stays in the VM — but
it is the same silicon as the host, so none of the physical-separation benefit above
applies. **Record it as a restructuring of L2, not as L3.**

### Consequence for the tier ladder

"Remote" is a real tier only in its self-hosted form, and its value is narrow and
specific: it protects *everything except the project it is currently running*.
Given the §11 threat ranking — where the top two risks are the agent doing something
wrong and cross-client contamination — **self-hosted remote addresses risk #2 well
and risk #1 not at all.** Price it accordingly when the tiers are finalised.
