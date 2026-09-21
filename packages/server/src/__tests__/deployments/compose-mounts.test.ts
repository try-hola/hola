/**
 * `injectWritableMount` (spec 008, R21) — the restore-staging grant's mount
 * injector. Mirrors `injectReadonlyMount`'s own shape (there is no dedicated
 * test file for that one; this is the first compose-mounts unit test file),
 * differing in exactly one respect: no `:ro` suffix.
 */
import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { injectWritableMount, injectReadonlyMount, injectContainerLogsSource, CONTAINER_LOGS_PROXY_SERVICE } from '../../services/core/compose-mounts';

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
