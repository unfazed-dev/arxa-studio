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

### 1a-quater. RETRACTED — `UseVirtualizationFramework: False` is a performance setting, not a security one

An earlier note here treated this as an open security/performance question and
suggested checking whether enabling VZ + VirtioFS was safe. **That was a misreading.**

The flag selects **Docker VMM** — Docker Desktop's own hypervisor — for Docker
Desktop's own Linux VM. It is a performance choice, and it is **orthogonal** to
`sbx`, `apple/container`, Lima and UTM, all of which drive Apple's Virtualization
framework directly regardless of this setting. Virtualization is not "off".
**Do not flip it** on security grounds.

The bind-mount performance question in §2b remains open on its own merits, but it is
a Docker Desktop file-sharing question, not this flag.

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

### 12a. Offline dependency mirrors — the Dart half is the weak one

Air-gapping (`--network=none` during the agent's edit loop) only works if dependency
resolution can be satisfied locally. arxa's two targets differ sharply here.

**npm / `website/` — solved.** Verdaccio is the standard free self-hosted proxy
registry; `npm ci` against a committed lockfile is already the right default.

**Dart / `application/` — no first-party answer.** `dart pub` supports third-party
repositories via a `hosted-url`, overridden with the **`PUB_HOSTED_URL`** environment
variable — Dart's docs name mirroring pub.dev "in a restricted network environment"
as the intended use case. But **there is no official pub.dev mirror server**; a
standing feature request asks for a Verdaccio equivalent and none exists. Third-party
options, all free:

| Option | Shape | Fit for air-gapping |
|---|---|---|
| [`tuna/pub-mirror`](https://github.com/tuna/pub-mirror) | multi-threaded downloader; static output | ❌ **ARCHIVED** — verified via GitHub API: `archived=true`, last push **2022-10-25**, 16 stars. Do not adopt. |
| [`unpub`](https://github.com/bytedance/unpub) | MongoDB-backed private host, community standard | heavier; aimed at publishing private packages |
| [`ricardoboss/PubNet`](https://github.com/ricardoboss/PubNet) | self-hosted host with upstream fallback to `pub.dev/api/` | ⚠️ **reads are authenticated too**, not just publishing — friction for a build cache |
| [pub-dev itself](https://github.com/dart-lang/pub-dev) | the real site's source, open | explicitly *not* designed for private hosting |

JFrog Artifactory supports Dart repositories but is commercial — out of scope.

**CORRECTED — there is no healthy free pub mirror.** Verified via the GitHub API:
`tuna/pub-mirror` is **archived** (last push 2022-10-25); `unpub` is dormant;
`ricardoboss/PubNet` is alive (pushed 2026-08-29, Apache-2.0) but small at 48 stars
**and authenticates reads**, not just publishes. By contrast Verdaccio for npm is
17.8k stars, MIT, pushed today. **The Dart answer is a warm `PUB_CACHE`, not a mirror
server.** An earlier note in this file recommending `tuna/pub-mirror` was wrong and
is retracted.

**Consequence:** an air-gapped tier is credible for `website/` today and rests on
cache warming for `application/`. Record as a prerequisite for any
tier that denies egress during dependency resolution — the `(deny network*)` profile
measured in §9b blocks `dart pub get` outright, so the network split must be
**allow during install, deny during the edit loop**, not a blanket deny.

---

## 13. The egress ladder — and its hard ceiling

| Rung | Mechanism | Stops |
|---|---|---|
| 0 | unrestricted | nothing |
| 1 | **log-only** (`sbx policy log`, incl. `--json`) | nothing — but tells you what normal looks like. Records allowed *and* blocked hosts with the matching rule. |
| 2 | default-deny + coarse hostname allowlist | naive exfil, reverse shells, DNS tunnelling. **Where L2 already sits.** |
| 3 | minimal allowlist, per-sandbox (`--sandbox` scoping, effective immediately) | most of the above, scoped per project |
| 4a | **SNI filtering** (Squid peek/splice) — terminate on SNI mismatch, no TLS break | IP-literal and shared-CDN holes |
| 4b | **MITM + private CA** (mitmproxy) | the only rung that can say "GET yes, POST no" on an allowed host |
| 5 | **phase split** — no network in the edit loop, network only during dependency install | agent-initiated fetches mid-edit |
| 6 | air-gapped build with warm caches / local mirrors | resolution-time supply chain |
| 7 | `--network=none` | **the only rung whose guarantee does not depend on software being correct** |

### ⚠️ The ceiling: rung 7 is unreachable for an agent edit loop

Docker's own docs state the Locked Down preset blocks **model provider APIs**,
including `api.anthropic.com`. An agent that cannot reach its model cannot run. So
"air-gapped edit loop" actually means **"exactly one allowed hostname" — and that
hostname is itself an exfiltration path.**

**This is the ceiling on the entire ladder, and it should be stated in the UI.** No
egress tier can claim to prevent exfiltration by an agent that can still talk to its
own model.

### Two limits that change the tier maths

- **`sbx` rules cannot express repo-level or read-vs-write granularity.** Rules are
  hostname / CIDR / port with action `connect:tcp`. Allowing `github.com:443` so
  `git pull` works **also allows `git push` to any repo**. Only rung 4b closes this —
  and that means running a private CA.
- **Credentials never enter the VM.** The host proxy injects auth headers, so the
  agent cannot read raw values. **For the credential half of the threat model, L2
  already sits above plain allowlisting.** Source-code exfiltration is the hard half,
  and it is the one the ceiling above applies to.

### The phase split — adopt, with two corrections

The idea in §12a is sound: both toolchains have frozen-install modes and relocatable
caches, and it converts "the agent added a dependency" into a **reviewable lockfile
diff**. Corrections: (1) under `sbx` this is **policy toggling**, not
`--network=none`; (2) the edit loop still needs the model API, per the ceiling.

### Offline specifics per toolchain

- **npm — clean.** `npm ci --offline`. **Not `--prefer-offline`, which still reaches
  out.** Verdaccio (MIT, active) if a mirror is wanted.
- **Dart — `dart pub get --offline` + committed `pubspec.lock` + warm `PUB_CACHE`.**
  Documented trap: **offline resolution silently pins stale versions if the cache is
  old** — a correctness risk, not just a convenience one.
- **Flutter needs more than pub.** Engine artifacts are separate
  (`FLUTTER_STORAGE_BASE_URL`, `flutter precache`); Gradle needs `--offline` with a
  warm `~/.gradle/caches/modules-2`; **CocoaPods is the weak link for iOS.**

### macOS host layer

**The built-in Application Firewall is inbound-only** — Apple's documentation
describes it purely in terms of incoming connections. That is why Little Snitch
exists (and Little Snitch is paid). **`pf` is the free outbound answer**: scriptable
via named anchors, and it logs UID + PID to `pflog0`. Granularity is **IP/CIDR/port
only, never domains**, so treat it as a coarse backstop and an audit log, never as
the primary allowlist. OpenSnitch is Linux-only.

### Two default-on settings to flip for client work

- **Workspace is a read-write direct mount by default.** A poisoned git hook or
  `postinstall` runs on *your host* later. `--clone` is opt-in. (Same finding as §4,
  arriving independently.)
- **The shared skills store is read-write across sandboxes by default.** One session
  can plant instructions another client's session later loads. `--no-share-skills`
  opts out. **This is a cross-client contamination path that has nothing to do with
  the filesystem mount** — threat #2 in the §11 ranking, via a route neither the
  Seatbelt work nor the mount design covers.

### Recommended landing point

Rung **3** for the agent loop — plus `--clone`, `--no-share-skills`, and **logging
always on**. Rung **7** for a separate, *agent-free* build/test container. An
explicit, supervised install phase between them. Escalate to 4b only if pull-vs-push
granularity matters more than the cost of running a private CA.

### Open empirical question — settle before committing

**Does `flutter build` actually complete at rung 7 with warm caches?** The Gradle
path is documented-supported and CocoaPods is flagged as the weak link, but this was
inferred from docs, not tested. **Proof-of-concept required** — it is the difference
between the agent-free build container being real or theoretical.

---

## 14. L3 via full VMs — verdict: it collapses into L2, and DIY is a regression

Researched against `apple/container`, Lima, Colima, UTM and Apple's Virtualization
framework. **There is no meaningful isolation tier above L2 on this hardware.**

### Why

**Every candidate rides the same Virtualization.framework that `sbx` already uses.**
A VM around a VM is not a higher boundary. For cross-project access and host damage
the gain is **zero** — L2 is already at the hypervisor boundary.

### Worse: a DIY full VM is a REGRESSION on the one axis that matters

Egress is the discriminator (§13), and the DIY options are weaker on it:

| Option | Egress posture |
|---|---|
| **`sbx`** | **default-deny all outbound TCP; UDP/ICMP blocked at the network layer; policy enforced HOST-side, outside the agent's reach** |
| `apple/container` | every container gets a **routable vmnet IP**. Its only isolation primitive is network-to-network — "a container on one network has no connectivity to containers on other networks". No allowlist, no deny-by-default, no policy DNS. |
| Lima / Colima / UTM | NAT with **full outbound** |

To match `sbx` you would build host-side `pf` rules, a policy resolver and a
credential proxy yourself. **In-guest firewalls do not count** — the agent has `sudo`
and `CAP_NET_RAW` inside its own VM and can flush them.

### The one genuine gain is a CI capability, not an isolation tier

A **Lima Ubuntu VM as a self-hosted runner host** makes `container:` and `services:`
jobs legal, dissolving the §5 constraint. **File this under CI, not security.**

Two caveats before building on it:
- **The runner would be ARM64**, and Virtualization.framework cannot run an Intel
  guest on Apple silicon. Every image used in a `container:`/`services:` block needs
  an arm64 variant or it runs emulated. **Check the actual images first.**
- GitHub's docs list "ARM64 — Linux, macOS, Windows (currently in public preview)".
  Whether the preview label covers ARM64 **Linux** is ambiguous. One check needed.

### `apple/container` — track it as a CHEAPER L2, not a tier above

Apache-2.0, v1.3.1 (2026-08-29), requires macOS 26 + Apple silicon — **this box
qualifies**. Free commercially, no subscription tier.

**Its real attraction is memory: ~1 GiB per container VM, versus `sbx`'s 8 GiB
default on this 16 GiB machine.** Blocked today on the missing egress control.
Revisit if Apple ships one.

### ⚠️ Operational finding — `sbx` concurrency will exhaust this machine

**Two `sbx` sandboxes at stock defaults claim 16 GiB — 100 % of this machine's RAM.**
Any concurrent-session design must pass an explicit `-m`. This is a **tuning
requirement for L2**, not an argument for L3, and it compounds §1b's one-Supabase-
stack-at-a-time constraint.

### Licences — all free for commercial use

`apple/container` Apache-2.0 · Lima Apache-2.0 · Colima MIT · UTM Apache-2.0 (the
App Store listing is identical; it funds the project) · Virtualization.framework is
part of macOS · `sbx` free including commercial, with only org governance paid.

### Recommendation

**Keep L0 / L1 / L2. Do not build an L3 from VMs.** Instead **tune L2**: explicit
`-m`, tighter per-project `sbx policy`, and `--clone` with **secrets kept outside the
working tree** — clone mode blocks *modification*, not *inspection*. Separately,
stand up one Lima Ubuntu VM as a CI runner host.

**Rigor caveat:** `sbx` and `container` are not installed here, so the above is
documented behaviour, not measured. No startup-time numbers are asserted because no
vendor publishes them.

---

## 15. L3/L4 as INTEGRITY — orthogonal to confinement, not above it

**The framing answer.** L0–L2 are runtime *confinement*. The threats that survive
them live on a different axis — **what the artifact contains, and what credential the
agent holds**. So L3/L4 is **orthogonal to L0–L2, not additive**. A user could
sensibly run L0 confinement with L4 integrity, or the reverse. Do not present them as
one ladder.

### The top surviving threat is not the one people expect

**The agent's push credential is itself an exfiltration channel.** The Nx
`s1ngularity` malware (CVE-2025-10894) exfiltrated by **committing stolen data to a
repo under the victim's own GitHub account** — legitimate git credentials, no
attacker endpoint anywhere. L2's default-deny egress **must** allow `github.com` for
the agent to open PRs, so **it permits this by construction**.

Two independent agents reached this conclusion by different routes (§11's "exfiltration
through an allowed domain like github.com"). Treat it as established.

Then, in order: **the agent can edit `check.sh` and `.github/**`**; and a dependency
compromise via a lockfile bump the agent makes, which **detonates on the self-hosted
runner where nothing is contained**.

### What is worth building — two items

**1. Lockfile-pinned, script-free installs. ~2–3 hours, once.**
`npm ci --ignore-scripts` with a committed `.npmrc` and a short *named* allowlist for
packages that genuinely need a rebuild · `dart pub get --enforce-lockfile` ·
OSV-Scanner over both lockfiles. **The only item here with a track record**: it blunts
both Shai-Hulud (malicious `postinstall`) and the Nx payload on the runner.

**2. A mechanical diff-policy gate the agent cannot edit. ~4–5 hours, once.**
Forbidden paths (**CI config first**) · `gitleaks` on the diff · lockfile/manifest
coherence.

> ⚠️ **Non-negotiable detail:** CI must run the **base branch's** copy of `check.sh`
> against the PR head. Otherwise the gate is **self-modifying and worth nothing** —
> the agent edits the gate in the same PR the gate is supposed to judge.
> **This directly amends B11/D113 in `git-card-sessions-worktree-rewire.md`:** fixing
> the gate to actually test code is necessary but insufficient if the PR under test
> supplies the gate.

**3. ~30 minutes, nearly free.** A single-repo fine-grained token for the agent · **no
publish tokens in its environment** · Dependabot alerts on (free) · required human
review.

### Explicitly NOT worth doing at solo-agency scale

GitHub artifact attestations (**verified GHEC-only for private repos — unavailable
here**) · npm provenance (we *consume* packages, we do not publish) · cosign/Sigstore ·
chasing a SLSA level · SBOM generation · a second scanner alongside OSV-Scanner ·
**prompt-injection guardrail products** — the ~95 %-detection problem makes them
*actively harmful* because they substitute for review · dual-LLM / CaMeL
architectures (real research, but they remove the generality that makes a coding
agent useful).

### The paid line item — and it confirms the other plan

**Required reviews on a private repo need GitHub Pro**, verified under *both*
mechanisms — classic protected branches and current rulesets are gated identically.
This is the same wall the CI/CD plan hit empirically (§ "branch protection 403s on
every private repo on this account"). **Two independent routes, same conclusion.**
It is a personal-plan upgrade, not an enterprise one.

### The uncomfortable part — say this in the UI

The two recommended items **do not address prompt injection reaching committed code,
nor subtly-wrong-but-not-malicious code** — and those are the two *highest-frequency*
risks. **Nothing free does.** The literature (OWASP LLM01, Willison, the ETH/IBM
design-patterns work) is consistent that injection is unsolved and that guardrails
are a failing grade.

**The only control is a human reading the diff, and it degrades with diff size.**

So the highest-leverage decision in this entire document is **not a tool**:

- small agent PRs
- dependency bumps in their own PR
- never merge a diff you did not read

**This independently validates D112** (always show diff size; warn past ~400
reviewable lines) from the CI/CD grill — arrived at from the security side rather
than the review-throughput side.

---

## 16. The consolidated model — two axes, not one ladder

### Axis A — confinement (how contained the agent's process is)

| Tier | Mechanism | Cost | Buys |
|---|---|---|---|
| **A0** | today: `danger-full-access` | — | nothing |
| **A1** | preset → `workspace-write` | **one line** | per-worktree **write** boundary (Bash *and* file tools) |
| **A2** | + scoped read-deny in the Seatbelt profile | small | **cross-project read isolation** — measured working |
| **A3** | + `(deny network*)` or an allowlist | small | egress control — measured working |
| **A4** | hardened Docker container | medium | reproducible toolchain, hermetic deps, process-tree confinement |
| **A5** | `sbx` microVM + `--clone` + `--no-share-skills` | medium | separate kernel, host-side default-deny egress, credentials never enter the VM |
| — | *full VMs, remote vendor services* | — | **rejected**: L3-by-VM collapses into A5 and regresses on egress; vendor remote fails data residency |

**Ceiling on A3–A5:** an agent must reach its model, so "air-gapped agent" means one
allowed hostname which is itself an exfil path. **No confinement tier prevents
exfiltration.** State this plainly rather than implying otherwise.

### Axis B — integrity (what the artifact contains, what credential is held)

| Tier | Mechanism | Cost |
|---|---|---|
| **B0** | today: none | — |
| **B1** | `npm ci --ignore-scripts` · `dart pub get --enforce-lockfile` · OSV-Scanner | ~2–3 h |
| **B2** | diff-policy gate run from the **base branch**: forbidden paths, gitleaks, lockfile coherence | ~4–5 h |
| **B3** | scoped single-repo token, no publish tokens, Dependabot, required review | ~30 min (+ GitHub Pro for required review on private) |

### What this means for the org/project inheritance rule

The user's rule — org picks a level and projects inherit; org picks none and a project
may still choose — **works unchanged on both axes**, but the offer should be **two
choices, not one**. A client under a strict NDA may want A5/B1; an internal tool may
want A1/B2. Collapsing them into a single number would force false pairings.

---

## 17. MEASURED: the preset flip is not free — it breaks Dart/Flutter

Tested with dsh's **exact** `workspace-write` Seatbelt profile, reconstructed from
source, against the real toolchain on this machine.

```
(version 1) (allow default) (deny file-write*)
(allow file-write* (literal "/dev/null"))
(allow file-write* (subpath "<workspaceRoot>") (subpath "/tmp") (subpath "<os.tmpdir()>"))
```

| Command | Result |
|---|---|
| `git --version` | **OK** |
| `node --version` | **OK** |
| `npm --version` | **OK** |
| `dart --version` | **FAIL** |
| `flutter --version` | **FAIL** |
| session workflow: `git init` → write → `add` → `commit` | **SESSION-WORKFLOW-OK** |

**Cause.** Flutter's `bin/internal/update_engine_version.sh` writes
`cache/engine.stamp.tmp.NNNNN` **inside the SDK**, at
`/Volumes/developer_ssd/dev/fvm/versions/stable/bin/cache/` — outside every writable
root. It runs on **every** invocation, so this is not a one-time cache warm that
could be done before confinement.

**And it is not configurable.** `writableRoots(policy)`
(`@deepseek-ai/dsh-sandbox/lib/index.js:154`) returns exactly
`[workspaceRoot, "/tmp", os.tmpdir()]` under `workspace-write`, and `[]` under
`read-only`. **Hardcoded, no extension point, no settings key.**

### Consequence

The flip closes the live cross-project **write** hole and simultaneously **breaks the
`application/` target — one of arxa's two shipped target types.** `website/` (node,
npm) is unaffected. Git is unaffected, so sessions still commit.

**So "one line, zero code" was wrong.** It is one line *plus* a writable-root for the
Flutter SDK, and that requires code, because the seam does not expose one.

### The fix, and it reuses an attach point already identified

Ship an **arxa `SandboxProvider`** that extends the writable roots with the resolved
Flutter/FVM SDK cache, and swap it in at the same single profile row the research
identified for a future Docker provider (`dsh-base/cordis.patch.yml:169-170`). arxa
already overrides bundle rows this way, so the mechanism is proven — only the payload
is new, and it is small.

Two details for whoever builds it:
- **Resolve the SDK path at runtime**, do not hardcode. FVM versions move
  (`fvm/versions/<channel>`), and end users will have their own layout.
- dsh already ships an **escalation** path (`approveEscalation`, `ESCALATION_TARGETS`,
  `escalationHintMarker`) — a denied write surfaces as a model-facing
  `[sandbox: …]` marker with a hint. **Do not rely on it here:** the Flutter write
  happens on every invocation, so escalation would prompt constantly. It is the wrong
  mechanism for a predictable, known-good path.

---

## 18. Decisions

### S1 — Ship an arxa `SandboxProvider`, then flip the preset. Do not flip first.

The live exposure (`danger-full-access`, §3) is closed by a preset change, but §17
measured that the change breaks `dart` and `flutter`. So the order is fixed:

1. Write a small arxa `SandboxProvider` extending the writable roots with the
   **runtime-resolved** Flutter/FVM SDK cache. Never hardcode the path — FVM versions
   move and end users have their own layout.
2. Swap it in at the single cordis profile row arxa already overrides
   (`dsh-base/cordis.patch.yml:169-170`). The override mechanism is proven; only the
   payload is new.
3. Set `permission.defaultPreset: workspace-write` in `~/.arxa/dsh/settings.yaml`.

**Rejected — flip now, fix Dart after.** It closes the hole hours earlier at the cost
of breaking the `application/` target, and the failure surfaces as an opaque
permission error rather than a clear message.

**Rejected — wait for the whole tier programme.** The exposure is the mechanism that
would contain the highest-ranked threat (§11: an agent doing something destructive, or
touching another client's code). It should not wait on the container work, which §16
shows may never be built.

**Verification for this change, from §17's measurements:** `git`, `node`, `npm` and
the full `init → write → add → commit` session workflow already pass under the
unmodified profile, so they are the regression baseline. The provider is correct when
`dart --version` and `flutter --version` also pass **and** a write to a sibling
project is still denied.

### S2 — Build the container tiers as well (user decision, 2026-09-01)

My recommendation was Seatbelt tiers + integrity, deferring containers until a client
contract demanded them. **The user chose to build the container tiers too.** Recorded
as the decision; A4 (hardened container) and A5 (`sbx` microVM) are in scope as
user-selectable options, alongside A1–A3 and B1–B2.

Consequence: the worktree/container collision (§6) moves from "resolve before L1" to
**blocking, on the critical path**. §19 resolves it.

---

## 19. CORRECTION — the worktree/container collision is not what was reported

§6 recorded, from research: *"containerising one project forces mounting the whole
parent repo — which re-exposes every sibling project and the org's `account/` dir."*
**Measured on live data, that is wrong.**

### What a session worktree actually contains

`/Volumes/business_ssd/TOPO/.arxa/worktrees/s-mthl5ryn-epm2k2`:

```
.git  .gitignore  AGENTS.md  check.sh  communications  meetings  notes  org.json

projects/ present? *** NO ***
account/  present? *** NO ***
```

And the org's git objects hold neither:

```
git -C <org> ls-files projects/  -> 0
git -C <org> ls-files account/   -> 0
```

Both are gitignored (D37), so they are **never tracked and never checked out into a
worktree**. Mounting a session worktree plus the org's `.git` therefore exposes
**neither sibling projects nor `account/`**. The mount is safe.

### The project repo is independently mountable

```
project .git       : REAL DIR (self-contained, not a pointer file)
project remote     : https://github.com/unfazed-dev/project-001
project worktrees  : 1 (itself)
```

No common-git-dir coupling at all. It mounts cleanly on its own.

### The real blocker is a bug we already found

Every session worktree — **including project-scoped ones** — is a worktree of the
**ORG** repo, at `<org>/.arxa/worktrees/<id>`. The project repo has exactly one
worktree: itself.

**So a project session's worktree contains no project files.** This is exactly **B2**
from `git-card-sessions-worktree-rewire.md` ("project-scoped sessions cannot see their
project"), now confirmed from the container direction: containerising a project
session today would hand the agent org scaffolding and no project.

### Consequence — good news for S2

The container tiers are **not** blocked by an unsolvable git-plumbing problem. They
are blocked by a defect that is already found, already understood, and already
scheduled: **D98/D99 session→repo routing, Phase 1 of the CI/CD plan.**

Once a project session is a worktree of the **project** repo, that repo is
self-contained and mounts alone — and the container design becomes straightforward:

| Session scope | Mount |
|---|---|
| project session | the project repo's worktree + its own `.git` — self-contained, no org access |
| org session | the org worktree + org `.git` — contains no `projects/`, no `account/` |

**Ordering, now firm: CI/CD Phase 1 (D98/D99) is a hard prerequisite for A4/A5.**
Build the container tiers on top of corrected routing, never before it — otherwise
every project container is empty.

---

## 20. CORRECTION to §9 — cross-project READ isolation is only half-achievable in-process

§9 recorded "cross-project read isolation — measured working". **That is true for
subprocesses only.** Two independent limits, both verified:

### Limit 1 — Seatbelt confines a launched process and its children, nothing else

Per `sandbox(7)`, `sandbox-exec` confines a **freshly-launched** process tree. arxa's
agent runs **in-process** inside a long-lived engine that was never itself launched
under a profile. So extending `seatbeltProfileArgs()` protects **subprocesses the
engine spawns** — `git`, shells, CLI tools — and does **not** fence the engine's own
`fs`/`require()` reads.

### Limit 2 — `SandboxedFileSystem` has no read path at all

Read from source: it overrides exactly two methods —

```
:130  writeText -> super.writeText(await this.checkedTarget(...))
:144  editText  -> super.editText(await this.checkedTarget(...))
```

and `checkedTarget` only ever raises `cannot write` (`:161`, `:168`). **There is no
`readText`/`readFile` override.** The in-process file tools' reads are unfenced in
every mode, including `workspace-write`.

### The resulting picture

| Read path | Seatbelt read-deny | `dsh-fs-sandbox` |
|---|---|---|
| subprocess (`cat`, `grep`, a shell, a test runner) | ✅ blocked | n/a |
| **the agent's own file-read tool (in-process)** | ❌ **not covered** — engine not launched under a profile | ❌ **not covered** — no read override exists |

**So A2 as scoped in §16 is half a control.** An agent told to read
`../other-client/secrets.env` via its file tool still succeeds. Blocking `cat` while
leaving the Read tool open is not cross-project read isolation, and the plan must not
claim it is.

### Three ways to close it, and what they cost

1. **Ship an arxa FileSystem provider** with a read check mirroring `checkedTarget`,
   swapped at the same seam as the S1 SandboxProvider. Cheapest real fix, same
   mechanism already chosen, and it composes with the Seatbelt work.
2. **Relaunch the whole engine under a Seatbelt profile.** Closes both limits at once,
   but the writable/readable roots would then be fixed for the engine's whole
   lifetime, across every session — architecturally much bigger, and it fights the
   per-session model.
3. **Containers (A4/A5).** The boundary is the container, so *both* limits vanish —
   in-process reads cannot escape a mount namespace.

### This strengthens S2

The user chose to build the container tiers against my recommendation. **This finding
argues in their favour.** The cheap Seatbelt rungs cannot deliver cross-project read
isolation for the agent's own tools; containers can, structurally. Option 1 above
should still be built — it is cheap and helps at every level — but the honest ceiling
of the no-container path is lower than §9 implied.

### Other macOS mechanisms — verified, and mostly not tiers

- **`(deny network*)`** cleanly blocks outbound TCP **per-process** — better suited
  here than `pf` or the Application Firewall, both of which are coarse (and the
  built-in firewall is inbound-only). Same subprocess-scope caveat applies.
- **`(deny mach-lookup)`** blocks real Keychain retrieval — verified with a clean
  three-way test (unsandboxed succeeds → sandboxed-without-deny succeeds identically →
  sandboxed-with-deny fails → item still retrievable afterwards). An earlier attempt
  used an unconfirmed keychain item and was discarded as ambiguous.
- **User accounts, APFS encrypted volumes, FileVault** are operator-level manual
  partitions, not per-task tooling. Real session-switching and mount friction; they do
  not help live in-process isolation.
- **Endpoint Security** is out of reach for a free distributed app — restricted
  entitlement, weeks-to-months Apple approval, no App Store path.

**Placement:** these are **not** a tier beside containers. They are a cheap,
always-on **floor beneath every mode**, including native execution. Fold them under
A1–A3 rather than presenting them as an alternative to A4/A5.

---

## 21. `sbx` INSTALLED — L2 moves from documented to measured

Installed per Docker's official macOS steps (`docs.docker.com/ai/sandboxes/install/`):

```
brew trust docker/tap
brew install docker/tap/sbx
```

**`sbx` v0.39.0** (cask), binary at `/opt/homebrew/Caskroom/sbx/0.39.0/bin/sbx`.
Prerequisites met: macOS 26.6.2 (needs Sonoma 14+), Apple M4.

### Verified on this machine

```
CLI binary        ✓ found, v0.39.0
Daemon            ✓ healthy (after `sbx daemon start`)
Virtualization    ✓ supported — kern.hv_support = 1
Storage dirs      ✓ present and writable
Authentication    ✗ NOT SIGNED IN  -> blocks everything else
```

`sbx login` is browser-interactive and **must be run by the user**. Until then
`sbx ls`, `sbx policy ls` and `sbx policy profile ls` all return
`401 Unauthorized`. **L2 verification is blocked on that one step.**

### ✅ Confirmed from the real CLI

- **`--clone` exists, and the trap is real.** Help text: *"Run the agent on a private
  in-container clone of the host Git repository; **must be set at sandbox creation
  time** (no-op when re-attaching to an existing clone-mode sandbox)."* §4's warning
  stands, verbatim from the tool.
- **`--deny-network`** exists as a creation-time, per-sandbox rule, listable and
  removable via `sbx policy ls` / `sbx policy rm`. Notably: *"a local deny can only
  narrow, never widen, egress."*
- **`sbx policy`** subcommands: `allow`, `deny`, `ls`, `log`, `init`, `inspect`,
  `check`, `profile`. Confirms `sbx policy log` (§13 rung 1) and reveals
  `policy check` — "check whether policy allows an access request", useful for
  testing a policy without running an agent.

### ⚠️ Two corrections to the research

1. **`--no-share-skills` does not exist.** There is no such flag on `sbx run`.
   The mechanism is a top-level **`sbx skills`** command, marked *(Experimental)*,
   with only two subcommands: **`import`** ("Import skills from supported agent
   directories") and **`ls`**. That reads as skills being **explicitly imported**
   rather than shared read-write by default — the opposite of what §13 recorded.
   **The concern and its remedy are both unverified; re-check after login before
   carrying either into the design.**
2. **Memory default is not a flat 8 GiB.** `-m, --memory` help states:
   *"Default: **50% of host memory, max 32 GiB**."* On this 16 GiB machine that is
   8 GiB, so §14's arithmetic ("two sandboxes claim 100% of the machine") holds —
   but the mechanism scales with the host, so the figure must not be quoted as a
   constant.

### Capabilities worth designing around (found while inspecting)

| Command | Why it matters |
|---|---|
| **`sbx secret`** | "Manage stored secrets" — **cross-check against §7's Keychain + SOPS design before building anything.** May already cover part of it. |
| **`sbx env`** | *(Experimental)* "Manage sandboxes declaratively from a `.sbxenv.yaml` file" — **the natural way for arxa to spin sandboxes per project**, rather than shelling out to `create` with flags. |
| `sbx template`, `sbx kit` | reusable sandbox definitions |
| `sbx mcp` | MCP server registration — relevant to §11's "local stdio MCP servers run on the host" hole |
| `sbx cp`, `sbx exec`, `sbx ports` | host↔sandbox plumbing arxa would need |

### ⚠️ Storage location — NOT relocated, unlike Docker Desktop

```
~/Library/Application Support/com.docker.sandboxes   (not a symlink)
mount: /System/Volumes/Data    currently 540K
```

Docker Desktop's data was symlinked out to `business_ssd` (§1a). **`sbx`'s store was
not**, so microVM images will accumulate on the **internal** disk. Decide whether to
relocate it before creating sandboxes.

**Note on the disk figures:** §1a recorded `3.4Gi free / 99%` for this volume;
it now reads `35Gi free / 83%`. The readings are inconsistent — macOS purgeable space
makes `df` unstable here. **Re-measure before relying on either number**; do not
quote §1a's figure as current.

### Next step to unblock

The user runs `sbx login`. Then verify, in order: the default network posture
(`sbx policy ls`, `sbx policy profile ls`), whether skills are shared or imported,
and a real `--clone` sandbox against a scratch repo to confirm the source is
read-only.

---

## 22. MEASURED post-login — two more research claims corrected

Signed in as `unfazedhuman`. `sbx ls` now answers. Both remaining L2 questions settled
against the real CLI.

### ⚠️ 22a. `sbx` is NOT deny-by-default. There is no policy at all until you initialize one.

```
$ sbx policy ls
ERROR: global network policy has not been initialized
  Initialize it with: sbx policy init <allow-all|balanced|deny-all>

$ sbx policy profile ls
No policy profiles found
```

`sbx policy init --help`:

> This sets the initial global network policy and **must be run before adding custom
> allow/deny rules or starting a sandbox for the first time.** It is a one-time setup;
> once initialized, use `sbx policy reset` to start over.

| Posture | Meaning |
|---|---|
| `allow-all` | all outbound traffic allowed |
| `balanced` | "typical development traffic … such as AI services and package registries" |
| `deny-all` | all outbound blocked |

**Docker's own example calls `balanced` "recommended".**

**This overturns §4 and §13**, which recorded "default-deny outbound TCP, UDP/ICMP
blocked" as `sbx`'s *default posture*. Deny-all is an **available** posture, not the
out-of-box state — and the out-of-box state is *no policy*, with first use forcing a
choice.

**Consequences for the design:**
1. **arxa must own this decision explicitly.** If arxa ships L2 and does not
   initialize the policy, the user's own earlier choice governs — possibly
   `allow-all`, silently.
2. The §16 tier table's claim that A5 buys "host-side default-deny egress" is only
   true **if arxa initializes `deny-all`** (or `balanced` plus deny rules).
3. It is a **global, one-time** setting, not per-sandbox. Per-sandbox rules — including
   those from built-in agent kits — apply *on top*. So "per-project egress policy"
   means global posture + per-sandbox narrowing, and §21 already confirmed a local
   deny "can only narrow, never widen".

### ✅ 22b. Skills: the store IS shared, but it is empty until explicitly imported

```
Skills store: ~/Library/Application Support/com.docker.sandboxes/sandboxes/agent-skills
No skills found. Use 'sbx skills import' to add skills.
```

`sbx skills import --help`: *"Copy skills from supported agent directories on the host
into the **persistent store shared by sandboxes**."* Sources scanned, alphabetically,
first-wins:

```
~/.agents/skills  ~/.claude/skills  ~/.copilot/skills  ~/.cursor/skills  ~/.factory/skills
```

**Both earlier accounts were half right.** §13 said the store is "read-write across
sandboxes by default" and named `--no-share-skills` as the remedy; §21 inferred the
opposite from the CLI surface. The truth:

- **Shared across sandboxes — yes**, that part of §13 stands.
- **Populated by default — no.** It is empty until someone runs `sbx skills import`.
- **`--no-share-skills` does not exist.** The control is simply *not importing*.

**Live relevance:** `~/.claude/skills` exists on this machine and holds the operator's
own skills. An import would copy them into the shared store, at which point the §13
cross-contamination concern becomes real. **Until then it is inert.**
**Recommendation: do not import, and do not have arxa import on the user's behalf.**

---

## 23. SCOPE DIRECTIVE — arxa provisions all of this; the user does nothing

**User instruction, 2026-09-02:** *"this process we are actually doing must be
automatically taken care of at install and packaged by arxa for users to consume
without users to do anything — so ensure all the work we are doing are in that in
mind and in that direction."*

**This is binding on every decision in this document.** Nothing here may land as a
README step or a manual prerequisite. Re-read every prior section against it — several
were written as operator instructions and must be re-expressed as things arxa does.

### The provisioning checklist, as arxa must perform it

| Step | Automatable by arxa? | Notes |
|---|---|---|
| Install `sbx` | **Yes** | `brew trust docker/tap && brew install docker/tap/sbx`, or bundle/download the release artifact. Must not assume Homebrew exists. |
| Start the daemon | **Yes** | `sbx daemon start`; `sbx diagnose` gives a machine-checkable health report. |
| Initialize the network policy | **Yes** | `sbx policy init deny-all` — **and arxa must do this, or the user's own earlier global choice silently governs** (§22a). One-time and global; `sbx policy reset` to change. |
| Per-project egress rules | **Yes** | `sbx policy allow` globally + `--deny-network` per sandbox; local denies can only narrow. |
| Create the sandbox | **Yes** | `sbx create --clone --name <n> <agent>`; `sbx env` (Experimental) does it declaratively from `.sbxenv.yaml`. |
| Preset flip + SandboxProvider (S1) | **Yes** | ships in the app. |
| Seatbelt profile extension (A2/A3) | **Yes** | ships in the app. |
| Integrity items (B1/B2) | **Yes** | generated into the repo frame, like `check.sh`. |
| **`sbx login`** | ❌ **NO** | **See below. This is the one that does not yield.** |

### ⚠️ 23a. The blocker: L2 requires a Docker account and an interactive sign-in

Measured this session. `sbx login` is an **OAuth device-code flow**: it prints a code
and a `login.docker.com/activate` URL and waits for a human to confirm in a browser.
Until it completes, **every** meaningful command returns
`401 Unauthorized … no valid user session found`.

**arxa cannot automate this away.** It requires the end user to (a) have or create a
Docker account and (b) complete a browser confirmation. There is no headless path that
does not amount to handling the user's Docker credentials, which arxa must not do.

**Also observed: it is not reliable.** The first attempt on this machine failed with
`oauth2: "access_denied" "Global rate limit exceeded"` — an upstream Auth0 limit,
nothing to do with the local setup. Any arxa flow that depends on it **must treat
sign-in failure as an expected state**, retry-able and clearly explained, never a
crash.

### 23b. Consequence — this is a real tier boundary, and it should be surfaced as one

| Tier | Third-party account required? |
|---|---|
| A0–A3 (preset, Seatbelt read-deny, egress) | **None.** Ships entirely inside arxa. Fully automatic, zero user action. |
| A4 (hardened Docker container) | Docker Desktop/Engine must be present; no Docker *account* needed for basic use. |
| **A5 (`sbx` microVM)** | **A Docker account plus an interactive browser sign-in.** |
| B1–B3 (integrity) | None, except **GitHub Pro** for required reviews on private repos (§15). |

**Design consequence.** The "user does nothing" promise holds cleanly for A0–A3 and
B1–B2 — which is most of the value, and covers the two highest-ranked threats. It
**cannot** hold for A5. So arxa should:

1. **Provision A0–A3 + B1–B2 silently at install.** No prompts, no choices, no README.
2. **Offer A4 as automatic-if-Docker-is-present**, and detect rather than assume.
3. **Present A5 as the one tier with a one-time sign-in**, stated honestly at the point
   of choosing it — never discovered later as a failed session.
4. **Never let a missing L2 sign-in break a session.** Degrade to the highest tier that
   is actually available and say so plainly.

This also re-frames the org/project inheritance question: the inherited *setting* can
be automatic, but an inherited **A5** may still stall on a sign-in the user has not
done. Inheritance must therefore carry a "best available" fallback, not a hard demand.

### S3 — Tier provisioning model, approved 2026-09-02

Approved as proposed in §23b:

1. **A0–A3 + B1–B2 provision silently at install.** No prompts, no choices, no README
   steps. This is the bulk of the value and covers both top-ranked threats (§11).
2. **A4 is automatic when Docker is present** — arxa **detects**, never assumes.
3. **A5 is presented as the one tier carrying a one-time Docker sign-in**, stated
   honestly at the moment of choosing it — **never discovered later as a failed
   session**.
4. **A missing A5 sign-in never breaks a session.** Degrade to the highest tier
   actually available and say so plainly.
5. **Inheritance carries "best available", not a hard demand.** An org set to A5 must
   not stall a project whose user has not signed in.

Corollary for the org/project offer: the inherited *setting* is automatic, but the
*effective* tier is resolved per machine at session start. The card must show the
effective tier, not the configured one, whenever they differ.
