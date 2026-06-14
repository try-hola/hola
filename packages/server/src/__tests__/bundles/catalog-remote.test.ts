/**
 * RealCatalogService consumes a remote catalog.json (#83)
 *
 * The server browses apps from a remote catalog set via HOLA_CATALOG_URL
 * (catalogConfig.catalogUrl). This verifies listApps/getApp/getVersions resolve
 * apps from a fetched catalog and that mapApp applies sensible defaults for
 * sparse entries. Served from a `data:` URL — no network, no ORAS (bundle pulls
 * only happen in getVersionDetail, which this does not exercise).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { catalogConfig } from '../../config/catalog';
import { RealCatalogService } from '../../services/core/catalog';

// Two apps: gitea (full metadata) + "barebones" (only id+name, to exercise the
// mapApp defaults: icon 📦, category "apps", empty tags).
const CATALOG = {
  apps: [
    {
      id: 'gitea',
      name: 'Gitea',
      description: 'Self-hosted Git service',
      icon: '🍵',
      category: 'apps',
      tags: ['git'],
      versions: [{ version: '1.0.0', refs: { oci: 'ghcr.io/try-hola/gitea:1.0.0' } }],
    },
    {
      id: 'barebones',
      name: 'Barebones',
      versions: [{ version: '2.1.0', refs: { oci: 'ghcr.io/try-hola/barebones:2.1.0' } }],
    },
  ],
};

function dataUrl(obj: unknown): string {
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(obj));
}

describe('RealCatalogService remote catalog (#83)', () => {
  let prevCatalogUrl: string | undefined;

  beforeEach(() => {
    prevCatalogUrl = catalogConfig.catalogUrl;
    Object.assign(catalogConfig, { catalogUrl: dataUrl(CATALOG) });
  });

  afterEach(() => {
    Object.assign(catalogConfig, { catalogUrl: prevCatalogUrl });
  });

  test('listApps returns the catalog apps, mapped with defaults', async () => {
    const svc = new RealCatalogService();
    const res = await svc.listApps({ page: 1, limit: 12 });

    expect(res.total).toBe(2);
    const gitea = res.items.find(a => a.id === 'gitea');
    expect(gitea).toMatchObject({ name: 'Gitea', icon: '🍵', category: 'apps', tags: ['git'] });

    // Sparse entry falls back to mapApp defaults.
    const bare = res.items.find(a => a.id === 'barebones');
    expect(bare).toMatchObject({ name: 'Barebones', icon: '📦', category: 'apps', tags: [] });
    expect(bare?.description).toBe('');
  });

  test('getApp / getVersions resolve a catalog app', async () => {
    const svc = new RealCatalogService();

    const app = await svc.getApp('gitea');
    expect(app.id).toBe('gitea');
    expect(app.versions).toContain('1.0.0');

    const versions = await svc.getVersions('gitea');
    expect(versions.items.map(v => v.version)).toContain('1.0.0');

    await expect(svc.getApp('does-not-exist')).rejects.toThrow('APP_NOT_FOUND');
  });
});
