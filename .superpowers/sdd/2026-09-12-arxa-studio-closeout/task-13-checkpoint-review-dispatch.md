You are performing the MANDATED CONTRACT-FREEZE CHECKPOINT REVIEW for Task 13 Part A of the arxa-studio closeout program. The plan freezes the WorkspaceProvider Wire v1 protocol here: "Stop for task review before writing either adapter; any wire change after this checkpoint requires a new protocol version." Your verdict decides whether the frozen contract stands or needs amending BEFORE the adapters are built. Work in /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout. You are a FRESH independent reviewer.

## Inputs

- Brief (contains the Wire v1 table — the authority): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-brief.md
- Implementer report (lists the 10 resolved ambiguities with rationale): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-report.md
- Diff package (base e800fe9 → head 3597a40): /Volumes/business_ssd/arxa_digital_solutions/.worktrees/arxa-studio-closeout/.superpowers/sdd/2026-09-12-arxa-studio-closeout/task-13-checkpoint-package.txt

## Your job

1. For EACH of the implementer's 10 ambiguity resolutions: UPHOLD or OVERTURN, with one sentence each. An overturn means the frozen contract must change before Part B (a new protocol version per the freeze rule) — treat that as severe: only overturn where the resolution contradicts the Wire v1 table, breaks local-first parity, leaks secrets, or creates a security/IDOR hole. Judgement calls consistent with the table's letter are upholds.
2. Verify the golden tests actually pin the table: routes/verbs/headers/media types exact; envelope and error taxonomy shapes; bounds/pagination/cursor; token lifecycle (issue/refresh/revoke/introspect, opaque bearer); capability-driven sign-in kinds; abort signals; request IDs; config-cannot-name-executable-code; unknown version/collection rejected BEFORE I/O.
3. Verify Step 1's doc rewrite records D32–D35 authority correctly.
4. Independent verification: run `node plugins/workspace-provider/selftest.contract.mjs` (expect 12/12), then `npm test` (exit 0, ALL GREEN, record suite count). One at a time — RAM-constrained.
5. Read-only on git state; verification runs may create artifacts.

## Output format

`### Ambiguity verdicts` — numbered 1–10: UPHOLD/OVERTURN + one sentence each.
`### Golden-test pinning` — what is pinned, any gap.
`### Step 1 doc rewrite` — verdict.
`### Independent verification` — commands, exits, key lines.
`### Issues` — Critical / Important / Minor with file:line.
`### Verdict` — `CONTRACT STANDS` or `CONTRACT MUST CHANGE: <list>`.

Your final message IS the report — no preamble. Never spawn claude/agents/reviewers.
