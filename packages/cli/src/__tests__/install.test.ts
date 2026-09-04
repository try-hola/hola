import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runInstall, resolveAppAndVersion, parseProfiles } from '../commands/install/install';
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

    // No --set and no fillable secrets in the seeded appEnv → we still fetch
    // the draft (to scan for empty generate-recipe secrets) but never PATCH it.
    expect(sdk.calls).toEqual(['create', 'byId', 'validate', 'preflight', 'finalize', 'deploy']);
    expect(sdk.drafts.update).not.toHaveBeenCalled();
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

  it('rejects an invalid typed --set value before finalize (never calls finalize)', async () => {
    const sdk = makeSdk({
      drafts: {
        byId: vi.fn(async () => ({
          draftId: 'd1',
          appEnv: [{ key: 'PORT', value: '', isSecret: false, type: 'port' }],
        })),
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await runInstall('gitea', { set: ['PORT=99999'], noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.drafts.finalize).not.toHaveBeenCalled();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('PORT:'));
    errSpy.mockRestore();
  });

  it('auto-fills an empty required secret that has a generate recipe, and proceeds', async () => {
    let updatePatch: { appEnv: Array<{ key: string; value: string }> } | undefined;
    const sdk = makeSdk({
      drafts: {
        byId: vi.fn(async () => ({
          draftId: 'd1',
          appEnv: [{ key: 'TOKEN', value: '', isSecret: true, required: true, generate: { kind: 'hex', length: 16 } }],
        })),
        update: vi.fn(async (_id: string, patch: { appEnv: Array<{ key: string; value: string }> }) => {
          updatePatch = patch;
          return { ok: true };
        }),
      },
    });
    const res = await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(sdk.drafts.update).toHaveBeenCalledTimes(1);
    const token = updatePatch?.appEnv.find(e => e.key === 'TOKEN');
    expect(token?.value).toMatch(/^[0-9a-f]{32}$/);
    expect(sdk.deployments.create).toHaveBeenCalled();
    expect(res?.deploymentId).toBe('dep1');
    expect(process.exitCode).toBe(0);
  });

  it('fails validation on an empty required secret with NO generate recipe (actionable message)', async () => {
    const sdk = makeSdk({
      drafts: {
        byId: vi.fn(async () => ({
          draftId: 'd1',
          appEnv: [{ key: 'TOKEN', value: '', isSecret: true, required: true }],
        })),
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.drafts.update).not.toHaveBeenCalled();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('TOKEN:'));
    errSpy.mockRestore();
  });

  it('--no-generate-secrets disables auto-fill, so the same secret now fails validation', async () => {
    const sdk = makeSdk({
      drafts: {
        byId: vi.fn(async () => ({
          draftId: 'd1',
          appEnv: [{ key: 'TOKEN', value: '', isSecret: true, required: true, generate: { kind: 'hex', length: 16 } }],
        })),
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await runInstall('gitea', { noStream: true, noGenerateSecrets: true }, { sdk: sdk as unknown as HolaSdk });

    expect(res).toBeUndefined();
    expect(sdk.drafts.update).not.toHaveBeenCalled();
    expect(sdk.deployments.create).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('TOKEN:'));
    errSpy.mockRestore();
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

  it('passes --allow-multiple and the distinct --name through to the deployment create (#246)', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { name: 'gitea-2', allowMultiple: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith({ draftId: 'd1', name: 'gitea-2', allowMultiple: true });
  });

  it('a plain install does not opt into multiples (#246)', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    // name defaults to the app id; allowMultiple is left unset (singleton).
    expect(sdk.deployments.create).toHaveBeenCalledWith({ draftId: 'd1', name: 'gitea', allowMultiple: undefined });
  });

  it('passes repeated --profile keys through to the deployment create (#162)', async () => {
    const sdk = makeSdk();
    await runInstall('postiz', { profile: ['elasticsearch', 'metrics'], noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith({
      draftId: 'd1', name: 'postiz', allowMultiple: undefined, profiles: ['elasticsearch', 'metrics'],
    });
  });

  it('splits a comma-separated --profile and dedupes (#162)', async () => {
    const sdk = makeSdk();
    await runInstall('postiz', { profile: 'a, b ,a', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ profiles: ['a', 'b'] }),
    );
  });

  it('a plain install sends no profiles, so the manifest defaults apply server-side (#162)', async () => {
    const sdk = makeSdk();
    await runInstall('postiz', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ profiles: undefined }),
    );
  });

  it('passes repeated --grant refs through to the deployment create (ADR 0004)', async () => {
    const sdk = makeSdk();
    await runInstall('backrest', { grant: ['backup@1'], noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ grants: ['backup@1'] }),
    );
  });

  it('splits a comma-separated --grant and dedupes', async () => {
    const sdk = makeSdk();
    await runInstall('backrest', { grant: 'backup@1, backup@1 ,logs@1', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ grants: ['backup@1', 'logs@1'] }),
    );
  });

  it('a plain install sends no grants, so an app that declares one is refused server-side', async () => {
    // Consent is never implied by silence: the CLI sends nothing and the server
    // rejects, rather than the CLI guessing on the operator's behalf.
    const sdk = makeSdk();
    await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(
      expect.objectContaining({ grants: undefined }),
    );
  });

  it('hints at --allow-multiple when a single-instance app is already installed (#246)', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errors.push(String(m)); });
    try {
      const sdk = makeSdk({
        drafts: {
          create: vi.fn(async () => ({ draftId: 'd1' })),
          byId: vi.fn(async () => ({ draftId: 'd1', appEnv: [] })),
          validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
          preflight: vi.fn(async () => ({ ok: true, checks: [] })),
          finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
        },
      });
      sdk.deployments.create = vi.fn(async () => {
        throw new Error("'gitea' is already installed (deployment gitea-abc123de). This app is single-instance; pass --allow-multiple ...");
      });
      const res = await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(res).toBeUndefined();
      expect(process.exitCode).toBe(1);
      expect(errors.some(e => /--allow-multiple --name/.test(e))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('hints at a distinct --name when the subdomain is already taken (#246)', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errors.push(String(m)); });
    try {
      const sdk = makeSdk();
      sdk.deployments.create = vi.fn(async () => {
        throw new Error("Host 'gitea.local.hola' is already in use by deployment gitea-abc123de");
      });
      await runInstall('gitea', { name: 'gitea', allowMultiple: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(process.exitCode).toBe(1);
      expect(errors.some(e => /different instance name with --name/.test(e))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  // --- Release channels (#428) ---

  it('--channel reaches drafts.create', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { channel: 'rc', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.drafts.create).toHaveBeenCalledWith({ appId: 'gitea', version: 'latest', channel: 'rc' });
  });

  it('--as maps to name', async () => {
    const sdk = makeSdk();
    await runInstall('gitea', { as: 'gitea-beta', noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'gitea-beta' }));
  });

  it('when both --name and --as are given, --name wins and a note is printed', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      const sdk = makeSdk();
      await runInstall('gitea', { name: 'gitea-1', as: 'gitea-2', noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(sdk.deployments.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'gitea-1' }));
      expect(logs.some(l => /--name overrides --as/.test(l))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('prints "Following channel" when the create response channel is non-stable', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      const sdk = makeSdk({
        drafts: {
          create: vi.fn(async () => ({ draftId: 'd1' })),
          byId: vi.fn(async () => ({ draftId: 'd1', appEnv: [] })),
          update: vi.fn(async () => ({ ok: true })),
          validate: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
          preflight: vi.fn(async () => ({ ok: true, checks: [] })),
          finalize: vi.fn(async () => ({ spec: {}, checksum: 'x' })),
        },
      });
      sdk.deployments.create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1', channel: 'rc' }));
      await runInstall('gitea', { channel: 'rc', name: 'gitea-rc', noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(logs.some(l => l === 'Following channel: rc')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not print "Following channel" for a plain stable install', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      const sdk = makeSdk();
      sdk.deployments.create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1', channel: 'stable' }));
      await runInstall('gitea', { noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(logs.some(l => /Following channel/.test(l))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('prints "Following channel" when a pinned version implies a non-stable channel (no explicit --channel)', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    try {
      const sdk = makeSdk();
      sdk.deployments.create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1', channel: 'rc' }));
      await runInstall('gitea@1.3.0-rc.1', { name: 'gitea-rc', noStream: true }, { sdk: sdk as unknown as HolaSdk });
      expect(logs.some(l => l === 'Following channel: rc')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('--json output includes channel', async () => {
    const sdk = makeSdk();
    sdk.deployments.create = vi.fn(async () => ({ deploymentId: 'dep1', releaseId: 'r1', jobId: 'j1', channel: 'rc' }));
    const res = await runInstall('gitea', { channel: 'rc', json: true, noStream: true }, { sdk: sdk as unknown as HolaSdk });
    expect(res?.channel).toBe('rc');
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

describe('parseProfiles', () => {
  it('returns undefined when no flag is given (so manifest defaults apply)', () => {
    expect(parseProfiles(undefined)).toBeUndefined();
  });

  it('wraps a single repeated flag value into an array', () => {
    expect(parseProfiles('elasticsearch')).toEqual(['elasticsearch']);
    expect(parseProfiles(['elasticsearch', 'metrics'])).toEqual(['elasticsearch', 'metrics']);
  });

  it('splits comma-separated values, trims, drops blanks, and dedupes', () => {
    expect(parseProfiles('a, b , a,')).toEqual(['a', 'b']);
    expect(parseProfiles(['a,b', 'c , a'])).toEqual(['a', 'b', 'c']);
  });
});
