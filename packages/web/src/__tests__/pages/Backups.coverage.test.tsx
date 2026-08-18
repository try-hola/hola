import React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { GetContractsResponse } from '@hola/shared';
import { globalCache } from '../../utils/cache';

/**
 * The Backups page under ADR 0004 Phase 4 (settling #160 in favour of Option A):
 * a view over the installed backup provider, not a second backup engine. What it
 * must answer, without an operator opening a single manifest — is anything backing
 * this machine up, and which installed apps does it actually cover?
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

const rollup = (over: Partial<GetContractsResponse['items'][number]> = {}): GetContractsResponse => ({
  items: [
    {
      ref: 'backup@1',
      id: 'backup',
      version: 1,
      shape: 'brokered',
      providerKind: 'app',
      summary: 'Back up every app that accepts the contract',
      providers: [],
      acceptors: [],
      unaffiliated: [],
      ...over,
    },
  ],
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

describe('Backups page coverage', () => {
  it('says plainly when nothing is backing the machine up', async () => {
    contractsList.mockResolvedValue(rollup({ unaffiliated: [app('immich')] }));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    // The empty state has to be an assertion, not silence: a page with no rows
    // reads identically to a page that failed to load.
    expect(await screen.findByText('No backup provider installed')).toBeInTheDocument();
  });

  it('names the provider and the apps it does not cover', async () => {
    contractsList.mockResolvedValue(rollup({
      providers: [app('backrest', { granted: true })],
      acceptors: [app('paperless', { hooks: true }), app('uptime-kuma', { hooks: false })],
      unaffiliated: [app('immich')],
    }));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    expect(await screen.findByText('Backup provider')).toBeInTheDocument();
    expect(screen.getAllByText('backrest').length).toBeGreaterThan(0);
    // The disclosed privilege, visible after install rather than only during it.
    expect(screen.getByText('Reads all app data')).toBeInTheDocument();

    expect(screen.getByText('Quiesced')).toBeInTheDocument();
    expect(screen.getByText('Covered as-is')).toBeInTheDocument();
    // immich is the case the whole phase exists for: installed, backed up as raw
    // files mid-write, and until now indistinguishable from a covered app. Backrest
    // is the second: a provider that never accepted the contract doesn't cover its
    // OWN data, and asking the question of everyone else doesn't exempt it.
    expect(screen.getAllByText('Not covered')).toHaveLength(2);
    expect(screen.getByText(/2 of 4 installed apps covered/)).toBeInTheDocument();
  });

  it('flags a provider that is installed but not running', async () => {
    contractsList.mockResolvedValue(rollup({
      providers: [app('backrest', { granted: true, status: 'stopped' })],
    }));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    expect(await screen.findByText(/Installed but not running/)).toBeInTheDocument();
  });

  it('flags a provider holding no grant, which can read nothing', async () => {
    // The upgrade case: a release declares the role, the operator's consent
    // predates it, and the app silently backs up nothing until they consent again.
    contractsList.mockResolvedValue(rollup({ providers: [app('backrest', { granted: false })] }));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    expect(await screen.findByText('Access not granted')).toBeInTheDocument();
  });

  it('offers no "create backup" action — Hola takes none', async () => {
    // The page used to POST to a stub that returned a synthetic id and did
    // nothing, which reads as a backup that was taken.
    contractsList.mockResolvedValue(rollup({ providers: [app('backrest', { granted: true })] }));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    await screen.findByText('Backup provider');
    expect(screen.queryByRole('button', { name: /create backup/i })).toBeNull();
  });

  it('surfaces a failed rollup instead of rendering an empty, reassuring page', async () => {
    contractsList.mockRejectedValue(new Error('server unreachable'));
    render(<MemoryRouter><Backups /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/server unreachable/)).toBeInTheDocument());
    expect(screen.queryByText('No backup provider installed')).toBeNull();
  });
});
