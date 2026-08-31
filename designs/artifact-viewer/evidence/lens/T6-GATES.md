# T6 gate evidence — docked artifact-viewer column (D88–D93)

Run 2026-08-31 (headless Chrome, raw CDP, /tmp/t6-gate2.mjs rungs).

| gate | result |
|---|---|
| dock @1280 — session-bound column opens, panel header (maximize/close) renders | PASS (280px 640px 0px 360px) |
| blocking regression — elementFromPoint hits the app under the open column; composer focusable | PASS (inApp:true focused:true) |
| drag — CDP mouse drag on the viewer handle follows pointer | PASS (360 -> 320) |
| clamp — drag below min stops at 320px (D93) | PASS |
| width persistence — reload + reopen keeps the dragged width (localStorage write-through in the generated store) | PASS (320 kept) |
| maximize — viewport - sidebar - 640 center floor | PASS (1600 -> 680 = 1600-280-640) |
| conversation end-to-end — send -> GLM reply -> blank flips -> auto-title | PASS ("Visual Test Ping Acknowledgment") |
| sheet @744/@390 (D92) | OPEN — sheetLayer does not mount on emulated resize; needs React-level debugging next round |

CI: scripts/ci.mjs ALL GREEN (incl. sidebar selftest with T4 file-section
checks and artifact-viewer selftest with T5 card-routing checks).

Evidence shots: conversation-agent-live-1280.png (live agent + docked
column), session-open-1280.png (conversation open), t4-files-viewer-1280.png.
