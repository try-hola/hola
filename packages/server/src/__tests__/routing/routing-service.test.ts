/**
 * RoutingService Tests (issue #16)
 *
 * Covers deterministic rule generation, host-conflict validation against the
 * active routing map, atomic activate/deactivate, restart-style reconcile, and
 * deterministic Traefik dynamic-config emission.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { parse as parseYAML } from 'yaml';

import { RealRoutingService } from '../../services/core/routing';
import { MockStorageService } from '../../services/core/storage';

describe('RoutingService', () => {
  let storage: MockStorageService;
  let routing: RealRoutingService;

  beforeEach(() => {
    storage = new MockStorageService();
    routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
  });

  test('generates a deterministic host-based rule', () => {
    const rule = routing.generateRule({ deploymentId: 'deploy-abc123def456', appName: 'gitea', port: 3000 });
    expect(rule.host).toBe('gitea.local.hola');
    expect(rule.serviceName).toBe('gitea-deploy-abc12');
    expect(rule.networkName).toBe('hola-deploy-abc12');
    expect(rule.port).toBe(3000);
  });

  test('base domain comes from option (default local.hola)', () => {
    expect(routing.baseDomain()).toBe('local.hola');
    expect(new RealRoutingService(storage).baseDomain()).toBe('local.hola');
  });

  test('detects a host conflict only against a different deployment', async () => {
    const a = routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea' });
    await routing.activateRoute(a);

    // Same host, different deployment -> conflict (identifies the owner).
    const b = routing.generateRule({ deploymentId: 'dep-b', appName: 'gitea' });
    const conflicts = await routing.validateRule(b);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictingDeploymentId).toBe('dep-a');
    expect(conflicts[0].conflictingHost).toBe('gitea.local.hola');

    // Same deployment re-validating its own host -> no conflict.
    expect(await routing.validateRule(a)).toHaveLength(0);

    // Different app -> different host -> no conflict.
    const c = routing.generateRule({ deploymentId: 'dep-c', appName: 'grafana' });
    expect(await routing.validateRule(c)).toHaveLength(0);
  });

  test('activate emits routing map and deterministic Traefik dynamic config', async () => {
    const rule = routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea', port: 3000 });
    await routing.activateRoute(rule);

    expect(await storage.fileExists('runtime/traefik/routing-map.json')).toBe(true);
    expect(await storage.fileExists('runtime/traefik/dynamic.yml')).toBe(true);

    const map = await routing.getRoutingMap();
    expect(map['gitea.local.hola']?.deploymentId).toBe('dep-a');

    const dynamic = parseYAML(await storage.readFileAsString('runtime/traefik/dynamic.yml'));
    expect(dynamic.http.routers['gitea-dep-a'].rule).toBe('Host(`gitea.local.hola`)');
    expect(dynamic.http.services['gitea-dep-a'].loadBalancer.servers[0].url).toBe('http://gitea-dep-a:3000');

    // Deterministic: re-emitting identical state yields identical output.
    const first = await storage.readFileAsString('runtime/traefik/dynamic.yml');
    await routing.activateRoute(rule);
    expect(await storage.readFileAsString('runtime/traefik/dynamic.yml')).toBe(first);
  });

  test('forward-auth rule emits the outpost middleware + path-prefix router', async () => {
    const base = routing.generateRule({ deploymentId: 'dep-a', appName: 'grafana', port: 3000 });
    const rule = { ...base, forwardAuth: { name: 'ak-grafana-dep-a', outpostUrl: 'http://authentik-server:9000' } };
    await routing.activateRoute(rule);

    const dynamic = parseYAML(await storage.readFileAsString('runtime/traefik/dynamic.yml'));

    // The app router is gated by the middleware.
    expect(dynamic.http.routers['grafana-dep-a'].middlewares).toEqual(['ak-grafana-dep-a']);
    // The middleware points at the outpost's forward-auth endpoint with identity headers.
    const mw = dynamic.http.middlewares['ak-grafana-dep-a'].forwardAuth;
    expect(mw.address).toBe('http://authentik-server:9000/outpost.goauthentik.io/auth/traefik');
    expect(mw.trustForwardHeader).toBe(true);
    expect(mw.authResponseHeaders).toContain('X-authentik-username');
    // A higher-priority router routes the outpost's own endpoints to Authentik.
    const outpost = dynamic.http.routers['grafana-dep-a-ak-outpost'];
    expect(outpost.rule).toBe('Host(`grafana.local.hola`) && PathPrefix(`/outpost.goauthentik.io/`)');
    expect(outpost.priority).toBeGreaterThan(1);
    expect(dynamic.http.services['grafana-dep-a-ak-outpost'].loadBalancer.servers[0].url).toBe('http://authentik-server:9000');

    // forwardAuth survives a restart rebuild (persisted on the rule).
    const fresh = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    await fresh.reconcile([rule]);
    const map = await fresh.getRoutingMap();
    expect(map['grafana.local.hola']?.forwardAuth?.name).toBe('ak-grafana-dep-a');
  });

  test('re-activating the same deployment replaces its prior host', async () => {
    await routing.activateRoute(routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea' }));
    await routing.activateRoute(routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea-renamed' }));

    const map = await routing.getRoutingMap();
    expect(map['gitea.local.hola']).toBeUndefined();
    expect(map['gitea-renamed.local.hola']?.deploymentId).toBe('dep-a');
  });

  test('deactivate removes a deployment route', async () => {
    await routing.activateRoute(routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea' }));
    await routing.deactivateRoute('dep-a');
    expect(Object.keys(await routing.getRoutingMap())).toHaveLength(0);
  });

  test('reconcile replaces the entire routing map (restart rebuild)', async () => {
    await routing.activateRoute(routing.generateRule({ deploymentId: 'dep-a', appName: 'gitea' }));

    const fresh = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    await fresh.reconcile([
      fresh.generateRule({ deploymentId: 'dep-b', appName: 'grafana' }),
      fresh.generateRule({ deploymentId: 'dep-c', appName: 'vaultwarden' }),
    ]);

    const map = await fresh.getRoutingMap();
    expect(Object.keys(map).sort()).toEqual(['grafana.local.hola', 'vaultwarden.local.hola']);
    expect(map['gitea.local.hola']).toBeUndefined();
  });
});
