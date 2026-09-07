/**
 * Backup coverage, derived from the `backup@1` contract rollup (ADR 0004 Phase 4;
 * partial coverage and implicit contracts added by spec 004).
 *
 * Pure so it can be tested without a DOM, and separate from the component so the
 * four states below have one definition: an app is quiesced (every recognised
 * database service has a pre-backup hook), partially covered (at least one
 * recognised database has none), covered as-is (accepts the contract, runs no
 * recognised database, and needs nothing run), or not covered at all. The last one
 * is the reason the view exists — an uncovered app fails silently, at restore time.
 */

import type { ContractCoverage, ContractParticipant, ContractRollup } from '@hola/shared';

export type Coverage = 'quiesced' | 'partial' | 'as-is' | 'uncovered';

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
  partial: {
    label: 'Partially covered',
    title: 'Some of this app’s databases have no pre-backup hook, so they may be copied mid-write.',
    color: 'var(--warn)',
    bg: 'var(--warn-weak)',
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

/**
 * The recognised database services `coverage` runs that no participation's
 * pre-hook targets — what a `partial` badge names as the gap ("`temporal-postgres`
 * has no pre-backup hook").
 */
export function unquiescedServices(coverage: ContractCoverage): string[] {
  const targeted = new Set(coverage.participations.map((p) => p.service).filter((s): s is string => Boolean(s)));
  return coverage.databases.filter((db) => !targeted.has(db));
}

/** A participant's coverage state: the server-computed judgement when present, else the legacy `hooks` fallback. */
function deriveCoverage(participant: ContractParticipant): Coverage {
  if (participant.coverage) return participant.coverage.state;
  return participant.hooks ? 'quiesced' : 'as-is';
}

/** Flatten the three buckets into one row per install, preserving each role. */
export function coverageRows(rollup: ContractRollup): CoverageRow[] {
  const providers = new Set(rollup.providers.map(p => p.deploymentId));
  // An implicit contract (container-logs@1) has no acceptance to opt out of —
  // every non-provider install is a subject by virtue of running, so a subject
  // is never rendered with the "not covered" treatment (spec 004, FR-029).
  const implicit = rollup.participation === 'implicit';

  const rows: CoverageRow[] = rollup.acceptors.map(participant => ({
    participant,
    coverage: deriveCoverage(participant),
    isProvider: providers.has(participant.deploymentId),
  }));

  for (const participant of rollup.unaffiliated) {
    rows.push({ participant, coverage: 'uncovered', isProvider: false });
  }
  // A provider that doesn't accept the contract is in neither bucket above; it is
  // still an installed app whose own data has to land somewhere, so it gets a row.
  for (const participant of rollup.providers) {
    if (!rows.some(r => r.participant.deploymentId === participant.deploymentId)) {
      rows.push({ participant, coverage: implicit ? 'as-is' : 'uncovered', isProvider: true });
    }
  }

  return rows.sort((a, b) => a.participant.name.localeCompare(b.participant.name));
}
