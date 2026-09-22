/**
 * The container-logs proxy (spec 004, ADR 0004 §12): unit tests for the pure
 * allowlist/redaction logic, plus an integration test against a fake Docker API
 * served over a temp unix socket — no real Docker daemon needed.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  decide,
  redactInspect,
  startDockerProxy,
  redactInfo,
  redactContainerList,
  redactLabels,
  redactEvent,
} from '../../lib/docker-proxy';
import type { DockerProxyHandle } from '../../lib/docker-proxy';

describe('decide', () => {
  test('allows the container-list, inspect, logs and events GETs', () => {
    // `list` and `events` are NOT `passthrough` (F08): allowing the path is only
    // half the decision, and both bodies are rebuilt/filtered before they leave.
    expect(decide('GET', '/containers/json')).toEqual({ allow: true, kind: 'list' });
    expect(decide('GET', '/containers/abc123/json')).toEqual({ allow: true, kind: 'inspect' });
    expect(decide('GET', '/containers/abc123/logs')).toEqual({ allow: true, kind: 'stream' });
    expect(decide('GET', '/events')).toEqual({ allow: true, kind: 'events' });
    expect(decide('GET', '/_ping')).toEqual({ allow: true, kind: 'passthrough' });
    expect(decide('GET', '/version')).toEqual({ allow: true, kind: 'passthrough' });
  });

  test('accepts an API-version prefix and forwards the same decision', () => {
    expect(decide('GET', '/v1.45/containers/json')).toEqual({ allow: true, kind: 'list' });
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

  test('empties HostConfig, Mounts and NetworkSettings without dropping them', () => {
    // Emptied rather than removed: a real daemon always returns these, so
    // clients walk them unchecked (Dozzle segfaults on a missing HostConfig).
    // The content is what the grant withholds, not the shape.
    const redacted = redactInspect(FULL_INSPECT) as Record<string, unknown>;
    expect(redacted.HostConfig).toEqual({ PortBindings: {} });
    expect(redacted.Mounts).toEqual([]);
    expect(redacted.NetworkSettings).toEqual({ Networks: {} });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('172.18.0.5');
    expect(serialized).not.toContain('/var/run/docker.sock');
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
      HostConfig: { PortBindings: {} }, Mounts: [], NetworkSettings: { Networks: {} },
    });
  });
});

// ---------------------------------------------------------------------------
// F08. `/containers/json` used to pass through byte-identical, which made the
// inspect allowlist decorative: Docker's list response carries the same
// categories under different names. The fixture below is a realistic entry for
// one of this repo's own app containers, carrying the two things the finding
// names — a password on the command line and a sensitive bind source — plus the
// host paths Compose writes into labels.
const LIST_ENTRY = {
  Id: 'c0ffee1234567890',
  Names: ['/gitea'],
  Image: 'gitea/gitea:1.22.3',
  ImageID: 'sha256:deadbeef',
  // The finding's dummy credential, exactly where Docker's list endpoint puts it.
  Command: '/usr/bin/entrypoint --db-password=hunter2 --admin-token=s3cr3t',
  Created: 1758400000,
  State: 'running',
  Status: 'Up 3 hours',
  Ports: [{ IP: '0.0.0.0', PrivatePort: 3000, PublicPort: 8929, Type: 'tcp' }],
  Labels: {
    'sh.hola.app': 'gitea',
    'sh.hola.deployment': 'gitea-a1b2c3',
    'sh.hola.name': 'Gitea',
    'com.docker.compose.project': 'gitea-a1b2c3',
    'com.docker.compose.service': 'server',
    // Compose records absolute HOST paths as labels on every container it makes.
    'com.docker.compose.project.working_dir': '/srv/hola/apps/gitea-a1b2c3',
    'com.docker.compose.project.config_files': '/srv/hola/apps/gitea-a1b2c3/docker-compose.yml',
  },
  HostConfig: { NetworkMode: 'hola-gitea-a1b2c3' },
  NetworkSettings: { Networks: { hola: { IPAddress: '172.18.0.7', Gateway: '172.18.0.1' } } },
  // The finding's sensitive bind source.
  Mounts: [
    { Type: 'bind', Source: '/srv/hola/apps/gitea-a1b2c3/data', Destination: '/data' },
    { Type: 'bind', Source: '/etc/ssl/private', Destination: '/certs' },
  ],
};

describe('redactContainerList (F08)', () => {
  const [out] = redactContainerList([LIST_ENTRY]) as Record<string, unknown>[];

  test('discloses no command line, bind source, host port or network topology', () => {
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('hunter2');              // dummy password on the command line
    expect(serialized).not.toContain('s3cr3t');
    expect(serialized).not.toContain('/etc/ssl/private');     // sensitive bind source
    expect(serialized).not.toContain('8929');                 // host port binding
    expect(serialized).not.toContain('172.18.0.7');           // network topology
    expect(serialized).not.toContain('/srv/hola/apps');       // host paths smuggled in labels
    expect(serialized).not.toContain('docker-compose.yml');
    const labels = out.Labels as Record<string, string>;
    expect(labels['com.docker.compose.project.working_dir']).toBeUndefined();
    expect(labels['com.docker.compose.project.config_files']).toBeUndefined();
  });

  test('denied-but-structural fields are present and empty, like inspect', () => {
    // Same reasoning as redactInspect: a real daemon always returns these, so
    // clients walk them without nil checks. `Command` is a string, and '' is
    // exactly what Docker's Go SDK decodes an absent Command into.
    expect(out.Command).toBe('');
    expect(out.Ports).toEqual([]);
    expect(out.Mounts).toEqual([]);
    expect(out.HostConfig).toEqual({});
    expect(out.NetworkSettings).toEqual({ Networks: {} });
  });

  // Deliberately asserts ONLY what must survive, so it passes on both sides of
  // the fix: a collector that cannot identify and group containers cannot do its
  // job at all, and a redaction that broke this would be a regression, not a fix.
  test('what a log collector needs still comes through', () => {
    expect(out.Id).toBe('c0ffee1234567890');
    expect(out.Names).toEqual(['/gitea']);
    expect(out.Image).toBe('gitea/gitea:1.22.3');
    expect(out.State).toBe('running');
    expect(out.Status).toBe('Up 3 hours');
    const labels = out.Labels as Record<string, string>;
    expect(labels['sh.hola.app']).toBe('gitea');
    expect(labels['sh.hola.deployment']).toBe('gitea-a1b2c3');
    expect(labels['sh.hola.name']).toBe('Gitea');
    // Compose's own grouping labels are how any standard Docker client groups a
    // project; only the two host-PATH labels are withheld (asserted above).
    expect(labels['com.docker.compose.project']).toBe('gitea-a1b2c3');
    expect(labels['com.docker.compose.service']).toBe('server');
  });

  test('is defensive against a missing/malformed body', () => {
    expect(redactContainerList(null)).toBeNull();
    expect(redactContainerList({ message: 'nope' })).toEqual({ message: 'nope' });
    expect(redactContainerList([])).toEqual([]);
    expect(redactContainerList(['garbage'])).toEqual(['garbage']);
  });
});

describe('redactLabels (F08)', () => {
  test('withholds only the host-path label keys', () => {
    expect(
      redactLabels({
        'sh.hola.app': 'calibre-web',
        'org.opencontainers.image.title': 'Calibre-Web',
        'com.docker.compose.project.working_dir': '/srv/hola/apps/x',
        'desktop.docker.io/binds/0/Source': '/Users/me/secrets',
      }),
    ).toEqual({
      'sh.hola.app': 'calibre-web',
      'org.opencontainers.image.title': 'Calibre-Web',
    });
  });

  test('returns the original map untouched when nothing is denied', () => {
    const labels = { 'sh.hola.app': 'x' };
    expect(redactLabels(labels)).toBe(labels);
  });

  test('a non-map passes through', () => {
    expect(redactLabels(undefined)).toBeUndefined();
    expect(redactLabels(null)).toBeNull();
    expect(redactLabels(['a'])).toEqual(['a']);
  });
});

// A real container-start event. Actor.Attributes is the container's whole label
// map plus image/name — so every host path Compose writes into a label arrives
// here even with list and inspect locked down.
const EVENT_WITH_HOST_PATHS = {
  Type: 'container',
  Action: 'start',
  Actor: {
    ID: 'c0ffee1234567890',
    Attributes: {
      image: 'gitea/gitea:1.22.3',
      name: 'gitea',
      'sh.hola.app': 'gitea',
      'com.docker.compose.project': 'gitea-a1b2c3',
      'com.docker.compose.project.working_dir': '/srv/hola/apps/gitea-a1b2c3',
      'com.docker.compose.project.config_files': '/srv/hola/apps/gitea-a1b2c3/docker-compose.yml',
    },
  },
  scope: 'local',
  time: 1758400000,
  timeNano: 1758400000000000,
  status: 'start',
  id: 'c0ffee1234567890',
  from: 'gitea/gitea:1.22.3',
};

describe('redactEvent (F08)', () => {
  const EVENT = EVENT_WITH_HOST_PATHS;

  test('strips the host paths the label map smuggles through', () => {
    const out = JSON.stringify(redactEvent(EVENT));
    expect(out).not.toContain('/srv/hola/apps/gitea-a1b2c3');
    expect(out).not.toContain('docker-compose.yml');
  });

  test('keeps everything a collector consumes, inventory labels included', () => {
    // Deliberate: "know what exists, and read its logs" IS the envelope, and the
    // sh.hola.* labels are what let a collector group by app with no per-app
    // configuration. Withholding them would break the contract, not close a hole.
    const out = redactEvent(EVENT) as Record<string, unknown>;
    expect(out.Type).toBe('container');
    expect(out.Action).toBe('start');
    expect(out.status).toBe('start');
    expect(out.id).toBe('c0ffee1234567890');
    expect(out.time).toBe(1758400000);
    expect(out.from).toBe('gitea/gitea:1.22.3');
    const attrs = (out.Actor as Record<string, unknown>).Attributes as Record<string, string>;
    expect(attrs.name).toBe('gitea');
    expect(attrs.image).toBe('gitea/gitea:1.22.3');
    expect(attrs['sh.hola.app']).toBe('gitea');
    expect(attrs['com.docker.compose.project']).toBe('gitea-a1b2c3');
  });

  test('passes through an event with no Actor or no Attributes', () => {
    const bare = { Type: 'network', Action: 'connect' };
    expect(redactEvent(bare)).toBe(bare);
    expect(redactEvent({ Actor: { ID: 'x' } })).toEqual({ Actor: { ID: 'x' } });
    expect(redactEvent(null)).toBeNull();
    expect(redactEvent('nope')).toBe('nope');
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
          return Response.json([LIST_ENTRY]);
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
        // A prompt event stream, for asserting the redaction rather than the
        // timeout: two NDJSON payloads and EOF.
        if (req.method === 'GET' && url.pathname === '/events' && url.searchParams.has('fast')) {
          return new Response(
            `${JSON.stringify(EVENT_WITH_HOST_PATHS)}\n{"Type":"network","Action":"connect"}\n`,
          );
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

  // This test used to assert the opposite — that the list body reached the
  // caller byte-identical. That expectation WAS the finding (F08): it pinned the
  // behaviour that handed over command lines, bind sources and network topology
  // through the one endpoint the inspect allowlist does not cover. Inverting it
  // is the measurement.
  test('GET /containers/json is redacted, not passed through', async () => {
    const res = await fetch(proxyUrl('/containers/json'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('hunter2');            // password on the command line
    expect(serialized).not.toContain('/etc/ssl/private');   // sensitive bind source
    expect(serialized).not.toContain('172.18.0.7');         // network topology
    expect(serialized).not.toContain('8929');               // host port binding
    expect(serialized).not.toContain('/srv/hola/apps');     // host path via a Compose label

    // ...and a collector can still find and group what it must read logs from.
    expect(body[0].Id).toBe('c0ffee1234567890');
    expect(body[0].Names).toEqual(['/gitea']);
    expect(body[0].State).toBe('running');
    expect(body[0].Labels['sh.hola.app']).toBe('gitea');
  });

  test('GET /events redacts each NDJSON payload in flight', async () => {
    const res = await fetch(proxyUrl('/events?fast=1'));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('/srv/hola/apps');
    expect(text).not.toContain('docker-compose.yml');

    // Still a stream of newline-delimited events, one per payload, in order.
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].Action).toBe('start');
    expect(lines[0].Actor.Attributes['sh.hola.app']).toBe('gitea');
    expect(lines[0].Actor.Attributes.name).toBe('gitea');
    expect(lines[1]).toEqual({ Type: 'network', Action: 'connect' });
  });

  test('GET /v1.45/containers/{id}/json is redacted (no Env, empty HostConfig and Mounts)', async () => {
    const res = await fetch(proxyUrl('/v1.45/containers/c1/json'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.Config.Tty).toBe(true);
    expect(body.Config.Labels).toEqual({ app: 'x' });
    expect(body.Config.Env).toBeUndefined();
    expect(body.HostConfig).toEqual({ PortBindings: {} });
    expect(body.Mounts).toEqual([]);
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

// ---------------------------------------------------------------------------
// What a real Docker client actually sends (found by running Dozzle, the first
// container-logs@1 provider, against this proxy on a VM).
describe('serving a standard Docker client', () => {
  test('HEAD /_ping is allowed — every Docker client pings with HEAD first', () => {
    // A GET-only allowlist refuses the very first call any client makes, and
    // the client reports it as "no Docker engine" rather than as a refusal.
    expect(decide('HEAD', '/_ping')).toEqual({ allow: true, kind: 'passthrough' });
    expect(decide('HEAD', '/v1.52/_ping')).toEqual({ allow: true, kind: 'passthrough' });
  });

  test('HEAD is allowed wherever GET is — it reveals strictly less', () => {
    expect(decide('HEAD', '/containers/json')).toEqual({ allow: true, kind: 'list' });
    expect(decide('HEAD', '/containers/abc123/json')).toEqual({ allow: true, kind: 'inspect' });
  });

  test('HEAD does not open anything GET cannot reach', () => {
    expect(decide('HEAD', '/containers/abc123/archive')).toEqual({ allow: false });
    expect(decide('HEAD', '/secrets')).toEqual({ allow: false });
  });

  test('every mutating verb is still refused', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(decide(verb, '/containers/abc123/restart')).toEqual({ allow: false });
      expect(decide(verb, '/containers/json')).toEqual({ allow: false });
    }
  });

  test('GET /info is allowed, versioned or not', () => {
    expect(decide('GET', '/info')).toEqual({ allow: true, kind: 'info' });
    expect(decide('GET', '/v1.52/info')).toEqual({ allow: true, kind: 'info' });
  });
});

describe('redactInfo', () => {
  const raw = {
    ID: 'ABCD:EFGH',
    Name: 'hola-vm-102',
    ServerVersion: '27.3.1',
    OSType: 'linux',
    Architecture: 'x86_64',
    NCPU: 4,
    MemTotal: 6221225472,
    Containers: 9,
    ContainersRunning: 8,
    ContainersPaused: 0,
    ContainersStopped: 1,
    Images: 12,
    // Everything below must not survive.
    HttpProxy: 'http://user:hunter2@proxy.internal:3128',
    HttpsProxy: 'https://user:hunter2@proxy.internal:3128',
    RegistryConfig: { IndexConfigs: { 'docker.io': {} } },
    Labels: ['tier=prod'],
    Plugins: { Volume: ['local'] },
    DockerRootDir: '/var/lib/docker',
    SecurityOptions: ['name=apparmor'],
    Swarm: { NodeID: 'xyz', LocalNodeState: 'active' },
    KernelVersion: '6.8.0-45-generic',
    OperatingSystem: 'Ubuntu 24.04.1 LTS',
  };

  test('keeps what identifies and sizes the engine', () => {
    const out = redactInfo(raw) as Record<string, unknown>;
    expect(out.Name).toBe('hola-vm-102');
    expect(out.ServerVersion).toBe('27.3.1');
    expect(out.OSType).toBe('linux');
    expect(out.NCPU).toBe(4);
    expect(out.ContainersRunning).toBe(8);
    // Kept so a client can tell Docker from Podman — Dozzle reads it for exactly
    // that, and it says no more than OSType already does.
    expect(out.OperatingSystem).toBe('Ubuntu 24.04.1 LTS');
  });

  test('drops the proxy URLs, which routinely carry credentials', () => {
    const out = JSON.stringify(redactInfo(raw));
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('HttpProxy');
  });

  test('drops host configuration the grant has no business exposing', () => {
    const out = redactInfo(raw) as Record<string, unknown>;
    for (const k of ['RegistryConfig', 'Labels', 'Plugins', 'DockerRootDir', 'SecurityOptions', 'Swarm', 'KernelVersion']) {
      expect(out[k]).toBeUndefined();
    }
  });

  test('a non-object body passes through untouched', () => {
    expect(redactInfo(null)).toBeNull();
    expect(redactInfo('nope')).toBe('nope');
  });
});

describe('redactInspect keeps the response shape a real client expects', () => {
  const raw = {
    Id: 'abc123',
    Name: '/hola-app-1',
    Created: '2026-09-20T00:00:00Z',
    State: { Status: 'running' },
    Image: 'sha256:deadbeef',
    Config: { Tty: false, Labels: { 'sh.hola.app': 'calibre-web' }, Image: 'app:1', Hostname: 'h', Env: ['SECRET=hunter2'] },
    HostConfig: { PortBindings: { '8080/tcp': [{ HostPort: '8080' }] }, Binds: ['/etc/passwd:/x'], Privileged: true },
    Mounts: [{ Source: '/srv/hola/apps/x', Destination: '/data' }],
    NetworkSettings: { Networks: { hola: { IPAddress: '172.18.0.5' } } },
  };

  test('structural fields are present but empty — clients walk them without nil checks', () => {
    // Dozzle segfaults on HostConfig.PortBindings when HostConfig is absent;
    // anything on Docker's SDK assumes the same shape. Dropping the field denies
    // the client, not the data.
    const out = redactInspect(raw) as Record<string, unknown>;
    expect(out.HostConfig).toEqual({ PortBindings: {} });
    expect(out.Mounts).toEqual([]);
    expect(out.NetworkSettings).toEqual({ Networks: {} });
  });

  test('and they disclose nothing', () => {
    const out = JSON.stringify(redactInspect(raw));
    expect(out).not.toContain('8080');           // no host port map
    expect(out).not.toContain('/etc/passwd');    // no bind sources
    expect(out).not.toContain('172.18.0.5');     // no network topology
    expect(out).not.toContain('Privileged');
    expect(out).not.toContain('hunter2');        // env still gone
  });

  test('what a log collector needs still comes through', () => {
    const out = redactInspect(raw) as Record<string, unknown>;
    expect(out.Id).toBe('abc123');
    expect(out.State).toEqual({ Status: 'running' });
    const cfg = out.Config as Record<string, unknown>;
    expect((cfg.Labels as Record<string, string>)['sh.hola.app']).toBe('calibre-web');
    expect(cfg.Tty).toBe(false);
  });
});
