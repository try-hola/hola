import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RealCatalogService } from '../../services/core/catalog';
import { MockCatalogSourceService } from '../../services/core/catalog-sources';

const URLS: Record<string, unknown> = {
  'https://acme.test/catalog.json': {
    apps: [
      { id: 'cms', name: 'Acme CMS', category: 'apps', versions: [{ version: '1.0.0', refs: { oci: 'ghcr.io/acme/cms:1.0.0' } }] },
      { id: 'db', name: 'Acme DB', category: 'database', versions: [{ version: '2.0.0' }] },
    ],
  },
  'https://globex.test/catalog.json': {
    apps: [
      // Same appId as an acme app → collision that must NOT drop either.
      { id: 'db', name: 'Globex DB', category: 'database', versions: [{ version: '9.9.9' }] },
    ],
  },
};

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
});

describe('RealCatalogService aggregation', () => {
  const realFetch = globalThis.fetch;
  let failGlobex = false;

  beforeEach(() => {
    failGlobex = false;
    // Stub network: serve each source's catalog.json by URL.
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('globex') && failGlobex) throw new Error('boom');
      const body = URLS[url];
      if (!body) throw new Error(`unexpected url ${url}`);
      return okResponse(body);
    }) as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  async function harness() {
    const sources = new MockCatalogSourceService();
    await sources.add({ id: 'acme', name: 'Acme', url: 'https://acme.test/catalog.json' });
    await sources.add({ id: 'globex', name: 'Globex', url: 'https://globex.test/catalog.json' });
    // hola has no URL in the test env, so it is inert and doesn't interfere.
    const catalog = new RealCatalogService(undefined, sources, undefined);
    return { catalog };
  }

  test('merges apps across sources, badges each with source + trust', async () => {
    const { catalog } = await harness();
    const { items } = await catalog.listApps({ page: 1, limit: 50 });

    const byQualified = new Map(items.map(a => [`${a.source}/${a.id}`, a]));
    expect(byQualified.has('acme/cms')).toBe(true);
    expect(byQualified.get('acme/cms')!.trust).toBe('custom');
    // The colliding `db` id survives once per source (namespaced), not deduped away.
    expect(byQualified.has('acme/db')).toBe(true);
    expect(byQualified.has('globex/db')).toBe(true);
    expect(byQualified.get('globex/db')!.name).toBe('Globex DB');
  });

  test('a single source filter returns only that source', async () => {
    const { catalog } = await harness();
    const { items } = await catalog.listApps({ page: 1, limit: 50, source: 'globex' });
    expect(items.map(a => `${a.source}/${a.id}`)).toEqual(['globex/db']);
  });

  test('is fail-soft: a broken source does not sink the listing', async () => {
    const { catalog } = await harness();
    failGlobex = true;
    const { items } = await catalog.listApps({ page: 1, limit: 50 });
    // Acme still lists; globex is skipped.
    expect(items.some(a => a.source === 'acme')).toBe(true);
    expect(items.some(a => a.source === 'globex')).toBe(false);
  });

  test('getVersions routes to the right source', async () => {
    const { catalog } = await harness();
    const acme = await catalog.getVersions('db', 'acme');
    expect(acme.items.map(v => v.version)).toEqual(['2.0.0']);
    const globex = await catalog.getVersions('db', 'globex');
    expect(globex.items.map(v => v.version)).toEqual(['9.9.9']);
  });
});
