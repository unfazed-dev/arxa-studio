# Job controls and background-agent insights

Status: **host half LANDED and proven live 2026-09-03.** D1, D2 and D5's first
assertion are done: `plugins/arxa-jobs` lists and cancels a real background job
through `ctx.get('jobs')`, and the cancel killed the actual OS process. The UI
(D4's rows in the chip) and D3's subagent wake box are NOT built yet.

## Why this exists

`session-naming-agent-controls-and-cicd-card.md` closed with six known gaps.
Gaps 1 and 2 were recorded as **blocked on dsh**:

> 1. **No job control exists in this dsh build.** Not a shortcut — there is no
>    `job.*` RPC, no jobs field on the ApiProxy, and `ctx.jobs` is composed
>    under the agent scope. […] Closing this needs a dsh-side API […], not a
>    client change.

That claim was re-tested on 2026-09-03 against a live engine. **Half of it is
wrong**, and the half that is wrong is the half that blocks the feature.

## What was actually measured (live engine, port 7897, 2026-09-03)

A temporary `agent.__probe` action was added to `plugins/arxa-sidebar/lib/index.js`
(the top-level arxa plugin whose reachability was in question), the engine was
restarted, the action was called over the real HTTP route, and the probe was
then reverted. Three reads per service:

| read | `jobs` | `subagents` |
|---|---|---|
| `ctx.reflect.get(name)` | **resolves** — full registry | **resolves** |
| bare `ctx.<name>` | throws `cannot get property "jobs" without inject` | throws, same |
| `ctx.get(name)` | **resolves** — full registry | **resolves** |

The registry handed back by `ctx.get('jobs')` exposes:
`start, list, get, read, kill, wait, onJobDone, onJobsChanged,
attachController, servesOwner, activeTaskCount, listenersFor, expect`.

`ctx.get('subagents')` exposes:
`startContinuable, followup, interrupt, reportFrom, registerContinuableSetup,
drainContinuableDescendants, drainContinuableChildren, listChildren,
listDescendants, registerProvider, getProvider, list, start`.

**So the recorded reason was wrong.** The comment at
`plugins/arxa-sidebar/lib/index.js:897-905` says both services are "composed
under the agent scope, so this context's `reflect.get` resolves neither."
`reflect.get` resolves **both**. Only the bare property read throws, and that
is cordis' inject discipline — not unreachability. The correct statement is
"reachable via `ctx.get`, not via a bare read."

## The fence — is reachable also callable?

Read from `@deepseek-ai/dsh-jobs-local/lib/index.js`, the loaded implementation:

```js
list(caller) {
  const session = caller?.id;
  return [...this.store.values()]
    .filter((job) => job.owner === void 0 || job.owner.id === session)
    .map((job) => this.snapshot(job));
}

assertAccess(job, caller) {
  if (job.owner !== void 0 && job.owner.id !== caller?.id)
    throw new Error(`job ${job.id} belongs to another session`);
}

kill(id, caller, reason) { … this.assertAccess(job, caller); … job.cancel(reason); … }
```

The fence is a **plain `.id` string comparison against any object the caller
passes**. There is no capability token, no signature, no Agent-identity check.
`jobs.list({ id: sessionId })` and `jobs.kill(jobId, { id: sessionId }, reason)`
from the host plugin would both work today.

`servesOwner(owner)` is the one method that genuinely needs a real Agent — it
reads `scopeOf(owner.ctx)` and threw `Cannot read properties of undefined
(reading 'Symbol(dsh.scope)')` when handed a string. It gates `start()`, not
`list()`/`kill()`.

`jobs.list()` with no argument returned `[]` and `activeTaskCount()` returned
`0` — correct, because no background job was running at probe time. That `[]`
is therefore **not** evidence of a fence; it is evidence of an empty registry.

**`caller.id` really is the session id** (checked after the grill, because D1
rests on it). `Agent` is declared at
`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:60-62`:

```ts
export interface Agent {
    /** The single identity shared with {@link session}. */
    readonly id: SessionId;
```

So `job.owner.id` is the owning session's id, and `{ id: sessionId }` matches it
exactly. Had `Agent` carried only `sessionId`, `list()` would have returned `[]`
silently — indistinguishable from the empty-registry result above, and D1 would
have been built on nothing.

## What genuinely IS blocked (re-confirmed, unchanged)

Checked against `@deepseek-ai/dsh-host-apiproxy/lib/types/api/rpc-map.d.ts`,
the authoritative wire contract. Complete verb list contains **no `job.*`**:

`credentials.describe/set/unset · goal.clear/complete/create/edit/pause/resume ·
host.createDirectory/describe/listDirectory/openPath/pickDirectory ·
llm.discoverModels/models/providers · session.attachment/cancel/create/fork/
history/list/models/prompt/rename/search/selectModel/updateQueue ·
settings.describe/mutate/openDocument/replace/update · skill.list ·
subagent.history/interrupt/list/prompt · workspace.*`

- **No `job.*` RPC.** Confirmed. Jobs reach the browser only as the push event
  `session/jobs` carrying `JobView[]`
  (`dsh-host-apiproxy/lib/types/api/events.d.ts:124`). Read-only, one direction.
  So a *client-side* job button remains impossible — but a **host-side** one is
  not, because the host holds the registry object itself.
- **No subagent terminate verb.** `subagent.*` is
  `history · interrupt · list · prompt`. Confirmed by the RPC map and by the
  `ctx.get('subagents')` method list above, which has no cancel/terminate.
- **`session.cancel` cannot stand in for it.** Its own doc
  (`api/sessions.d.ts:400-404`): "Stops an ordinary session's active turn […]
  **Session-backed subagents reject with `agent-busy`.**"
- **No resume verb.** `subagent.interrupt` doc: "Once the interrupted driver is
  idle, a waking send resumes the parked FIFO queue" — waking needs content a
  human writes. Gap 2 stands exactly as recorded.

## Composition facts

- The job REGISTRY (`@deepseek-ai/dsh-jobs-local`, row id `jobs`) is loaded by
  `@deepseek-ai/dsh-base/cordis.patch.yml:69`, beside `agent`,
  `agent-default-model`, `llm-retry` and `settings`.
- The model-facing TOOL (`@deepseek-ai/dsh-tool-jobs`) is what arxa's own agent
  preset carries (`profile/agent-presets/arxa/agent.cordis.yml:124`), and that
  file's own comment already states the split correctly: *"The task REGISTRY
  stays on the host plane […] The registry is keyed by owning agent anyway, so
  one host instance serves every session. What a preset chooses is whether its
  agent can collect and stop background work at all."*

That comment and the sidebar comment contradict each other. The preset comment
is the correct one.

## Test-coverage finding

`scripts/agent-services-probe.mjs:67` asserts:

```js
check('jobs are honestly declared uncontrollable (no job.* RPC exists in this build)',
  d.services.jobs === false && d.jobsControllable === false && d.jobsReason === 'no-job-api', …)
```

`services.jobs` is a **hardcoded literal `false`** in the handler
(`arxa-sidebar/lib/index.js`, `agent.list`). The assertion therefore pins the
shape of an honest refusal — a useful contract test — but it does **not** probe
whether jobs are controllable, despite the file being named a probe and the
check being worded as a finding about this build. Nothing in the suite would
fail if jobs became controllable tomorrow.

## Decisions (grilled 2026-09-03)

| # | Decision | Chosen |
|---|---|---|
| D1 | Drive `ctx.jobs` from the host | **Yes.** arxa is the host UI acting for the human, who owns every session in their own app. The `.id` fence exists to stop agent A touching agent B's jobs, not to stop the human's own window. Passing `{ id: sessionId }` is use, not circumvention. |
| D2 | Guard the undocumented seam | **CI gate + runtime degrade.** A selftest reads the installed `dsh-jobs-local` and asserts the fence is still the `.id` comparison, so a dsh upgrade is a loud RED naming the file. At runtime every registry call is wrapped; a throw falls back to today's honest `no-job-api` refusal. A user on a newer dsh gets a disabled button with a reason, never a crash. |
| D3 | Subagent control surface | **Pause + a real wake box; Cancel stays refused.** Pause keeps `subagent.interrupt`. The dead Resume button becomes a message box sending through `subagent.prompt`, whose contract is "delivers human content to a continuable child" — asking the human for the words is not inventing them. Cancel stays disabled with `no-terminate-verb`, because none exists anywhere in the build. Closes gap 2. |
| D4 | Background-work insight | **Live rows with real status + Cancel.** The jobs view round-trips to the host like subagents already do — real kind, label, status, elapsed, owner from the registry, refreshed on `onJobsChanged`. No new storage: a persisted history was considered and dropped, because `dsh-jobs-local` is in-memory only and a history would mean arxa owning a new on-disk log, its growth and its pruning. |
| D5 | How it is proven | **Offline selftest + one live cancel.** A selftest drives the real handler against a fake registry for the logic and every refusal path, plus the D2 gate. Then one live run: prompt a session to start a background `sleep`, watch it appear in the card, cancel it from the button, confirm it died. **The live run's FIRST assertion is that the job appears in `jobs.list({ id: sessionId })` at all** — the probe only ever saw an empty registry, so until one real job is observed through it, D1 and D4 rest on an inference, which is the exact shape of the fact this document corrects. |

| D6 | The stronger subagent stop, found after Q3 | **Not used.** `ctx.get('agents').get(sessionId)` returns the live `Agent`, whose `cancel(cause, {keepInbox})` aborts the active turn AND clears queued work — a harder stop than `interrupt`. It is deliberately NOT wired. The jobs seam is dsh *not offering* a wire verb; this is dsh's wire verb existing and **explicitly refusing** subagents (`session.cancel`: "Session-backed subagents reject with `agent-busy`"). Going around a refusal is not the same as using an unoffered seam, and D1's reasoning does not cover it. Cancel keeps `no-terminate-verb`. |

**Consequence of D6:** a runaway subagent still cannot be stopped from arxa.
That is a known, accepted cost. Revisit only if someone establishes *why*
`session.cancel` refuses subagents — if the reason turns out to be turn
accounting rather than authority, the answer may change.

### Consequences taken without a separate question

- **The wake box lives in the side panel only.** The previous grill established
  three subagent surfaces (side panel, dropdown row, hover). A text input
  cannot sensibly sit on a hover affordance or inside a dropdown row, so the
  other two keep Pause and a link into the panel.
- **`subagent.prompt` is continuable-only** (`Extract<SubagentAddress, {mode:
  'continuable'}>`). A one-shot child gets no wake box and keeps a stated
  reason, matching how Pause already distinguishes the two.
- **The jobs view stops reading the client store.** D4 makes it round-trip, so
  `state.jobsBySession` is no longer its source. The push event stays useful as
  a refresh trigger.
- **No database.** Nothing here touches Supabase or needs one, so the CLAUDE.md
  local-only contract is satisfied by construction rather than by a fallback.
- **The `no-job-api` refusal is kept, not deleted.** It becomes the degrade
  path (D2) rather than the permanent answer, so the honest-refusal shape that
  `scripts/agent-services-probe.mjs` pins stays meaningful.

### Correction owed to the record

`plugins/arxa-sidebar/lib/index.js:895-919` states both services are
unreachable and that jobs "cannot be cancelled from any plugin surface in this
build". That comment must be rewritten when this lands — it is the source the
gap note was drawn from, and it is wrong on the reachability claim while right
on the RPC claim. `scripts/agent-services-probe.mjs` must also gain a check
that actually probes rather than asserting a hardcoded literal.

## Live proof — 2026-09-03, engine on 7897

Not a probe this time: the real route, a real job, a real process.

A session was created (`session.create`, preset `arxa`) and prompted once, with
the only instruction being to run `sleep 400` in the background. Then, through
`POST /__arxa/jobs/action`:

```
jobs.list  { sessionId }  ->  rows: [{
  id: "bash-1", kind: "bash", label: "sleep 400", status: "running",
  ownerSession: "session-6d8d63eb-…", elapsedMs: 3040, live: true, canCancel: true }]
```

**The registry answered for a caller arxa minted itself** (`{ id: sessionId }`),
and `ownerSession` came back equal to that id — so the `.id` fence matches the
way `scripts/jobs-fence-check.mjs` asserts it does. This is the assertion D5
demanded before any UI was built, and it is the one the earlier note got wrong
by inference.

The fence also held against a caller who does not own the job:

```
jobs.cancel { sessionId: "someone-elses-session", jobId: "bash-1" }  ->  not-yours
jobs.list   { sessionId: "someone-elses-session" }                   ->  0 rows
```

And the cancel is real, not cosmetic:

```
OS `pgrep -f 'sleep 400'` before        1
jobs.cancel { sessionId, jobId }   ->   requested       (status: stopping)
  +2s                                   status: killed  live: false
OS `pgrep -f 'sleep 400'` after         0
jobs.cancel again                  ->   already-finished (ok, not an error)
```

`requested → stopping → killed` is reported honestly at each step: arxa never
claims "cancelled" while the producer is still settling.

## What landed

- `plugins/arxa-jobs/lib/index.js` — host half. `jobs.list` / `jobs.cancel` over
  `POST /__arxa/jobs/action`, reading the registry with `ctx.get('jobs')`. Every
  call wrapped; a missing service, a tightened fence and a broken call all
  degrade to the same `no-job-api` refusal (D2).
- `profile/cordis.patch.yml` — mounts it host-plane. The stock
  `dsh-client-ui-jobs` row is deliberately LEFT mounted: it is dsh's patch, not
  arxa's, and replacing it would make arxa diverge from stock on every upgrade.
- `scripts/jobs-fence-check.mjs` — the D2 CI gate, wired into `ci.mjs`. Proven
  to bite: hardening the installed fence with a `scopeOf()` check turned it RED,
  and restoring the file turned it green again.
- `plugins/arxa-jobs/selftest.mjs` — 23 assertions, offline, against a fake
  carrying the real fence. Covers elapsed-freezes-on-finish, the fence, all four
  refusal reasons, and a ctx that throws on the bare `ctx.jobs` read.
- `bin/arxa-studio.mjs` — `PROFILE_PLUGINS` row, so the packed desktop build
  cannot ship without it (the drift regression that broke a release before).

### The documented-API finding

dsh's own `cordis-plugin-development` skill, under "Access Services", says:
*"Read optional capabilities with `ctx.get(name)` by default and handle their
absence… Declare `inject` only when a Service is a hard dependency."* So
`ctx.get('jobs')` is not a loophole arxa found — it is the sanctioned way to
read an optional service, and the bare `ctx.jobs` that throws is the Guard doing
its job. This strengthens D1 from "permitted" to "documented", and confirms the
sidebar comment was wrong about the API as well as about the scope.

## The push proof — 2026-09-03, the gap the other tests could not reach

Every test written before this one was host-side. `JobView` is push-only, so
"the registry says killed" and "the human's screen says killed" are different
claims, and only the first had been checked. If `kill()` did not notify, an
arxa cancel would leave a **stale row on screen** — a user-visible bug that the
27 offline assertions and the fence gate are both structurally unable to catch.

The chain, read in the installed dsh:

| step | file | what it does |
|---|---|---|
| 1 | `dsh-jobs-local/lib/index.js:207` | `kill()` calls `notifyChanged(job.owner)` |
| 2 | `dsh-host-apiproxy/lib/index.js:3589` | subscribes `jobs.onJobsChanged`, pushes a `session/jobs` frame to `owner.id` |

Step 1 is handed the job's **stored** owner — a real Agent — not arxa's
synthetic `{ id }` caller. That is why a cancel made on the human's behalf still
addresses the right session.

Proven live by `scripts/jobs-push-proof.mjs`, which subscribes to the browser's
own channel (`ws /api/events.mux`, found after `readSse` turned out to be a
different transport and a bare GET answered `426 Upgrade Required`):

```
the channel announced the RUNNING job          bash-1:running
arxa cancel (host registry, synthetic caller)  requested
  << [bash-1:stopping]        \ two frames, 154ms after the cancel
  << [bash-1:killed]          /
second cancel                                  already-finished
```

It is **not in CI**: it needs a live engine and spends one real model call to
make a genuine background job. It creates its own scratch session, so no real
work is touched, and cancelling the job is both the test and the cleanup.

### The bug this caught

The live row read `endedAt`. **dsh has no such field** — the registry emits
`finishedAt` (`snapshot()`:328, set at :370; `JobView.finishedAt?`). So the read
was always `undefined`, a settled job fell through to `now`, and **a dead job's
elapsed time ticked upward forever** on screen.

The offline selftest passed the whole time, because its fake used the same
invented name. A fake is only worth what pins it to the real thing. Fixed in
three places, deliberately:

- `jobRow` reads `finishedAt`, and a settled job with no end stamp now reports
  elapsed `null` — blank renders as "unknown", a running clock asserts a lie.
- The selftest's fake uses dsh's real field names and covers the no-stamp case.
- `jobs-fence-check.mjs` now pins the snapshot field names, so a rename turns CI
  red instead of silently un-freezing the clock. Negative control: renaming
  `finishedAt` in the installed dsh made it FAIL, restoring made it pass.

## D4 landed — and it was smaller than planned

The plan assumed a new generated client plugin copying `dsh-client-ui-jobs`.
That was wrong: **arxa already had the chip.** `ArxaJobsPlaceholder`
(arxa-sidebar, order 19) renders `ArxaAgentControl` with real rows as soon as
`count > 0`, with a capability map, a menu and per-row verbs. Only the claim was
stale — `arxaJobRow` hardcoded `can.cancel: false, why: "no-job-api"`.

So D4 was three surgical changes, not a new plugin:

1. **The claim.** `cancel` is armed on `running` only. `stopping` is still live
   but a cancel is already in flight — arming it again invites a click that
   changes nothing. `pause` now refuses with `jobs-have-no-pause` (the status
   union has no paused member) rather than the stale `no-job-api`.
2. **The dispatch.** A job row goes to `/__arxa/jobs/action`, not the agent
   plane. No `load()` after: the registry's push repaints the menu in ~154ms,
   and re-fetching would race it.
3. **The duplicate.** See below.

### The stock chip came down, and the earlier reasoning was wrong

This document previously recorded leaving `dsh-client-ui-jobs` mounted, because
"replacing it would make arxa diverge from stock on every upgrade". Wrong twice:

- **It is not what leaving it produces.** `conversation.session.header.actions`
  is kind:list, `replaceRisk: none` — additive. arxa's chip and dsh's both read
  `state.jobsBySession`, so with one job running the header would show **two**
  job chips, and only arxa's could act.
- **Disabling costs no divergence.** `- id: ui-jobs / disabled: true` lives in
  *arxa's* patch; dsh's file is never touched and its package stays
  byte-identical. Rows 11a/11/11c already do exactly this for `ui-sidebar`,
  `ui-workspace` and `ui-layout`. Delete the row to revert.

The stock chip was the only surface showing a duration, so the arxa row **gained
elapsed** rather than losing it — same freeze rule as the host row, ticking once
a second only while the menu is open over a live job.

## Not yet done

- **D3's wake box.** `subagent.prompt` is confirmed as the sanctioned wake, but
  nothing is wired.
- **`busy` is per-menu, not per-row.** With two live jobs, cancelling one greys
  out both rows' buttons. Same class as the ticking clock; key it by row id.
- **The populated chip has never been SEEN.** Everything above is proven at the
  route level (live, twice, with the repaint push) and asserted at the source
  level, but no screenshot shows the button rendered: arxa's sidebar is
  org-based, so a scratch workspace never appears in it and the browser could
  not be driven onto a session holding a job. Only the empty branch is
  photographed. Worth one manual look next time a real background job runs.

### Closed since the last revision

- **The stale comment** at `plugins/arxa-sidebar/lib/index.js` is rewritten. It
  had generalised a true subagent result to jobs without probing them, and said
  jobs "cannot be cancelled from any plugin surface in this build".
- **`scripts/agent-services-probe.mjs`** now pins BOTH surfaces: the sidebar
  still declares jobs uncontrollable *from itself* (true — no `job.*` RPC on the
  agent plane), while arxa-jobs answers on the host plane. It skips the second
  check on engines without the route, so it still runs against older builds.

## A UI observation, not a defect

The live header shows `2 subagents ⌄` beside `No subagents`. Both are correct —
the first counts every subagent the session has ever had, the second counts live
ones — but read together they look like a contradiction. Worth a wording pass
whenever the header is next touched; nothing is wrong underneath.
