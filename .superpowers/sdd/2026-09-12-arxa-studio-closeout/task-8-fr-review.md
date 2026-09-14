# Task 8 Step 3 — native French review (fr vs en source keys)

Reviewer scope: translation quality only. Sources reviewed at HEAD `d3a7c47`.
Sibling-convention checks done against shipped fr keys (curly apostrophe `’`,
espace before `: ?`, `p. ex.`, branch/product names verbatim). Key parity
verified by count (en = fr) for every full dict below.

### Keys reviewed

| Plugin | Keys | Note |
|---|---|---|
| personalisation | 9 | full dict (en vs fr) |
| theme-accent | 20 | full dict; note-key concatenation verified against usage (`palette.noteMarks` concatenates ratio digits — `atteint 4.5:6.2:1` — not `contraste`) |
| arxa-git-card | 108 | full fr dict line-by-line against en; task subsets (gate row, tier shift, runner/frame, relink/wake, checks strip, ledger strip, confirm dialogs, finish) given closest scrutiny |
| arxa-sidebar | 20 | scoped, mirroring the pl review: `session.new.err.mainRed`, trash family (8), `freestyle.trash.*` (6), `newSession.repoNeeded`/`initRepo` (repair CTA), `menu.org/project.sweep` (2), `github.signin.required` |
| workspace-provider | 14 | full DICT (backend settings, sign-in states, degraded badges) |
| sandbox | 0 | no client dictionary exists — the confinement copy rides git-card `git.tier.shift`; `effective-tier.js` emits English machine vocabulary only. Informational, matches the pl review |
| artifact-viewer | 4 literals | install strip — see verdict row 1 |

Total: 171 dictionary keys + 4 raw literals.

### Verdicts

| Key | Current French | Proposed correction | Reason | Severity |
|---|---|---|---|---|
| artifact-viewer `lib/client.js:888-897` (install strip — no keys exist) | `'No {lang} language server.'`, `'No {lang} language server — install its SDK ({cmd}) to get one.'`, `'Install'`, `'Installing…'` (hardcoded English) | add dict keys: `lsp.none`: « Aucun serveur de langage {lang}. », `lsp.hint`: « Aucun serveur de langage {lang} — installez son SDK ({cmd}) pour en obtenir un. », `lsp.install`: « Installer », `lsp.installing`: « Installation… » | key-set mismatch: scoped surface ships English-only; raw literals bypass the locale service entirely (confirms the Polish finding symmetrically in fr) | must-fix |
| git-card `git.parked` | **Porte rouge** — commit mis de côté, arbre rembobiné | **Gate rouge** — commit mis de côté, arbre rembobiné | "Gate" is a CONTEXT.md glossary term (the arxa-cicd check run); « porte » = household door, misleading. pl kept the term (« Bramka czerwona »). Keeping the English loan « Gate » is the convention in French dev UI | must-fix |
| git-card `git.wakeStarted` | Réveil du runner — les **contrôles** reprennent dès qu’il répond. | Réveil du runner — les **vérifications** reprennent dès qu’il répond. | consistency: "checks" = « vérifications » in the other 14 keys of this dict (`git.checks.*`, `git.ci.*`, `git.pr.checks`); two words for one concept on the same card (symmetric to the pl must-fix `kontrole`→`testy`) | must-fix |
| workspace-provider `badgeLive` | en direct | actif | « en direct » = live broadcast; a capability badge wants actif / dégradé / désactivé (symmetric to the pl « na żywo » finding) | nice-to-fix |
| workspace-provider `signInBrowser` | Connexion navigateur | Connexion dans le navigateur | missing preposition; the telegraphic apposition is ungrammatical-leaning and siblings (`signInDeviceCode`: « Code d’appareil ») carry the pattern only where natural | nice-to-fix |
| git-card `git.relinkNeeded` | Session GitHub expirée | Connexion GitHub expirée | « session » collides with the product's Session term (worktree + branch); en is "GitHub sign-in expired" (symmetric to the pl finding) | nice-to-fix |
| git-card `git.askDraft` | Demander à la session un sujet | Demander à la session de rédiger le sujet | en "Ask the session to draft the subject" — the drafting act is dropped; length still fits sibling buttons (« Pousser et ouvrir une pull request ») | nice-to-fix |
| git-card `git.changed`, `git.staged`, `git.unstaged`, `git.untracked` | {n} modifiés / {n} indexés / {n} non indexés / {n} non suivis | {n} modifié(s) / {n} indexé(s) / {n} non indexé(s) / {n} non suivi(s) | grammar: plural participles break at n = 1 (« 1 modifiés »); the (s) form is standard French UI and length-neutral (pl review took the same class of fix) | nice-to-fix |
| git-card `git.frame.wired` | cadre **câblé** | cadre **connecté** | « câblé » = physically cabled; a native reads branché/connecté for "wired" (pl used « podłączona » = connected). Keep « cadre » to mirror pl « rama » | nice-to-fix |
| git-card `git.confirm.merge.body` | …et la carte ne l’annule pas. | …et la carte n’offre aucun retour arrière. | meaning drift: en "the card has no undo for it" (capability absent), not "the card does not undo it" | nice-to-fix |
| theme-accent `palette.desc` | **Touchez** une bande… une pastille… | **Cliquez sur** une bande pour choisir la palette, sur une pastille pour définir l’accent. | « touchez » is touch-speak; desktop studio UI says cliquez (symmetric to the pl « dotknij » finding) | nice-to-fix |
| theme-accent `font.desc` | **Monospace utilisée** par l’éditeur de l’artifact viewer. | **Police monospace utilisée** par l’éditeur de l’artifact viewer. Fira Code ajoute des ligatures. | bare elliptical subject + participle-gender ambiguity; « Police monospace… » fixes both; protected term "artifact viewer" stays verbatim either way | nice-to-fix |
| theme-accent `palette.noteOffline` | moteur de contraste **hors ligne** | moteur de contraste **indisponible** | « hors ligne » implies network offline; the engine failed to load. pl already chose « niedostępny » (unavailable) — align | nice-to-fix |
| sidebar `archives.toTrash` | Déplacer **dans** la corbeille | Déplacer **vers** la corbeille | same "Move to Trash" action as `menu.org.trash`, `menu.project.trash`, `freestyle.menu.trash` — all ship « vers »; one outlier says « dans » | nice-to-fix |
| sidebar `newSession.repoNeeded` (repair CTA) | …les sessions **se branchent sur** son premier instantané. | …les sessions **démarrent à partir de** son premier instantané. | « se brancher sur » reads as plugging in; en "branch from its first snapshot" wants a start-point verb | nice-to-fix |
| sidebar terminology (cross-key) | `dépôt` in `menu.org.sweep`, `newSession.repoNeeded`, `newSession.initRepo` vs `repo` in `github.signin.desc`, `purge.*`, `rename.orgNote` (and `dépôt Git` capital G vs `dépôt git` in the sibling key) | pick one term for "repository" across the sidebar fr (recommend « dépôt », the proper French, or match the majority « repo »), and lowercase « git » consistently | terminology consistency across surfaces; also a straight apostrophe in `n’a pas` vs curly `’` elsewhere in the same key set | nice-to-fix |

### Confirmed-good

The remaining 158 keys are correct, natural French with proper accents, elisions (l’adresse-type elisions throughout), French typographic conventions matching shipped siblings (espace before `:` and `?`, « p. ex. », guillemets in sidebar copy), correct gender/plural agreements, IDs/paths/branches/commands preserved verbatim (`main`, `svc.sh start`, `~/.arxa/runners/<owner>__<name>`, `github.com/login/device`, `arxa-studio provider verify`, `coolors`, `Fira Code`, `AA/APCA`, `Wire v1`, `Totem`, `artifact viewer`), and `git.ledger.*` « livraison » correctly matching arxa-dashboard's shipped `group.delivery`: « Livraison ».

### Overall

**NEEDS-CORRECTIONS — 3 must-fix, 13 nice-to-fix.** The must-fixes: (1) the artifact-viewer install strip is not localized at all — it needs dictionary keys in en/pl/fr and `t()` wiring before the locale closeout can claim the touched surfaces complete (confirms the Polish finding); (2) `git.parked` « Porte rouge » mistranslates the CONTEXT.md product term Gate; (3) the one-word « contrôles » → « vérifications » alignment in `git.wakeStarted`. Everything else is polish, safe to batch or defer.
