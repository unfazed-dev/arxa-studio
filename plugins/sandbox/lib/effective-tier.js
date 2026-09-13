// Effective-tier resolution (S3, docs/plans/arxa-isolation-levels.md §16/§23).
//
// The org/project setting says what confinement was CONFIGURED; what a session
// actually runs is resolved per machine at session start and shown on the card
// whenever the two differ. Two invariants, both load-bearing:
//
//   * the effective tier can only DECREASE from the configured capability —
//     a machine with more runners never silently upgrades the operator's
//     choice;
//   * every decrease carries a user-readable reason, because a card that says
//     "A2" without saying "sbx is not signed in" is a broken promise, not a
//     tier (§23b: a missing A5 sign-in never breaks a session — it degrades
//     and says so plainly).
//
// Pure function: no probes, no fs, no network. The caller measures the
// platform's runners and passes them in.

/** The ladder, A0 (no confinement) to A5 (microVM). */
export const TIERS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']

/**
 * The highest A0–A3 rung a platform's profile runner can actually enforce.
 * @param {string} platform - a process.platform string.
 * @param {Record<string, boolean>} runners - measured runner availability
 *   ({seatbelt}, {bwrap}, {landlock}, {'windows-acl'}).
 * @returns {{ tier: number, reason: string }} the cap and why.
 */
function platformCap (platform, runners) {
  if (platform === 'darwin') {
    return runners.seatbelt
      ? { tier: 3, reason: 'macOS Seatbelt runner available — the write, read-isolation and subprocess-egress rungs are all enforceable in the profile' }
      : { tier: 0, reason: 'no usable Seatbelt runner on this Mac — no rung of the profile ladder can be enforced' }
  }
  if (platform === 'linux') {
    if (runners.bwrap) return { tier: 3, reason: 'bwrap runner available — mount-namespace confinement including an unshared network' }
    if (runners.landlock) return { tier: 2, reason: 'Landlock runner available — filesystem confinement only; it cannot deny network, so the egress rung is unreachable' }
    return { tier: 0, reason: 'no bwrap and no Landlock on this Linux host — no rung of the profile ladder can be enforced' }
  }
  if (platform === 'win32') {
    return runners['windows-acl']
      ? { tier: 1, reason: 'Windows ACL runner available — write confinement only; read isolation and egress are not expressible in that rung' }
      : { tier: 0, reason: 'the Windows ACL rung is unsupported here — no rung of the profile ladder can be enforced' }
  }
  return { tier: 0, reason: `unsupported platform '${String(platform)}' — no confinement rung can be enforced` }
}

/**
 * Resolve the tier a session actually runs.
 *
 * @param {object} input - the resolution request.
 * @param {string} input.configured - the configured tier, 'A0'…'A5'.
 * @param {string} input.platform - a process.platform string.
 * @param {Record<string, boolean>} [input.runners] - measured runner
 *   availability; the container tiers read {docker}, {sbx}, {sbxAuthed}.
 * @returns {{ configured: string, effective: string, reason: string }} the
 *   resolved tier. `effective` never exceeds `configured`; an unknown
 *   `configured` resolves to A0 rather than guessing.
 */
export function resolveEffectiveTier ({ configured, platform, runners = {} }) {
  const configuredIdx = TIERS.indexOf(configured)
  if (configuredIdx === -1) {
    return {
      configured: String(configured),
      effective: 'A0',
      reason: `unknown configured tier '${String(configured)}' — resolving to A0 rather than guessing`
    }
  }

  const cap = platformCap(platform, runners)
  let ceiling = cap.tier
  let reason = cap.reason

  // The container tiers (A4/A5) have runners of their own and sit above the
  // profile ladder: an A5 machine needs sbx regardless of Seatbelt.
  if (configured === 'A4') {
    if (runners.docker) {
      ceiling = Math.max(ceiling, 4)
      reason = 'Docker is present — the hardened-container tier is available on this machine'
    } else {
      // The measured detail (a dead daemon is NOT "Docker is not present")
      // replaces the generic line, because a card that paraphrases the
      // machine is a broken promise (Task 10: detectDocker() feeds this).
      reason = runners.dockerReason ?? 'Docker is not present — arxa detects rather than assumes (S3); degrading to the highest tier this machine can enforce'
    }
  }
  if (configured === 'A5') {
    if (runners.sbx && runners.sbxAuthed) {
      ceiling = Math.max(ceiling, 5)
      reason = 'sbx is installed and signed in — the microVM tier is available on this machine'
    } else if (runners.docker) {
      // S3 #4: degrade to the highest tier ACTUALLY available — with the
      // microVM out of reach but Docker running containers, that is A4.
      ceiling = Math.max(ceiling, 4)
      reason = (runners.sbx
        ? 'sbx is installed but not signed in — the one-time browser sign-in is the only step arxa cannot automate (§23a)'
        : 'sbx (Docker Sandboxes) is not installed on this machine') + '; Docker is present, so degrading to A4 (the hardened-container tier), the best this machine can enforce'
    } else {
      reason = runners.sbx
        ? 'sbx is installed but not signed in — the one-time browser sign-in is the only step arxa cannot automate (§23a); degrading to the highest tier this machine can enforce'
        : 'sbx (Docker Sandboxes) is not installed on this machine; degrading to the highest tier this machine can enforce'
    }
  }

  const effectiveIdx = Math.min(configuredIdx, ceiling)
  return { configured, effective: TIERS[effectiveIdx], reason }
}
