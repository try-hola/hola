/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Opt-in private Tailscale ingress (spec 010): the pure validator and the pure
 * guidance builder. Exercised from the server suite, same arrangement as the
 * channel helpers — @hola/shared has no test runner of its own.
 */
import { describe, test, expect } from 'bun:test';

import {
  validateTailscaleIngressInput,
  buildTailscaleGuidance,
  nodeNameFor,
  hasTraefikRoute,
  tailnetUrlFor,
  tailscaleExposureOf,
  type TailscaleIngressValidationContext,
  type TailscaleIngressFailure,
  type ValidatedTailscaleIngress,
} from '@hola/shared';

const CRED = 'tskey-auth-kSECRETMARKER123-abcdefABCDEF456';

const ctx = (over: Partial<TailscaleIngressValidationContext> = {}): TailscaleIngressValidationContext => ({
  services: [
    { name: 'app', hasNetworkMode: false },
    { name: 'db', hasNetworkMode: false },
    { name: 'sidecar', hasNetworkMode: true },
  ],
  defaultBackend: { service: 'app', port: 8080 },
  requiresForwardAuthAcknowledgement: false,
  identityEnrolled: false,
  credentialHeld: false,
  ...over,
});

const base = { serviceName: 'svc:omnigraph', tag: 'tag:hola-ingress', authKey: CRED };
const run = (input: unknown, c = ctx()) => validateTailscaleIngressInput(input, c);
const fails = (r: ReturnType<typeof run>): TailscaleIngressFailure => {
  expect(r.ok).toBe(false);
  return r as TailscaleIngressFailure;
};

describe('validateTailscaleIngressInput: valid input', () => {
  test('applies defaults: backend from ctx, https, 443, node name derived', () => {
    const r = run(base) as ValidatedTailscaleIngress;
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({
      serviceName: 'svc:omnigraph',
      tag: 'tag:hola-ingress',
      backend: { service: 'app', port: 8080 },
      mode: 'https',
      listenPort: 443,
      forwardAuthAcknowledged: false,
      nodeName: 'hola-omnigraph',
      exposure: 'both',
      authKey: CRED,
    });
  });

  test('accepts an alternative backend, tcp mode and a custom listen port', () => {
    const r = run({ ...base, backend: { service: 'db', port: 5432 }, mode: 'tcp', listenPort: 5432 }) as ValidatedTailscaleIngress;
    expect(r.ok).toBe(true);
    expect(r.value.backend).toEqual({ service: 'db', port: 5432 });
    expect(r.value.mode).toBe('tcp');
    expect(r.value.listenPort).toBe(5432);
  });

  test.each(['svc:a', 'svc:omni-graph', 'svc:a1', 'svc:' + 'a'.repeat(63)])('accepts service name %s', (n) => {
    expect(run({ ...base, serviceName: n }).ok).toBe(true);
  });

  test.each(['tag:a', 'tag:hola-ingress', 'tag:Grok-Bot2'])('accepts tag %s', (t) => {
    expect(run({ ...base, tag: t }).ok).toBe(true);
  });

  test.each([
    'tskey-auth-kABC123-def456',
    'tskey-client-kABC123-def456',
  ])('accepts credential form %s', (k) => {
    expect(run({ ...base, authKey: k }).ok).toBe(true);
  });

  test('trims surrounding whitespace on the credential', () => {
    const r = run({ ...base, authKey: `  ${CRED}\n` }) as ValidatedTailscaleIngress;
    expect(r.value.authKey).toBe(CRED);
  });

  test('credential may be omitted once an identity is enrolled or a credential is held', () => {
    const { authKey: _drop, ...noKey } = base;
    expect(run(noKey, ctx({ identityEnrolled: true })).ok).toBe(true);
    expect(run(noKey, ctx({ credentialHeld: true })).ok).toBe(true);
  });
});

describe('validateTailscaleIngressInput: invalid input', () => {
  test.each([
    'omnigraph', 'svc:', 'svc:Omni', 'svc:-a', 'svc:a-', 'svc:a_b', 'svc:a.b', 'svc:a b', 'svc:' + 'a'.repeat(64), '',
  ])('refuses service name %p', (n) => {
    const f = fails(run({ ...base, serviceName: n }));
    expect(f.code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(f.field).toBe('serviceName');
  });

  test('refuses a non-string service name', () => {
    expect(fails(run({ ...base, serviceName: 5 })).field).toBe('serviceName');
  });

  test.each(['hola', 'tag:', 'tag:1a', 'tag:a_b', 'tag:a b', 'tag:a;rm'])('refuses tag %p', (t) => {
    const f = fails(run({ ...base, tag: t }));
    expect(f.code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(f.field).toBe('tag');
  });

  test.each(['http', 'udp', 'HTTPS', 3])('refuses mode %p', (m) => {
    expect(fails(run({ ...base, mode: m })).field).toBe('mode');
  });

  test.each([0, -1, 65536, 1.5, '443', null])('refuses listenPort %p', (p) => {
    expect(fails(run({ ...base, listenPort: p })).field).toBe('listenPort');
  });

  test.each([0, 65536, 8080.5, '80'])('refuses backend.port %p', (p) => {
    expect(fails(run({ ...base, backend: { port: p } })).field).toBe('backend.port');
  });

  test('refuses a non-object body and a non-object backend', () => {
    expect(fails(run('x')).code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(fails(run(null)).code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(fails(run({ ...base, backend: 'app' })).field).toBe('backend');
  });

  test('no default port and none supplied -> INVALID_TAILSCALE_INGRESS on backend.port', () => {
    const f = fails(run(base, ctx({ defaultBackend: { service: 'app', port: null } })));
    expect(f.code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(f.field).toBe('backend.port');
    expect(run({ ...base, backend: { port: 80 } }, ctx({ defaultBackend: { service: 'app', port: null } })).ok).toBe(true);
  });

  test('unknown backend lists the declared services', () => {
    const f = fails(run({ ...base, backend: { service: 'nope' } }));
    expect(f.code).toBe('TAILSCALE_BACKEND_UNKNOWN');
    expect(f.details?.services).toEqual(['app', 'db', 'sidecar']);
  });

  test('a backend with network_mode is unsupported', () => {
    const f = fails(run({ ...base, backend: { service: 'sidecar', port: 80 } }));
    expect(f.code).toBe('TAILSCALE_BACKEND_UNSUPPORTED');
    expect(f.details?.reason).toBe('network-mode');
  });

  test.each(['hola-tailscale', 'hola-docker-proxy'])('reserved backend %s is unsupported', (name) => {
    const c = ctx({ services: [...ctx().services, { name, hasNetworkMode: false }] });
    const f = fails(run({ ...base, backend: { service: name, port: 80 } }, c));
    expect(f.code).toBe('TAILSCALE_BACKEND_UNSUPPORTED');
    expect(f.details?.reason).toBe('platform-service');
  });

  test('hostile backend strings are refused as unknown (never reach an upstream host)', () => {
    for (const s of ['app:80/../x', 'app;id', '$(id)', 'evil.example.com', 'app\nhost', '../app', '']) {
      const f = fails(run({ ...base, backend: { service: s, port: 80 } }));
      expect(['TAILSCALE_BACKEND_UNKNOWN']).toContain(f.code);
    }
  });

  test('forward-auth app needs the acknowledgement', () => {
    const c = ctx({ requiresForwardAuthAcknowledgement: true });
    expect(fails(run(base, c)).code).toBe('TAILSCALE_FORWARD_AUTH_ACK_REQUIRED');
    expect(fails(run({ ...base, acknowledgeForwardAuthBypass: false }, c)).code).toBe('TAILSCALE_FORWARD_AUTH_ACK_REQUIRED');
    const ok = run({ ...base, acknowledgeForwardAuthBypass: true }, c) as ValidatedTailscaleIngress;
    expect(ok.ok).toBe(true);
    expect(ok.value.forwardAuthAcknowledged).toBe(true);
  });

  test('first enable without a credential is refused', () => {
    const { authKey: _drop, ...noKey } = base;
    expect(fails(run(noKey)).code).toBe('TAILSCALE_CREDENTIAL_REQUIRED');
    expect(fails(run({ ...noKey, authKey: '' })).code).toBe('TAILSCALE_CREDENTIAL_REQUIRED');
  });

  test.each(['password', 'tskey-api-abc', 'tskey-auth-', 'tskey-auth-a b', 'tskey-auth-a;b', 42])(
    'refuses credential form %p',
    (k) => {
      const f = fails(run({ ...base, authKey: k }));
      expect(f.code).toBe('INVALID_TAILSCALE_INGRESS');
      expect(f.field).toBe('authKey');
    },
  );

  test('no failure message or detail contains a supplied credential', () => {
    const secret = 'SUPERSECRETVALUE9999';
    const bodies: unknown[] = [
      { ...base, authKey: secret },
      { ...base, authKey: `tskey-auth-${secret}`, serviceName: 'bad' },
      { ...base, authKey: `tskey-auth-${secret}`, tag: 'bad' },
      { ...base, authKey: `tskey-auth-${secret}`, mode: 'bad' },
      { ...base, authKey: `tskey-auth-${secret}`, backend: { service: 'nope' } },
      { ...base, authKey: `tskey-auth-${secret}`, backend: { service: 'sidecar', port: 1 } },
      { ...base, authKey: `tskey-auth-${secret}`, listenPort: 0 },
    ];
    for (const b of bodies) {
      const f = fails(run(b));
      expect(JSON.stringify(f)).not.toContain(secret);
    }
    const c = ctx({ requiresForwardAuthAcknowledgement: true });
    expect(JSON.stringify(fails(run({ ...base, authKey: `tskey-auth-${secret}` }, c)))).not.toContain(secret);
  });
});

describe('nodeNameFor', () => {
  test('prefixes with hola-', () => {
    expect(nodeNameFor('svc:omnigraph')).toBe('hola-omnigraph');
  });
  test('truncates to 63 characters and never ends in a hyphen', () => {
    const n = nodeNameFor('svc:' + 'a'.repeat(63));
    expect(n.length).toBeLessThanOrEqual(63);
    expect(n.startsWith('hola-a')).toBe(true);
    expect(n.endsWith('-')).toBe(false);
    const m = nodeNameFor('svc:' + 'a'.repeat(57) + '-b' + 'c'.repeat(3));
    expect(m.endsWith('-')).toBe(false);
  });
});

describe('buildTailscaleGuidance', () => {
  const g = buildTailscaleGuidance({ serviceName: 'svc:omnigraph', tag: 'tag:grokbot', listenPort: 443 });

  test('has four steps and prerequisites naming the narrowest scope', () => {
    expect(g.steps).toHaveLength(4);
    const pre = g.prerequisites.join(' ');
    expect(pre).toContain('tag:grokbot');
    expect(pre).toContain('auth_keys');
  });

  test('both examples parse as JSON and name the service', () => {
    const grant = JSON.parse(g.exampleGrant);
    expect(grant.grants[0]).toEqual({ src: ['tag:example-client'], dst: ['svc:omnigraph'], ip: ['tcp:443'] });
    const auto = JSON.parse(g.exampleAutoApprover);
    expect(auto.autoApprovers.services['svc:omnigraph']).toEqual(['tag:grokbot']);
    for (const s of g.steps) if (s.snippet) expect(() => JSON.parse(s.snippet!)).not.toThrow();
  });

  test('the grant follows the listen port', () => {
    const g8 = buildTailscaleGuidance({ serviceName: 'svc:x', tag: 'tag:t', listenPort: 8443 });
    expect(JSON.parse(g8.exampleGrant).grants[0].ip).toEqual(['tcp:8443']);
  });

  test('carries the five required notes', () => {
    expect(g.notes).toHaveLength(5);
    const all = g.notes.join('\n').toLowerCase();
    expect(all).toContain('additive');
    expect(all).toContain('not a grant to the app');
    expect(all).toContain('share one tailnet identity');
    expect(all).toContain('not authentication');
    expect(all).toContain('host header');
  });
});

describe('exposure (#596)', () => {
  const only = { ...base, exposure: 'tailscale-only', acknowledgeTailscaleOnly: true };

  test('hasTraefikRoute is false ONLY for an enabled tailscale-only setting', () => {
    expect(hasTraefikRoute(undefined)).toBe(true);
    expect(hasTraefikRoute(null)).toBe(true);
    expect(hasTraefikRoute({ enabled: true })).toBe(true); // absent exposure on a stored record
    expect(hasTraefikRoute({ enabled: true, exposure: 'both' })).toBe(true);
    expect(hasTraefikRoute({ enabled: true, exposure: 'tailscale-only' })).toBe(false);
    // disabled / removal-pending (enabled:false) restores the route
    expect(hasTraefikRoute({ enabled: false, exposure: 'tailscale-only' })).toBe(true);
  });

  test('absent reads as both', () => {
    expect(tailscaleExposureOf({})).toBe('both');
    expect(tailscaleExposureOf(undefined)).toBe('both');
    expect(tailscaleExposureOf({ exposure: 'tailscale-only' })).toBe('tailscale-only');
  });

  test('tailnetUrlFor: https only, port shown when not 443, none without an observed name', () => {
    expect(tailnetUrlFor({ mode: 'https', listenPort: 443, lastDnsName: 'a.b.ts.net' })).toBe('https://a.b.ts.net');
    expect(tailnetUrlFor({ mode: 'https', listenPort: 8443, lastDnsName: 'a.b.ts.net.' })).toBe('https://a.b.ts.net:8443');
    expect(tailnetUrlFor({ mode: 'tcp', listenPort: 5432, lastDnsName: 'a.b.ts.net' })).toBeUndefined();
    expect(tailnetUrlFor({ mode: 'https', listenPort: 443 })).toBeUndefined();
  });

  test('defaults to both; accepts tailscale-only with the acknowledgement', () => {
    expect((run(base) as ValidatedTailscaleIngress).value.exposure).toBe('both');
    expect((run(only) as ValidatedTailscaleIngress).value.exposure).toBe('tailscale-only');
  });

  test('an unknown exposure is INVALID_TAILSCALE_INGRESS on the field', () => {
    const f = fails(run({ ...base, exposure: 'public' }));
    expect(f.code).toBe('INVALID_TAILSCALE_INGRESS');
    expect(f.field).toBe('exposure');
  });

  test('tailscale-only without the acknowledgement -> TAILSCALE_ONLY_ACK_REQUIRED', () => {
    expect(fails(run({ ...only, acknowledgeTailscaleOnly: undefined })).code).toBe('TAILSCALE_ONLY_ACK_REQUIRED');
    expect(fails(run({ ...only, acknowledgeTailscaleOnly: 'yes' })).code).toBe('TAILSCALE_ONLY_ACK_REQUIRED');
  });

  test('an SSO auth mode refuses tailscale-only with details.authMode; "both" is unaffected', () => {
    const f = fails(run(only, ctx({ tailscaleOnlyBlockedByAuth: 'native-oidc' })));
    expect(f.code).toBe('TAILSCALE_ONLY_UNSUPPORTED_AUTH');
    expect(f.details).toEqual({ authMode: 'native-oidc' });
    expect(run(base, ctx({ tailscaleOnlyBlockedByAuth: 'native-oidc' })).ok).toBe(true);
  });
});
