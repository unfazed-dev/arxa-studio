# arxa-push-doorbell

The engine-side push doorbell (option B1 of
[doorbell-decision-2026-08-29.md](../../arxa/docs/plans/doorbell-decision-2026-08-29.md)):
when the engine raises an approval that needs the owner on the phone, this
library POSTs a Visible push to the desktop's cairn-pushd sidecar
(`POST /v1/send`, loopback), once per paired device.

**Pure library.** Nothing registers into cordis — the approvals feature owns
the call site when it lands:

```js
import { notifyApprovalRequested } from 'arxa-push-doorbell'

// fire-and-forget; never throws, never blocks the agent loop
void notifyApprovalRequested({ id: approval.id, title: 'Approve deploy?' })
```

## Config

Off by default. The gate is the literal env `ARXA_DOORBELL_PUSH=true`.

| env | default | effect |
|---|---|---|
| `ARXA_DOORBELL_PUSH` | _off_ | literal `true` arms the doorbell |
| `ARXA_APP_DATA_DIR` | platform dir for bundle id `solutions.arxadigital.arxa` | where `pushd.env` + `pairing.json` live |
| `ARXA_PUSHD_URL` | `http://$CAIRN_PUSHD_BIND` (from pushd.env, else `127.0.0.1:8090`) | override the loopback bind |
| `ARXA_PUSHD_KEY` | secret of the first `pushd.env` API-key entry | bearer for `/v1/send` |
| `ARXA_PAIRING_STORE` | `<app data>/pairing.json` | device-token source, re-read per send |

The bearer is the key **secret** only — the tenant is stamped daemon-side
(cairn-push `auth.rs`, ADR-0018 discipline).

## Behavior contract (pinned by `selftest.mjs`)

- Gate off → zero traffic, `{gated: true}`.
- One POST per paired peer that carries a push token; peers without one are
  skipped.
- `collapse_key = approval:<id>` — resends coalesce on the rail instead of
  stacking.
- pushd down, rail unconfigured, bad key, 429, timeout (2 s) → all counted
  in the returned `{sent, skipped, failed}` summary and debug-logged.
  **Nothing ever throws into the engine.**

Run: `node plugins/push-doorbell/selftest.mjs` (also rides `node
scripts/ci.mjs` via selftest auto-discovery).
