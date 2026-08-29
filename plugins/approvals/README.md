# arxa-approvals

The engine half of the approvals loop (grill D60–D68,
[arxa-studio-grill-decisions.md](../../docs/plans/arxa-studio-grill-decisions.md);
doorbell decision
[B1](../../arxa/docs/plans/doorbell-decision-2026-08-29.md)):

> An **Approval** IS a dsh session's pending human-input request. The list is
> a derived projection (nothing persists — restart re-derives from the mux
> replay); deciding = answering the session's question remotely.

Host-only plugin (absolute-path row 14 in `profile/cordis.patch.yml`, same
shape as arxa-memory / arxa-pi-delegate). No browser half — the desktop web
UI already answers through its own composer; this plugin is the PHONE's path.

## What it does

1. Consumes `ctx.apiProxy.events.mux` — the same event stream the browser
   client subscribes to. On attach the mux **replays every still-pending
   question**; live frames then arrive as they happen. The plugin folds
   `question/requested` into approval records and deletes on
   `question/resolved`. First sight of an rpcId only: replays never re-door.
2. Rings [`arxa-push-doorbell`](../push-doorbell/) on first sight —
   `notifyApprovalRequested({ id })`, nothing else (D65: fixed content-free
   copy; the summary rides the tunnel, never APNs/FCM). The doorbell stays
   gated by `ARXA_DOORBELL_PUSH=true` and never throws (library contract); a
   missing library degrades to routes-only, logged once.
3. Serves the phone (through the iroh pairing tunnel's loopback proxy —
   tunnel-layer AUTH gates the caller):

   | route | behavior |
   |---|---|
   | `GET /__arxa/approvals` | `{ approvals: [record…] }` oldest first |
   | `POST /__arxa/approvals/action` `{ action: 'decide', arg: { id, answers } }` | answers via `ctx.apiProxy.respond` — **first claimant wins**: the desktop composer and the phone can never double-answer; the loser gets `409 not-pending` |

## The approval record (cairn-row-shaped, D61)

```json
{
  "id": "<the question wait's rpcId>",
  "session_id": "<dsh session id>",
  "kind": "approval",
  "summary": "<first question text>",
  "questions": [ "…the full batch, verbatim — needed to answer" ],
  "raised_at": 1760000000000,
  "status": "pending"
}
```

Field names are the future cairn table's columns, so the B2 swap (approvals
riding real cairn sync, doorbell becoming the silent wake) changes transport,
not model. `kind` stays `'approval'` for every pending question (D64: one
class in practice). `status` ships `'pending'` only — decided approvals
DELETE from the live list; history is a B2 concern.

## Deciding

The decide action carries a complete answer batch — one answer per question
in the batch, ids in order, labels from the question's own options (the same
rules the engine's `matchesQuestions` fence enforces server-side; this plugin
shape-checks first to fail fast with honest errors). Single-select questions
accept `selected: [oneLabel]` OR `custom: "text"`, never both.

## Testing

`node plugins/approvals/selftest.mjs` — projection shape, replay-dedup,
resolved-deletion, envelope shape-checks, the fake-engine route loop
(decide → accepted → list updates; refused receipt → 409; unknown action →
400). Rides `scripts/ci.mjs` via selftest auto-discovery.
