import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GetContractsResponse } from '@hola/shared';
import { globalCache } from '../../utils/cache';

/**
 * spec 008, US4 (T093): the `restore@1` rollup, rendered alongside `backup@1`
 * on the Backups page's per-app coverage list — a separate contract, fetched
 * and matched by deployment id (`restoreCoverageFor` in
 * `../../utils/restore-coverage.ts`), never derived from the backup verdict.
 */

const contractsList = vi.fn<() => Promise<GetContractsResponse>>();

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    contracts: { list: () => contractsList() },
    backups: {
      list: vi.fn(async () => ({ items: [], page: 1, limit: 10, total: 0 })),
      create: vi.fn(),
      restore: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const { Backups } = await import('../../pages/Backups');

type Item = GetContractsResponse['items'][number];

const contractItem = (ref: string, over: Partial<Item> = {}): Item => ({
  ref,
  id: ref.split('@')[0],
  version: 1,
  shape: 'brokered',
  providerKind: 'app',
  participation: 'declared',
  summary: '',
  providers: [],
  acceptors: [],
  unaffiliated: [],
  ...over,
});

const app = (id: string, over: Record<string, unknown> = {}) => ({
  deploymentId: id,
  name: id,
  app: id,
  icon: '📦',
  status: 'running' as const,
  ...over,
});

beforeEach(() => {
  globalCache.clear();
  contractsList.mockReset();
});

afterEach(cleanup);

describe('Backups page — restore coverage alongside backup coverage', () => {
  it('renders a partial restore verdict as "Incomplete", distinct from the backup verdict on the same row', async () => {
    contractsList.mockResolvedValue({
      items: [
        contractItem('backup@1', {
          providers: [app('backrest', { granted: true })],
          acceptors: [
            app('postiz', {
              hooks: true,
              coverage: {
                state: 'quiesced',
                targeted: 1,
                recognised: 1,
                participations: [{ id: 'default', service: 'postiz-postgres' }],
                databases: ['postiz-postgres'],
              },
            }),
          ],
        }),
        contractItem('restore@1', {
          providers: [],
          acceptors: [
            app('postiz', {
              restoreCoverage: {
                state: 'incomplete',
                targeted: 0,
                recognised: 1,
                participations: [{ id: 'default', service: 'postiz-postgres', declared: false }],
                databases: ['postiz-postgres'],
              },
            }),
          ],
        }),
      ],
    });
    render(<MemoryRouter><Backups /></MemoryRouter>);

    // The backup badge says this app is fully quiesced...
    expect(await screen.findByText('Quiesced')).toBeInTheDocument();
    // ...while the restore badge, computed independently, says it is not.
    expect(screen.getByText('Incomplete · 0 of 1')).toBeInTheDocument();
  });

  it('renders "Not restorable" for an app that never declared the restore contract', async () => {
    contractsList.mockResolvedValue({
      items: [
        contractItem('backup@1', {
          providers: [app('backrest', { granted: true })],
          acceptors: [app('uptime-kuma', { hooks: false, coverage: { state: 'as-is', targeted: 0, recognised: 0, participations: [], databases: [] } })],
        }),
        contractItem('restore@1', { providers: [], acceptors: [], unaffiliated: [app('uptime-kuma')] }),
      ],
    });
    render(<MemoryRouter><Backups /></MemoryRouter>);

    expect(await screen.findByText('Covered as-is')).toBeInTheDocument();
    // Both uptime-kuma (never declared restore@1) and backrest (uncovered for
    // backup, and equally undeclared for restore) render "Not restorable".
    expect(screen.getAllByText('Not restorable')).toHaveLength(2);
  });

  it('renders "Restorable" when a full restore verdict is declared', async () => {
    contractsList.mockResolvedValue({
      items: [
        contractItem('backup@1', {
          providers: [app('backrest', { granted: true })],
          acceptors: [app('paperless', { hooks: true, coverage: { state: 'quiesced', targeted: 1, recognised: 1, participations: [{ id: 'default', service: 'paperless-postgres' }], databases: ['paperless-postgres'] } })],
        }),
        contractItem('restore@1', {
          providers: [],
          acceptors: [
            app('paperless', {
              restoreCoverage: {
                state: 'restorable',
                targeted: 1,
                recognised: 1,
                participations: [{ id: 'default', service: 'paperless-postgres', declared: true }],
                databases: ['paperless-postgres'],
              },
            }),
          ],
        }),
      ],
    });
    render(<MemoryRouter><Backups /></MemoryRouter>);

    expect(await screen.findByText('Quiesced')).toBeInTheDocument();
    expect(screen.getByText('Restorable')).toBeInTheDocument();
  });
});
