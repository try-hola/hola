/**
 * The container-logs proxy (spec 004, ADR 0004 §12): unit tests for the pure
 * allowlist/redaction logic, plus an integration test against a fake Docker API
 * served over a temp unix socket — no real Docker daemon needed.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { decide, redactInspect, startDockerProxy } from '../../lib/docker-proxy';
import type { DockerProxyHandle } from '../../lib/docker-proxy';

describe('decide', () => {
  test('allows the container-list, inspect, logs and events GETs', () => {
    expect(decide('GET', '/containers/json')).toEqual({ allow: true, kind: 'passthrough' });
    expect(decide('GET', '/containers/abc123/json')).toEqual({ allow: true, kind: 'inspect' });
    expect(decide('GET', '/containers/abc123/logs')).toEqual({ allow: true, kind: 'stream' });
    expect(decide('GET', '/events')).toEqual({ allow: true, kind: 'stream' });
    expect(decide('GET', '/_ping')).toEqual({ allow: true, kind: 'passthrough' });
    expect(decide('GET', '/version')).toEqual({ allow: true, kind: 'passthrough' });
  });

  test('accepts an API-version prefix and forwards the same decision', () => {
    expect(decide('GET', '/v1.45/containers/json')).toEqual({ allow: true, kind: 'passthrough' });
    expect(decide('GET', '/v1.45/containers/abc/json')).toEqual({ allow: true, kind: 'inspect' });
    expect(decide('GET', '/v1.45/containers/abc/logs')).toEqual({ allow: true, kind: 'stream' });
  });

  test('denies file exfiltration, exec, images, stats, top, and every non-GET', () => {
    expect(decide('GET', '/containers/abc/archive').allow).toBe(false);
    expect(decide('POST', '/containers/abc/exec').allow).toBe(false);
    expect(decide('GET', '/images/json').allow).toBe(false);
    expect(decide('GET', '/containers/abc/stats').allow).toBe(false);
    expect(decide('GET', '/containers/abc/top').allow).toBe(false);
    expect(decide('POST', '/containers/abc/start').allow).toBe(false);
    expect(decide('DELETE', '/containers/abc').allow).toBe(false);
    expect(decide('PUT', '/containers/json').allow).toBe(false);
  });
});

describe('redactInspect', () => {
  const FULL_INSPECT = {
    Id: 'abc123',
    Name: '/postiz',
    Created: '2026-01-01T00:00:00Z',
    State: { Status: 'running' },
    Image: 'sha256:deadbeef',
    Config: {
      Tty: false,
      Labels: { 'sh.hola.app': 'postiz' },
      Image: 'ghcr.io/gitroomhq/postiz-app:v1.0.0',
      Hostname: 'abc123',
      Env: ['DB_PASSWORD=supersecret', 'API_KEY=xyz'],
      Cmd: ['node', 'server.js'],
      Entrypoint: ['docker-entrypoint.sh'],
    },
    HostConfig: { Binds: ['/host/path:/container/path'] },
    Mounts: [{ Source: '/host/path', Destination: '/container/path' }],
    NetworkSettings: { IPAddress: '172.18.0.5' },
  };

  test('keeps the allowlisted fields', () => {
    const redacted = redactInspect(FULL_INSPECT) as Record<string, unknown>;
    expect(redacted.Id).toBe('abc123');
    expect(redacted.Name).toBe('/postiz');
    expect(redacted.Created).toBe('2026-01-01T00:00:00Z');
    expect(redacted.State).toEqual({ Status: 'running' });
    expect(redacted.Image).toBe('sha256:deadbeef');
    const config = redacted.Config as Record<string, unknown>;
    expect(config.Tty).toBe(false);
    expect(config.Labels).toEqual({ 'sh.hola.app': 'postiz' });
    expect(config.Image).toBe('ghcr.io/gitroomhq/postiz-app:v1.0.0');
    expect(config.Hostname).toBe('abc123');
  });

  test('drops Config.Env, Config.Cmd, Config.Entrypoint, HostConfig, Mounts, NetworkSettings', () => {
    const redacted = redactInspect(FULL_INSPECT) as Record<string, unknown>;
    expect(redacted.HostConfig).toBeUndefined();
    expect(redacted.Mounts).toBeUndefined();
    expect(redacted.NetworkSettings).toBeUndefined();
    const config = redacted.Config as Record<string, unknown>;
    expect(config.Env).toBeUndefined();
    expect(config.Cmd).toBeUndefined();
    expect(config.Entrypoint).toBeUndefined();
  });

  test('is defensive against a missing/malformed body', () => {
    expect(redactInspect(null)).toBeNull();
    expect(redactInspect(undefined)).toBeUndefined();
    expect(redactInspect('not an object')).toBe('not an object');
    expect(redactInspect({})).toEqual({
      Id: undefined, Name: undefined, Created: undefined, State: undefined, Image: undefined,
      Config: { Tty: undefined, Labels: undefined, Image: undefined, Hostname: undefined },
    });
  });
});

/** Longer than Bun.serve's default 10s idleTimeout, so an idle stream would be cut. */
const IDLE_GAP_MS = 13_000;

describe('startDockerProxy (integration, fake Docker API on a temp unix socket)', () => {
  let socketDir: string;
  let socketPath: string;
  let fakeDocker: ReturnType<typeof Bun.serve>;
  let proxy: DockerProxyHandle;

  const INSPECT_BODY = {
    Id: 'c1', Name: '/app', Created: 'now', State: { Status: 'running' }, Image: 'sha256:x',
    Config: { Tty: true, Labels: { app: 'x' }, Image: 'nginx:1.27', Hostname: 'c1', Env: ['SECRET=1'], Cmd: ['nginx'] },
    HostConfig: { Binds: ['/x:/x'] },
    Mounts: [{ Source: '/x' }],
  };

  beforeAll(async () => {
    socketDir = await mkdtemp(join(tmpdir(), 'hola-docker-proxy-'));
    socketPath = join(socketDir, 'docker.sock');

    fakeDocker = Bun.serve({
      unix: socketPath,
      // Real dockerd holds an idle `/events` or `follow`ed log stream open
      // indefinitely; Bun.serve would close it after 10s, so match dockerd.
      // (Cast: Bun's unix-socket overload types `idleTimeout` as `undefined`.)
      ...({ idleTimeout: 0 } as unknown as { idleTimeout?: undefined }),
      fetch(req) {
        const fullUrl = new URL(req.url);
        // Real dockerd accepts an optional `/vN.NN` API-version prefix on any
        // path; mimic that here so the proxy's "forward with prefix intact"
        // behaviour is actually exercised.
        const url = new URL(fullUrl.pathname.replace(/^\/v\d+(?:\.\d+)*(?=\/|$)/, '') + fullUrl.search, fullUrl);
        if (req.method === 'GET' && url.pathname === '/containers/json') {
          return Response.json([{ Id: 'c1', Names: ['/app'] }]);
        }
        if (req.method === 'GET' && /^\/containers\/[^/]+\/json$/.test(url.pathname)) {
          return Response.json(INSPECT_BODY);
        }
        if (req.method === 'GET' && /^\/containers\/[^/]+\/logs$/.test(url.pathname)) {
          return new Response('line one\nline two\n');
        }
        if (req.method === 'GET' && url.pathname === '/_ping') {
          return new Response('OK');
        }
        // A quiet event stream: the response opens, then NOTHING for longer than
        // Bun.serve's default 10s idleTimeout, then one event. That is exactly
        // dockerd on a host where no container starts or stops for a while — and
        // the shape that trips the timeout (any earlier byte resets its timer).
        if (req.method === 'GET' && url.pathname === '/events') {
          return new Response(
            new ReadableStream({
              async start(controller) {
                await new Promise((r) => setTimeout(r, IDLE_GAP_MS));
                controller.enqueue(new TextEncoder().encode('{"late":1}\n'));
                controller.close();
              },
            }),
          );
        }
        // exec/archive/etc — never reached in these tests (the proxy denies
        // before forwarding), but present so a would-be leak is observable.
        return new Response('unexpected upstream call', { status: 404 });
      },
    });

    proxy = await startDockerProxy({ socketPath, port: 0 });
  });

  afterAll(async () => {
    await proxy.stop();
    fakeDocker.stop(true);
    await rm(socketDir, { recursive: true, force: true });
  });

  const proxyUrl = (path: string) => `http://127.0.0.1:${proxy.port}${path}`;

  test('GET /containers/json passes through byte-identical', async () => {
    const res = await fetch(proxyUrl('/containers/json'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ Id: 'c1', Names: ['/app'] }]);
  });

  test('GET /v1.45/containers/{id}/json is redacted (no Env, no HostConfig, no Mounts)', async () => {
    const res = await fetch(proxyUrl('/v1.45/containers/c1/json'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.Config.Tty).toBe(true);
    expect(body.Config.Labels).toEqual({ app: 'x' });
    expect(body.Config.Env).toBeUndefined();
    expect(body.HostConfig).toBeUndefined();
    expect(body.Mounts).toBeUndefined();
  });

  test('GET /containers/{id}/logs streams bytes identical', async () => {
    const res = await fetch(proxyUrl('/containers/c1/logs'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('line one\nline two\n');
  });

  test('GET /_ping passes through', async () => {
    const res = await fetch(proxyUrl('/_ping'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');
  });

  test('GET /containers/{id}/archive is denied with 403 and the grant message', async () => {
    const res = await fetch(proxyUrl('/containers/c1/archive'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: 'not permitted by the container-logs grant' });
  });

  test('POST /containers/{id}/exec is denied', async () => {
    const res = await fetch(proxyUrl('/containers/c1/exec'), { method: 'POST' });
    expect(res.status).toBe(403);
  });

  test('GET /images/json is denied', async () => {
    const res = await fetch(proxyUrl('/images/json'));
    expect(res.status).toBe(403);
  });

  // Deliberately slow (~11s): the only way to observe an idle-timeout close is
  // to stay idle past it. Bun.serve's default is 10s, which drops every quiet
  // `/events` watch and every `follow`ed log stream on a real host — the two
  // things the container-logs grant exists to serve — so the proxy disables it.
  // Without `idleTimeout: 0` this fails with "socket connection was closed
  // unexpectedly" instead of delivering the late event.
  test(
    'a stream that sends nothing for longer than Bun.serve\'s default 10s timeout is not closed',
    async () => {
      const res = await fetch(proxyUrl('/events'));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"late":1}\n');
    },
    IDLE_GAP_MS + 15_000,
  );
});
