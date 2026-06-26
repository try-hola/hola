import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runInstall, resolveAppAndVersion } from '../commands/install/install';
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

  it('proceeds past preflight WARNINGS (non-strict): warnings are advisory, not fatal', async () => {
    // e.g. disk under the 2 GB soft threshold, or an unconventional env-var name.
    const sdk = makeSdk({
      drafts: {
        preflight: vi.fn(async () => ({
          ok: false,
          checks: [
            { name: 'disk', status: 'warn', detail: '1.9GB free' },
            { name: 'env', status: 'warn', detail: "name 'GITEA__server__DOMAIN' should use uppercase" },
          ],
        })),
      },
    });
    const res = await runInstall('gitea', { noStream: true, json: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.calls).toContain('deploy');
    expect(res?.deploymentId).toBe('dep1');
    expect(process.exitCode).toBe(0);
  });

  it('aborts (exit 1, no deploy) on a hard preflight FAIL check even without --strict', async () => {
    const sdk = makeSdk({
      drafts: {
        preflight: vi.fn(async () => ({
          ok: false,
          checks: [{ name: 'routing', status: 'fail', detail: "Host 'x' already in use" }],
        })),
      },
    });
    const res = await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res).toBeUndefined();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('aborts on preflight warnings under --strict (spotless preflight required)', async () => {
    const sdk = makeSdk({
      drafts: {
        preflight: vi.fn(async () => ({ ok: false, checks: [{ name: 'disk', status: 'warn', detail: '1.9GB free' }] })),
      },
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

  it('pins the version from --app-version', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { appVersion: '1.2.1', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'gitea', version: '1.2.1' });
  });

  it('pins the version from an inline <appId>@<version>', async () => {
    const sdk = makeSdk();
    await runInstall('uptime-kuma@1.2.1', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'uptime-kuma', version: '1.2.1' });
  });

  it('lets --app-version win over an inline suffix and defaults the name to the bare id', async () => {
    const sdk = makeSdk();
    const res = await runInstall('uptime-kuma@9.9.9', { appVersion: '1.2.1', noStream: true, json: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'uptime-kuma', version: '1.2.1' });
    expect(res?.deploymentId).toBe('dep1');
  });
});

describe('resolveAppAndVersion', () => {
  it('defaults to latest when no version is given', () => {
    expect(resolveAppAndVersion('gitea')).toEqual({ appId: 'gitea', version: 'latest' });
  });

  it('reads an inline @version', () => {
    expect(resolveAppAndVersion('gitea@1.2.1')).toEqual({ appId: 'gitea', version: '1.2.1' });
  });

  it('prefers the explicit flag over the inline suffix', () => {
    expect(resolveAppAndVersion('gitea@1.0.0', '2.0.0')).toEqual({ appId: 'gitea', version: '2.0.0' });
  });

  it('splits on the last @ so the version is taken from the suffix', () => {
    expect(resolveAppAndVersion('ns/app@3.1.4')).toEqual({ appId: 'ns/app', version: '3.1.4' });
  });
});
