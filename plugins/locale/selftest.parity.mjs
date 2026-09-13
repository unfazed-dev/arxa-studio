#!/usr/bin/env node
// arxa-locale parity gate — ONE place that enforces the closeout contract:
// every user-facing dictionary arxa studio ships carries IDENTICAL key sets
// in en/pl/fr (task 8, docs/plans/dsh-plugin-ui-conformance.md). English is
// the source set and the fallback; a missing translation shows English
// through the stock lookup chain, but the closeout law is parity — a sparse
// table is a bug, not a degradation.
//
// Scopes (owners per the task-8 Files list):
//   * arxa-locale itself: common ns + settings.locale ns (whole tables)
//   * arxa-sidebar: the workspace-region override dictionaries (enOver is
//     the arxa vocabulary; plOver/frOver must mirror it key-for-key). The
//     STOCK shell/workspace keys ride along en/zh-only by design — the
//     per-key fallback covers them and they are not arxa copy — EXCEPT the
//     shell's arxa-added key, which is pinned individually below.
//   * arxa-git-card, artifact-viewer, workspace-provider: whole tables
//   * personalisation, theme-accent: the Settings > Personalisation tab
//     (en/pl/fr through the arxa-locale service — added by task 8)
//
// Run standalone: node plugins/locale/selftest.parity.mjs  (CI auto-discovers)
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}
const src = (rel) => readFileSync(join(repo, rel), 'utf8')

/** Extract the object literal assigned to `const NAME = {…}` (brace-balanced, string-aware). */
function objLit (source, name) {
  // `name` is a regex-safe fragment (callers escape `$` as `\$` for minified consts like en$1)
  const m = source.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\{`))
  if (!m) return null
  const start = source.indexOf('{', m.index)
  let depth = 0, end = -1, quote = null
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return end === -1 ? null : source.slice(start, end + 1)
}
// Keys may be quoted ("section.workspaces") or bare (sectionTitle); values in
// every one of these dictionaries are string literals. Requiring a key
// position (after `{`, `,` or newline) plus the value's opening quote keeps
// prose colons inside values (e.g. 'format:') from reading as keys.
const keys = (lit) => new Set([...lit.matchAll(/(?:^|[,{\n])\s*["']?([\w.\-$]+)["']?\s*:\s*["']/g)].map((m) => m[1]))

/** Extract the object literal at a property `NAME: {…}` (for tables inside a DICT const). */
function propLit (source, name) {
  const m = source.match(new RegExp(`(?:^|[,{\\n\\s])${name}\\s*:\\s*\\{`))
  if (!m) return null
  const start = source.indexOf('{', m.index + m[0].length - 1)
  let depth = 0, end = -1, quote = null
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  return end === -1 ? null : source.slice(start, end + 1)
}

/** Assert en/pl/fr key-set identity for one dictionary owner. */
function parity (owner, enLit, plLit, frLit, note = '') {
  const missing = (a, b) => [...a].filter((k) => !b.has(k))
  check(`parity: ${owner} en/pl/fr key sets identical${note ? ` (${note})` : ''}`,
    enLit && plLit && frLit,
    enLit ? (plLit ? (frLit ? '' : 'fr table missing') : 'pl table missing') : 'en table missing')
  if (!enLit || !plLit || !frLit) return
  const en = keys(enLit), pl = keys(plLit), fr = keys(frLit)
  check(`parity: ${owner} pl covers en (${en.size} keys)`, missing(en, pl).length === 0,
    `missing: ${missing(en, pl).join(', ')}`)
  check(`parity: ${owner} fr covers en`, missing(en, fr).length === 0,
    `missing: ${missing(en, fr).join(', ')}`)
  check(`parity: ${owner} no extra pl keys`, missing(pl, en).length === 0,
    `extra: ${missing(pl, en).join(', ')}`)
  check(`parity: ${owner} no extra fr keys`, missing(fr, en).length === 0,
    `extra: ${missing(fr, en).join(', ')}`)
  check(`parity: ${owner} pl is a real translation`, enLit !== plLit)
  check(`parity: ${owner} fr is a real translation`, enLit !== frLit)
}

// ---- 1. arxa-locale: common + settings namespaces ------------------------------
{
  const client = src('plugins/locale/lib/client.js')
  parity('arxa-locale common', objLit(client, 'en\\$1'), objLit(client, 'pl\\$1'), objLit(client, 'fr\\$1'), 'en$1/pl$1/fr$1')
  // the settings.locale ns spells three one-key tables inline; pin them by needle
  check('parity: arxa-locale settings.locale carries language.title in en/pl/fr',
    client.includes('const pl = { "language.title": "Język" };') && client.includes('const fr = { "language.title": "Langue" };'))
}

// ---- 2. arxa-sidebar: workspace override dictionaries ---------------------------
{
  const snippet = src('plugins/arxa-sidebar/lib/workspace-region.snippet.txt')
  parity('arxa-sidebar workspace region', objLit(snippet, 'enOver'), objLit(snippet, 'plOver'), objLit(snippet, 'frOver'), 'enOver/plOver/frOver')

  // The shell's arxa-added key: sparse pl/fr are the documented stock-fallback
  // policy, but the key D111 ADDED must exist in all three shell tables.
  const shell = src('plugins/arxa-sidebar/lib/client.js')
  for (const [loc, value] of [['en', 'main is red'], ['pl', 'main jest czerwony'], ['fr', 'main est au rouge']]) {
    check(`parity: arxa-sidebar shell session.new.err.mainRed translated (${loc})`,
      new RegExp(`"session\\.new\\.err\\.mainRed": "[^"]*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"]*"`).test(shell))
  }
}

// ---- 3. whole-table owners ------------------------------------------------------
{
  const gc = src('plugins/arxa-git-card/lib/client.js')
  parity('arxa-git-card', objLit(gc, 'en'), objLit(gc, 'pl'), objLit(gc, 'fr'))

  const av = src('plugins/artifact-viewer/lib/client.js')
  parity('artifact-viewer', objLit(av, 'en'), objLit(av, 'pl'), objLit(av, 'fr'))

  const wp = src('plugins/workspace-provider/lib/client.js')
  const dict = objLit(wp, 'DICT')
  const inner = (loc) => dict && propLit(dict, loc)
  parity('workspace-provider', inner('en'), inner('pl'), inner('fr'), 'DICT tables')
  check('parity: workspace-provider registers en/pl/fr through arxa-locale',
    wp.includes('ctx.locale.register(NS, { en: DICT.en, pl: DICT.pl, fr: DICT.fr })'))
}

// ---- 4. the Personalisation tab (task 8's addition) ------------------------------
{
  for (const owner of ['personalisation', 'theme-accent']) {
    const client = src(`plugins/${owner}/lib/client.js`)
    const dict = objLit(client, 'DICT')
    const inner = (loc) => dict && propLit(dict, loc)
    parity(`arxa-${owner}`, inner('en'), inner('pl'), inner('fr'), 'Settings > Personalisation tab')
    check(`parity: arxa-${owner} registers its tables through the arxa-locale service`,
      /ctx\.effect\(\(\)\s*=>\s*ctx\.locale\.register\(NS,\s*\{\s*en:\s*DICT\.en,\s*pl:\s*DICT\.pl,\s*fr:\s*DICT\.fr\s*\}\)/.test(client))
    check(`parity: arxa-${owner} declares locale on its slot registrations`, /locale:\s*NS/.test(client))
  }
}

console.log(failures === 0 ? 'locale parity: all green' : `locale parity: ${failures} FAILURE(S)`)
process.exitCode = failures === 0 ? 0 : 1
