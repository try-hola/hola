import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { RestoreCoverage } from '@hola/shared';
import { AppBackupCoverage } from '../../components/BackupCoverage';

/**
 * spec 008, US4 (T093): the restore verdict, rendered alongside the backup
 * verdict on an app's own detail panel. `judgeRestoreCoverage` produces the
 * judgement server-side (`packages/shared/src/contracts.ts`); these tests
 * cover the web surfacing that had been entirely missing — a green backup
 * badge previously implied "recoverable" with nothing checking that claim.
 */

afterEach(cleanup);

const restore = (over: Partial<RestoreCoverage> = {}): RestoreCoverage => ({
  state: 'restorable',
  targeted: 0,
  recognised: 0,
  participations: [],
  databases: [],
  ...over,
});

describe('AppBackupCoverage — restore verdict', () => {
  it('renders "Restorable" for a fully declared restore verdict', () => {
    render(
      <MemoryRouter>
        <AppBackupCoverage
          contracts={{
            accepts: ['restore@1'],
            restoreCoverage: { 'restore@1': restore({ state: 'restorable', targeted: 1, recognised: 1 }) },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Restorable')).toBeInTheDocument();
  });

  it('renders "Restorable (copy-back)" when the app needs no reload hook', () => {
    render(
      <MemoryRouter>
        <AppBackupCoverage
          contracts={{
            accepts: ['restore@1'],
            restoreCoverage: { 'restore@1': restore({ state: 'copy-back' }) },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Restorable (copy-back)')).toBeInTheDocument();
  });

  it('renders "Incomplete · N of M" for a partial restore verdict', () => {
    render(
      <MemoryRouter>
        <AppBackupCoverage
          contracts={{
            accepts: ['restore@1'],
            restoreCoverage: {
              'restore@1': restore({
                state: 'incomplete',
                targeted: 1,
                recognised: 2,
                participations: [
                  { id: 'default', service: 'app-postgres', declared: true },
                  { id: 'events', service: 'events-postgres', declared: false },
                ],
                databases: ['app-postgres', 'events-postgres'],
              }),
            },
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Incomplete · 1 of 2')).toBeInTheDocument();
    // The gap it names — the one database with no declared restore hook.
    expect(screen.getByText('events-postgres')).toBeInTheDocument();
  });

  it('renders "Not restorable" when the app never declares the restore contract', () => {
    render(
      <MemoryRouter>
        <AppBackupCoverage contracts={{ accepts: [] }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Not restorable')).toBeInTheDocument();
  });

  it('renders both verdicts, and lets them differ: quiesced for backup, not restorable', () => {
    render(
      <MemoryRouter>
        <AppBackupCoverage
          contracts={{
            accepts: ['backup@1'],
            hooks: ['backup@1'],
            coverage: {
              'backup@1': {
                state: 'quiesced',
                targeted: 1,
                recognised: 1,
                participations: [{ id: 'default', service: 'app-postgres' }],
                databases: ['app-postgres'],
              },
            },
            // Deliberately no `restore@1` in `accepts` and no `restoreCoverage`
            // entry — the well-captured-but-undeclared-for-restore case.
          }}
        />
      </MemoryRouter>,
    );

    // Both verdicts render, and they say different things about the same app.
    expect(screen.getByText('Quiesced')).toBeInTheDocument();
    expect(screen.getByText('Not restorable')).toBeInTheDocument();

    // The honest sentence spec 008 exists to make visible.
    expect(screen.getByText(/Quiesced but not restorable/)).toBeInTheDocument();
  });

  it('does not show the "quiesced but not restorable" sentence when backup coverage itself is uncovered', () => {
    // The sentence is specific to the quiesced/partial + undeclared combination —
    // an uncovered app already reads as unprotected without it.
    render(
      <MemoryRouter>
        <AppBackupCoverage contracts={{ accepts: [] }} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Quiesced but not restorable/)).toBeNull();
  });
});
