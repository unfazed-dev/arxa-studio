# Task 8 Step 3 — native Polish review

Reviewer: native-Polish UI-translation reviewer (dispatch role). Read-only; HEAD d3a7c47, branch closeout-2026-09-12. Sources reviewed where they live (client.js dictionaries; git-card/sidebar/artifact-viewer keep their dicts in `lib/client.js`, workspace-provider/personalisation/theme-accent same — no separate generator found, per task-8 report §8's extractor probing the same files).

### Keys reviewed

| Plugin | Keys | Note |
|---|---|---|
| personalisation | 9 | full tab dict (en vs pl, all 9) |
| theme-accent | 20 | full dict |
| arxa-git-card | 107 | full pl dict; task-scoped subsets (gate/checks strip, ledger strip, tier shift, relink, confirm dialogs, finish) line-by-line against en |
| arxa-sidebar | 20 | scoped: `session.new.err.mainRed`, `trash.*` (8), `freestyle.trash.*` (6), `newSession.repoNeeded`/`initRepo` (repair CTA), `menu.org/project.sweep` (2), `github.signin.required` |
| workspace-provider | 14 | full DICT (backend settings, sign-in states, badges) |
| sandbox | 0 | no client dictionary exists (no client.js) — confinement copy is git-card's `git.tier.shift` (parity-covered); informational, matches task-8 report §34 |
| artifact-viewer | 4 literals | install strip — see verdict row 1 |

Total ≈ 174 keys/literals.

### Verdicts

| Key | Current Polish | Proposed correction | Reason | Severity |
|---|---|---|---|---|
| artifact-viewer `lib/client.js:888-897` (install strip — no keys exist) | `'No {lang} language server.'`, `'— install its SDK ({cmd}) to get one.'`, `'Install'`, `'Installing…'` (hardcoded English) | add dict keys, e.g. `lsp.none`: „Brak serwera języka {lang}.”, `lsp.hint`: „Brak serwera języka {lang} — zainstaluj jego SDK ({cmd}), aby go uzyskać.”, `lsp.install`: „Zainstaluj”, `lsp.installing`: „Instalowanie…” | key-set mismatch: scoped surface ships English-only; raw literals bypass the locale service entirely | must-fix |
| git-card `git.wakeStarted` | Budzenie runnera — **kontrole** wznowią się, gdy się zgłosi. | Budzenie runnera — **testy** wznowią się, gdy się zgłosi. | consistency: "checks" = „testy” in the other 14 keys of this dict (`git.checks.*`, `git.ci.*`, `git.pr.checks`); two words for one concept on the same card | must-fix |
| git-card `git.ledger.summary` + `git.ledger.view` | dostawa · {detail} / Rejestr dostawy | dostarczanie · {detail} / Rejestr dostarczania | consistency: arxa-dashboard ships `group.delivery`: „Dostarczanie”; „dostawa” reads as parcel delivery | nice-to-fix |
| git-card `git.checks.light` | testy lekkie | lekkie testy | naturalness (postposed adjective reads as classification, not a state) | nice-to-fix |
| git-card `git.changed` + `git.untracked` | {n} zmienionych / {n} nieśledzonych | zmienione: {n} / nieśledzone: {n} | grammar: genitive-plural breaks at n=1–4 („1 zmienionych”); colon-form is grammatical for all n and has in-dict precedent (`git.ledger.next`: „następny: {next}”) | nice-to-fix |
| git-card `git.confirm.mint.body` | …następna idzie do przodu, nigdy po tej. | …następna idzie naprzód, nigdy ponad tę. | meaning drift: en "never over this one" (no overwrite), „po tej” = "after this one" | nice-to-fix |
| git-card `git.relink` | Połącz ponownie GitHub | Połącz ponownie z GitHubem | grammar (missing preposition/case) | nice-to-fix |
| git-card `git.relinkNeeded` | Sesja GitHub wygasła | Wygasło logowanie do GitHub | en "GitHub sign-in expired"; „sesja” collides with the product's Session term | nice-to-fix |
| theme-accent `palette.desc` | Dotknij paska… dotknij próbki… | Kliknij paska… kliknij próbki… | naturalness: „dotknij” is touch-speak; desktop studio UI says „kliknij” | nice-to-fix |
| theme-accent `palette.pasteHint` + `palette.err` | adres coolors | adres URL z serwisu coolors | naturalness (product name preserved either way) | nice-to-fix |
| theme-accent `palette.noteAdjusted` | akcent dostosowany dla kontrastu | akcent dostosowany pod kątem kontrastu | naturalness (calque of "for contrast") | nice-to-fix |
| theme-accent `font.desc` | Monospace używany przez edytor artifact viewer. | Czcionka monospace używana w edytorze artifact viewer. | naturalness: bare „Monospace” + „przez” apposition is clunky; protected term "artifact viewer" stays verbatim | nice-to-fix |
| workspace-provider `badgeLive` | na żywo | działa | naturalness: „na żywo” = live broadcast; capability badge wants działa/ograniczony/wyłączony | nice-to-fix |
| workspace-provider `licenseLine` | Licencja arxa: oficjalny backend Totem | Licencja arxa: oficjalny backend Totemu | grammar (genitive declension of the proper noun) | nice-to-fix |

### Confirmed-good

Overall quality is high — the modal bodies (`git.confirm.*`, trash, sweep, repair CTA) read like hand-written Polish, not MT: „Konflikt zatrzyma scalanie w połowie — dokończysz je z karty”, „Uprzątnij scalone sesje”, „main jest czerwony — napraw main przed rozpoczęciem sesji”. Product terms preserved everywhere verified: main, pull request/PR, GitHub, wip, Trash→Kosz (consistent org + freestyle), coolors, Fira Code, AA, hex, artifact viewer, Supabase, Wire v1; commands/paths untouched (`svc.sh start`, `~/.arxa/runners/<owner>__<name>`, `github.com/login/device`, `arxa-studio provider verify`). Diacritics and typography correct throughout (no stray ASCII look-alikes; em dashes/middots consistent with the en design). Length: Polish runs 10–25% longer as expected; worst button case `git.pr.create` (30 vs 26 chars) is within shipped sibling norms — no overflow risk found. „testy” for checks and „Bramka” for Gate are defensible in-register choices, internally consistent (outside the two rows above).

### Overall

**NEEDS-CORRECTIONS — 2 must-fix, 12 nice-to-fix.** The must-fixes: (1) the artifact-viewer install strip is not localized at all — it needs dictionary keys in en/pl/fr and `t()` wiring before the locale closeout can claim the touched surfaces complete; (2) the one-word `kontrole`→`testy` alignment in git-card. Everything else is polish, safe to batch or defer.
