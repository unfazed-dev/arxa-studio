/** Public surface of the workspace-index plugin (Phase 2, D46). */
export { openBackend, FORMAT_VERSION, INDEX_DIR, INDEX_FILE } from './backend.js'
export { scanWorkspace, CATEGORIES } from './scan.js'
export { appendFact, readFactEvents, deriveFactState } from './facts.js'
export { rebuild } from './rebuild.js'
