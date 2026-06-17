import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runInstall } from '../commands/install/install';
import type { HolaSdk } from '@hola/sdk';

function makeSdk(overrides: { drafts?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    drafts: {
      create: vi.fn(async () => { calls.push('create'); return { draftId: 'd1' }; }),
      byId: vi.fn(async () => { calls.push('byId'); return { draftId: 'd1', appEnv: [{ key: 'A', value: '1', isSecret: false }] }; }),
      update: vi.fn(async () => { calls.push('update'); return { ok: true }; }),
      validate: vi.fn(async () => { calls.push('validate'); return { ok: true, errors: [], warnings: [] }; }),
      preflight: vi.fn(async () => { calls.push('preflight'); return { ok: true, checks: [] }; }),
      finalize: vi.fn(async () => { calls.push('finalize'); return { spec: {}, checksum: 'x' }; }),
      ...(overrides.drafts ?? {}),
    },
    deployments: {
      create: vi.fn(async () => { calls.push('deploy'); return { deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }; }),
    },
    jobs: { byId: vi.fn(async () => ({ status: 'completed' })) },
  };
}

describe('install', () => {
  beforeEach(() => { process.exitCode = 0; });
  afterEach(() => { process.exitCode = 0; });

  it('seeds a draft from the catalog (no update without --set) and runs the deploy flow', async () => {
    const sdk = makeSdk();
    const res = await runInstall('gitea', { noStream: true, json: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.calls).toEqual(['create', 'validate', 'preflight', 'finalize', 'deploy']);
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'gitea', version: 'latest' });
    expect(res?.deploymentId).toBe('dep1');
    expect(res?.status).toBe('completed');
    expect(process.exitCode).toBe(0);
  });

  it('merges --set overrides onto the catalog-seeded appEnv', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { set: ['A=2', 'B=x'], noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.drafts.byId).toHaveBeenCalledWith('d1');
    expect(sdk.drafts.update).toHaveBeenCalledWith('d1', {
      appEnv: [
        { key: 'A', value: '2', isSecret: false },
        { key: 'B', value: 'x', isSecret: false },
      ],
    });
  });

  it('fails (exit 1) on validation errors under --strict and does not deploy', async () => {
    const sdk = makeSdk({
      drafts: { validate: vi.fn(async () => ({ ok: true, errors: [{ message: 'bad' }], warnings: [] })) },
    });
    const res = await runInstall('gitea', { strict: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('rejects a malformed --set', async () => {
    const sdk = makeSdk();
    const res = await runInstall('gitea', { set: 'NOEQUALS', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(sdk.drafts.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
