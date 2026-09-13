/**
 * Portable export/import bundles (task 13 step 7, §6 of the source plan).
 *
 * A bundle is provider-independent: versioned manifest.json, one JSONL per
 * collection in CONTRACT shape ({id, doc} lines — never provider rows),
 * members.json (emails + roles; identities are not portable), audit.jsonl,
 * and a storage/ blob tree. Hashes for every file live in the manifest and
 * are verified BEFORE any mutation on import — a tampered bundle is refused
 * whole, never half-applied. Nothing from the license plane (entitlements,
 * machines, subscriptions) or any credential ever enters a bundle.
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { COLLECTIONS, WIRE_VERSION } from './contract.js'
import { decodeJsonl, encodeJsonl } from './wire.js'
import { WorkspaceError, invalidRequest } from './errors.js'

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const jsonlText = (rows) => (rows.length ? encodeJsonl(rows) : '')

/** Read every record of a collection through the provider's own pagination. */
async function readAll (provider, orgId, collection) {
  const records = []
  let cursor
  do {
    const page = await provider.listRecords(orgId, collection, { cursor })
    records.push(...page.records)
    cursor = page.nextCursor
  } while (cursor !== null && cursor !== undefined)
  return records
}

/** List every file under dir as posix-ish relative paths. */
function walkFiles (dir, rel = []) {
  const out = []
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walkFiles(join(dir, e.name), [...rel, e.name]))
    else out.push({ path: [...rel, e.name].join('/'), file: join(dir, e.name) })
  }
  return out
}

export async function exportBundle (provider, orgId, outDir) {
  mkdirSync(outDir, { recursive: true })
  const org = await provider.getOrg(orgId)
  const members = await provider.listMembers(orgId)
  const manifest = {
    bundle: 1,
    wireVersion: WIRE_VERSION,
    exportedAt: new Date().toISOString(),
    org: { name: org.name, kind: org.kind },
    collections: {},
    blobs: {},
    members: members.map((m) => ({ email: m.email, role: m.role })),
    hashes: {},
  }
  for (const collection of COLLECTIONS) {
    const records = await readAll(provider, orgId, collection)
    manifest.collections[collection] = records.length
    writeFileSync(join(outDir, collection + '.jsonl'), jsonlText(records))
  }
  const audit = await provider.readAudit(orgId)
  writeFileSync(join(outDir, 'audit.jsonl'), jsonlText(audit))
  writeFileSync(join(outDir, 'members.json'), JSON.stringify(manifest.members, null, 2) + '\n')
  if (typeof provider.listBlobs === 'function') {
    for (const path of await provider.listBlobs(orgId)) {
      const bytes = await provider.getBlob(orgId, path)
      manifest.blobs[path] = sha256(bytes)
      const file = join(outDir, 'storage', ...path.split('/'))
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, bytes)
    }
  }
  for (const f of walkFiles(outDir)) manifest.hashes[f.path] = sha256(readFileSync(f.file))
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { manifest }
}

/**
 * Verify every manifest hash BEFORE the first mutation: a mismatched or
 * missing file refuses the whole import (the caller has changed nothing).
 */
export function verifyBundle (bundleDir) {
  const manifestFile = join(bundleDir, 'manifest.json')
  if (!existsSync(manifestFile)) throw invalidRequest('bundle has no manifest.json')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.bundle !== 1) throw invalidRequest('unknown bundle version')
  for (const [path, expected] of Object.entries(manifest.hashes ?? {})) {
    const file = join(bundleDir, ...path.split('/'))
    if (!existsSync(file)) throw invalidRequest('bundle file missing: ' + path)
    if (sha256(readFileSync(file)) !== expected) throw invalidRequest('bundle hash mismatch: ' + path)
  }
  return manifest
}

export async function importBundle (provider, bundleDir) {
  const manifest = verifyBundle(bundleDir) // refuses tampered bundles BEFORE any write
  const org = await provider.createOrg({ name: manifest.org.name + ' (imported)', kind: manifest.org.kind })
  const idMap = { org: org.id, records: {} }

  for (const collection of COLLECTIONS) {
    const file = join(bundleDir, collection + '.jsonl')
    if (!existsSync(file)) continue
    idMap.records[collection] = {}
    for (const { id, doc } of decodeJsonl(readFileSync(file, 'utf8'))) {
      try {
        await provider.putRecord(org.id, collection, id, doc)
      } catch (e) {
        if (!(e instanceof WorkspaceError)) throw e
        // IDs are preserved where the target accepts them; otherwise a fresh
        // id is written and recorded in the map (§6).
        const newId = id + '-' + randomUUID().slice(0, 8)
        await provider.putRecord(org.id, collection, newId, doc)
        idMap.records[collection][id] = newId
      }
    }
  }

  const storageDir = join(bundleDir, 'storage')
  if (typeof provider.putBlob === 'function') {
    for (const { path, file } of walkFiles(storageDir)) {
      await provider.putBlob(org.id, path, readFileSync(file))
    }
  }

  // Members are RE-INVITED through provider operations (they re-authenticate
  // on the new provider); identities themselves never move.
  for (const m of manifest.members ?? []) {
    try { await provider.addMember(org.id, { email: m.email, role: m.role }) } catch { /* already a member */ }
  }

  // Audit imports as read-only history, marked with its origin.
  const auditFile = join(bundleDir, 'audit.jsonl')
  if (existsSync(auditFile)) {
    for (const row of decodeJsonl(readFileSync(auditFile, 'utf8'))) {
      await provider.appendAudit(org.id, { ...row, imported: true, importedFrom: manifest.exportedAt })
    }
  }

  writeFileSync(join(bundleDir, 'id-map.json'), JSON.stringify(idMap, null, 2) + '\n')
  return { orgId: org.id, idMap }
}
