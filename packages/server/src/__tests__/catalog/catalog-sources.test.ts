import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { RealStorageService } from '../../services/core/storage';
import { RealCatalogSourceService } from '../../services/core/catalog-sources';

const CATALOG = 'https://raw.githubusercontent.com/acme/hola-apps/main/catalog.json';

describe('RealCatalogSourceService', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeService() {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-test-'));
    dirs.push(holaDir);
    return new RealCatalogSourceService(new RealStorageService({ holaDir }));
  }

  test('always includes the built-in hola source (verified), even with nothing stored', async () => {
    const svc = await makeService();
    const list = await svc.list();
    expect(list[0]).toMatchObject({ id: 'hola', trust: 'verified', enabled: true });
    expect(list.length).toBe(1);
  });

  test('add persists a custom source, list surfaces it after hola, remove deletes it', async () => {
    const svc = await makeService();
    const rec = await svc.add({ id: 'acme', name: 'Acme', url: CATALOG });
    expect(rec).toMatchObject({ id: 'acme', trust: 'custom', enabled: true, url: CATALOG });

    const list = await svc.list();
    expect(list.map(s => s.id)).toEqual(['hola', 'acme']);

    await svc.remove('acme');
    expect((await svc.list()).map(s => s.id)).toEqual(['hola']);
    await expect(svc.remove('acme')).rejects.toThrow('SOURCE_NOT_FOUND');
  });

  test('rejects reserved ids, duplicates, invalid ids and non-http urls', async () => {
    const svc = await makeService();
    await expect(svc.add({ id: 'hola', name: 'x', url: CATALOG })).rejects.toThrow('SOURCE_ID_RESERVED');
    await expect(svc.add({ id: '(ref)', name: 'x', url: CATALOG })).rejects.toThrow('SOURCE_ID_RESERVED');
    await expect(svc.add({ id: 'Bad Id', name: 'x', url: CATALOG })).rejects.toThrow('SOURCE_ID_INVALID');
    await expect(svc.add({ id: 'acme', name: 'x', url: 'not-a-url' })).rejects.toThrow('SOURCE_URL_INVALID');

    await svc.add({ id: 'acme', name: 'Acme', url: CATALOG });
    await expect(svc.add({ id: 'acme', name: 'Acme2', url: CATALOG })).rejects.toThrow('SOURCE_ID_EXISTS');
  });

  test('the built-in hola source cannot be removed', async () => {
    const svc = await makeService();
    await expect(svc.remove('hola')).rejects.toThrow('SOURCE_ID_RESERVED');
  });

  test('custom sources persist across service instances', async () => {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-test-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });
    await new RealCatalogSourceService(storage).add({ id: 'acme', name: 'Acme', url: CATALOG });
    const reloaded = await new RealCatalogSourceService(storage).get('acme');
    expect(reloaded?.url).toBe(CATALOG);
  });
});

describe('RealCatalogSourceService allowRegistries (persistence + validation)', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  test('persists allowRegistries across instances and rejects malformed globs', async () => {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-allow-test-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });
    const svc = new RealCatalogSourceService(storage);

    // Valid: host/* and host/prefix/* both accepted, comma-separated in a single
    // string and as an array.
    const rec = await svc.add({
      id: 'pofallon',
      name: 'Pofallon',
      url: CATALOG,
      allowRegistries: ['ghcr.io/pofallon/*', 'ghcr.io/acme,ghcr.io/other/*'],
    });
    expect(rec.allowRegistries).toEqual(['ghcr.io/pofallon/*', 'ghcr.io/acme', 'ghcr.io/other/*']);

    // Persists across instances.
    const reloaded = await new RealCatalogSourceService(storage).get('pofallon');
    expect(reloaded?.allowRegistries).toEqual(['ghcr.io/pofallon/*', 'ghcr.io/acme', 'ghcr.io/other/*']);

    // Malformed (spaces, regex metachars): rejected with a discrete error.
    await expect(svc.add({ id: 'bad1', name: 'Bad', url: CATALOG, allowRegistries: ['ghcr io/pofallon/*'] })).rejects.toThrow('SOURCE_ALLOW_REGISTRY_INVALID');
    await expect(svc.add({ id: 'bad2', name: 'Bad', url: CATALOG, allowRegistries: ['ghcr.io/pofallon/.+'] })).rejects.toThrow('SOURCE_ALLOW_REGISTRY_INVALID');
  });

  test('add with no allowRegistries leaves the field undefined (baseline behaviour unchanged)', async () => {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-allow-test-'));
    dirs.push(holaDir);
    const svc = new RealCatalogSourceService(new RealStorageService({ holaDir }));
    const rec = await svc.add({ id: 'acme', name: 'Acme', url: CATALOG });
    expect(rec.allowRegistries).toBeUndefined();
  });

  describe('update', () => {
    test('adds allowRegistries to an existing source without delete-and-re-add', async () => {
      // The motivating case: a source was added without allowRegistries, its
      // pulls fail REF_NOT_ALLOWED, and the fix must not require recreating it.
      const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-update-'));
      dirs.push(holaDir);
      const storage = new RealStorageService({ holaDir });
      const svc = new RealCatalogSourceService(storage);
      await svc.add({ id: 'pofallon', name: 'Pofallon', url: CATALOG });

      const updated = await svc.update('pofallon', { allowRegistries: ['ghcr.io/pofallon/*'] });
      expect(updated.allowRegistries).toEqual(['ghcr.io/pofallon/*']);

      // Untouched fields survive, and it persists across instances.
      expect(updated).toMatchObject({ id: 'pofallon', name: 'Pofallon', url: CATALOG, trust: 'custom', enabled: true });
      expect((await new RealCatalogSourceService(storage).get('pofallon'))?.allowRegistries).toEqual(['ghcr.io/pofallon/*']);
    });

    test('patches only the supplied fields, and clears with empty array / null', async () => {
      const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-update2-'));
      dirs.push(holaDir);
      const svc = new RealCatalogSourceService(new RealStorageService({ holaDir }));
      await svc.add({
        id: 'acme', name: 'Acme', url: CATALOG,
        allowRegistries: ['ghcr.io/acme/*'], auth: { registry: 'ghcr.io', credentialRef: 'acme-bot' },
      });

      const renamed = await svc.update('acme', { name: 'Acme Corp' });
      expect(renamed.name).toBe('Acme Corp');
      expect(renamed.url).toBe(CATALOG); // untouched
      expect(renamed.allowRegistries).toEqual(['ghcr.io/acme/*']); // untouched
      expect(renamed.auth).toEqual({ registry: 'ghcr.io', credentialRef: 'acme-bot' }); // untouched

      expect((await svc.update('acme', { allowRegistries: [] })).allowRegistries).toBeUndefined();
      expect((await svc.update('acme', { auth: null })).auth).toBeUndefined();
      expect((await svc.update('acme', { enabled: false })).enabled).toBe(false);
    });

    test('applies the same validation as add, and refuses unknown/reserved ids', async () => {
      const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-update3-'));
      dirs.push(holaDir);
      const svc = new RealCatalogSourceService(new RealStorageService({ holaDir }));
      await svc.add({ id: 'acme', name: 'Acme', url: CATALOG });

      // A patch must not be able to write a record `add` would have rejected.
      await expect(svc.update('acme', { url: 'ftp://nope' })).rejects.toThrow('SOURCE_URL_INVALID');
      await expect(svc.update('acme', { allowRegistries: ['ghcr io/x/*'] })).rejects.toThrow('SOURCE_ALLOW_REGISTRY_INVALID');
      await expect(svc.update('acme', { auth: { registry: 'ghcr.io', credentialRef: '' } })).rejects.toThrow('SOURCE_AUTH_INVALID');

      await expect(svc.update('nope', { name: 'x' })).rejects.toThrow('SOURCE_NOT_FOUND');
      // The built-in source is synthesized from env — there's nothing to patch.
      await expect(svc.update('hola', { name: 'x' })).rejects.toThrow('SOURCE_ID_RESERVED');
    });
  });

  test('a corrupt source store fails loudly instead of silently wiping every source', async () => {
    // loadCustom used to return [] on a parse failure. add()/update() are
    // read-modify-write over that result, so the next write would have persisted
    // an empty list — destroying every configured source on a transient read error.
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-src-corrupt-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });
    const svc = new RealCatalogSourceService(storage);
    await svc.add({ id: 'acme', name: 'Acme', url: CATALOG });

    await storage.writeFile('config/catalog-sources.json', '{ this is not json');

    await expect(svc.list()).rejects.toThrow(/unreadable or corrupt/);
    await expect(svc.add({ id: 'other', name: 'Other', url: CATALOG })).rejects.toThrow(/unreadable or corrupt/);
    expect((await svc.healthCheck()).healthy).toBe(false);

    // Critically, the bad add did NOT overwrite the store with an empty list.
    expect(await storage.readFileAsString('config/catalog-sources.json')).toBe('{ this is not json');
  });
});
