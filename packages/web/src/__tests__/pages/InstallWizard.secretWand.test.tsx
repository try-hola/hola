import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AppEnvVar, CreateDraftResponse, Draft } from '@hola/shared';
import { globalCache } from '../../utils/cache';

// InstallWizard's step 0 wand button must call the shared `generateSecretValue`
// with the manifest's own `generate` recipe when the seeded row declares one,
// and fall back to the legacy 32-byte-hex behavior when it doesn't (so
// existing untyped/custom secrets don't regress). Exercised end-to-end
// against the real component rather than a re-implementation of its logic,
// so the whole draft-creation -> render -> wand-click path is faithful.
const draftId = 'draft-wand-test';

const seededEnv: AppEnvVar[] = [
  {
    key: 'GEN_SECRET',
    value: '',
    isSecret: true,
    label: 'Generated secret',
    generate: { kind: 'hex', length: 4 }, // 4 bytes -> 8 hex chars, distinguishable from the legacy 64-char hex
  },
  {
    key: 'LEGACY_SECRET',
    value: '',
    isSecret: true,
    label: 'Legacy secret',
    // no `generate` recipe — must use the original 32-byte-hex fallback
  },
];

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    draftId,
    appId: 'testapp',
    version: '1.0.0',
    systemOverrides: {},
    appEnv: seededEnv,
    ports: [],
    ...overrides,
  };
}

const draftsApi = {
  create: vi.fn(async (): Promise<CreateDraftResponse> => ({
    draftId,
    app: { id: 'testapp', name: 'Test App', icon: '📦' },
    systemEnv: [],
    appEnv: seededEnv,
    defaults: { ports: [], volumes: [] },
  })),
  byId: vi.fn(async () => makeDraft()),
  update: vi.fn(async (_id: string, updates: Partial<Draft>) => ({ ok: true as const, draft: makeDraft(updates) })),
  remove: vi.fn(async () => ({ ok: true as const })),
  validate: vi.fn(),
  preflight: vi.fn(),
  finalize: vi.fn(),
};

vi.mock('../../utils/api-hybrid', () => ({
  api: {
    drafts: draftsApi,
    deployments: { create: vi.fn() },
  },
}));

// Imported after the mock so InstallWizard picks up the mocked api-hybrid.
const { InstallWizard } = await import('../../pages/InstallWizard');

function renderWizard() {
  return render(
    <MemoryRouter initialEntries={['/install/testapp']}>
      <Routes>
        <Route path="/install/:appId" element={<InstallWizard />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  globalCache.clear();
  draftsApi.create.mockClear();
  draftsApi.byId.mockClear();
  draftsApi.update.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('InstallWizard secret wand', () => {
  it('uses generateSecretValue with the spec recipe for a seeded secret that declares one', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getAllByTitle('Generate a random secret')).toHaveLength(2));

    const wands = screen.getAllByTitle('Generate a random secret');
    // First seeded row is GEN_SECRET (has a `generate` recipe).
    fireEvent.click(wands[0]);

    await waitFor(() => {
      const generatedInput = screen.getByLabelText(/^Generated secret/) as HTMLInputElement;
      // 4 bytes -> 8 lowercase hex chars, per the spec's generate.length: 4.
      expect(generatedInput.value).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  it('falls back to the legacy 32-byte-hex value for a seeded secret with no generate recipe', async () => {
    renderWizard();
    await waitFor(() => expect(screen.getAllByTitle('Generate a random secret')).toHaveLength(2));

    const wands = screen.getAllByTitle('Generate a random secret');
    // Second seeded row is LEGACY_SECRET (no `generate` recipe).
    fireEvent.click(wands[1]);

    await waitFor(() => {
      const legacyInput = screen.getByLabelText(/^Legacy secret/) as HTMLInputElement;
      // 32 bytes -> 64 lowercase hex chars, matching the original `openssl rand -hex 32` behavior.
      expect(legacyInput.value).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
