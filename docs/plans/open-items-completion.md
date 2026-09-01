# Open-items completion run (continuation, 2026-09-02)

Continues `session-execution-log.md`. Mandate: complete every open item, gap or
miss; smoke/pressure/stress/e2e as we go; fan out subagents. Advisor consult was
attempted before this plan and returned `over_budget` (session fuse 21/20) —
recorded as skipped; decisions below rest on the plan docs + official sandbox
docs (Claude Code `code.claude.com/docs/en/sandboxing`, Codex
`developers.openai.com/codex/concepts/sandboxing`, both indexed).

## Inventory (from five parallel spec extractions)

| Item | Spec | Code locus | Status |
|---|---|---|---|
| B2 / D98 / D99 | rewire.md:83-98, Phase 1 :237-258; project-sessions-physical.md | sessions.js (all id-keyed fns), file-org-shell/lib/lifecycle.js:973-1024, arxa-sidebar index.js:738-916 | open — everything queues behind |
| S1 | isolation.md:980-1067 | new plugin swapping cordis `id: sandbox`; `~/.arxa/dsh/settings.yaml:38` | open, provider-first |
| B7 | rewire.md:26,303,311,741 | new reconcile module over `git worktree list --porcelain` + `sessions.json` + `.arxa/worktrees/*` | open |
| B8 | rewire.md:27,275,320 | `github-link/lib/frame.js:120-141` classifies `asleep`; sidebar renders only `frame.protection` | open |
| B12 / V5 / Gap 2 | vocab.md:214-252, 402-454; isolation.md:1680-1690, 2085-2108 | `git-workspace/lib/versions.js` (mint never called) | open |
| Gap 1 (`supersededBy`) | vocab.md §V3 | **arxa repo** (`_d_meta.json`) | deferred — cross-repo, "break nothing in arxa" |
| D110 | rewire.md:791-819, 910-928 | scaffold root `.gitignore`; last-known commit not implemented in code | decide + .gitignore |
| D111 | rewire.md | sidebar new-session block vs merge gate classification | decide + wire |
| Phase 2 | rewire.md:260-299 as revised by D107 (§9 :493-537) | github-link frame.js, github-bridge.js, sidebar `card.pr.*` | open |
| Phase 3 | rewire.md:301-312 | new finish/sweep module; revive tip SHA | open |
| Phase 4 | rewire.md:314-331 | sidebar snippet (conformance contract) | minimal slice: wired/runner chips + wake CTA + order 30 |
| Phase 0b | rewire.md:220-236 | TOPO/TESTO registries | preconditions: named confirmation, engine stopped, snapshot first |
| L1/L2 tiers | isolation.md:198-239 | after B2 | deferred (depends on B2 landing + Docker `--clone`) |

## Decisions taken here (blanket permission, recorded for the user)

- **D110 → option (b)**: derive the org's view of a project SHA live; never track
  it in a file. No write amplification exists to remove because D95's tracked
  field was never implemented. The concrete fix is the §10.1 finding: every
  scaffolded project ships a root `.gitignore` before any auto-commit.
- **D111**: the new-session block adopts the merge gate's three-way
  classification. Only a *red* main blocks; `asleep`/`pending`/never-completed
  (queue-limit cancel) are infrastructure and show a wake/wait notice instead.
- **V5 shape**: build the doc's own recommendation (project ledger + per-target
  rows) on the studio side. It is additive, so if arxa later asks for a single
  number the rows are simply unused. Gap 1 stays arxa-side and is not built.
- **B12 trigger**: the missing product event becomes an explicit sidebar action
  `version.mint` (human-initiated "publish to client"), which is the only honest
  trigger while arxa has none.
- **Phase 0b**: run the snapshot + dry-run unconditionally; execute deletion only
  if the engine is not holding any of the affected sessions open. Report either way.

## Execution shape

Wave 1 — parallel, worktree-isolated, disjoint files, each with its own
`selftest.<topic>.mjs` (ci.mjs now discovers those):
R routing (B2), S sandbox (S1 provider only, no flip), V versions (V5+Gap2),
D scaffold gitignore (D110), W reconcile (B7), F finish/sweep (Phase 3),
G PR flow lib (Phase 2 github-link side).

Wave 2 — serial sidebar wiring on top of the merged result: per-repo session
merge, `card.pr.merge`, B8 chips + wake CTA, `version.mint`, D111 block, order 30.

Wave 3 — e2e: routing e2e, PR-flow e2e against a bare remote, frame gate re-run,
S1 flip + verify, Phase 0b snapshot/dry-run.
