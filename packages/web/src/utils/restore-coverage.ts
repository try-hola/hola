/**
 * Restore coverage, derived from the `restore@1` contract rollup (spec 008,
 * FR-053-FR-055) — the second half of `backup-coverage.ts`'s story, and
 * deliberately its own module rather than folded into that one.
 *
 * A green backup badge answers "is this app's data being captured?". It says
 * nothing about whether that capture can be put back — an app can be
 * `quiesced` for backup (every database has a pre-backup hook) and still have
 * declared no way to reload a capture, or declared reload hooks for only some
 * of its databases. `judgeRestoreCoverage` (in `@hola/shared/contracts`)
 * computes that verdict on the server; this module carries the copy and the
 * pure helpers a component needs to render it, mirroring `backup-coverage.ts`
 * shape-for-shape so the two read as one system rather than two designs.
 */

import type { ContractRollup, RestoreCoverage, RestoreCoverageState } from '@hola/shared';

export const RESTORE_COVERAGE_META: Record<RestoreCoverageState, { label: string; title: string; color: string; bg: string }> = {
  restorable: {
    label: 'Restorable',
    title: 'This app declares a restore hook for every recognised database, so a held capture can be loaded back in cleanly.',
    color: 'var(--success)',
    bg: 'var(--success-weak)',
  },
  'copy-back': {
    label: 'Restorable (copy-back)',
    title: 'This app accepts the restore contract and declares no reload hook — a plain file copy is enough to put it back.',
    color: 'var(--success)',
    bg: 'var(--success-weak)',
  },
  incomplete: {
    label: 'Incomplete',
    title: 'Some of this app’s databases have no declared restore hook, so a held capture can be loaded back in only partially.',
    color: 'var(--warn)',
    bg: 'var(--warn-weak)',
  },
  undeclared: {
    label: 'Not restorable',
    title: 'This app does not declare the restore contract, so Hola has no instructions for loading a captured copy back in — a good backup here is not the same as a working restore.',
    color: 'var(--warn)',
    bg: 'var(--warn-weak)',
  },
};

/** The default verdict for an app that accepts nothing — no rollup lookup needed. */
export const UNDECLARED_RESTORE_COVERAGE: RestoreCoverage = {
  state: 'undeclared',
  targeted: 0,
  recognised: 0,
  participations: [],
  databases: [],
};

/**
 * The recognised database services `coverage` runs that no participation's
 * restore declaration targets — what an `incomplete` badge names as the gap,
 * mirroring `unquiescedServices` for the backup side.
 */
export function unrestoredServices(coverage: RestoreCoverage): string[] {
  const declared = new Set(
    coverage.participations.filter((p) => p.declared).map((p) => p.service).filter((s): s is string => Boolean(s)),
  );
  return coverage.databases.filter((db) => !declared.has(db));
}

/**
 * One participant's restore-coverage verdict from the `restore@1` rollup.
 * `judgeRestoreCoverage` only runs server-side (and the rollup builder only
 * attaches `restoreCoverage`) for a deployment that accepts the contract —
 * an app absent from `acceptors` never declared it, which IS the `undeclared`
 * verdict, not a missing one.
 */
export function restoreCoverageFor(deploymentId: string, rollup?: ContractRollup): RestoreCoverage {
  const participant = rollup?.acceptors.find((p) => p.deploymentId === deploymentId);
  return participant?.restoreCoverage ?? UNDECLARED_RESTORE_COVERAGE;
}
