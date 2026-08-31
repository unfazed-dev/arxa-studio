# Composer git card — PART B of the git management plan (grilled 2026-08-31)

Grounded in: D75 brief (docs/plans/arxa-studio-grill-decisions.md:786),
docs/plans/git-capability-audit.md, docs/plans/file-organisation-implementation.md
phases 3-4, t3ci canon (t3ci/CI/01,02,04 + model-communication/files:
AGENTS.md letter, file-pr skill), arxa/docs/ci/self-hosted-runners.md,
arxa-cicd skill references, GitHub REST docs (pulls, merge methods,
branch protection), git-status(1) porcelain v2.

## What Part B is

D75: a collapsible dsh-goals-style card over the composer in EVERY arxa
session, worktree-aware. Part A (shipped) = the git rail + GitHub linking:
org/project repos, snapshots, sessions (branch+worktree, gates, parked,
archive/revive), publish/heal/connect, local-only inheritance (D69-D92).
Part B = the git card v1 + the CI frame it needs to be meaningful.

## Reassessment that reshaped the brief

- The brief predates local-only orgs (D89-D91): every remote affordance
  must degrade + offer Connect.
- The brief predates the t3ci canon adoption: PR-first merge for CI'd
  repos replaces pure-local merge authority.
- Nothing scaffolded any CI: PR create against bare repos would merge
  unchecked -> the frame is a v1 prerequisite, not a rider.
- D18's "continuous" WIP layer was event-poked only (editor saves, trash,
  archive, pre-squash) — the watcher completes it.

## Decisions

| Q | Decision |
|---|---|
| Q1 | v1 = full brief scope: status, LLM commit draft, push, publish/heal, PR create |
| Q2 | Merge authority = the strictest gate the repo has. CI frame wired -> PR + required checks authoritative (GitHub blocks merge). Local-only / frame-less -> local runGate authoritative. D73 relaxed: session branches push ONLY to open a PR |
| Q3 | Frame ships in v1: scaffold writes green-by-absence check.sh into every new org/project repo; publish/connect wires ci.yml + branch protection with the D76 token |
| Q4 | Day-zero checks: content-light for org repos (org.json parses, slug-valid dirs, no stray lock/temp files, stages well-formed); project repos get a stack probe (pubspec/package.json/Cargo.toml/pyproject -> that stack's test command; light otherwise) |
| Q5 | Self-hosted runners, canon labels [self-hosted, macOS, ARM64, arxa]. Never GitHub-hosted for arxa-managed repos (private by default makes it safe). End users: same labels, overridable, their own runners — never Arxa infra. Runner-asleep is a first-class card state (wake/setup CTA; never fix a queued job with code). Flipping an org public -> GitHub-hosted, categorical |
| Q6 | The session's own model drafts commit messages. Engine prepares evidence (diff stat + recent stage subjects); card pre-fills a confirm field; one click accepts; editable |
| Q7 | Conventional subjects everywhere history looks: <type>(<scope>): <what is now true, in words a human would use>. Types: docs feat fix refactor test chore perf build ci style merge. Stage commits: conventional subject, provenance in trailer Arxa-Stage: <session> (tier detection is committer-identity-based; the stage: subject prefix dies). Machine commits migrate to chore(<scope>): ... WIP tier unchanged (wip: auto-save, internal, squashed away). PR mechanics per file-pr: dedupe (pr list --head), rebase before open, real never draft, one concern per PR, body = problem first (user's words) then fix, attribution footer "— written by <model> in arxa studio", red checks disclosed. Enforcement: day-one REQUIRED subject check in check.sh (--no-merges, window origin/main..HEAD) — arxa-created repos have zero legacy. Tag map is [arxa-<skill-name>] (abx- renamed 2026-08-31, both skill copies + pipeline-map swept); org content repos use the attribution footer, not stage tags |
| Q8 | Squash-merge on connected repos (boundaries preserved on session branch + stageLog + chips; main gets one releasable conventional commit per PR, subject = PR title). Local-only keeps stage commits on main. Frame locks repo settings to squash-only (allow_squash_merge only) so the policy is structural |
| Q9 | WIP watcher: debounced (~3s) fs watcher on the org primary worktree + every open session worktree (ignore .git), wipCommit on quiet; in-app event pokes retained for immediacy. Watchers owned by the open-org handle, torn down by closeOrg (undo list) — relaxes the old no-watcher invariant deliberately |
| Q10 | Card status cluster: dirty counts (porcelain v2), ahead/behind vs origin/main, WIP-run length + time since last boundary, CI/runner state (+ wake CTA), version chip (discharges D44 surface half; versions.js mints on boundary; Draft/In review/Approved/Superseded; no SHAs), local-only badge -> Connect CTA. Sidebar rows keep their planned per-project chips from the same data source (integration plan Phase B) |

## Build riders (user, this session)

- UI harmony via Creator mode: compose and validate the card in the
  Cordis preset (profile/cordis.patch.yml) before freezing; shipped
  preset read-only; arxa ships its own composition.
- Stock DSH workspace UI via the splice pattern (gen-workspace.mjs —
  depend-don't-fork) where the card touches dsh-owned surfaces.
- Coordinate with the artifact-viewer docked column work (same composer
  region, other session) before landing layout.

## Status (2026-08-31)

S0–S4 SHIPPED; S5 smoke extended. Implementation record:
docs/plans/git-card-part-b-implementation.md (verification log inside).
One user action ships with this: the FIRST GitHub re-link after update
(the `workflow` scope is new — status() reports missingScopes; same
class as D76's one-time re-link).

## Build-time verifications (not yet proven)

1. D76 token scopes cover: branch-protection PUT, repo settings PUT
   (merge methods), runner registration-token POST, PR create/merge.
2. Pushing main containing a PR's commits resolves the PR on GitHub's
   side (auto-close/merged) — verify live on a test repo.
3. Watcher cost on large org trees (business_ssd-scale) — debounce
   budget, ignore rules.
4. Protection strict:true vs machine commits: enforce_admins false +
   admin token lets snapshot/manifest/publish commits ride main direct
   (canon: direct pushes run CI via push trigger).
5. Token refresh inside long card sessions (D76 window) during PR flows.

## Enforcement knobs summary

- check.sh day-one: content-light or stack-probe checks + REQUIRED
  conventional-subject check (--no-merges).
- ci.yml: on push[main] + pull_request; concurrency ci-<ref>
  cancel-in-progress; job-per-area; timeout-minutes always;
  runs-on [self-hosted, macOS, ARM64, arxa].
- Protection: strict true, contexts = exact job names, enforce_admins
  false, no force-push/delete.
- Repo settings: allow_squash_merge only.
- Card: title validated before PR open; body template; runner-asleep
  detection surfaces wake/setup CTA.
