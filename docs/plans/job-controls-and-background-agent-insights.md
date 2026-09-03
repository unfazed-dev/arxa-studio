# Job controls and background-agent insights

Status: **grilling in progress 2026-09-03.** Facts below are verified; the
decisions are not taken yet. Nothing is implemented.

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

## Open decisions — to be grilled, one at a time

1. Should arxa drive `ctx.jobs` directly from the host, given the fence is an
   id comparison rather than an authorization boundary?
2. If yes: which verbs — list only, or list + kill?
3. What is the honest label for a subagent that can be interrupted but never
   terminated or resumed?
4. Do background agents/jobs get an insight view, and what does it show?
5. What must be true for any of it to be testable without a live model turn?

## Not yet done

- Nothing implemented.
- No live background job has been observed through the host registry — the
  probe ran against an empty registry. A run with a real `run_in_background`
  job is required before any list/kill claim is called verified.
