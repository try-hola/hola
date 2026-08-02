/**
 * Previewing a catalog.json before adding it as a source.
 *
 * The point is consent from real data: a source added without `allowRegistries`
 * looks fine until the first install dies with REF_NOT_ALLOWED, so the preview
 * reports the registries the catalog's own OCI refs point at and lets the
 * operator grant them up front. It doubles as URL validation — the fetcher casts
 * parsed JSON straight to a catalog shape, so a wrong URL would otherwise be
 * discovered as a mysteriously empty source.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { RealCatalogService } from '../../services/core/catalog';

const CATALOG = {
  apps: [
    // Two apps, same namespace → one glob, counted by APPS not versions.
    { id: 'cms', name: 'CMS', versions: [
      { version: '1.0.0', refs: { oci: 'ghcr.io/acme/cms:1.0.0' } },
      { version: '1.1.0', refs: { oci: 'ghcr.io/acme/cms:1.1.0' } },
    ] },
    { id: 'wiki', name: 'Wiki', versions: [{ version: '2.0.0', refs: { oci: 'ghcr.io/acme/wiki:2.0.0' } }] },
    // A different namespace on the same registry — must stay a separate consent.
    { id: 'tool', name: 'Tool', versions: [{ version: '1.0.0', refs: { oci: 'ghcr.io/othervendor/tool:1.0.0' } }] },
    // Already covered by the default baseline (ghcr.io/try-hola/*).
    { id: 'builtin', name: 'Builtin', versions: [{ version: '1.0.0', refs: { oci: 'ghcr.io/try-hola/builtin:1.0.0' } }] },
    // No installable package at all.
    { id: 'refless', name: 'Refless', versions: [{ version: '0.1.0' }] },
  ],
};

const okResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
});

describe('RealCatalogService.previewSource', () => {
  const realFetch = globalThis.fetch;
  let served: unknown = CATALOG;
  let status = 200;
  let calls: string[] = [];

  beforeEach(() => {
    served = CATALOG; status = 200; calls = [];
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input));
      if (status === 0) throw new Error('network unreachable');
      return okResponse(served, status);
    }) as unknown as typeof fetch;
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('reports each publishing namespace, counted by apps, with baseline coverage marked', async () => {
    const res = await new RealCatalogService().previewSource('https://acme.test/catalog.json');

    expect(res.appCount).toBe(5);
    expect(res.appsWithoutRefs).toBe(1);
    // Most-used namespace first; every glob is namespace-scoped, never a bare host.
    expect(res.registries).toEqual([
      { glob: 'ghcr.io/acme/*', appCount: 2, covered: false },
      { glob: 'ghcr.io/othervendor/*', appCount: 1, covered: false },
      // Baseline already permits this one, so it needs no per-source grant.
      { glob: 'ghcr.io/try-hola/*', appCount: 1, covered: true },
    ]);
  });

  test('a URL that is not a catalog fails loudly instead of previewing as empty', async () => {
    // The fetcher does no schema validation, so without this check an HTML page
    // or someone's repo root would "succeed" and be added as a silent no-op source.
    served = { message: 'not a catalog' };
    await expect(new RealCatalogService().previewSource('https://acme.test/README.md'))
      .rejects.toThrow('CATALOG_MALFORMED');

    served = CATALOG; status = 404;
    await expect(new RealCatalogService().previewSource('https://acme.test/missing.json'))
      .rejects.toThrow('CATALOG_UNREACHABLE');

    status = 0;
    await expect(new RealCatalogService().previewSource('https://down.test/catalog.json'))
      .rejects.toThrow('CATALOG_UNREACHABLE');
  });

  test('an empty catalog previews as empty rather than failing', async () => {
    served = { apps: [] };
    const res = await new RealCatalogService().previewSource('https://acme.test/catalog.json');
    expect(res).toEqual({ appCount: 0, registries: [], appsWithoutRefs: 0 });
  });

  test('always hits the URL — a preview is never served from the source cache', async () => {
    // The URL isn't a source yet, and re-probing an edited URL must reflect what
    // is there NOW, not what a shared 24h cache last saw.
    const svc = new RealCatalogService();
    await svc.previewSource('https://acme.test/catalog.json');
    served = { apps: [{ id: 'new', name: 'New', versions: [{ version: '1.0.0', refs: { oci: 'ghcr.io/changed/new:1.0.0' } }] }] };
    const second = await svc.previewSource('https://acme.test/catalog.json');

    expect(calls).toHaveLength(2);
    expect(second.registries).toEqual([{ glob: 'ghcr.io/changed/*', appCount: 1, covered: false }]);
  });
});
