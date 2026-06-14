/**
 * ProvisionerService — auth/SSO provisioning for deployed apps (MVP pt2).
 *
 * When a catalog app declares an `auth` block, Hola provisions the matching auth
 * artifacts on the operator's auth platform at deploy time and injects the
 * resulting settings into the app's environment, so SSO "just works" on first
 * boot — with no human in the auth UI. On uninstall the artifacts are torn down.
 *
 * The interface is platform-agnostic so the lightweight Authelia+LLDAP backend
 * (try-hola/hola#88) can implement the same contract later. The first backend is
 * Authentik, and PR1 fully implements only `native-oidc`; `forward-auth` and
 * `native-ldap` are part of the contract but throw "not implemented" until PR3/PR4.
 *
 * Provisioning is idempotent and keyed on `deploymentId` (stable across releases):
 * a re-deploy/rollback reuses the same OIDC client rather than creating a new one.
 */

import { randomBytes, randomUUID } from 'crypto';
import { getLogger } from '../../lib/logger';
import { ProvisioningError } from '../../middleware/error-mapping';
import type { AuthConfig } from '../../config/auth';
import type { AuthMode, ProvisionedAuthRef } from '@hola/shared';
import type { ServiceHealth, HealthCheckable } from './types';

export interface ProvisionInput {
  /** Stable key for the deployment — NEVER releaseId (rollback keeps the same client). */
  deploymentId: string;
  appName: string;
  mode: AuthMode;
  /** The app's external host (`{appName}.{baseDomain}`), used to build redirect/issuer URLs. */
  host: string;
  /** Existing provisioned ref (from deployment metadata) for idempotent re-provision. */
  existingRef?: ProvisionedAuthRef;
  oidc?: {
    redirectPath: string;
    scopes: string[];
    /** The app's expected env-var NAMES for each OIDC setting. */
    env: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
  };
  ldap?: {
    env: { host: string; port: string; bindDn: string; bindPassword: string; baseDn: string };
  };
  forwardAuth?: { allowedGroups?: string[] };
}

export interface ProvisionResult {
  /** Environment to inject, keyed by the app's expected var NAMES. */
  env: Record<string, string>;
  /** Opaque handle to persist for idempotent re-provision and teardown. */
  ref: ProvisionedAuthRef;
  /** forward-auth only (PR3): Traefik middleware descriptor for the router. */
  middleware?: {
    name: string;
    forwardAuth: { address: string; trustForwardHeader: boolean; authResponseHeaders: string[] };
  };
}

export interface DeprovisionInput {
  deploymentId: string;
  ref?: ProvisionedAuthRef;
}

export interface ProvisionerService extends HealthCheckable {
  provision(input: ProvisionInput): Promise<ProvisionResult>;
  deprovision(input: DeprovisionInput): Promise<void>;
  healthCheck(): Promise<ServiceHealth>;
}

// ---------------------------------------------------------------------------
// Authentik REST backend
// ---------------------------------------------------------------------------

const AUTHZ_FLOW_SLUG = 'default-provider-authorization-implicit-consent';
const INVALIDATION_FLOW_SLUG = 'default-provider-invalidation';

/** Sanitize a string into an Authentik slug (lowercase, alnum + hyphen). */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export class RealAuthentikProvisionerService implements ProvisionerService {
  private logger = getLogger().child({ service: 'RealAuthentikProvisionerService' });

  constructor(private config: AuthConfig) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      await this.api('GET', '/api/v3/admin/version/');
      return { healthy: true, lastCheck: new Date() };
    } catch (error) {
      return { healthy: false, lastCheck: new Date(), error: error instanceof Error ? error.message : String(error) };
    }
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    switch (input.mode) {
      case 'native-oidc':
        return this.provisionOidc(input);
      case 'forward-auth':
      case 'native-ldap':
        throw new ProvisioningError(`auth mode '${input.mode}' is not implemented yet`);
      case 'none':
        return { env: {}, ref: { mode: 'none' } };
      default:
        throw new ProvisioningError(`unknown auth mode '${String(input.mode)}'`);
    }
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    const ref = input.ref;
    if (!ref || ref.mode !== 'native-oidc') return;
    // Delete the application first (it points at the provider), then the provider.
    if (ref.applicationSlug) {
      await this.apiDeleteIgnoreMissing(`/api/v3/core/applications/${encodeURIComponent(ref.applicationSlug)}/`);
    }
    if (ref.providerPk != null) {
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/oauth2/${ref.providerPk}/`);
    }
    this.logger.info('Deprovisioned OIDC client', { deploymentId: input.deploymentId, providerPk: ref.providerPk });
  }

  // ---- native-oidc -------------------------------------------------------

  private async provisionOidc(input: ProvisionInput): Promise<ProvisionResult> {
    const oidc = input.oidc;
    if (!oidc) throw new ProvisioningError('native-oidc requires an oidc config block');

    const redirectUri = `https://${input.host}${oidc.redirectPath}`;
    const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);

    // Idempotent re-provision: reuse the existing client, refresh its redirect URI.
    const existing = input.existingRef;
    if (existing && existing.mode === 'native-oidc' && existing.providerPk != null) {
      const provider = await this.api<AuthentikOAuth2Provider>('GET', `/api/v3/providers/oauth2/${existing.providerPk}/`);
      await this.api('PATCH', `/api/v3/providers/oauth2/${existing.providerPk}/`, {
        redirect_uris: [{ matching_mode: 'strict', url: redirectUri }],
      });
      this.logger.info('Reused existing OIDC client', { deploymentId: input.deploymentId, providerPk: existing.providerPk });
      return {
        env: this.oidcEnv(oidc.env, provider.client_id, provider.client_secret, redirectUri, existing.applicationSlug ?? slug),
        ref: existing,
      };
    }

    // Fresh provision: pre-generate credentials so injection needs no read-back.
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('hex');

    const [authFlow, invalidationFlow, propertyMappings] = await Promise.all([
      this.resolveFlowPk(AUTHZ_FLOW_SLUG),
      this.resolveFlowPk(INVALIDATION_FLOW_SLUG),
      this.resolveScopeMappingPks(oidc.scopes),
    ]);

    const provider = await this.api<AuthentikOAuth2Provider>('POST', '/api/v3/providers/oauth2/', {
      name: `hola-${input.appName}-${input.deploymentId.slice(0, 8)}`,
      authorization_flow: authFlow,
      invalidation_flow: invalidationFlow,
      client_type: 'confidential',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [{ matching_mode: 'strict', url: redirectUri }],
      property_mappings: propertyMappings,
      sub_mode: 'hashed_user_id',
    });

    // Create the application; roll back the provider if that fails so we never
    // leave a half-provisioned orphan.
    try {
      await this.api('POST', '/api/v3/core/applications/', {
        name: `${input.appName} (${input.deploymentId.slice(0, 8)})`,
        slug,
        provider: provider.pk,
        meta_launch_url: `https://${input.host}/`,
      });
    } catch (error) {
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/oauth2/${provider.pk}/`);
      throw new ProvisioningError('failed to create Authentik application', error);
    }

    this.logger.info('Provisioned OIDC client', { deploymentId: input.deploymentId, providerPk: provider.pk, slug });

    return {
      env: this.oidcEnv(oidc.env, clientId, clientSecret, redirectUri, slug),
      ref: { mode: 'native-oidc', providerPk: provider.pk, applicationSlug: slug, clientId },
    };
  }

  private oidcEnv(
    names: { issuer: string; clientId: string; clientSecret: string; redirectUri: string },
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    slug: string
  ): Record<string, string> {
    const base = this.config.authentikPublicUrl || this.config.authentikUrl || '';
    return {
      [names.issuer]: `${base}/application/o/${slug}/`,
      [names.clientId]: clientId,
      [names.clientSecret]: clientSecret,
      [names.redirectUri]: redirectUri,
    };
  }

  private async resolveFlowPk(slug: string): Promise<string> {
    const flow = await this.api<{ pk: string }>('GET', `/api/v3/flows/instances/${encodeURIComponent(slug)}/`);
    return flow.pk;
  }

  /** Best-effort: collect scope-mapping pks for the requested scope names. */
  private async resolveScopeMappingPks(scopes: string[]): Promise<string[]> {
    const pks: string[] = [];
    for (const scope of scopes) {
      try {
        const res = await this.api<{ results: Array<{ pk: string }> }>(
          'GET',
          `/api/v3/propertymappings/provider/scope/?scope_name=${encodeURIComponent(scope)}`
        );
        if (res.results?.[0]?.pk) pks.push(res.results[0].pk);
      } catch (error) {
        this.logger.warn('Could not resolve OIDC scope mapping; continuing', {
          scope,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return pks;
  }

  // ---- HTTP --------------------------------------------------------------

  private async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config.authentikUrl) throw new ProvisioningError('HOLA_AUTHENTIK_URL is not configured');
    if (!this.config.authentikApiToken) throw new ProvisioningError('HOLA_AUTHENTIK_API_TOKEN is not configured');

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
    try {
      const res = await fetch(`${this.config.authentikUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.authentikApiToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ProvisioningError(`Authentik ${method} ${path} failed: ${res.status}`, { status: res.status, body: text });
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (error) {
      if (error instanceof ProvisioningError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProvisioningError(`Authentik ${method} ${path} timed out`);
      }
      throw new ProvisioningError(`Authentik ${method} ${path} error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(tid);
    }
  }

  /** DELETE that tolerates an already-absent resource (404) — for teardown. */
  private async apiDeleteIgnoreMissing(path: string): Promise<void> {
    try {
      await this.api('DELETE', path);
    } catch (error) {
      const status = error instanceof ProvisioningError ? (error.details as { status?: number })?.status : undefined;
      if (status === 404) return;
      throw error;
    }
  }
}

interface AuthentikOAuth2Provider {
  pk: number;
  client_id: string;
  client_secret: string;
}

// ---------------------------------------------------------------------------
// Mock backend — no network. Used in test/dev and when HOLA_AUTH_MODE=none.
// ---------------------------------------------------------------------------

export class MockProvisionerService implements ProvisionerService {
  private logger = getLogger().child({ service: 'MockProvisionerService' });

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    if (input.mode === 'native-oidc' && input.oidc) {
      const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);
      const clientId = input.existingRef?.clientId ?? `mock-client-${input.deploymentId.slice(0, 8)}`;
      const clientSecret = `mock-secret-${input.deploymentId.slice(0, 8)}`;
      const redirectUri = `https://${input.host}${input.oidc.redirectPath}`;
      const names = input.oidc.env;
      return {
        env: {
          [names.issuer]: `https://auth.mock/application/o/${slug}/`,
          [names.clientId]: clientId,
          [names.clientSecret]: clientSecret,
          [names.redirectUri]: redirectUri,
        },
        ref: input.existingRef ?? { mode: 'native-oidc', providerPk: 1, applicationSlug: slug, clientId },
      };
    }
    // none / unimplemented modes: no-op so a deploy proceeds without auth wiring.
    return { env: {}, ref: { mode: input.mode } };
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    this.logger.debug('Mock deprovision', { deploymentId: input.deploymentId, mode: input.ref?.mode });
  }
}
