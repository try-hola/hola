/**
 * Backup coverage, derived from the `backup@1` contract rollup (ADR 0004 Phase 4).
 *
 * Pure so it can be tested without a DOM, and separate from the component so the
 * three states below have one definition: an app is quiesced (hooks run around the
 * backup), covered as-is (accepts the contract and needs nothing run), or not
 * covered at all. The last one is the reason the view exists — an uncovered app
 * fails silently, at restore time.
 */

import type { ContractParticipant, ContractRollup } from '@hola/shared';

export type Coverage = 'quiesced' | 'as-is' | 'uncovered';

export type CoverageRow = {
  participant: ContractParticipant;
  coverage: Coverage;
  isProvider: boolean;
};

export const COVERAGE_META: Record<Coverage, { label: string; title: string; color: string; bg: string }> = {
  quiesced: {
    label: 'Quiesced',
    title: 'Hola runs this app’s pre/post-backup hooks around every backup, so the captured data is consistent.',
    color: 'var(--success)',
    bg: 'var(--success-weak)',
  },
  'as-is': {
    label: 'Covered as-is',
    title: 'This app accepts the backup contract and needs no hooks — its files are safe to copy exactly as they sit.',
    color: 'var(--success)',
    bg: 'var(--success-weak)',
  },
  uncovered: {
    label: 'Not covered',
    title: 'This app does not accept the backup contract. Its data is still captured with everything else, but nothing quiesces it first, so a database may be copied mid-write.',
    color: 'var(--warn)',
    bg: 'var(--warn-weak)',
  },
};

/** Flatten the three buckets into one row per install, preserving each role. */
export function coverageRows(rollup: ContractRollup): CoverageRow[] {
  const providers = new Set(rollup.providers.map(p => p.deploymentId));
  const rows: CoverageRow[] = rollup.acceptors.map(participant => ({
    participant,
    coverage: participant.hooks ? 'quiesced' : 'as-is',
    isProvider: providers.has(participant.deploymentId),
  }));

  for (const participant of rollup.unaffiliated) {
    rows.push({ participant, coverage: 'uncovered', isProvider: false });
  }
  // A provider that doesn't accept the contract is in neither bucket above; it is
  // still an installed app whose own data has to land somewhere, so it gets a row.
  for (const participant of rollup.providers) {
    if (!rows.some(r => r.participant.deploymentId === participant.deploymentId)) {
      rows.push({ participant, coverage: 'uncovered', isProvider: true });
    }
  }

  return rows.sort((a, b) => a.participant.name.localeCompare(b.participant.name));
}


