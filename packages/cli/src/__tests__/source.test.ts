import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runSource } from '../commands/source/source';
import type { HolaSdk } from '@hola/sdk';
import type { CatalogSourceRecord } from '@hola/shared';

const RECORD: CatalogSourceRecord = {
  id: 'pofallon', name: 'Pofallon apps', type: 'index-url',
  url: 'https://example.test/catalog.json', trust: 'custom', enabled: true,
};

function makeSdk(updated: Partial<CatalogSourceRecord> = {}) {
  return {
    catalogSources: {
      add: vi.fn(async () => RECORD),
      update: vi.fn(async () => ({ ...RECORD, ...updated })),
      list: vi.fn(async () => ({ items: [RECORD] })),
      remove: vi.fn(async () => ({ success: true })),
    },
  };
}

const asSdk = (s: ReturnType<typeof makeSdk>) => ({ sdk: s as unknown as HolaSdk, args: [] as string[] });

describe('source update', () => {
  let logs: string[];
  let errs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = []; errs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => { errs.push(String(m)); });
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('adds allowRegistries to an existing source — the REF_NOT_ALLOWED fix, no re-add', async () => {
    const sdk = makeSdk({ allowRegistries: ['ghcr.io/pofallon/*'] });
    await runSource('update', { allowRegistry: 'ghcr.io/pofallon/*' }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(sdk.catalogSources.update).toHaveBeenCalledWith('pofallon', { allowRegistries: ['ghcr.io/pofallon/*'] });
    // Nothing else is touched: a patch must not silently rewrite url/name/auth.
    expect(sdk.catalogSources.add).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('allow: ghcr.io/pofallon/*');
    expect(process.exitCode).toBe(0);
  });

  it('accepts repeated and comma-separated globs, as `source add` does', async () => {
    const sdk = makeSdk();
    await runSource('update', { allowRegistry: ['ghcr.io/a/*', 'ghcr.io/b/*,ghcr.io/c/*'] }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(sdk.catalogSources.update).toHaveBeenCalledWith('pofallon', {
      allowRegistries: ['ghcr.io/a/*', 'ghcr.io/b/*', 'ghcr.io/c/*'],
    });
  });

  it('clears the allowlist only when asked explicitly', async () => {
    const sdk = makeSdk();
    await runSource('update', { clearAllowRegistry: true }, { ...asSdk(sdk), args: ['pofallon'] });
    expect(sdk.catalogSources.update).toHaveBeenCalledWith('pofallon', { allowRegistries: [] });
  });

  it('sends only the flags given — an omitted field is left alone', async () => {
    const sdk = makeSdk();
    await runSource('update', { name: 'Renamed' }, { ...asSdk(sdk), args: ['pofallon'] });
    expect(sdk.catalogSources.update).toHaveBeenCalledWith('pofallon', { name: 'Renamed' });
  });

  it('refuses a no-op patch rather than sending an empty body', async () => {
    const sdk = makeSdk();
    await runSource('update', {}, { ...asSdk(sdk), args: ['pofallon'] });

    expect(sdk.catalogSources.update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/nothing to change/i);
  });

  it('rejects half a credential and contradictory enable/disable', async () => {
    const sdk = makeSdk();
    await runSource('update', { registry: 'ghcr.io' }, { ...asSdk(sdk), args: ['pofallon'] });
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/must be provided together/i);

    process.exitCode = 0;
    await runSource('update', { enable: true, disable: true }, { ...asSdk(sdk), args: ['pofallon'] });
    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toMatch(/mutually exclusive/i);

    expect(sdk.catalogSources.update).not.toHaveBeenCalled();
  });

  it('requires a source id', async () => {
    const sdk = makeSdk();
    await runSource('update', { name: 'x' }, asSdk(sdk));
    expect(sdk.catalogSources.update).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('surfaces a server rejection (e.g. a malformed glob) instead of claiming success', async () => {
    const sdk = makeSdk();
    sdk.catalogSources.update.mockRejectedValueOnce(new Error('HTTP 400: SOURCE_ALLOW_REGISTRY_INVALID: ghcr io/x/*'));
    await runSource('update', { allowRegistry: 'ghcr io/x/*' }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(process.exitCode).toBe(1);
    expect(errs.join('\n')).toContain('SOURCE_ALLOW_REGISTRY_INVALID');
    expect(logs.join('\n')).not.toMatch(/Updated catalog source/);
  });
});
