/**
 * apps-data read-only mount injection (ADR 0002, backup Phase 2).
 *
 * The server grants a trusted app read-only access to all app data roots by
 * injecting an identity-mapped `<base>:<base>:ro` mount into every service.
 */

import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { injectReadonlyMount, injectContainerLogsSource, CONTAINER_LOGS_PROXY_SERVICE, CONTAINER_LOGS_DOCKER_HOST, CONTAINER_LOGS_PROXY_PORT } from '../../services/core/compose-mounts';

const ROOT = '/srv/hola/apps';
const out = (yaml: string) => parse(injectReadonlyMount(yaml, { hostPath: ROOT }));

describe('injectReadonlyMount', () => {
  test('adds the read-only mount to every service, preserving existing volumes', () => {
    const input = [
      'services:',
      '  backrest:',
      '    image: garethgeorge/backrest:v1',
      '    volumes:',
      '      - ${HOLA_APP_DATA}/config:/config',
      '  helper:',
      '    image: alpine:3',
      '',
    ].join('\n');
    const doc = out(input);

    expect(doc.services.backrest.volumes).toEqual([
      '${HOLA_APP_DATA}/config:/config',
      `${ROOT}:${ROOT}:ro`,
    ]);
    expect(doc.services.helper.volumes).toEqual([`${ROOT}:${ROOT}:ro`]);
  });

  test('is idempotent (no duplicate mount)', () => {
    const once = injectReadonlyMount('services:\n  app:\n    image: app:1\n', { hostPath: ROOT });
    const twice = injectReadonlyMount(once, { hostPath: ROOT });
    expect(parse(twice).services.app.volumes).toEqual([`${ROOT}:${ROOT}:ro`]);
  });

  test('no services -> returns input unchanged', () => {
    const input = 'networks:\n  hola:\n    external: true\n';
    expect(injectReadonlyMount(input, { hostPath: ROOT })).toBe(input);
  });
});

describe('injectContainerLogsSource (spec 004, ADR 0004 §12)', () => {
  const IMAGE = 'ghcr.io/try-hola/server:0.11.0';
  const SOCKET = '/var/run/docker.sock';
  const LABELS = { 'sh.hola.app': 'alloy', 'sh.hola.deployment': 'alloy-77', 'sh.hola.name': 'Alloy' };

  const outLogs = (yaml: string, logging?: unknown) =>
    parse(injectContainerLogsSource(yaml, { image: IMAGE, socketPath: SOCKET, labels: LABELS, logging }));

  test('adds the sidecar with the exact shape: image, command, ro socket volume, restart, security_opt, labels, no networks/ports', () => {
    const doc = outLogs('services:\n  alloy:\n    image: alloy:1\n');
    const sidecar = doc.services[CONTAINER_LOGS_PROXY_SERVICE];
    expect(sidecar.image).toBe(IMAGE);
    expect(sidecar.command).toEqual(['bun', 'src/docker-proxy.ts']);
    expect(sidecar.volumes).toEqual([`${SOCKET}:/var/run/docker.sock:ro`]);
    expect(sidecar.restart).toBe('unless-stopped');
    expect(sidecar.security_opt).toEqual(['no-new-privileges:true']);
    expect(sidecar.labels).toEqual(LABELS);
    expect(sidecar.networks).toBeUndefined();
    expect(sidecar.ports).toBeUndefined();
  });

  test('pins the sidecar PORT and socket so nothing is inherited from the server image', () => {
    // The sidecar runs from the SERVER's image, which sets `ENV PORT=3001` (and
    // a HEALTHCHECK against the API server's /healthz). Inheriting either leaves
    // the proxy listening on the wrong port — with every other service dialling
    // DOCKER_HOST on 2375 — and the container permanently "unhealthy".
    const doc = outLogs('services:\n  alloy:\n    image: alloy:1\n');
    const sidecar = doc.services[CONTAINER_LOGS_PROXY_SERVICE];
    expect(sidecar.environment).toEqual({ PORT: '2375', DOCKER_SOCKET: '/var/run/docker.sock' });
    expect(sidecar.environment.PORT).toBe(String(CONTAINER_LOGS_PROXY_PORT));
    expect(CONTAINER_LOGS_DOCKER_HOST).toBe(`tcp://${CONTAINER_LOGS_PROXY_SERVICE}:${CONTAINER_LOGS_PROXY_PORT}`);
    expect(sidecar.healthcheck).toEqual({ disable: true });
  });

  test('binds a non-default host socket path to the fixed container path', () => {
    const doc = parse(
      injectContainerLogsSource('services:\n  alloy:\n    image: alloy:1\n', {
        image: IMAGE,
        socketPath: '/run/user/1000/docker.sock',
        labels: LABELS,
      }),
    );
    const sidecar = doc.services[CONTAINER_LOGS_PROXY_SERVICE];
    expect(sidecar.volumes).toEqual(['/run/user/1000/docker.sock:/var/run/docker.sock:ro']);
    // DOCKER_SOCKET names the CONTAINER side, which never moves with the host path.
    expect(sidecar.environment.DOCKER_SOCKET).toBe('/var/run/docker.sock');
  });

  test('carries the platform logging block onto the sidecar when given', () => {
    const logging = { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } };
    const doc = outLogs('services:\n  alloy:\n    image: alloy:1\n', logging);
    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE].logging).toEqual(logging);
  });

  test('sets DOCKER_HOST on every other service, map form', () => {
    const doc = outLogs('services:\n  alloy:\n    image: alloy:1\n  helper:\n    image: alpine:3\n');
    expect(doc.services.alloy.environment).toEqual({ DOCKER_HOST: CONTAINER_LOGS_DOCKER_HOST });
    expect(doc.services.helper.environment).toEqual({ DOCKER_HOST: CONTAINER_LOGS_DOCKER_HOST });
  });

  // List-form env is normalised to the equivalent map (as `injectEnvironment`
  // does elsewhere); Compose accepts either, and the existing entries survive.
  test('normalises list-form environment to a map, preserving entries and adding DOCKER_HOST', () => {
    const input = 'services:\n  alloy:\n    image: alloy:1\n    environment:\n      - FOO=bar\n';
    const doc = outLogs(input);
    expect(doc.services.alloy.environment).toEqual({ FOO: 'bar', DOCKER_HOST: CONTAINER_LOGS_DOCKER_HOST });
  });

  test('overwrites a user-authored DOCKER_HOST', () => {
    const input = 'services:\n  alloy:\n    image: alloy:1\n    environment:\n      DOCKER_HOST: tcp://elsewhere:9999\n';
    const doc = outLogs(input);
    expect(doc.services.alloy.environment.DOCKER_HOST).toBe(CONTAINER_LOGS_DOCKER_HOST);
  });

  test('is idempotent — a second call does not duplicate the sidecar or the env entry', () => {
    const once = injectContainerLogsSource('services:\n  alloy:\n    image: alloy:1\n', { image: IMAGE, socketPath: SOCKET, labels: LABELS });
    const twice = injectContainerLogsSource(once, { image: IMAGE, socketPath: SOCKET, labels: LABELS });
    const doc = parse(twice);
    expect(Object.keys(doc.services).sort()).toEqual(['alloy', CONTAINER_LOGS_PROXY_SERVICE].sort());
    expect(doc.services.alloy.environment).toEqual({ DOCKER_HOST: CONTAINER_LOGS_DOCKER_HOST });
  });

  test('joins the networks the provider services are actually on, never `hola`', () => {
    // A sidecar left on `default` while every app service sits on a custom
    // network is unreachable — `DOCKER_HOST` resolves to nothing and the grant
    // silently does nothing.
    const input = [
      'services:',
      '  alloy:',
      '    image: alloy:1',
      '    networks:',
      '      backend: {}',
      '      hola:',
      '        aliases: [alloy]',
      '  helper:',
      '    image: alpine:3',
      '    networks: [backend]',
      'networks:',
      '  backend: {}',
      '  hola:',
      '    external: true',
      '',
    ].join('\n');
    const doc = outLogs(input);
    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE].networks).toEqual(['backend']);
  });

  test('adds `default` alongside a custom network when some service declares none', () => {
    const input = [
      'services:',
      '  alloy:',
      '    image: alloy:1',
      '    networks: [backend]',
      '  helper:',
      '    image: alpine:3',
      'networks:',
      '  backend: {}',
      '',
    ].join('\n');
    const doc = outLogs(input);
    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE].networks).toEqual(['backend', 'default']);
  });

  test('omits `networks` entirely when no service declares any', () => {
    const doc = outLogs('services:\n  alloy:\n    image: alloy:1\n  helper:\n    image: alpine:3\n');
    expect(doc.services[CONTAINER_LOGS_PROXY_SERVICE].networks).toBeUndefined();
  });

  test('is idempotent for networks too — the sidecar does not feed itself', () => {
    const input = 'services:\n  alloy:\n    image: alloy:1\n    networks: [backend]\n';
    const opts = { image: IMAGE, socketPath: SOCKET, labels: LABELS };
    const twice = injectContainerLogsSource(injectContainerLogsSource(input, opts), opts);
    expect(parse(twice).services[CONTAINER_LOGS_PROXY_SERVICE].networks).toEqual(['backend']);
  });

  test('no services -> returns input unchanged', () => {
    const input = 'networks:\n  hola:\n    external: true\n';
    expect(injectContainerLogsSource(input, { image: IMAGE, socketPath: SOCKET, labels: LABELS })).toBe(input);
  });
});
