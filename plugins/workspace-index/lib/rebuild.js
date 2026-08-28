/**
 * rebuild(root) — clear the index and fully rescan the workspace tree.
 *
 * This is the whole recovery story (D46): the index is a pure derived cache,
 * so every problem — corruption, format change, external edits, deletion —
 * is fixed by clear + rescan. No migrations, no reconciliation.
 *
 * Note on cost: clear+rescan is O(workspace). Fine for the current scale;
 * if workspaces reach tens of thousands of files, measure before bolting on
 * incremental invalidation.
 */

import { openBackend } from './backend.js'
import { scanWorkspace } from './scan.js'
import { deriveFactState } from './facts.js'

/**
 * Rebuild the index for `root`. Reuses `backend` if given (must belong to the
 * same root), otherwise opens one. Returns { backend, counts }; caller owns
 * closing the backend.
 */
export function rebuild(root, backend = openBackend(root)) {
  backend.clear()
  const { orgs, projects, files } = scanWorkspace(root)
  for (const org of orgs) backend.put('orgs', org.path, org)
  for (const project of projects) backend.put('projects', project.path, project)
  for (const file of files) backend.put('files', file.path, file)
  // Cache the facts derivation per org (the JSONL logs remain the truth).
  for (const org of orgs) {
    backend.put('facts_state', org.slug, {
      orgSlug: org.slug,
      orgId: org.id,
      state: deriveFactState(root, org.slug),
    })
  }
  return {
    backend,
    counts: {
      orgs: orgs.length,
      projects: projects.length,
      files: files.length,
    },
  }
}
