/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';
import { injectTailscaleIngress, TailscaleBackendError } from '../../services/core/compose-tailscale';
import { validateComposeDocument } from '@hola/shared/compose-validate';

const IMAGE = 'tailscale/tailscale:v1.104.7@sha256:' + 'a'.repeat(64);
const labels = { 'sh.hola.app': 'omnigraph', 'sh.hola.deployment': 'dep1', 'sh.hola.name': 'Omni' };
const opts = (over: Record<string, unknown> = {}) => ({
  image: IMAGE,
  backendService: 'web',
  nodeName: 'hola-omnigraph',
  labels,
  ...over,
});

const BASE = `
services:
  web:
    image: nginx:1.27
    networks:
      hola:
        aliases: [omnigraph]
  db:
    image: postgres:16
networks:
  hola:
    external: true
`;

const inject = (yaml = BASE, o = opts()) => parse(injectTailscaleIngress(yaml, o)) as any;

describe('injectTailscaleIngress: the companion (contracts/compose.md)', () => {
  const doc = inject();
  const ts = doc.services['hola-tailscale'];

  test('exact shape', () => {
    expect(ts).toEqual({
      image: IMAGE,
      entrypoint: ['tailscaled'],
      command: ['--tun=userspace-networking', '--statedir=/var/lib/tailscale', '--socket=/tmp/tailscaled.sock'],
      hostname: 'hola-omnigraph',
      restart: 'unless-stopped',
      read_only: true,
      tmpfs: ['/tmp'],
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
      volumes: ['hola-ts-state:/var/lib/tailscale'],
      networks: ['hola-ts-backend', 'hola-ts-egress'],
      healthcheck: { disable: true },
      stop_grace_period: '15s',
      labels: { ...labels, 'sh.hola.role': 'tailscale-ingress' },
    });
  });

  test('image is digest-pinned', () => expect(ts.image).toMatch(/@sha256:[0-9a-f]{64}$/));

  test.each(['ports', 'privileged', 'cap_add', 'devices', 'network_mode', 'pid', 'ipc', 'userns_mode', 'environment', 'env_file', 'extends', 'volumes_from'])(
    'has no %s',
    (key) => expect(ts[key]).toBeUndefined(),
  );

  test('is not a member of hola or default', () => {
    expect(ts.networks).not.toContain('hola');
    expect(ts.networks).not.toContain('default');
    expect(ts.networks).toEqual(['hola-ts-backend', 'hola-ts-egress']);
  });

  test('has no bind mount (no Docker socket, no data root, no staging or apps-data mount)', () => {
    for (const v of ts.volumes as string[]) {
      expect(v.startsWith('/')).toBe(false);
      expect(v.startsWith('.')).toBe(false);
      expect(v).not.toContain('docker.sock');
    }
    expect(ts.volumes).toHaveLength(1);
  });

  test('carries logging only when one is supplied', () => {
    expect(ts.logging).toBeUndefined();
    const l = { driver: 'json-file', options: { 'max-size': '10m' } };
    expect(inject(BASE, opts({ logging: l })).services['hola-tailscale'].logging).toEqual(l);
  });

  test('networks and volume are declared with the right options', () => {
    expect(doc.networks['hola-ts-backend']).toEqual({ internal: true });
    expect(doc.networks['hola-ts-egress']).toEqual({});
    expect(doc.networks['hola-ts-egress'].internal).toBeUndefined();
    expect(doc.networks.hola).toEqual({ external: true });
    expect(doc.volumes['hola-ts-state']).toEqual({});
  });
});

describe('injectTailscaleIngress: the backend', () => {
  test('map-form networks keep their entries and gain the backend network + alias', () => {
    const w = inject().services.web;
    expect(w.networks.hola).toEqual({ aliases: ['omnigraph'] });
    expect(w.networks['hola-ts-backend']).toEqual({ aliases: ['hola-ts-backend'] });
    expect(w.networks.default).toBeUndefined();
  });

  test('a backend with no networks is kept on default', () => {
    const w = inject(BASE.replace(/ {4}networks:\n {6}hola:\n {8}aliases: \[omnigraph\]\n/, ''), opts()).services.web;
    expect(w.networks).toEqual({ default: {}, 'hola-ts-backend': { aliases: ['hola-ts-backend'] } });
  });

  test('list-form networks are converted to map form without losing members', () => {
    const y = BASE.replace(/ {4}networks:\n {6}hola:\n {8}aliases: \[omnigraph\]\n/, '    networks: [hola, internal]\n').replace('networks:\n  hola:', 'networks:\n  internal: {}\n  hola:');
    const w = inject(y).services.web;
    expect(Object.keys(w.networks).sort()).toEqual(['hola', 'hola-ts-backend', 'internal']);
    expect(w.networks.hola).toEqual({});
  });

  test('another service as backend leaves the first untouched', () => {
    const d = inject(BASE, opts({ backendService: 'db' }));
    expect(d.services.db.networks['hola-ts-backend']).toBeDefined();
    expect(d.services.web.networks['hola-ts-backend']).toBeUndefined();
  });

  test('every other service is unchanged', () => {
    const before = parse(BASE) as any;
    const after = inject();
    expect(after.services.db).toEqual(before.services.db);
    const { networks: _n, ...webBefore } = before.services.web;
    const { networks: _m, ...webAfter } = after.services.web;
    expect(webAfter).toEqual(webBefore);
  });

  test('is idempotent', () => {
    const once = injectTailscaleIngress(BASE, opts());
    const twice = injectTailscaleIngress(once, opts());
    expect(parse(twice)).toEqual(parse(once));
  });
});

describe('injectTailscaleIngress: errors', () => {
  test('missing backend', () => {
    try {
      injectTailscaleIngress(BASE, opts({ backendService: 'nope' }));
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TailscaleBackendError);
      expect((e as TailscaleBackendError).reason).toBe('missing');
    }
  });

  test('backend with network_mode', () => {
    const y = BASE.replace('    image: postgres:16', '    image: postgres:16\n    network_mode: "service:web"');
    try {
      injectTailscaleIngress(y, opts({ backendService: 'db' }));
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(TailscaleBackendError);
      expect((e as TailscaleBackendError).reason).toBe('network-mode');
    }
  });

  test('no services at all is "missing", not a crash', () => {
    expect(() => injectTailscaleIngress('services: {}\n', opts())).toThrow(TailscaleBackendError);
  });
});

describe('what an app bundle may not declare (T020)', () => {
  const codes = (y: string) => validateComposeDocument(y).filter((i) => i.severity === 'error').map((i) => i.code);
  test('the injected result is NOT something an app may author itself', () => {
    // The injection output re-validated as an app bundle is refused: reserved service and networks.
    const c = codes(injectTailscaleIngress(BASE, opts()));
    expect(c).toContain('RESERVED_SERVICE_NAME');
    expect(c).toContain('RESERVED_NETWORK_NAME');
  });
});
