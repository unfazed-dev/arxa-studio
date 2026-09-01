# Vocabulary collisions — arxa ↔ arxa studio

Status: **inventory complete, resolutions proposed, not yet decided.**
Raised as blocking by the owner 2026-09-02, ahead of the version-management work.

## Why this is blocking

Both products are about to share a client-facing surface (`/ship/deploy`, the version
chip, the deliverable timeline). Today the same words name different things in each.
Any code that maps one product's noun onto the other's **by name** will be silently
wrong, and the docs already disagree with each other in print.

## The authority question — settle this first

**`arxa/docs/VOCABULARY.md` should be the SSOT for shared vocabulary.** Three reasons:

1. **It is a real glossary, not a word list.** 1109 lines, and every entry carries a
   plain-language line, a precise line, an **`_Avoid_`** list of forbidden synonyms, and
   a **`_Layer_`**. Studio's `CONTEXT.md` terms are single prose paragraphs.
2. **Its terms are implemented and enforced.** Freeze, Gate, Publish, Share Link and
   Draft Overlay all have running code behind them. Most of studio's contested terms
   (Version chip, the `versions.json` states) have **none** — §26–29 established five
   built-but-unwired mechanisms on the studio side.
3. **It already forbids the usages studio has adopted** — see the `_Avoid_` violations
   below. Studio drifted from a written standard, not into a vacuum.

**Therefore: studio renames. arxa does not.** The exceptions are two gaps where arxa is
genuinely missing a concept (§4).

## The collisions, with evidence

### 1. `Target` — HARD COLLISION, worst of the set

| | Definition |
|---|---|
| **arxa** `VOCABULARY.md:241` | *"The platforms a project ships to — iOS, Android, macOS, web — chosen once at project creation."* **"platform-only by contract"** |
| **studio** `CONTEXT.md:144` | *"the two fixed subfolders of every stage container: `website/` and `application/`"* |

arxa's definition says **platform-only by contract**. Studio uses the same word for a
pair of folders. **And it compounds:** arxa's `Artifact` entry (`:782`) carries
`_Avoid_: project, website, page` — studio's target is literally named `website/`.

**Two violations in one term. Studio must rename.**

### 2. `Publish` — HARD COLLISION, live in both products

| | Definition |
|---|---|
| **arxa** `VOCABULARY.md:1044` | *"The operator-triggered deploy of committed artifact source to the artifact's single stable share URL; never automatic, always from the Arxa Dial."* `_Avoid_: deploy (the pipeline verb this rides), save, push (git)` |
| **studio** `CONTEXT.md:22` | *"Creation **publishes** a private [GitHub repo]"* |

Studio uses `publish` for **creating a private GitHub repo** — the opposite of
client-facing. arxa uses it for **the client-facing deploy**, and explicitly forbids
calling that "deploy" — while studio's stage folder is named `08-deploy`.

**Studio already has the right word: `GitHub link` (`CONTEXT.md:55`).** Use it.

### 3. `Gate` — ALIGNED IN MEANING, VIOLATED IN PRACTICE

| | Definition |
|---|---|
| **arxa** `VOCABULARY.md:308` | *"An automatic check that either passes or stops the line — **and is proven able to fail, so a green gate means something.**"* |
| **studio** `CONTEXT.md:62` | *"the arxa-cicd check run on a stage-boundary commit"* |

**The words agree. The behaviour does not.** arxa's definition states the invariant as
its defining property — *proven able to fail*. **B11 is exactly that invariant broken:**
studio's project `check.sh` cannot fail for code reasons, so its green means nothing.

**This reframes B11 from a bug to a vocabulary violation with a written standard behind
it.** No rename needed — studio must make the word true.

### 4. `Draft` — collision, with room to resolve

| | Definition |
|---|---|
| **arxa** `VOCABULARY.md:1038` | **Draft Overlay** — *"the author's unsent adjustments … visible on their screen, invisible to clients until Publish"* |
| **studio** (proposed `versions.json`) | a version state the **client may see** |

Author-private versus client-visible: **opposite audiences**. Mitigation: arxa's term is
the two-word **"Draft Overlay"**, so bare `Draft` is not strictly taken — but using it
for a client-visible state directly next to arxa's author-private one invites the error.

### 5. `Approval` — THREE meanings, not two

| | Definition |
|---|---|
| **studio** `CONTEXT.md:127` | *"a pending interaction of kind approval"* — a **dsh human-in-the-loop prompt** |
| **arxa** `gate_freeze.dart` | `approval.lock` — **hash-bound pipeline** approval ("safe to scaffold from?") |
| **proposed** `versions.json` | **client sign-off** on a deliverable |

Three unrelated concepts, one word. Studio's is inherited from dsh and cannot simply be
renamed away; it must be **qualified** at every use.

### 6. Pipeline nouns — `intake` / `scaffold` / `review` / `deploy`

The same four words name **three different kinds of thing** (§29h):

| Model | What it is | Count |
|---|---|---|
| studio `00-moodboard … 08-deploy` | folder taxonomy — where files live | 10 |
| arxa `phases.dart` | FSM lifecycle state — where the run is | 7 |
| arxa `gateOrder` | check execution order — what runs | 14 |

Orthogonal axes, but name-colliding. Any stage→phase→gate mapping by name is wrong.

**Note also** `Stage` itself: arxa (`:111`) defines it as *"a user-facing phase of the
pipeline … rendered as a read-only timeline"*, while studio's is a **folder**. Studio
already says **"Stage container"**, which helps — but studio's ten do not correspond to
arxa's stage list (*"intake, design, freeze, build, ship"*).

## Proposed resolutions

| # | Term | Resolution |
|---|---|---|
| 1 | studio `Target` (`website/`+`application/`) | **Rename.** Candidates: **`Track`**, **`Lane`**, **`Deliverable kind`**. Frees `Target` for arxa's platforms and clears the `website` avoid-violation. |
| 2 | studio `publish` (GitHub repo) | **Rename to `link` / `connect`**, reusing studio's own existing `GitHub link`. Reserve `Publish` for arxa's client deploy. |
| 3 | `Gate` | **No rename — fix the behaviour.** Make studio's gate provably able to fail (B11/D113), per arxa's own definition. |
| 4 | studio version state `Draft` | **Rename** to avoid arxa's author-private Draft Overlay. Candidate: **`Working`** — or drop the state, since §26k mints at publish and a pre-publish client-visible state may not need to exist. |
| 5 | `Approval` | **Qualify every use**: `approval prompt` (dsh), `freeze approval` (arxa pipeline), `client sign-off` (deliverable). Never bare `approval` in shared docs. |
| 6 | Pipeline nouns | **Write the mapping down explicitly.** Never map stage↔phase↔gate by name in code; if a mapping is needed it is an explicit table, reviewed. |

## Two places arxa is missing a concept, not studio

Per §28a, the gaps run both ways — these are **not** studio renames:

- **arxa has no `superseded`.** Old versions are just earlier array entries in `_d_meta.json`. W3C defines superseded as a *relation* (replaced-by), and it needs a successor pointer.
- **arxa has no `changes-requested` equivalent in studio.** arxa's design status vocabulary (`design_tools.dart:2944-2949`) has it; studio's four states do not. Client objection opens new work, and that needs recording.

## What must NOT happen

Do not add a **sixth** vocabulary. The version work must adopt arxa's `Freeze`
(hash identity) and `Publish` (client deploy) as they are defined, rather than
introducing parallel studio terms that mean nearly-but-not-quite the same thing.

---

## V1 — DECIDED: `kind → target`, and it resolves the collision structurally

**Owner decision, 2026-09-02.** The tree gains one level:

```
<org>/projects/<slug>/<NN-stage>/<kind>/<target>/
                                  │       └─ ios, android, macos   (application)
                                  │          landing, docs, …      (website)
                                  └───────── application | website
```

- **`application/` and `website/` are the KIND.** (The owner's own word.)
- **The level below is the TARGET.**

### Why this is better than a rename

`ios` and `android` **genuinely are** arxa's targets — *"the platforms a project ships
to"* (`VOCABULARY.md:241`). Putting them at that level makes studio **agree with arxa**
rather than compete with it. The old `Target` = `{website, application}` usage
disappears on its own; nothing needs renaming to free the word.

It also clears the second violation: `website` stops being a *target* name, so it no
longer trips arxa's `Artifact` `_Avoid_: project, website, page`. It becomes a **kind**,
which arxa does not define.

### The accepted cost — write this down, do not leave it implied

`website/landing` is **not** a platform. arxa's contract says targets are
*"platform-only by contract"*, and that remains true **for the `application` kind
only**. For `website`, `target` means *the concrete thing shipped*.

**The shared glossary must state this explicitly**, or the next reader will find
`website/landing` and conclude the contract was broken by accident. Proposed wording for
studio's `CONTEXT.md`:

> **Kind** — one of the two fixed subfolders of every stage container: `application/`
> and `website/`.
> **Target** — the concrete thing shipped, one level under a kind. For `application/`
> these are arxa platforms (`ios`, `android`, `macos`) and arxa's platform-only contract
> holds. For `website/` they are site types (`landing`, `docs`); the platform is always
> web and is therefore left implicit.

## V2 — Work this forces

### Template v4 — an additive migration, following the existing pattern

`MIGRATIONS` in `plugins/workspace/lib/migrate.js:85` is a chain of
`{from, to, description, apply(orgPath)}`, and it is **additive only** — *"create
missing template dirs, never touch existing content"*. A `{from: 3, to: 4}` entry is
exactly the shape already used twice.

| File | Change |
|---|---|
| `plugins/workspace/lib/template.js:9` | `TEMPLATE_VERSION` 3 → **4** |
| `plugins/workspace/lib/template.js:122` | `PROJECT_TARGETS_V2 = ['website','application']` becomes the **kind** list; add a per-kind **target** list |
| `plugins/workspace/lib/migrate.js:85` | add the `{from: 3, to: 4}` additive migration |
| `CONTEXT.md:144` | rewrite `Target`; add `Kind` (wording above) |
| selftests | *"selftests pin the pair"* (`CONTEXT.md:146`) — must now pin kind **and** target |

### ⚠️ D113's gate walk changes depth — catch this now

D113 (in `arxa-isolation-levels.md`) specified the project gate walks
`<stage>/website/` and `<stage>/application/`. **Under V1 it must walk
`<stage>/<kind>/<target>/`.** The Dart probe belongs at
`application/<platform>/`, not at `application/`.

**This must land in the same change as the template bump**, or the gate silently
resumes testing nothing — which is B11 all over again, at one level deeper.

### Default targets at creation

Open: what does a new project scaffold with? Creating all of
`ios/android/macos/landing/docs` up front contradicts arxa, where **targets are
"chosen once at project creation"** (`VOCABULARY.md:241`). **Recommendation: ask at
project creation and scaffold only the chosen targets** — matching arxa's model
exactly, and avoiding ten empty folders per stage.

## V3 — The two gaps, now accepted as work

Both were identified in §28a of `arxa-isolation-levels.md`. Neither is a rename; each
side is missing a concept the other has.

### Gap 1 — arxa has no `superseded`

Old versions in `_d_meta.json` are simply earlier entries in `assets.<name>.versions[]`.
W3C defines superseded as a **relation** ("replaced by a newer version"), and
21 CFR 820.40(a) requires obsolete versions be *"prevented from unintended use"* —
which an implicit array position does not satisfy.

**Fix:** add an explicit `supersededBy` pointer on the superseded entry. **This is an
arxa-side change**, and it is the studio side that needs it, so it must be agreed
across both.

### Gap 2 — studio has no `changes-requested`

arxa's design status vocabulary (`design_tools.dart:2944-2949`) is
`needs-review | approved | changes-requested`. Studio's four states have no rejection
state at all.

This matters because of §26k: **client objection opens new work** (AIGA pairs objection
with *cure*), so a rejection must be recordable and distinguishable from "not yet
reviewed". Without it, a rejected deliverable is indistinguishable from an unreviewed
one.

**Fix:** studio adopts `changes-requested`, spelled exactly as arxa spells it.

### Reminder from §28e — neither side's states have ever run

`_d_meta.json` live data is **100 % `needs-review`, one version per asset, zero
accumulation**. Studio's `versions.json` exists nowhere on disk. **Adding two states to
two unexercised state machines means the first implementation exercises all of it for
the first time.** Budget for the states being wrong, not merely unwired.
