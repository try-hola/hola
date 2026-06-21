/**
 * Routing Service - Traefik host routing (issue #16)
 *
 * Owns the canonical routing-rule schema and is the single authority for:
 * - generating a deterministic Traefik routing rule for a deployment,
 * - validating host conflicts against the active routing map,
 * - emitting deterministic Traefik dynamic (file-provider) configuration,
 * - emitting the platform's own "core" routes (the Hola UI, the Traefik
 *   dashboard, and — when SSO is on — the Authentik login UI) into the same
 *   file provider, so Traefik needs no Docker provider and no Docker socket,
 * - atomically activating/removing routes on promote/rollback/delete, and
 * - reconciling routing from persisted deployments on restart.
 *
 * Ingress is host-based and Traefik-only: apps are reached at
 * `<appName>.<baseDomain>` with no per-app host ports.
 */

import { stringify as stringifyYAML } from 'yaml';
import type { TraefikRoutingRule, TraefikRoutingMap, RoutingConflict } from '@hola/shared';

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from './types';
import type { StorageService } from './storage';

const ROUTING_MAP_PATH = 'runtime/traefik/routing-map.json';
const DYNAMIC_CONFIG_PATH = 'runtime/traefik/dynamic.yml';
// Platform routes (UI / dashboard / Authentik) live in their OWN file so the
// per-app `persist()` (which rewrites dynamic.yml) never clobbers them. Traefik's
// file provider merges every file in the watched directory.
const CORE_CONFIG_PATH = 'runtime/traefik/core.yml';
const DEFAULT_BASE_DOMAIN = 'local.hola';

export interface GenerateRuleInput {
  deploymentId: string;
  appName: string;
  /** Internal container/service port Traefik forwards to (defaults to 80). */
  port?: number;
}

/**
 * A platform-owned ("core") Traefik route. These are the Hola server's own
 * services — not deployed apps — that used to be discovered via Docker labels.
 * Emitting them through the file provider lets the stack drop the Docker
 * provider and the mounted Docker socket from Traefik entirely.
 */
export interface CoreRoute {
  /** Stable router/service key, e.g. `hola-web`. */
  name: string;
  /** Host the router matches, e.g. `app.example.com`. */
  host: string;
  /** Upstream URL (e.g. `http://hola-web:80`). Omit when `service` is set. */
  url?: string;
  /** Reference a built-in Traefik service instead of a load balancer
   *  (e.g. `api@internal` for the dashboard). Mutually exclusive with `url`. */
  service?: string;
}

/**
 * Build the platform's core routes from the process environment. Hosts that are
 * unset are skipped (e.g. dev without a real domain); the Authentik route is
 * only emitted when SSO is enabled.
 */
export function coreRoutesFromEnv(env: NodeJS.ProcessEnv = process.env): CoreRoute[] {
  const routes: CoreRoute[] = [];
  const uiHost = env.HOLA_DOMAIN?.trim();
  if (uiHost) routes.push({ name: 'hola-web', host: uiHost, url: 'http://hola-web:80' });
  const dashboardHost = env.TRAEFIK_DASHBOARD_DOMAIN?.trim();
  // The dashboard is Traefik's built-in api@internal service (enabled by --api).
  if (dashboardHost) routes.push({ name: 'traefik-dashboard', host: dashboardHost, service: 'api@internal' });
  if ((env.HOLA_AUTH_MODE?.trim() || 'none') === 'authentik') {
    const authHost = env.HOLA_AUTHENTIK_DOMAIN?.trim();
    if (authHost) routes.push({ name: 'authentik', host: authHost, url: 'http://authentik-server:9000' });
  }
  return routes;
}

export interface RoutingService extends HealthCheckable {
  /** Base domain that apps are exposed under (e.g. `local.hola`). */
  baseDomain(): string;
  /** Build a deterministic routing rule for a deployment. */
  generateRule(input: GenerateRuleInput): TraefikRoutingRule;
  /** Conflicts if the rule's host is already owned by a different deployment. */
  validateRule(rule: TraefikRoutingRule): Promise<RoutingConflict[]>;
  /** Add/replace a deployment's route and re-emit dynamic config (atomic). */
  activateRoute(rule: TraefikRoutingRule): Promise<void>;
  /** Remove a deployment's route(s) and re-emit dynamic config (atomic). */
  deactivateRoute(deploymentId: string): Promise<void>;
  /** Replace the entire routing map (used to rebuild from persisted state). */
  reconcile(rules: TraefikRoutingRule[]): Promise<void>;
  getRoutingMap(): Promise<TraefikRoutingMap>;
  /** (Re)write the platform's core routes (UI/dashboard/Authentik) into the
   *  file provider. Idempotent; called once at startup. */
  emitCoreRoutes(routes: CoreRoute[]): Promise<void>;
}

/** Build a deterministic routing rule (pure; shared by real and mock services). */
function buildRule(input: GenerateRuleInput, domain: string): TraefikRoutingRule {
  const host = `${input.appName}.${domain}`;
  // The deployment id is already a compact, unique `<slug>-<hash>` (it embeds the
  // app slug), so use it whole — truncating it would collide between two installs
  // of the same app.
  return {
    deploymentId: input.deploymentId,
    appName: input.appName,
    host,
    domain,
    serviceName: input.deploymentId,
    networkName: `hola-${input.deploymentId}`,
    port: input.port,
    createdAt: new Date().toISOString(),
  };
}

/** Conflicts for a rule whose host is already owned by a different deployment. */
function conflictsFor(rule: TraefikRoutingRule, map: TraefikRoutingMap): RoutingConflict[] {
  const existing = map[rule.host];
  if (existing && existing.deploymentId !== rule.deploymentId) {
    return [{
      conflictingDeploymentId: existing.deploymentId,
      conflictingAppName: existing.appName,
      conflictingHost: existing.host,
      message: `Host '${rule.host}' is already in use by deployment ${existing.deploymentId}`,
    }];
  }
  return [];
}

/** Map keyed by host, in deterministic (sorted) host order. */
function sortedMap(rules: TraefikRoutingRule[]): TraefikRoutingMap {
  const map: TraefikRoutingMap = {};
  for (const rule of [...rules].sort((a, b) => a.host.localeCompare(b.host))) {
    map[rule.host] = rule;
  }
  return map;
}

// Identity headers Authentik's outpost returns and Traefik must copy upstream.
const AUTHENTIK_AUTH_RESPONSE_HEADERS = [
  'X-authentik-username',
  'X-authentik-groups',
  'X-authentik-email',
  'X-authentik-name',
  'X-authentik-uid',
  'X-authentik-jwt',
];

/**
 * The TLS block stamped on every emitted router.
 *
 * Empty `tls: {}` keeps the entrypoint's default cert resolver with on-demand,
 * per-host issuance (the HTTP-01 default). In **wildcard mode** — DNS-01, where
 * the compose `dns01` overlay sets `HOLA_TLS_CERT_RESOLVER` on the server — every
 * router must carry the wildcard `tls.domains` itself: Traefik v3 does **not**
 * proactively resolve an entrypoint-level `tls.domains` when routers emit an
 * empty `tls: {}`, so without this the `*.<base>` cert is never requested and
 * Traefik serves its self-signed default. A fresh object per call avoids the
 * YAML serializer emitting anchor/alias references for the repeated block.
 */
function routerTlsBlock(baseDomain: string, certResolver?: string): Record<string, unknown> {
  if (!certResolver) return {};
  return { certResolver, domains: [{ main: baseDomain, sans: [`*.${baseDomain}`] }] };
}

/** Render the Traefik file-provider dynamic config for a routing map (deterministic). */
function renderDynamicConfig(map: TraefikRoutingMap, baseDomain: string, certResolver?: string): string {
  const routers: Record<string, unknown> = {};
  const services: Record<string, unknown> = {};
  const middlewares: Record<string, unknown> = {};

  for (const host of Object.keys(map).sort()) {
    const rule = map[host];
    const router: Record<string, unknown> = {
      rule: `Host(\`${host}\`)`,
      service: rule.serviceName,
      entryPoints: ['websecure'],
      tls: routerTlsBlock(baseDomain, certResolver),
    };

    if (rule.forwardAuth) {
      const mwName = rule.forwardAuth.name;
      const outpost = rule.forwardAuth.outpostUrl.replace(/\/+$/, '');
      // Gate the app's router behind the outpost.
      router.middlewares = [mwName];
      middlewares[mwName] = {
        forwardAuth: {
          address: `${outpost}/outpost.goauthentik.io/auth/traefik`,
          trustForwardHeader: true,
          authResponseHeaders: AUTHENTIK_AUTH_RESPONSE_HEADERS,
        },
      };
      // Higher-priority router sends the outpost's own auth/callback endpoints to
      // Authentik (without this, login/callback 404s). Priority beats the Host router.
      const outpostRouter = `${rule.serviceName}-ak-outpost`;
      const outpostService = `${rule.serviceName}-ak-outpost`;
      routers[outpostRouter] = {
        rule: `Host(\`${host}\`) && PathPrefix(\`/outpost.goauthentik.io/\`)`,
        service: outpostService,
        priority: 100,
        entryPoints: ['websecure'],
        tls: routerTlsBlock(baseDomain, certResolver),
      };
      services[outpostService] = {
        loadBalancer: { servers: [{ url: outpost }] },
      };
    }

    routers[rule.serviceName] = router;
    services[rule.serviceName] = {
      loadBalancer: {
        servers: [{ url: `http://${rule.serviceName}:${rule.port ?? 80}` }],
      },
    };
  }

  const http: Record<string, unknown> = { routers, services };
  if (Object.keys(middlewares).length > 0) http.middlewares = middlewares;
  return stringifyYAML({ http });
}

/** Render the file-provider config for the platform's core routes (deterministic). */
function renderCoreConfig(routes: CoreRoute[], baseDomain: string, certResolver?: string): string {
  const routers: Record<string, unknown> = {};
  const services: Record<string, unknown> = {};
  for (const route of [...routes].sort((a, b) => a.name.localeCompare(b.name))) {
    routers[route.name] = {
      rule: `Host(\`${route.host}\`)`,
      // Built-in services (api@internal) are referenced directly; everything else
      // gets a load balancer pointing at the upstream URL below.
      service: route.service ?? route.name,
      entryPoints: ['websecure'],
      // `tls: {}` inherits the entrypoint default resolver (on-demand per-host);
      // in wildcard mode each router carries the wildcard domains. See routerTlsBlock.
      tls: routerTlsBlock(baseDomain, certResolver),
    };
    if (!route.service) {
      services[route.name] = { loadBalancer: { servers: [{ url: route.url }] } };
    }
  }
  const http: Record<string, unknown> = { routers };
  if (Object.keys(services).length > 0) http.services = services;
  return stringifyYAML({ http });
}

export class RealRoutingService implements RoutingService {
  private logger = getLogger().child({ service: 'RoutingService' });
  private domain: string;
  private certResolver?: string;
  private map: TraefikRoutingMap = {};
  private loadPromise: Promise<void> | null = null;

  constructor(private storageService: StorageService, options?: { baseDomain?: string; certResolver?: string }) {
    this.domain = options?.baseDomain || process.env.HOLA_BASE_DOMAIN?.trim() || DEFAULT_BASE_DOMAIN;
    // Set (to the resolver name, e.g. `le`) only in wildcard/DNS-01 mode — the
    // compose dns01 overlay injects HOLA_TLS_CERT_RESOLVER on the server. When
    // set, emitted routers carry the wildcard `tls.domains` (see routerTlsBlock).
    this.certResolver = options?.certResolver ?? (process.env.HOLA_TLS_CERT_RESOLVER?.trim() || undefined);
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.storageService.ensureDir('runtime/traefik');
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  baseDomain(): string {
    return this.domain;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    if (await this.storageService.fileExists(ROUTING_MAP_PATH)) {
      try {
        this.map = JSON.parse(await this.storageService.readFileAsString(ROUTING_MAP_PATH));
      } catch (error) {
        this.logger.warn('Failed to load routing map; starting empty', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  generateRule(input: GenerateRuleInput): TraefikRoutingRule {
    return buildRule(input, this.domain);
  }

  async validateRule(rule: TraefikRoutingRule): Promise<RoutingConflict[]> {
    await this.ensureLoaded();
    return conflictsFor(rule, this.map);
  }

  async activateRoute(rule: TraefikRoutingRule): Promise<void> {
    await this.ensureLoaded();
    // Drop any prior route owned by this deployment (e.g. a host change), then set.
    for (const host of Object.keys(this.map)) {
      if (this.map[host].deploymentId === rule.deploymentId) {
        delete this.map[host];
      }
    }
    this.map[rule.host] = rule;
    await this.persist();
    this.logger.info('Activated route', { deploymentId: rule.deploymentId, host: rule.host });
  }

  async deactivateRoute(deploymentId: string): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const host of Object.keys(this.map)) {
      if (this.map[host].deploymentId === deploymentId) {
        delete this.map[host];
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
      this.logger.info('Deactivated route', { deploymentId });
    }
  }

  async reconcile(rules: TraefikRoutingRule[]): Promise<void> {
    await this.ensureLoaded();
    this.map = sortedMap(rules);
    await this.persist();
    this.logger.info('Reconciled routing from persisted state', { ruleCount: rules.length });
  }

  async getRoutingMap(): Promise<TraefikRoutingMap> {
    await this.ensureLoaded();
    return { ...this.map };
  }

  async emitCoreRoutes(routes: CoreRoute[]): Promise<void> {
    await this.storageService.ensureDir('runtime/traefik');
    await this.storageService.writeFile(CORE_CONFIG_PATH, renderCoreConfig(routes, this.domain, this.certResolver));
    this.logger.info('Emitted core Traefik routes', {
      count: routes.length,
      hosts: routes.map(r => r.host),
    });
  }

  /** Persist the routing map and re-emit the Traefik dynamic config (atomic writes). */
  private async persist(): Promise<void> {
    await this.storageService.ensureDir('runtime/traefik');
    const ordered = sortedMap(Object.values(this.map));
    await this.storageService.writeFile(ROUTING_MAP_PATH, JSON.stringify(ordered, null, 2));
    await this.storageService.writeFile(DYNAMIC_CONFIG_PATH, renderDynamicConfig(ordered, this.domain, this.certResolver));
  }
}

/** In-memory routing service for tests/dev (no file emission). */
export class MockRoutingService implements RoutingService {
  private domain: string;
  private map: TraefikRoutingMap = {};

  constructor(options?: { baseDomain?: string }) {
    this.domain = options?.baseDomain || DEFAULT_BASE_DOMAIN;
  }

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  baseDomain(): string {
    return this.domain;
  }

  generateRule(input: GenerateRuleInput): TraefikRoutingRule {
    return buildRule(input, this.domain);
  }

  async validateRule(rule: TraefikRoutingRule): Promise<RoutingConflict[]> {
    return conflictsFor(rule, this.map);
  }

  async activateRoute(rule: TraefikRoutingRule): Promise<void> {
    for (const host of Object.keys(this.map)) {
      if (this.map[host].deploymentId === rule.deploymentId) {
        delete this.map[host];
      }
    }
    this.map[rule.host] = rule;
  }

  async deactivateRoute(deploymentId: string): Promise<void> {
    for (const host of Object.keys(this.map)) {
      if (this.map[host].deploymentId === deploymentId) {
        delete this.map[host];
      }
    }
  }

  async reconcile(rules: TraefikRoutingRule[]): Promise<void> {
    this.map = sortedMap(rules);
  }

  async getRoutingMap(): Promise<TraefikRoutingMap> {
    return { ...this.map };
  }

  async emitCoreRoutes(): Promise<void> {
    // No file emission in tests/dev.
  }
}
