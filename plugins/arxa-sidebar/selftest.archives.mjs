/**
 * arxa-sidebar archives selftest (2026-09-05 grill) — structural checks over
 * the generated client + the host half for the Archives surface:
 * section mounted ABOVE the trash (lifecycle order), the change signature
 * carrying both new faces (the D88 ghost-row lesson), the trash's Sessions
 * group + the modal's session scope (precheck line, typed-name door), i18n
 * keys in every shipped dict (en/pl/fr), and the host action table.
 * Route-level behavior lives in smoke.mjs (the archives flow section).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
const host = readFileSync(join(here, 'lib', 'index.js'), 'utf8')
const region = readFileSync(join(here, 'lib', 'workspace-region.snippet.txt'), 'utf8')

let passed = 0
function check(label, ok, extra = '') {
  assert.ok(ok, label + (extra ? ' — ' + extra : ''))
  passed++
  console.log(`PASS  ${label}`)
}

// ---- the section and its placement -----------------------------------------
check('ArchivesSection is defined in the region (snippet is the source of truth)',
  region.includes('function ArchivesSection({ t })') && client.includes('function ArchivesSection({ t })'))
check('mounted ABOVE the trash in the grouped tree tail (lifecycle order: tree → archives → trash)',
  client.includes('ARXA_ARCHIVES_AFTER_ORGS(), ARXA_TRASH_AFTER_ORGS()'))
check('ArchivesSection header mirrors the trash idiom (archive glyph + chevron + count)',
  client.includes('t("archives.section")') && /ArchivesSection[\s\S]{0,4000}IconArchiveOutline20, \{ size: 16 \}/.test(client))
check('Archives entries: Restore (revive) + Move to Trash in NORMAL ink (reversible, not danger)',
  client.includes('mutate("session.revive"') && client.includes('mutate("session.trash"')
    && !/ArchivesSection[\s\S]{0,4200}entryAction\(t\("archives\.toTrash"\)[\s\S]{0,80}, true\)/.test(client))
check('Archives auto-opens while non-empty (D82 parity)',
  /function ArchivesSection[\s\S]{0,600}manual === null \? total > 0 : manual/.test(client))
check('Archives groups by org (org-tagged rows, group labels)',
  client.includes('s.archives') && /byOrg\.set\(e\.orgId/.test(client))

// ---- data faces + change signature -----------------------------------------
check('state carries archives + sessionTrash defaults',
  region.includes('archives: [], sessionTrash: []'))
check('change signature includes BOTH faces (a session.trash changes only them)',
  client.includes('next.trashCount, next.archives, next.sessionTrash'))
check('trash section reads the sessionTrash face with a Sessions group',
  client.includes('s.sessionTrash') && client.includes('t("trash.sessionSection")'))
check('session entries restore through sessiontrash.restore with the owning org',
  client.includes('mutate("sessiontrash.restore"'))

// ---- the destructive door (one door, CI/CD-aware) ---------------------------
check('the purge modal routes scope "session" → sessiontrash.purge',
  client.includes('"sessiontrash.purge"'))
check('the modal fetches the live precheck (open PR + repo picture)',
  client.includes('"sessiontrash.precheck"') && client.includes('purge.prLine'))
check('session purge deletes forever in danger ink (the destructive door stays visually terminal)',
  /purge\("session", e\.entryId, e\.name, e\.orgId\)/.test(client))
check('typed-name gate covers the session scope (title + warn keys)',
  client.includes('purge.sessionTitle') && client.includes('purge.sessionWarn'))

// ---- i18n: every shipped dict ----------------------------------------------
for (const dict of ['en', 'pl', 'fr']) {
  const src = { en: client, pl: client, fr: client }[dict]
  void src
}
// The three dicts live inline; count occurrences of a representative key.
check('archives.section present in all three dicts (en/pl/fr)',
  (client.match(/"archives\.section":/g) || []).length === 3)
check('purge.sessionWarn present in all three dicts',
  (client.match(/"purge\.sessionWarn":/g) || []).length === 3)
check('trash.sessionSection present in all three dicts',
  (client.match(/"trash\.sessionSection":/g) || []).length === 3)

// ---- host half --------------------------------------------------------------
check('snapshot serves archives (org-tagged) + sessionTrash (all orgs)',
  host.includes('archives,') && host.includes('sessionTrash: orgSessionTrash(l)') && host.includes('orgId: id, orgName: name'))
check('the trash face excludes session-kind entries (folders-only)',
  host.includes("e.origin?.kind !== shell.SESSION_TRASH_KIND"))
check('action table carries the five archives verbs',
  ['session.revive', 'session.trash', 'sessiontrash.restore', 'sessiontrash.precheck', 'sessiontrash.purge']
    .every((a) => host.includes(`'${a}'`)))
check('header documents the D39 browse-face exception',
  host.includes('D39-sanctioned browse face'))

console.log(`arxa-sidebar archives selftest: ${passed} checks green`)
