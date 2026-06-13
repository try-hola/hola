import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runBundleDeploy } from '../commands/bundle/deploy';
import type { HolaSdk } from '@hola/sdk';

function makeSdk(overrides: { drafts?: Record<string, unknown>; deployments?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  return {
    calls,
    drafts: {
      create: vi.fn(async () => { calls.push('create'); return { draftId: 'd1' }; }),
      update: vi.fn(async () => { calls.push('update'); return { ok: true }; }),
      validate: vi.fn(async () => { calls.push('validate'); return { ok: true, errors: [], warnings: [] }; }),
      preflight: vi.fn(async () => { calls.push('preflight'); return { ok: true, checks: [] }; }),
      finalize: vi.fn(async () => { calls.push('finalize'); return { spec: {}, checksum: 'x' }; }),
      ...(overrides.drafts ?? {}),
    },
    deployments: {
      create: vi.fn(async () => { calls.push('deploy'); return { deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1' }; }),
      ...(overrides.deployments ?? {}),
    },
    jobs: {
      byId: vi.fn(async () => ({ status: 'completed' })),
    },
  };
}

describe('bundle deploy', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hola-bundle-'));
    process.exitCode = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  async function withCompose() {
    await writeFile(join(dir, 'docker-compose.yaml'), 'services:\n  gitea:\n    image: gitea/gitea\n');
  }

  it('runs the full workflow in order and reports the terminal job status', async () => {
    await withCompose();
    const sdk = makeSdk();
    const res = await runBundleDeploy({ path: dir, appId: 'gitea', noStream: true, json: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.calls).toEqual(['create', 'update', 'validate', 'preflight', 'finalize', 'deploy']);
    expect(res?.deploymentId).toBe('dep1');
    expect(res?.releaseId).toBe('r1');
    expect(res?.status).toBe('completed');
    expect(process.exitCode).toBe(0);
  });

  it('sets the compose override on the draft from the bundle', async () => {
    await withCompose();
    const sdk = makeSdk();
    await runBundleDeploy({ path: dir, appId: 'gitea', noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.drafts.update).toHaveBeenCalledWith('d1', expect.objectContaining({
      composeOverride: expect.stringContaining('gitea/gitea'),
    }));
  });

  it('fails with exit code 1 on validation errors under --strict and does not deploy', async () => {
    await withCompose();
    const sdk = makeSdk({
      drafts: { validate: vi.fn(async () => ({ ok: true, errors: [{ message: 'bad compose' }], warnings: [] })) },
    });

    const res = await runBundleDeploy({ path: dir, appId: 'gitea', strict: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('fails with exit code 1 when no compose file is present', async () => {
    const sdk = makeSdk();
    const res = await runBundleDeploy({ path: dir, appId: 'gitea', noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.drafts.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
