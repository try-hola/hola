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
      preview: vi.fn(async () => ({
        appCount: 3,
        appsWithoutRefs: 0,
        registries: [
          { glob: 'ghcr.io/pofallon/*', appCount: 2, covered: false },
          { glob: 'ghcr.io/try-hola/*', appCount: 1, covered: true },
        ],
      })),
    },
  };
}

const asSdk = (s: ReturnType<typeof makeSdk>) => ({ sdk: s as unknown as HolaSdk, args: [] as string[] });

describe('source add registry warning', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('warns when the new source cannot pull anything, naming the exact fix', async () => {
    const sdk = makeSdk();
    await runSource('add', { url: 'https://example.test/catalog.json' }, { ...asSdk(sdk), args: ['pofallon'] });

    const out = logs.join('\n');
    expect(out).toContain("Added catalog source 'pofallon'");
    expect(out).toContain('ghcr.io/pofallon/* (2 apps)');
    // The already-covered baseline registry isn't presented as a problem.
    expect(out).not.toContain('ghcr.io/try-hola/*');
    expect(out).toContain('hola source update pofallon --allow-registry ghcr.io/pofallon/*');
    // Advisory only — the source WAS added.
    expect(process.exitCode).toBe(0);
  });

  it('stays quiet when the operator already granted the registries', async () => {
    const sdk = makeSdk();
    await runSource('add', { url: 'https://example.test/catalog.json', allowRegistry: 'ghcr.io/pofallon/*' }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(sdk.catalogSources.preview).not.toHaveBeenCalled();
    expect(logs.join('\n')).not.toMatch(/REF_NOT_ALLOWED/);
  });

  it('stays quiet when every registry is already covered by the baseline', async () => {
    const sdk = makeSdk();
    sdk.catalogSources.preview.mockResolvedValueOnce({
      appCount: 1, appsWithoutRefs: 0, registries: [{ glob: 'ghcr.io/try-hola/*', appCount: 1, covered: true }],
    });
    await runSource('add', { url: 'https://example.test/catalog.json' }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(logs.join('\n')).not.toMatch(/REF_NOT_ALLOWED/);
  });

  it('an unreadable catalog degrades to a generic hint, never a failed add', async () => {
    const sdk = makeSdk();
    sdk.catalogSources.preview.mockRejectedValueOnce(new Error('CATALOG_UNREACHABLE'));
    await runSource('add', { url: 'https://down.test/catalog.json' }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(logs.join('\n')).toContain("Added catalog source 'pofallon'");
    expect(logs.join('\n')).toContain('could not read https://down.test/catalog.json');
    expect(process.exitCode).toBe(0);
  });

  it('--json stays machine-readable: no advisory prose in the output', async () => {
    const sdk = makeSdk();
    await runSource('add', { url: 'https://example.test/catalog.json', json: true }, { ...asSdk(sdk), args: ['pofallon'] });

    expect(() => JSON.parse(logs.join('\n'))).not.toThrow();
    expect(sdk.catalogSources.preview).not.toHaveBeenCalled();
  });
});

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
