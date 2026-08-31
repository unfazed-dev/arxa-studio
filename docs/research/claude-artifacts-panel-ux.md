# Research — Claude desktop/web artifact panel UX

Sources (fetched 2026-08-31):
- https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them
- https://www.aiuxplayground.com/teardowns/claude/artifacts/
- https://uk.pcmag.com/ai/154130/anthropic-brings-artifacts-split-screen-view-to-all-claude-users
- https://extpose.com/ext/476458 (Artifact Maximizer extension — exists because the native pane is NOT drag-resizable)

## Panel model
- Artifact opens in a **dedicated window to the right of the main chat** (help center). It is a layout pane in a split view — never a floating overlay; chat remains visible and the composer stays usable.
- **Three states**: closed (artifact rendered as an in-thread *card* = the handoff/entry point), **split** (default, chat left / artifact right), **full-width** (explicit expand toggle; known cost: hides chat entirely).
- **No free drag-resize natively** — the split is fixed; third-party extensions (Artifact Maximizer) exist solely to widen the pane. Teardown flags "cramped on smaller viewports; mobile needs fallback".
- **Mobile/narrow**: artifact takes the full screen (fallback mode), close returns to chat.

## Inside the pane
- **Preview | Code tabs in one pane** (two modes of one workspace, not separate destinations).
- Header chrome: **Copy**, **Publish** (explicit modal, public/private split), version controls.
- **Version selector** to switch between versions; user edits do not change Claude's memory of the original; editing a prior chat message forks a new conversation version with its own artifact set.
- **Editing stance**: ask-Claude or markdown **"Edit with Claude"** (select text → prompt-scoped edit). Code tab is inspect/copy — **no direct manual code editing** in the classic flow (teardown: "mechanical fixes still require a follow-up prompt or external editor").

## Bearing on the arxa studio grill
1. Validates Q1: docked right column, not an overlay. Claude's pane is a grid citizen; our blocking bug came from exactly the overlay model Claude rejects.
2. Our AppFrame already has drag handles — we get free-drag that Claude lacks; "max available width" can be a drag stop AND/OR an explicit maximize toggle (open decision).
3. Entry point parity: artifact card in conversation opens the pane (Claude's card-as-handoff pattern).
4. Editing: our D80 direct CM6 editing exceeds Claude's prompt-scoped edits — keep; version selector parallels our D85 chip.
5. Narrow viewport (≤744 ladder): full-screen sheet fallback, Claude-mobile parity.
