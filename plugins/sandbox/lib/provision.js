// Local-confinement provisioning plan (S3/S4, docs/plans/
// arxa-isolation-levels.md §23-24). One pure function answers "what does
// arxa provision on this machine, silently, at install?" — the launcher seeds
// the preset from it, the card reports from it, and the tests pin it.
//
// THE PLAN (§23b): A0–A3 + B1–B2 provision silently — no prompts, no choices,
// no README steps. A4 is automatic-if-Docker-present (detected, never
// assumed); A5 is the one tier carrying a one-time sign-in, and a missing
// sign-in never breaks a session (degrade and say so — see
// lib/effective-tier.js).
//
// A3 AND HONESTY: subprocess egress denial is a capability this provider
// ships (`(deny network*)`, §9b measured) but does NOT enforce by default:
// git push/fetch, npm install and dart pub get all need subprocess network,
// and the phase split (§12a) is not built. `subprocessEgress` therefore
// reports `enforced: false`, the exact form, and the things no egress tier
// could ever cover (§13's ceiling — the model channel is open by
// construction). A status that overstates coverage is a broken promise.

import { resolveEffectiveTier } from './effective-tier.js'

/** The confinement arxa silently provisions: write boundary + read isolation. */
export const DEFAULT_CONFIGURED_TIER = 'A2'

/**
 * The silent provisioning plan for a machine.
 *
 * @param {object} [input] - the machine facts.
 * @param {string} [input.platform] - a process.platform string.
 * @param {Record<string, boolean>} [input.runners] - measured runner
 *   availability; when given, `tier` carries the resolved effective tier.
 * @returns {object} the plan. Plain data only (deep-comparable for
 *   idempotence); `manualSteps` is empty by construction — §23's "the user
 *   does nothing" is a property of the plan, asserted where it is consumed.
 */
export function provisionLocalConfinement ({ platform = process.platform, runners } = {}) {
  return {
    configuredTier: DEFAULT_CONFIGURED_TIER,
    ...(runners === undefined ? {} : { tier: resolveEffectiveTier({ configured: DEFAULT_CONFIGURED_TIER, platform, runners }) }),
    preset: { settingsKey: 'permission.defaultPreset', value: 'workspace-write' },
    filesystem: {
      provider: 'arxa-filesystem',
      readIsolation: 'org-root',
      reservedPaths: ['.git', '.arxa']
    },
    subprocessEgress: {
      enforced: false,
      seatbeltForm: '(deny network*)',
      reason: 'subprocess network stays open by default — git push/fetch, npm install and pub get need it, and the install/edit phase split (§12a) is not built; A3 remains an explicit org choice',
      doesNotCover: [
        'WebFetch and every engine-side fetch',
        'local stdio MCP servers',
        'web search',
        'model-provider traffic'
      ]
    },
    subprocessWritableRoots: 'dsh mode roots (workspace, /tmp, the os.tmpdir() temp area) plus runtime-resolved, measured toolchain caches — never wider',
    integrity: {
      install: {
        npm: 'npm ci --ignore-scripts (where package-lock.json exists)',
        dart: 'dart pub get --enforce-lockfile (where pubspec.lock exists)'
      },
      osv: 'osv-scanner over the lockfiles when installed; an honest skip note otherwise — absence is never a failure',
      diffPolicy: 'base-branch'
    },
    manualSteps: []
  }
}
