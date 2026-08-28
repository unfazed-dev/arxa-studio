// arxa-sidebar CTA state machine — the single source of truth for which
// call-to-action buttons the sidebar shows. Runs SERVER-SIDE (lib/index.js
// computes CTAs into the /__arxa/sidebar/state response; the client renders
// what it receives), so this file is plain Node ESM and selftest.mjs drives
// it directly.
//
// Six states (docs/plans/file-org-shell-integration.md, Phase B):
//   1. no-org            → Open organisation / New organisation
//   2. empty-org         → New project
//   3. project-selected  → New session
//   4. session-parked    → Resume / Merge (parked worktree sessions on the
//                          selected project)
//   5. trash-non-empty   → Restore (additive: shown alongside the state CTA)
//   6. ci-reserved       → reserved stub slot for the D3 CI trigger — always
//                          present, disabled until D3 lands.

/** Every state the machine can report. Order is display order. */
export const CTA_STATES = [
  'no-org',
  'empty-org',
  'project-selected',
  'session-parked',
  'trash-non-empty',
  'ci-reserved',
]

/**
 * @param snap - {
 *   org:            { id, name } | null   — the open organisation
 *   projects:       [{ id, name }]        — projects of the open org
 *   selectedProject:string | null         — client-side selection
 *   parkedSessions: [{ id, project }]     — parked worktree sessions
 *   trashCount:     number
 * }
 * @returns [{ id, label, action, state, disabled?, reserved? }]
 */
export function computeCtas(snap) {
  const s = snap ?? {}
  const projects = s.projects ?? []
  const parked = s.parkedSessions ?? []
  const ctas = []

  if (!s.org) {
    ctas.push(
      { id: 'org-open', label: 'Open organisation', action: 'org.open', state: 'no-org' },
      { id: 'org-new', label: 'New organisation', action: 'org.new', state: 'no-org' },
    )
  } else if (projects.length === 0) {
    ctas.push({ id: 'project-new', label: 'New project', action: 'project.new', state: 'empty-org' })
  } else if (s.selectedProject) {
    // Sessions are org-level in the git-workspace registry (no project
    // field yet), so a null `project` counts for any selected project;
    // sessions that DO carry an association must match it.
    const parkedHere = parked.filter((p) => p.project == null || p.project === s.selectedProject)
    if (parkedHere.length > 0) {
      ctas.push(
        { id: 'session-resume', label: 'Resume session', action: 'session.resume', state: 'session-parked' },
        { id: 'session-merge', label: 'Merge session', action: 'session.merge', state: 'session-parked' },
      )
    } else {
      ctas.push({ id: 'session-new', label: 'New session', action: 'session.new', state: 'project-selected' })
    }
  }

  if (s.org && (s.trashCount ?? 0) > 0) {
    ctas.push({ id: 'trash-restore', label: 'Restore from trash', action: 'trash.restore', state: 'trash-non-empty' })
  }

  // Reserved D3 slot: always rendered, never actionable until Phase D3 flips
  // `disabled` off. Keeping the slot in the contract now means D3 is a data
  // change, not a layout change.
  ctas.push({ id: 'ci-run', label: 'Run CI', action: 'ci.run', state: 'ci-reserved', disabled: true, reserved: true })

  return ctas
}
