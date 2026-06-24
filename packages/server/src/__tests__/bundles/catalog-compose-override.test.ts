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
  defaultEnv: [{ key: 'APP_ENV', value: 'production', isSecret: false }],
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
  });
});
