/**
 * Release channels (#428) — catalog `channel` parsing, `channels[]` on the app
 * summary, pre-release-aware "newest" resolution, and the malformed/duplicate
 * drop rule. Served from a `data:` URL — no network, no ORAS (bundle pulls only
 * happen in getVersionDetail's pullValidateBuild, which this test stubs out).
 *
 * Template: bundles/catalog-remote.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import { catalogConfig } from '../../config/catalog';
import { RealCatalogService } from '../../services/core/catalog';

function dataUrl(obj: unknown): string {
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(obj));
}

// `demo`: stable 1.2.0 (no channel field), rc 1.3.0-rc.1, a malformed-channel
// entry (`RC` uppercase) that must be dropped with a warn, and 1.1.0 listed
// twice (duplicate — first occurrence wins, second dropped with a warn).
// `stringy`: an app whose only entries are non-numeric version strings, to
// exercise the compareVersions string fallback rather than list position.
const CATALOG = {
  apps: [
    {
      id: 'demo',
      name: 'Demo',
      versions: [
        { version: '1.2.0', refs: { oci: 'ghcr.io/try-hola/demo:1.2.0' } },
        { version: '1.3.0-rc.1', channel: 'rc', refs: { oci: 'ghcr.io/try-hola/demo:1.3.0-rc.1' } },
        { version: '1.3.0-rc.2', channel: 'RC', refs: { oci: 'ghcr.io/try-hola/demo:1.3.0-rc.2' } },
        { version: '1.1.0', refs: { oci: 'ghcr.io/try-hola/demo:1.1.0-a' } },
        { version: '1.1.0', refs: { oci: 'ghcr.io/try-hola/demo:1.1.0-b' } },
      ],
    },
    {
      id: 'stringy',
      name: 'Stringy',
      versions: [
        { version: 'main', refs: { oci: 'ghcr.io/try-hola/stringy:main' } },
        { version: 'edge', refs: { oci: 'ghcr.io/try-hola/stringy:edge' } },
      ],
    },
  ],
};

describe('Release channels: catalog parsing (#428)', () => {
  let prevCatalogUrl: string | undefined;

  beforeEach(() => {
    prevCatalogUrl = catalogConfig.catalogUrl;
    Object.assign(catalogConfig, { catalogUrl: dataUrl(CATALOG) });
  });

  afterEach(() => {
    Object.assign(catalogConfig, { catalogUrl: prevCatalogUrl });
  });

  function makeService(): RealCatalogService {
    const svc = new RealCatalogService();
    // Stub the bundle pull so getVersionDetail resolves without ORAS.
    Object.assign(svc, {
      pullValidateBuild: async (a: { version: string }) => ({
        version: a.version,
        defaultEnv: [],
        defaults: { ports: [], volumes: [] },
      }),
    });
    return svc;
  }

  test('listApps resolves version to the newest stable, and channels to the well-formed set', async () => {
    const svc = makeService();
    const res = await svc.listApps({ page: 1, limit: 12 });
    const demo = res.items.find(a => a.id === 'demo');
    expect(demo?.version).toBe('1.2.0');
    expect(demo?.channels).toEqual(['stable', 'rc']);
  });

  test('getApp().versions excludes the malformed and duplicate entries', async () => {
    const svc = makeService();
    const app = await svc.getApp('demo');
    // 1.2.0, 1.3.0-rc.1, first 1.1.0 — NOT the malformed RC entry, NOT the second 1.1.0.
    expect(app.versions.sort()).toEqual(['1.1.0', '1.2.0', '1.3.0-rc.1'].sort());
  });

  test('getVersions() items carry channel, defaulting untagged entries to stable', async () => {
    const svc = makeService();
    const res = await svc.getVersions('demo');
    const byVersion = new Map(res.items.map(v => [v.version, v.channel]));
    expect(byVersion.get('1.2.0')).toBe('stable');
    expect(byVersion.get('1.3.0-rc.1')).toBe('rc');
    expect(byVersion.get('1.1.0')).toBe('stable');
    expect(res.items.some(v => v.version === '1.3.0-rc.2')).toBe(false);
    expect(res.total).toBe(3);
  });

  test("getVersionDetail(app, 'latest') resolves the newest stable version", async () => {
    const svc = makeService();
    const detail = await svc.getVersionDetail('demo', 'latest');
    expect(detail.version).toBe('1.2.0');
  });

  test('an app with only non-numeric version strings falls back to list position (last listed wins)', async () => {
    const svc = makeService();
    const app = await svc.getApp('stringy');
    // `main` and `edge` both parse to the numeric core 0 with no prerelease
    // tag, so compareVersions rates them EQUAL — there is no version precedence
    // to resolve by. `newestEligibleVersion` then falls back to list position
    // (the catalog lists versions oldest-first), which is what the pre-#428
    // `pickLatestVersion` did for any non-semver list.
    expect(app.version).toBe('edge');
  });

  test('exactly one warn per malformed/duplicate entry', async () => {
    const svc = makeService();
    const logger = (svc as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
    const warnSpy = spyOn(logger, 'warn');
    await svc.getApp('demo');
    // One for the malformed `RC` channel, one for the duplicate 1.1.0.
    const relevant = warnSpy.mock.calls.filter(([msg]) => typeof msg === 'string' && msg.includes('Catalog version entry ignored'));
    expect(relevant.length).toBe(2);
  });
});
