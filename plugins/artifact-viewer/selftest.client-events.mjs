// Task9: execute the production event matcher and pin the org viewer's
// server-side root filter separately from its direct-root read/write lane.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const client = fs.readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8')
const match = client.match(/function matchesArtifactEvent\(ev, relPath, eventRootId\) \{[\s\S]*?\n    \}/)
assert.ok(match, 'production event matcher is extractable')
const matchesArtifactEvent = Function('return (' + match[0] + ')')()

assert.equal(matchesArtifactEvent({ relPath: 'notes.md', rootId: 'org-a' }, 'notes.md', 'org-a'), true,
  'the org root event reloads the org file')
assert.equal(matchesArtifactEvent({ relPath: 'notes.md', rootId: 'fs-b' }, 'notes.md', 'org-a'), false,
  'same-relPath activity in another root is ignored')
assert.equal(matchesArtifactEvent({ relPath: 'other.md', rootId: 'org-a' }, 'notes.md', 'org-a'), false)
assert.equal(matchesArtifactEvent({ relPath: 'notes.md', rootId: null }, 'notes.md', null), true,
  'session worktree streams retain their rootless event contract')

assert.match(client, /state\.eventRootId \? '\?root=' \+ encodeURIComponent\(state\.eventRootId\)/,
  'org and direct-root viewers request a root-filtered stream')
assert.match(client, /fetchRoot\(rootId\)/,
  'artifact opens resolve the event root identity with their metadata')
console.log('GREEN artifact-viewer event root isolation')
