import { describe, it, expect } from 'vitest';
import type { ContractParticipant, ContractRollup } from '@hola/shared';

import { coverageRows, unquiescedServices } from '../../utils/backup-coverage';

/**
 * Flattening the `backup@1` rollup into one row per installed app (ADR 0004
 * Phase 4). The rule that matters: every install gets exactly one row, so the
 * uncovered apps are a list the page can render rather than an absence the
 * operator has to notice.
 */

const app = (id: string, over: Partial<ContractParticipant> = {}): ContractParticipant => ({
  deploymentId: id,
  name: id,
  app: id,
  icon: '📦',
  status: 'running',
  ...over,
});

const rollup = (over: Partial<ContractRollup> = {}): ContractRollup => ({
  ref: 'backup@1',
  id: 'backup',
  version: 1,
  shape: 'brokered',
  providerKind: 'app',
  participation: 'declared',
  summary: 'Backups',
  providers: [],
  acceptors: [],
  unaffiliated: [],
  ...over,
});

describe('coverageRows', () => {
  it('separates apps whose hooks run from apps that are safe to copy as they sit', () => {
    const rows = coverageRows(rollup({
      acceptors: [app('paperless', { hooks: true }), app('uptime-kuma', { hooks: false })],
    }));

    expect(rows.find(r => r.participant.deploymentId === 'paperless')?.coverage).toBe('quiesced');
    // Not a degraded state — "accepts and needs nothing" is full coverage, and
    // rendering it as missing hooks would push authors to add hooks that do nothing.
    expect(rows.find(r => r.participant.deploymentId === 'uptime-kuma')?.coverage).toBe('as-is');
  });

  it('gives an app in no role a row of its own, marked uncovered', () => {
    const rows = coverageRows(rollup({ unaffiliated: [app('immich')] }));
    expect(rows).toEqual([expect.objectContaining({ coverage: 'uncovered' })]);
  });

  it('marks the provider and still counts its own data', () => {
    // Backrest backs up other apps; its own config is data too. A provider that
    // doesn't accept the contract appears once, flagged as provider AND uncovered —
    // it isn't exempt from the question just because it asks it of everyone else.
    const rows = coverageRows(rollup({ providers: [app('backrest')] }));
    expect(rows).toEqual([expect.objectContaining({ isProvider: true, coverage: 'uncovered' })]);
  });

  it('does not duplicate an app that both provides and accepts', () => {
    const rows = coverageRows(rollup({
      providers: [app('backrest')],
      acceptors: [app('backrest', { hooks: false })],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isProvider: true, coverage: 'as-is' });
  });

  it('sorts by name so the list is stable between polls', () => {
    const rows = coverageRows(rollup({
      acceptors: [app('zulip', { hooks: true })],
      unaffiliated: [app('audiobookshelf')],
    }));
    expect(rows.map(r => r.participant.name)).toEqual(['audiobookshelf', 'zulip']);
  });

  it('uses the server-computed coverage state when present, over the legacy hooks flag', () => {
    const rows = coverageRows(rollup({
      acceptors: [
        app('postiz', {
          hooks: true,
          coverage: {
            state: 'partial',
            targeted: 1,
            recognised: 2,
            participations: [{ id: 'default', service: 'postiz-postgres' }],
            databases: ['postiz-postgres', 'temporal-postgres'],
          },
        }),
      ],
    }));
    expect(rows[0]?.coverage).toBe('partial');
  });

  it('falls back to the hooks flag when coverage is absent (older server)', () => {
    const rows = coverageRows(rollup({ acceptors: [app('paperless', { hooks: true })] }));
    expect(rows[0]?.coverage).toBe('quiesced');
  });

  it('a row for an implicit rollup is never uncovered', () => {
    const rows = coverageRows(rollup({
      participation: 'implicit',
      providers: [app('collector')],
      acceptors: [app('appA'), app('appB')],
    }));
    expect(rows.every(r => r.coverage !== 'uncovered')).toBe(true);
  });
});

describe('unquiescedServices', () => {
  it('names the recognised databases no participation targets', () => {
    expect(
      unquiescedServices({
        state: 'partial',
        targeted: 1,
        recognised: 2,
        participations: [{ id: 'default', service: 'postiz-postgres' }],
        databases: ['postiz-postgres', 'temporal-postgres'],
      }),
    ).toEqual(['temporal-postgres']);
  });

  it('is empty when everything is targeted', () => {
    expect(
      unquiescedServices({
        state: 'quiesced',
        targeted: 1,
        recognised: 1,
        participations: [{ id: 'default', service: 'db' }],
        databases: ['db'],
      }),
    ).toEqual([]);
  });
});
