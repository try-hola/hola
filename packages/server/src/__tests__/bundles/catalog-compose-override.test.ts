/**
 * RealCatalogService surfaces the bundle compose (#82)
 *
 * getVersionDetail() pulls the bundle and reads manifest.json + compose.yaml from
 * the local bundle dir. This test verifies it returns the raw compose.yaml as
 * composeOverride (so a catalog-created draft can be deployed without the user
 * pasting compose). It runs against the MockBundleService (NODE_ENV=test, no
 * ORAS/GHCR): the remote catalog is served from a `data:` URL and the bundle is
 * pre-staged at the mock bundle path.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { catalogConfig } from '../../config/catalog';
import { resetServices } from '../../services/simple-factory';
import { RealCatalogService } from '../../services/core/catalog';

const APP_ID = 'fixtureapp';
const VERSION = '1.0.0';

const COMPOSE = `services:
  fixtureapp:
    image: nginx:1.27
    restart: unless-stopped
    volumes:
      - fixtureapp-data:/data
volumes:
  fixtureapp-data:
`;

const MANIFEST = JSON.stringify({
  name: APP_ID,
  ingress: { service: 'fixtureapp', port: 80 },
  // #246: this fixture app opts into multiple instances.
  multiInstance: true,
  // #162: an optional Compose profile the operator can enable at install time.
  profiles: [
    { key: 'elasticsearch', label: 'Elasticsearch advanced visibility', default: false },
    { key: 'bogus profile' }, // invalid key grammar — must be dropped by coercion
  ],
  defaultEnv: [
    { key: 'APP_ENV', value: 'production', isSecret: false },
    // A bogus/future param type must degrade to untyped rather than reject the
    // bundle (ADR 0003 forward-compat rule — see catalog.ts's coerceManifestEnvVar).
    { key: 'WEIRD_FIELD', value: 'x', isSecret: false, type: 'from-the-future' },
    // A fully-specified typed row must carry through end to end.
    {
      key: 'DOMAIN',
      value: 'https://example.com',
      isSecret: false,
      label: 'Domain',
      type: 'url',
      required: true,
      httpsOnly: true,
    },
  ],
  defaults: {
    ports: [{ container: 80, protocol: 'tcp' }],
    volumes: [{ containerPath: '/data' }],
  },
});

function dataUrlCatalog(): string {
  const catalog = {
    apps: [
      { id: APP_ID, name: 'Fixture App', versions: [{ version: VERSION, refs: { oci: `ghcr.io/try-hola/${APP_ID}:${VERSION}` } }] },
    ],
  };
  return 'data:application/json,' + encodeURIComponent(JSON.stringify(catalog));
}

describe('RealCatalogService composeOverride (#82)', () => {
  let dataRoot: string;
  let prevDataDir: string | undefined;
  let prevNodeEnv: string | undefined;
  let prevCatalogUrl: string | undefined;

  beforeEach(async () => {
    prevDataDir = process.env.HOLA_DATA_DIR;
    prevNodeEnv = process.env.NODE_ENV;
    prevCatalogUrl = catalogConfig.catalogUrl;

    dataRoot = await mkdtemp(join(tmpdir(), 'hola-catalog-'));
    process.env.HOLA_DATA_DIR = dataRoot;
    process.env.NODE_ENV = 'test'; // → MockBundleService (no ORAS/allowlist)
    resetServices();

    // Stage the bundle where MockBundleService.ensurePulled returns it:
    // <HOLA_DATA_DIR>/mock-bundles/<appId>/<version>/{compose.yaml,manifest.json}
    const bundleDir = join(dataRoot, 'mock-bundles', APP_ID, VERSION);
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'compose.yaml'), COMPOSE);
    await writeFile(join(bundleDir, 'manifest.json'), MANIFEST);

    Object.assign(catalogConfig, { catalogUrl: dataUrlCatalog() });
  });

  afterEach(async () => {
    Object.assign(catalogConfig, { catalogUrl: prevCatalogUrl });
    if (prevDataDir === undefined) delete process.env.HOLA_DATA_DIR;
    else process.env.HOLA_DATA_DIR = prevDataDir;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    resetServices();
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('returns the bundle compose.yaml as composeOverride', async () => {
    const svc = new RealCatalogService();
    const detail = await svc.getVersionDetail(APP_ID, VERSION);

    expect(detail.composeOverride).toBe(COMPOSE);
    // Defaults are still merged from manifest/compose as before.
    expect(detail.defaults.ports.some(p => p.container === 80)).toBe(true);
    // The manifest's ingress.service is surfaced so the deploy lifecycle can
    // route to / inject auth env into the right service.
    expect(detail.ingressService).toBe('fixtureapp');
    // The manifest's multiInstance flag (#246) is carried through so the singleton
    // guard can honor it at install time.
    expect(detail.multiInstance).toBe(true);
    // The manifest's optional Compose profiles (#162) carry through, with the
    // invalid-key entry dropped by narrow-shape coercion.
    expect(detail.profiles).toEqual([
      { key: 'elasticsearch', label: 'Elasticsearch advanced visibility' },
    ]);
  });

  test('defaultEnv carries typed-spec fields through and degrades an unknown type without rejecting the bundle (ADR 0003)', async () => {
    const svc = new RealCatalogService();
    const detail = await svc.getVersionDetail(APP_ID, VERSION);

    const weird = detail.defaultEnv.find((e) => e.key === 'WEIRD_FIELD');
    expect(weird).toBeDefined();
    expect(weird!.type).toBeUndefined(); // degraded to untyped, bundle still loaded

    const domain = detail.defaultEnv.find((e) => e.key === 'DOMAIN');
    expect(domain).toMatchObject({
      value: 'https://example.com',
      label: 'Domain',
      type: 'url',
      required: true,
      httpsOnly: true,
    });
  });

  test('resolves "latest" to the concrete version before pulling (cache keyed by resolved version)', async () => {
    // The bundle is staged only at mock-bundles/<app>/1.0.0/. Installing "latest"
    // must resolve to 1.0.0 and pull THAT — the bundle cache must be keyed by the
    // resolved concrete version, not the literal "latest". Otherwise a server that
    // cached <app>/latest from an earlier install keeps serving that stale bundle
    // forever and never picks up a newly published version. (Here, keying by
    // "latest" would look in the unstaged mock-bundles/<app>/latest/ and fail.)
    const svc = new RealCatalogService();
    const detail = await svc.getVersionDetail(APP_ID, 'latest');
    expect(detail.composeOverride).toBe(COMPOSE);
  });
});
