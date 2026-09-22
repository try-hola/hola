/**
 * `injectWritableMount` (spec 008, R21) — the restore-staging grant's mount
 * injector. Mirrors `injectReadonlyMount`'s own shape (there is no dedicated
 * test file for that one; this is the first compose-mounts unit test file),
 * differing in exactly one respect: no `:ro` suffix.
 */
import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { injectWritableMount, injectReadonlyMount, injectContainerLogsSource, injectContractEnvironment, CONTAINER_LOGS_PROXY_SERVICE } from '../../services/core/compose-mounts';

const COMPOSE = 'services:\n  app:\n    image: app:1.0.0\n  worker:\n    image: app:1.0.0\n';

describe('injectWritableMount (spec 008, scenario 8)', () => {
  test('appends <hostPath>:<hostPath> with no :ro to every service, deduped', () => {
    const out = injectWritableMount(COMPOSE, { hostPath: '/srv/hola/restore' });
    const doc = parse(out) as { services: Record<string, { volumes?: string[] }> };
    expect(doc.services.app.volumes).toEqual(['/srv/hola/restore:/srv/hola/restore']);
    expect(doc.services.worker.volumes).toEqual(['/srv/hola/restore:/srv/hola/restore']);
    expect(out).not.toContain(':ro');

    // Idempotent — re-running does not duplicate the mount.
    const twice = injectWritableMount(out, { hostPath: '/srv/hola/restore' });
    const doc2 = parse(twice) as { services: Record<string, { volumes?: string[] }> };
    expect(doc2.services.app.volumes).toEqual(['/srv/hola/restore:/srv/hola/restore']);
  });

  test('compose with no services is returned unchanged', () => {
    expect(injectWritableMount('services: {}\n', { hostPath: '/srv/hola/restore' })).toBe('services: {}\n');
  });

  // The container-logs sidecar already holds the Docker socket, and it is
  // injected EARLIER in `materializeCompose` than the restore-staging grant —
  // so a provider consenting to both `container-logs@1` and `restore@1` would
  // otherwise hand the socket-holding proxy a writable host mount it has no
  // use for. `injectReadonlyMount` escapes this only because it runs before
  // the sidecar exists, which is an accident of ordering, not a rule.
  test('never mounts into the container-logs proxy sidecar, whatever the injection order', () => {
    const withSidecar = injectContainerLogsSource(COMPOSE, {
      image: 'ghcr.io/try-hola/server:1.0.0',
      socketPath: '/var/run/docker.sock',
      labels: {},
    });
    const out = injectWritableMount(withSidecar, { hostPath: '/srv/hola/restore' });
    const doc = parse(out) as { services: Record<string, { volumes?: string[] }> };

    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE]).toBeDefined();
    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE]!.volumes ?? []).not.toContain('/srv/hola/restore:/srv/hola/restore');
    // The app's own services still get it.
    expect(doc.services.app!.volumes).toContain('/srv/hola/restore:/srv/hola/restore');
    expect(doc.services.worker!.volumes).toContain('/srv/hola/restore:/srv/hola/restore');
  });

  test('is a genuinely separate function from injectReadonlyMount — never emits :ro', () => {
    expect(injectWritableMount).not.toBe(injectReadonlyMount as unknown as typeof injectWritableMount);
    const ro = injectReadonlyMount(COMPOSE, { hostPath: '/srv/hola/apps' });
    expect(ro).toContain(':ro');
    const rw = injectWritableMount(COMPOSE, { hostPath: '/srv/hola/apps' });
    expect(rw).not.toContain(':ro');
  });
});

/**
 * `injectContractEnvironment` (#509) — contract credentials must reach every
 * service the APP declares, not just its ingress service.
 *
 * Ingress-only injection was enough for `backup@1`, whose provider scripts run
 * inside the ingress container because Backrest invokes them itself. `restore@1`
 * forces a separate long-running poller (Backrest has no restore-triggered hook
 * condition), and that container was receiving the grant's elevated MOUNTS with
 * no credential to use them — consent recorded, token withheld, provider half
 * inoperable. Found on the first live DR rehearsal, not by any unit suite.
 */
describe('injectContractEnvironment (#509)', () => {
  const CONTRACT = { HOLA_CONTRACT_TOKEN: 'hct_dummy', HOLA_API_URL: 'http://hola-server:3001' };

  test('reaches every service, not only the first/ingress one', () => {
    const out = injectContractEnvironment(COMPOSE, CONTRACT);
    const doc = parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
    for (const svc of ['app', 'worker']) {
      expect(doc.services[svc]!.environment).toMatchObject(CONTRACT);
    }
  });

  test('preserves a service\'s own declared environment', () => {
    const src = 'services:\n  app:\n    image: app:1.0.0\n  poller:\n    image: yq:1\n    environment:\n      MY_KNOB: "true"\n';
    const out = injectContractEnvironment(src, CONTRACT);
    const doc = parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
    expect(doc.services.poller!.environment).toMatchObject({ MY_KNOB: 'true', ...CONTRACT });
  });

  test('normalizes a KEY=value array form before merging', () => {
    const src = 'services:\n  app:\n    image: app:1.0.0\n    environment:\n      - MY_KNOB=true\n';
    const out = injectContractEnvironment(src, CONTRACT);
    const doc = parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
    expect(doc.services.app!.environment).toMatchObject({ MY_KNOB: 'true', ...CONTRACT });
  });

  test('SKIPS the platform-injected docker-proxy sidecar — it is not the app\'s trust boundary', () => {
    const withProxy = `services:\n  app:\n    image: app:1.0.0\n  ${CONTAINER_LOGS_PROXY_SERVICE}:\n    image: ghcr.io/try-hola/server:1\n`;
    const out = injectContractEnvironment(withProxy, CONTRACT);
    const doc = parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
    expect(doc.services.app!.environment).toMatchObject(CONTRACT);
    const proxyEnv = doc.services[CONTAINER_LOGS_PROXY_SERVICE]!.environment ?? {};
    expect(proxyEnv).not.toHaveProperty('HOLA_CONTRACT_TOKEN');
    expect(proxyEnv).not.toHaveProperty('HOLA_API_URL');
  });

  test('an empty env map is a no-op, not a rewrite', () => {
    expect(injectContractEnvironment(COMPOSE, {})).toBe(COMPOSE);
  });

  test('refuses a compose document with no services rather than silently doing nothing', () => {
    expect(() => injectContractEnvironment('version: "3"\n', CONTRACT)).toThrow(/no services/);
  });
});
