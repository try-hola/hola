/**
 * The deploy-time half of bind-source containment (F02a).
 *
 * The validator refuses an interpolated bind source in the document an app
 * DECLARES. This gate asks Compose what it actually resolved, under the same
 * allowlisted environment `up` runs with, and refuses to create containers when
 * a bind source landed outside the app's own data root — whatever produced it.
 *
 * These cover the pure functions; the wiring (a deploy that fails before
 * `compose pull`) is pinned in `compose-containment-gate.test.ts`.
 */

import { describe, test, expect } from 'bun:test';
import {
  normalizeHostPath,
  resolvedBindMounts,
  uncontainedBindMounts,
  describeUncontained,
} from '../../services/core/compose-resolved-guard';

const APP_ROOT = '/data/apps/dep_abc';

describe('normalizeHostPath', () => {
  test('collapses `.`, `..` and duplicate separators', () => {
    expect(normalizeHostPath('/data/apps/dep_abc/data')).toBe('/data/apps/dep_abc/data');
    expect(normalizeHostPath('/data/apps/dep_abc/./data//x')).toBe('/data/apps/dep_abc/data/x');
    expect(normalizeHostPath('/data/apps/dep_abc/../../../var/run')).toBe('/var/run');
    expect(normalizeHostPath('/data/apps/dep_abc/a/b/../..')).toBe('/data/apps/dep_abc');
  });

  test('a `..` at the root stays at the root, as the kernel resolves it', () => {
    expect(normalizeHostPath('/../../etc')).toBe('/etc');
    expect(normalizeHostPath('/')).toBe('/');
  });
});

describe('resolvedBindMounts', () => {
  test('reads the long syntax `docker compose config` emits', () => {
    const config = {
      services: {
        app: {
          volumes: [
            { type: 'bind', source: '/data/apps/dep_abc/data', target: '/data' },
            { type: 'volume', source: 'named', target: '/cache' },
            { type: 'tmpfs', target: '/run/x' },
          ],
        },
      },
    };
    expect(resolvedBindMounts(config)).toEqual([
      { service: 'app', source: '/data/apps/dep_abc/data', target: '/data' },
    ]);
  });

  test('reads a surviving short-syntax entry rather than waving it past', () => {
    const config = { services: { app: { volumes: ['/var/run:/var/run', 'named:/cache'] } } };
    expect(resolvedBindMounts(config)).toEqual([
      { service: 'app', source: '/var/run', target: '/var/run' },
    ]);
  });

  test('an entry with no readable source is reported, not skipped', () => {
    const config = { services: { app: { volumes: [{ type: 'bind', target: '/data' }] } } };
    expect(resolvedBindMounts(config)).toEqual([{ service: 'app', source: '', target: '/data' }]);
  });

  test('a document with no services or no volumes yields nothing', () => {
    expect(resolvedBindMounts({ services: {} })).toEqual([]);
    expect(resolvedBindMounts({ services: { app: { image: 'nginx:1.27' } } })).toEqual([]);
    expect(resolvedBindMounts(null)).toEqual([]);
    expect(resolvedBindMounts({ services: [] })).toEqual([]);
  });
});

describe('uncontainedBindMounts', () => {
  const bind = (source: string, service = 'app') => ({
    services: { [service]: { volumes: [{ type: 'bind', source, target: '/data' }] } },
  });

  test('the app data root and its sub-directories pass', () => {
    for (const source of [APP_ROOT, `${APP_ROOT}/data`, `${APP_ROOT}/a/b/c`]) {
      expect(uncontainedBindMounts(bind(source), { appRoot: APP_ROOT })).toEqual([]);
    }
  });

  test('an interpolated source that resolved out of the root is refused', () => {
    // What `${HOLA_APP_DATA}/${ESCAPE}:/data` with `ESCAPE=../../../../var/run`
    // becomes by the time Compose has resolved it.
    const bad = uncontainedBindMounts(bind(`${APP_ROOT}/../../../var/run`), { appRoot: APP_ROOT });
    expect(bad).toHaveLength(1);
    expect(bad[0].service).toBe('app');
    expect(bad[0].reason).toContain("'/var/run'");
    expect(describeUncontained(bad)).toContain("app: '/data/apps/dep_abc/../../../var/run'");
  });

  test('a sibling directory that merely shares the prefix is refused', () => {
    // `/data/apps/dep_abcde` starts with the root as a STRING but is another
    // app's data; containment is a path relationship, not `startsWith`.
    const bad = uncontainedBindMounts(bind('/data/apps/dep_abcde/data'), { appRoot: APP_ROOT });
    expect(bad).toHaveLength(1);
  });

  test('another app data root is refused', () => {
    expect(uncontainedBindMounts(bind('/data/apps/dep_other/config'), { appRoot: APP_ROOT })).toHaveLength(1);
  });

  test('a platform-granted path passes only when it was actually granted', () => {
    const socket = bind('/var/run/docker.sock', 'hola-docker-proxy');
    // Granted: the container-logs sidecar's own socket bind.
    expect(uncontainedBindMounts(socket, { appRoot: APP_ROOT, allowedPaths: ['/var/run/docker.sock'] })).toEqual([]);
    // Not granted: the very same mount is refused.
    expect(uncontainedBindMounts(socket, { appRoot: APP_ROOT, allowedPaths: [] })).toHaveLength(1);
  });

  test('an allowed path is a containment root, so the apps-data grant covers its children', () => {
    const config = bind('/data/apps/dep_other/data', 'backrest');
    expect(uncontainedBindMounts(config, { appRoot: APP_ROOT, allowedPaths: ['/data/apps'] })).toEqual([]);
  });

  test('a mount with no source, or a non-absolute one, is refused rather than skipped', () => {
    const noSource = { services: { app: { volumes: [{ type: 'bind', target: '/data' }] } } };
    expect(uncontainedBindMounts(noSource, { appRoot: APP_ROOT })[0].reason).toContain('no readable host source');
    const relative = bind('./data');
    expect(uncontainedBindMounts(relative, { appRoot: APP_ROOT })[0].reason).toContain('not an absolute host path');
  });

  test('every offending mount is reported, across services', () => {
    const config = {
      services: {
        app: { volumes: [{ type: 'bind', source: `${APP_ROOT}/data`, target: '/data' }] },
        side: { volumes: [{ type: 'bind', source: '/etc', target: '/host-etc' }] },
        other: { volumes: [{ type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' }] },
      },
    };
    const bad = uncontainedBindMounts(config, { appRoot: APP_ROOT });
    expect(bad.map((m) => m.service)).toEqual(['side', 'other']);
    expect(describeUncontained(bad)).toContain('/host-etc');
  });
});
