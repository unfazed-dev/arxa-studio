# Task 7 RED evidence (reconstructed 2026-09-13)

Scratch BASE tree: git archive 82296f8 -> /tmp/task7-red.NBFn ; WIP selftests copied in; worktree node_modules symlinked read-only.

## selftest runs (exit codes + first failing assertion)
```
===== node selftest.mjs (BASE lib, WIP tests) =====
exit=1
AssertionError [ERR_ASSERTION]: no token -> 403 (deny-default, Task 7 trust boundary)
   -> proves watcher.js SSE token gate + index.js verify wiring

===== node selftest.lsp.mjs (BASE lib, WIP tests) =====
exit=0  (expected: pins PRE-EXISTING dart locate-only behavior; lsp.js itself unchanged)

===== node selftest.client-events.mjs (BASE lib, WIP tests) =====
exit=1
AssertionError: the root-filtered stream is opened with a tree-read token minted for that root
   -> proves client.js lane-token minting change
```

## source pins against BASE (node --input-type=module -e, scratch tree)
```
RED: entry.mjs exports overlayBytes probe
RED: entry.mjs exports configValue probe
RED: spike asserts same-origin ext host (threat probe)
RED: spike asserts autoSave afterDelay probe
RED: gen-ui carries the DEFERRED marker
```

Allowlist freeze note: BASE entry.mjs already imports exactly the 14 pinned
extensions, so the S2 allowlist test passes on BASE BY DESIGN (it freezes
existing state); its RED was demonstrated by the predecessor via a smuggled
tomoki1207-pdf import and re-verified after the digit-matcher fix (claim from
the threat table; not re-replayed here).
