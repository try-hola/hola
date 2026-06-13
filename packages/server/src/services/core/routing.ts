/**
 * Routing Service - Traefik host routing (issue #16)
 *
 * Owns the canonical routing-rule schema and is the single authority for:
 * - generating a deterministic Traefik routing rule for a deployment,
 * - validating host conflicts against the active routing map,
 * - emitting deterministic Traefik dynamic (file-provider) configuration,
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
const DEFAULT_BASE_DOMAIN = 'local.hola';

export interface GenerateRuleInput {
  deploymentId: string;
  appName: string;
  /** Internal container/service port Traefik forwards to (defaults to 80). */
  port?: number;
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
}

/** Build a deterministic routing rule (pure; shared by real and mock services). */
function buildRule(input: GenerateRuleInput, domain: string): TraefikRoutingRule {
  const host = `${input.appName}.${domain}`;
  const shortId = input.deploymentId.slice(0, 12);
  return {
    deploymentId: input.deploymentId,
    appName: input.appName,
    host,
    domain,
    serviceName: `${input.appName}-${shortId}`,
    networkName: `hola-${shortId}`,
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

/** Render the Traefik file-provider dynamic config for a routing map (deterministic). */
function renderDynamicConfig(map: TraefikRoutingMap): string {
  const routers: Record<string, unknown> = {};
  const services: Record<string, unknown> = {};

  for (const host of Object.keys(map).sort()) {
    const rule = map[host];
    routers[rule.serviceName] = {
      rule: `Host(\`${host}\`)`,
      service: rule.serviceName,
      entryPoints: ['websecure'],
      tls: {},
    };
    services[rule.serviceName] = {
      loadBalancer: {
        servers: [{ url: `http://${rule.serviceName}:${rule.port ?? 80}` }],
      },
    };
  }

  return stringifyYAML({ http: { routers, services } });
}

export class RealRoutingService implements RoutingService {
  private logger = getLogger().child({ service: 'RoutingService' });
  private domain: string;
  private map: TraefikRoutingMap = {};
  private loadPromise: Promise<void> | null = null;

  constructor(private storageService: StorageService, options?: { baseDomain?: string }) {
    this.domain = options?.baseDomain || process.env.HOLA_BASE_DOMAIN?.trim() || DEFAULT_BASE_DOMAIN;
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

  /** Persist the routing map and re-emit the Traefik dynamic config (atomic writes). */
  private async persist(): Promise<void> {
    await this.storageService.ensureDir('runtime/traefik');
    const ordered = sortedMap(Object.values(this.map));
    await this.storageService.writeFile(ROUTING_MAP_PATH, JSON.stringify(ordered, null, 2));
    await this.storageService.writeFile(DYNAMIC_CONFIG_PATH, renderDynamicConfig(ordered));
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
}
