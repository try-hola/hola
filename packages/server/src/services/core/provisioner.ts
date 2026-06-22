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
import type { AuthMode, ProvisionedAuthRef, ForwardAuthMiddleware } from '@hola/shared';
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
    /** The app's expected env-var NAMES for each OIDC setting (optional — apps that
     *  configure OIDC via a setup command rather than env omit this). `redirectUri`
     *  is optional: apps that derive their own redirect URI from their base URL have
     *  no env var for the literal callback. */
    env?: { issuer: string; clientId: string; clientSecret: string; redirectUri?: string };
  };
  ldap?: {
    env: { host: string; port: string; bindDn: string; bindPassword: string; baseDn: string };
  };
  forwardAuth?: { allowedGroups?: string[] };
}

export interface ProvisionResult {
  /** Environment to inject, keyed by the app's expected var NAMES (empty if the app
   *  has no env mapping and is wired by a setup command instead). */
  env: Record<string, string>;
  /** Raw provisioned OIDC values, for post-deploy setup-command substitution. */
  credentials?: { clientId: string; clientSecret: string; issuer: string; redirectUri: string };
  /** Opaque handle to persist for idempotent re-provision and teardown. */
  ref: ProvisionedAuthRef;
  /** forward-auth only: descriptor the routing service attaches to the app's route. */
  middleware?: ForwardAuthMiddleware;
}

export interface DeprovisionInput {
  deploymentId: string;
  ref?: ProvisionedAuthRef;
}

/** Input for provisioning the Hola dashboard's OWN OIDC client (not a deployed app). */
export interface PlatformOidcInput {
  /** The dashboard's external host (HOLA_DOMAIN), e.g. `app.example.com`. */
  host: string;
  /** Browser callback path the SPA handles, e.g. `/auth/callback`. */
  redirectPath: string;
  /** OIDC scopes to grant, e.g. ['openid','profile','email']. */
  scopes: string[];
}

/** The dashboard OIDC client details, read back for the server + SPA to use. */
export interface PlatformOidcResult {
  issuer: string;
  clientId: string;
  redirectUri: string;
  audience: string;
}

export interface ProvisionerService extends HealthCheckable {
  provision(input: ProvisionInput): Promise<ProvisionResult>;
  deprovision(input: DeprovisionInput): Promise<void>;
  /**
   * Idempotently ensure a PUBLIC (PKCE) OIDC client for the dashboard itself and
   * return its issuer/clientId. Stable across restarts (keyed on a fixed slug), so
   * re-running reuses the same client. The dashboard is a public SPA client, so no
   * client secret is issued.
   */
  provisionPlatformOidc(input: PlatformOidcInput): Promise<PlatformOidcResult>;
  /**
   * Idempotently ensure a platform-owned admin group exists and seed all current
   * superusers into it. Both the dashboard (HOLA_OIDC_ADMIN_GROUP) and catalog
   * apps (e.g. Gitea's `--admin-group`) can then map admin to one stable group
   * instead of a backend-specific one like Authentik's built-in "authentik Admins".
   */
  ensureAdminGroup(name: string): Promise<void>;
  /**
   * Provision a named admin user (from HOLA_ADMIN_EMAIL) into `adminGroup` and,
   * if they've never logged in, return a one-time recovery link to set their own
   * password — so the operator signs in as themselves, not the generic akadmin.
   * No-op when no admin email is configured.
   */
  ensureBootstrapAdmin(adminGroup: string): Promise<{ created: boolean; recoveryLink?: string }>;
  healthCheck(): Promise<ServiceHealth>;
}

// Fixed identifiers for the dashboard's own OIDC client (stable → idempotent).
const DASHBOARD_SLUG = 'hola-dashboard';
const DASHBOARD_NAME = 'Hola Dashboard';

// ---------------------------------------------------------------------------
// Authentik REST backend
// ---------------------------------------------------------------------------

// Default flow slugs vary across Authentik versions, so we resolve by slug first
// and fall back to the first flow of the right designation (see resolveFlowPk).
const AUTHZ_FLOW_SLUG = 'default-provider-authorization-implicit-consent';
const INVALIDATION_FLOW_SLUG = 'default-provider-invalidation-flow';

// Scoped service account Hola self-bootstraps so provisioning runs with least
// privilege instead of as the akadmin superuser.
const PROVISIONER_USERNAME = 'hola-provisioner';
const PROVISIONER_TOKEN_ID = 'hola-provisioner-token';

// Global (model-level) permissions the provisioner needs — just enough to manage
// providers/applications/users/outposts and read flows/scope mappings. NOT superuser.
const PROVISIONER_PERMISSIONS = [
  'authentik_providers_oauth2.add_oauth2provider',
  'authentik_providers_oauth2.view_oauth2provider',
  'authentik_providers_oauth2.change_oauth2provider',
  'authentik_providers_oauth2.delete_oauth2provider',
  // Read OAuth2 scope mappings to attach openid/profile/email to provisioned
  // clients (the generic core.view_propertymapping is insufficient for the
  // provider/scope subclass endpoint — Authentik returns 403 without this).
  'authentik_providers_oauth2.view_scopemapping',
  'authentik_providers_proxy.add_proxyprovider',
  'authentik_providers_proxy.view_proxyprovider',
  'authentik_providers_proxy.change_proxyprovider',
  'authentik_providers_proxy.delete_proxyprovider',
  'authentik_providers_ldap.add_ldapprovider',
  'authentik_providers_ldap.view_ldapprovider',
  'authentik_core.add_application',
  'authentik_core.view_application',
  'authentik_core.change_application',
  'authentik_core.delete_application',
  'authentik_core.add_user',
  'authentik_core.view_user',
  'authentik_core.change_user',
  'authentik_core.delete_user',
  'authentik_core.reset_user_password',
  'authentik_core.assign_user_permissions',
  // Manage the platform admin group (create + seed superusers into it).
  'authentik_core.add_group',
  'authentik_core.view_group',
  'authentik_core.change_group',
  // Bind a recovery flow to the default brand so a named admin can be sent a
  // one-time password-setup link at bootstrap.
  'authentik_brands.view_brand',
  'authentik_brands.change_brand',
  'authentik_core.view_propertymapping',
  'authentik_outposts.view_outpost',
  'authentik_outposts.change_outpost',
  'authentik_flows.view_flow',
  // Create a recovery flow (Authentik ships none) reusing the password-change
  // stages, so a named admin can be sent a one-time password-setup link.
  'authentik_flows.add_flow',
  'authentik_flows.view_flowstagebinding',
  'authentik_flows.add_flowstagebinding',
  // Read stages (stages/all) so the recovery flow can append the built-in Login
  // stage — setting a password then signs the operator in automatically.
  'authentik_flows.view_stage',
  // Read certificate-keypairs to pick a signing key for the dashboard OIDC client.
  'authentik_crypto.view_certificatekeypair',
];

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
        return this.provisionForwardAuth(input);
      case 'native-ldap':
        return this.provisionLdap(input);
      case 'none':
        return { env: {}, ref: { mode: 'none' } };
      default:
        throw new ProvisioningError(`unknown auth mode '${String(input.mode)}'`);
    }
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    const ref = input.ref;
    if (!ref) return;
    if (ref.mode === 'native-oidc') {
      // Delete the application first (it points at the provider), then the provider.
      if (ref.applicationSlug) {
        await this.apiDeleteIgnoreMissing(`/api/v3/core/applications/${encodeURIComponent(ref.applicationSlug)}/`);
      }
      if (ref.providerPk != null) {
        await this.apiDeleteIgnoreMissing(`/api/v3/providers/oauth2/${ref.providerPk}/`);
      }
      this.logger.info('Deprovisioned OIDC client', { deploymentId: input.deploymentId, providerPk: ref.providerPk });
      return;
    }
    if (ref.mode === 'forward-auth') {
      // Detach from the outpost first, then delete the application and provider.
      if (ref.outpostPk != null && ref.providerPk != null) {
        await this.removeProviderFromOutpost(ref.outpostPk, ref.providerPk);
      }
      if (ref.applicationSlug) {
        await this.apiDeleteIgnoreMissing(`/api/v3/core/applications/${encodeURIComponent(ref.applicationSlug)}/`);
      }
      if (ref.providerPk != null) {
        await this.apiDeleteIgnoreMissing(`/api/v3/providers/proxy/${ref.providerPk}/`);
      }
      this.logger.info('Deprovisioned forward-auth provider', { deploymentId: input.deploymentId, providerPk: ref.providerPk });
      return;
    }
    if (ref.mode === 'native-ldap') {
      if (ref.bindAccountPk != null) {
        await this.apiDeleteIgnoreMissing(`/api/v3/core/users/${ref.bindAccountPk}/`);
      }
      this.logger.info('Deprovisioned LDAP bind account', { deploymentId: input.deploymentId, bindAccountPk: ref.bindAccountPk });
    }
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
      const reuseSlug = existing.applicationSlug ?? slug;
      return {
        env: this.oidcEnv(oidc.env, provider.client_id, provider.client_secret, redirectUri, reuseSlug),
        credentials: { clientId: provider.client_id, clientSecret: provider.client_secret, issuer: this.issuerUrl(reuseSlug), redirectUri },
        ref: existing,
      };
    }

    // Fresh provision: pre-generate credentials so injection needs no read-back.
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('hex');

    const [authFlow, invalidationFlow, propertyMappings] = await Promise.all([
      this.resolveFlowPk(AUTHZ_FLOW_SLUG, 'authorization'),
      this.resolveFlowPk(INVALIDATION_FLOW_SLUG, 'invalidation'),
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
      credentials: { clientId, clientSecret, issuer: this.issuerUrl(slug), redirectUri },
      ref: { mode: 'native-oidc', providerPk: provider.pk, applicationSlug: slug, clientId },
    };
  }

  private issuerUrl(slug: string): string {
    const base = this.config.authentikPublicUrl || this.config.authentikUrl || '';
    return `${base}/application/o/${slug}/`;
  }

  // ---- platform (dashboard) OIDC ----------------------------------------

  async provisionPlatformOidc(input: PlatformOidcInput): Promise<PlatformOidcResult> {
    const redirectUri = `https://${input.host}${input.redirectPath}`;
    const issuer = this.issuerUrl(DASHBOARD_SLUG);

    // Idempotent: if the dashboard application already exists, reuse its provider
    // (keeping a stable client_id across restarts) and just refresh the redirect URI.
    const existing = await this.findApplication(DASHBOARD_SLUG);
    if (existing?.provider != null) {
      const provider = await this.api<AuthentikOAuth2Provider>('GET', `/api/v3/providers/oauth2/${existing.provider}/`);
      // Self-heal on every startup: refresh the redirect URI, and (re)attach the
      // scope mappings + signing key so a client created before a permission/config
      // fix converges without manual deletion.
      const [propertyMappings, signingKey] = await Promise.all([
        this.resolveScopeMappingPks(input.scopes),
        this.resolveSigningKeyPk(),
      ]);
      await this.api('PATCH', `/api/v3/providers/oauth2/${existing.provider}/`, {
        redirect_uris: [{ matching_mode: 'strict', url: redirectUri }],
        ...(propertyMappings.length ? { property_mappings: propertyMappings } : {}),
        ...(signingKey ? { signing_key: signingKey } : {}),
      });
      this.logger.info('Reused dashboard OIDC client', { clientId: provider.client_id });
      return { issuer, clientId: provider.client_id, redirectUri, audience: provider.client_id };
    }

    // Fresh provision: a PUBLIC client (PKCE, no usable secret) with an asymmetric
    // signing key so access tokens are verifiable JWTs (RS256) via JWKS.
    const clientId = randomUUID();
    const [authFlow, invalidationFlow, propertyMappings, signingKey] = await Promise.all([
      this.resolveFlowPk(AUTHZ_FLOW_SLUG, 'authorization'),
      this.resolveFlowPk(INVALIDATION_FLOW_SLUG, 'invalidation'),
      this.resolveScopeMappingPks(input.scopes),
      this.resolveSigningKeyPk(),
    ]);

    const provider = await this.api<AuthentikOAuth2Provider>('POST', '/api/v3/providers/oauth2/', {
      name: DASHBOARD_NAME,
      authorization_flow: authFlow,
      invalidation_flow: invalidationFlow,
      client_type: 'public',
      client_id: clientId,
      redirect_uris: [{ matching_mode: 'strict', url: redirectUri }],
      property_mappings: propertyMappings,
      sub_mode: 'hashed_user_id',
      ...(signingKey ? { signing_key: signingKey } : {}),
    });

    try {
      await this.api('POST', '/api/v3/core/applications/', {
        name: DASHBOARD_NAME,
        slug: DASHBOARD_SLUG,
        provider: provider.pk,
        meta_launch_url: `https://${input.host}/`,
      });
    } catch (error) {
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/oauth2/${provider.pk}/`);
      throw new ProvisioningError('failed to create dashboard Authentik application', error);
    }

    this.logger.info('Provisioned dashboard OIDC client', { clientId, providerPk: provider.pk });
    return { issuer, clientId, redirectUri, audience: clientId };
  }

  /** Look up an application by slug, returning null when absent (404). */
  private async findApplication(slug: string): Promise<{ provider: number | null } | null> {
    try {
      return await this.api<{ provider: number | null }>(
        'GET',
        `/api/v3/core/applications/${encodeURIComponent(slug)}/`,
      );
    } catch (error) {
      const status = error instanceof ProvisioningError ? (error.details as { status?: number })?.status : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  /** Pick a certificate-keypair to sign tokens with (Authentik ships a default). */
  private async resolveSigningKeyPk(): Promise<string | undefined> {
    try {
      const res = await this.api<{ results: Array<{ pk: string }> }>(
        'GET',
        '/api/v3/crypto/certificatekeypairs/?has_key=true&ordering=name',
      );
      return res.results?.[0]?.pk;
    } catch (error) {
      this.logger.warn('Could not resolve a signing key for the dashboard client; tokens may be opaque', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  // ---- forward-auth ------------------------------------------------------

  private forwardAuthMiddleware(slug: string): ForwardAuthMiddleware {
    return { name: `ak-${slug}`, outpostUrl: this.config.authentikUrl ?? '' };
  }

  private async provisionForwardAuth(input: ProvisionInput): Promise<ProvisionResult> {
    const externalHost = `https://${input.host}`;
    const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);

    // Idempotent re-provision: reuse the existing proxy provider, refresh its host.
    const existing = input.existingRef;
    if (existing && existing.mode === 'forward-auth' && existing.providerPk != null) {
      await this.api('PATCH', `/api/v3/providers/proxy/${existing.providerPk}/`, { external_host: externalHost });
      this.logger.info('Reused existing forward-auth provider', { deploymentId: input.deploymentId, providerPk: existing.providerPk });
      return { env: {}, ref: existing, middleware: this.forwardAuthMiddleware(existing.applicationSlug ?? slug) };
    }

    const [authFlow, invalidationFlow] = await Promise.all([
      this.resolveFlowPk(AUTHZ_FLOW_SLUG, 'authorization'),
      this.resolveFlowPk(INVALIDATION_FLOW_SLUG, 'invalidation'),
    ]);

    const provider = await this.api<{ pk: number }>('POST', '/api/v3/providers/proxy/', {
      name: `hola-${input.appName}-${input.deploymentId.slice(0, 8)}`,
      authorization_flow: authFlow,
      invalidation_flow: invalidationFlow,
      mode: 'forward_single',
      external_host: externalHost,
    });

    try {
      await this.api('POST', '/api/v3/core/applications/', {
        name: `${input.appName} (${input.deploymentId.slice(0, 8)})`,
        slug,
        provider: provider.pk,
        meta_launch_url: externalHost,
      });
    } catch (error) {
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/proxy/${provider.pk}/`);
      throw new ProvisioningError('failed to create Authentik application', error);
    }

    // Bind the provider to the embedded outpost so it actually enforces auth.
    const outpostPk = await this.addProviderToEmbeddedOutpost(provider.pk);

    this.logger.info('Provisioned forward-auth provider', { deploymentId: input.deploymentId, providerPk: provider.pk, slug, outpostPk });

    return {
      env: {},
      ref: { mode: 'forward-auth', providerPk: provider.pk, applicationSlug: slug, outpostPk },
      middleware: this.forwardAuthMiddleware(slug),
    };
  }

  /** Ensure the admin group exists and contains every current superuser. */
  async ensureAdminGroup(name: string): Promise<void> {
    try {
      // Find or create the group.
      const found = await this.api<{ results: Array<{ pk: string; users: number[] }> }>(
        'GET', `/api/v3/core/groups/?name=${encodeURIComponent(name)}`
      );
      let group = found.results?.[0];
      if (!group) {
        group = await this.api<{ pk: string; users: number[] }>('POST', '/api/v3/core/groups/', { name });
        this.logger.info('Created platform admin group', { name, pk: group.pk });
      }

      // Seed all current superusers so platform admins are members (and thus
      // satisfy any app/dashboard admin-group mapping that points here).
      const supers = await this.api<{ results: Array<{ pk: number }> }>(
        'GET', '/api/v3/core/users/?is_superuser=true'
      );
      const superPks = (supers.results ?? []).map(u => u.pk);
      const current = group.users ?? [];
      const merged = Array.from(new Set([...current, ...superPks]));
      if (merged.length !== current.length) {
        await this.api('PATCH', `/api/v3/core/groups/${group.pk}/`, { users: merged });
        this.logger.info('Seeded superusers into platform admin group', { name, added: merged.length - current.length });
      }
    } catch (error) {
      this.logger.warn('Could not ensure platform admin group; admin mapping may have no members yet', {
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Provision the named admin user + a one-time password-setup recovery link. */
  async ensureBootstrapAdmin(adminGroup: string): Promise<{ created: boolean; recoveryLink?: string }> {
    const email = this.config.adminEmail;
    if (!email) return { created: false };
    const username = this.config.adminUsername || email.split('@')[0];
    const name = this.config.adminName || username;
    try {
      // Find (by email) or create the internal user.
      const found = await this.api<{ results: Array<{ pk: number; last_login: string | null }> }>(
        'GET', `/api/v3/core/users/?email=${encodeURIComponent(email)}`
      );
      let user = found.results?.[0];
      let created = false;
      if (!user) {
        user = await this.api<{ pk: number; last_login: string | null }>('POST', '/api/v3/core/users/', {
          username, email, name, type: 'internal', is_active: true, path: 'users',
        });
        created = true;
        this.logger.info('Provisioned named admin user', { email, username, pk: user.pk });
      }

      await this.addUserToGroup(adminGroup, user.pk);

      // Only mint a recovery link until they've logged in once, so we don't emit a
      // fresh one on every restart after they're set up.
      if (user.last_login) return { created };

      const recoveryLink = await this.mintRecoveryLink(user.pk);
      if (!recoveryLink) {
        this.logger.warn('Could not mint admin recovery link; set the password via akadmin or configure a recovery flow', { email });
      }
      return { created, recoveryLink };
    } catch (error) {
      this.logger.warn('Could not ensure bootstrap admin user', {
        email, error: error instanceof Error ? error.message : String(error),
      });
      return { created: false };
    }
  }

  /** Add a single user to a group by name (creating the group if needed). */
  private async addUserToGroup(groupName: string, userPk: number): Promise<void> {
    const found = await this.api<{ results: Array<{ pk: string; users: number[] }> }>(
      'GET', `/api/v3/core/groups/?name=${encodeURIComponent(groupName)}`
    );
    let group = found.results?.[0];
    if (!group) {
      group = await this.api<{ pk: string; users: number[] }>('POST', '/api/v3/core/groups/', { name: groupName });
    }
    const users = group.users ?? [];
    if (!users.includes(userPk)) {
      await this.api('PATCH', `/api/v3/core/groups/${group.pk}/`, { users: [...users, userPk] });
    }
  }

  /** Overridable indirection so tests can exercise the retry loop without waiting. */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mint a one-time recovery link, ensuring a recovery flow is bound first.
   *
   * Authentik 2025.x ships NO recovery flow by default, so a fresh install has
   * nothing to bind and `/recovery/` returns 400 forever. `ensureBrandRecoveryFlow`
   * now creates one when missing. The default blueprints it depends on (the
   * password-change stages) are also applied a little after the API starts
   * answering, so retry the ensure + mint over a short window.
   */
  private async mintRecoveryLink(userPk: number): Promise<string | undefined> {
    const delaysMs = [0, 3_000, 6_000, 10_000, 15_000, 20_000]; // ~54s total
    for (let i = 0; i < delaysMs.length; i++) {
      if (delaysMs[i]) await this.sleep(delaysMs[i]);
      // Ensure a recovery flow exists + is bound to the brand before the mint.
      if (!(await this.ensureBrandRecoveryFlow())) continue;
      try {
        const res = await this.api<{ link: string }>('POST', `/api/v3/core/users/${userPk}/recovery/`);
        // Authentik builds the link from the host the API was called on — which is
        // the internal `authentik-server:9000` for us, unreachable from a browser.
        // Rewrite the origin to the public Authentik URL so the operator can open it,
        // then point the post-recovery redirect at the dashboard instead of Authentik's
        // default "My applications" page.
        return this.withDashboardLanding(this.toPublicUrl(res.link));
      } catch (error) {
        this.logger.warn('Recovery link generation attempt failed; will retry', {
          attempt: i + 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return undefined;
  }

  /**
   * Append a `next` that sends the user to the Hola dashboard after the recovery
   * flow (set-password + auto-login) completes, instead of Authentik's default
   * "My applications" library page.
   *
   * It MUST be a relative path: Authentik's flow executor rejects any absolute
   * `next` (different host than Authentik) as "Invalid next URL" — `is_url_absolute`
   * returns true for anything with a netloc, so the cross-origin dashboard URL is
   * refused. The core `application/launch/<slug>/` view is same-origin and, for an
   * already-authenticated user (the recovery flow's Login stage signs them in),
   * 302s straight to the application's launch URL — i.e. the dashboard. The
   * dashboard SPA then auto-initiates its OIDC login (see Login.tsx), which
   * completes silently against the live Authentik session — so the user lands on
   * the Hola apps page authenticated, with no intermediate clicks. No-op if the
   * link can't be parsed.
   */
  private withDashboardLanding(link: string): string {
    try {
      const u = new URL(link);
      u.searchParams.set('next', `/application/launch/${DASHBOARD_SLUG}/`);
      return u.toString();
    } catch {
      return link;
    }
  }

  /**
   * Rewrite a link's origin to the public Authentik URL. Authentik builds links
   * (e.g. recovery) from the host the request arrived on, which for us is the
   * internal `authentik-server:9000` — not browser-reachable. Swap in the
   * configured public origin (HOLA_AUTHENTIK_PUBLIC_URL). No-op if unset/unparseable.
   */
  private toPublicUrl(link: string): string {
    const pub = this.config.authentikPublicUrl;
    if (!pub) return link;
    try {
      const u = new URL(link);
      const p = new URL(pub);
      u.protocol = p.protocol;
      u.hostname = p.hostname;
      u.port = p.port; // clears the internal :9000 when the public URL has no port
      return u.toString();
    } catch {
      return link;
    }
  }

  /**
   * Ensure a recovery flow exists and is bound to the default brand (so
   * `/recovery/` works). Authentik ships none, so create one when absent.
   * Returns true once a flow exists and is bound, false while the prerequisite
   * default blueprints have not been applied yet (so the caller can retry).
   */
  private async ensureBrandRecoveryFlow(): Promise<boolean> {
    try {
      let flowPk: string | undefined = (await this.api<{ results: Array<{ pk: string }> }>(
        'GET', '/api/v3/flows/instances/?designation=recovery'
      )).results?.[0]?.pk;
      if (!flowPk) flowPk = await this.createRecoveryFlow();
      if (!flowPk) return false; // couldn't find or create one yet — retry later
      // Self-heal: make sure the flow ends by logging the user in. Runs for an
      // existing flow too (found by designation above), so legacy installs whose
      // flow was built with the wrong terminal stage converge without a rebuild.
      await this.ensureRecoveryFlowAutoLogin(flowPk);
      const brands = await this.api<{ results: Array<{ brand_uuid: string; flow_recovery: string | null }> }>(
        'GET', '/api/v3/core/brands/?default=true'
      );
      const brand = brands.results?.[0];
      if (!brand) return false;
      if (brand.flow_recovery !== flowPk) {
        await this.api('PATCH', `/api/v3/core/brands/${brand.brand_uuid}/`, { flow_recovery: flowPk });
        this.logger.info('Bound recovery flow to the default brand', { flowPk });
      }
      return true;
    } catch (error) {
      this.logger.warn('Could not ensure a brand recovery flow', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Create a `recovery`-designation flow, reusing the stages of the shipped
   * `default-password-change` flow (a Prompt + User Write stage) so the recovery
   * link lets the operator set their own password, then appending the built-in
   * Login stage so setting the password ALSO signs them in — otherwise the flow
   * ends unauthenticated and they're bounced to a login screen to re-enter the
   * password they just set. Idempotent by slug. Returns the flow pk, or undefined
   * if the prerequisite `default-password-change` blueprint has not been applied
   * yet (so the caller retries).
   */
  private async createRecoveryFlow(): Promise<string | undefined> {
    const slug = 'hola-recovery';
    const existing = (await this.api<{ results: Array<{ pk: string }> }>(
      'GET', `/api/v3/flows/instances/?slug=${slug}`
    )).results?.[0]?.pk;
    if (existing) return existing;
    // Reuse the password-change flow's stages (prompt for a new password + write it).
    const pwFlowPk = (await this.api<{ results: Array<{ pk: string }> }>(
      'GET', '/api/v3/flows/instances/?slug=default-password-change'
    )).results?.[0]?.pk;
    if (!pwFlowPk) return undefined; // default blueprints not applied yet
    const bindings = (await this.api<{ results: Array<{ stage: string; order: number }> }>(
      'GET', `/api/v3/flows/bindings/?target=${pwFlowPk}`
    )).results ?? [];
    if (!bindings.length) return undefined;
    const flow = await this.api<{ pk: string }>('POST', '/api/v3/flows/instances/', {
      name: 'Hola Recovery',
      slug,
      title: 'Set your password',
      designation: 'recovery',
      authentication: 'require_unauthenticated',
    });
    for (const b of bindings) {
      await this.api('POST', '/api/v3/flows/bindings/', { target: flow.pk, stage: b.stage, order: b.order });
    }
    // The terminal Login stage (so set-password ALSO signs the operator in) is
    // added by ensureRecoveryFlowAutoLogin, which the caller runs for both fresh
    // and pre-existing flows.
    this.logger.info('Created a recovery flow (Authentik ships none)', { flowPk: flow.pk, slug });
    return flow.pk;
  }

  /** Admin-form `component` of a bound stage, identifying its type. */
  private static readonly LOGIN_STAGE_COMPONENT = 'ak-stage-user-login-form';
  /** Stages that must never be in the recovery flow — they re-prompt for credentials. */
  private static readonly STRAY_RECOVERY_STAGE_COMPONENTS = new Set([
    'ak-stage-password-form',
    'ak-stage-identification-form',
  ]);

  /**
   * Ensure a recovery flow ends by logging the user in: the reused Prompt +
   * User Write stages, then a `user_login` stage. Removes any stray credential
   * stages and appends the login stage if missing. Idempotent.
   *
   * This repairs flows built by earlier releases that bound the WRONG terminal
   * stage: `resolveLoginStagePk` used `/api/v3/stages/all/?name__iexact=…`, but
   * that polymorphic endpoint IGNORES the filter and returns every stage, so
   * `results[0]` was whatever sorted first (a password stage) — leaving the
   * operator unauthenticated after set-password and bounced to a login screen.
   */
  private async ensureRecoveryFlowAutoLogin(flowPk: string): Promise<void> {
    const bindings = (await this.api<{
      results: Array<{ pk: string; order: number; stage_obj?: { component?: string } }>;
    }>('GET', `/api/v3/flows/bindings/?target=${flowPk}&ordering=order`)).results ?? [];

    let changed = false;
    // Drop stray credential stages (e.g. the mis-bound password stage).
    for (const b of bindings) {
      if (RealAuthentikProvisionerService.STRAY_RECOVERY_STAGE_COMPONENTS.has(b.stage_obj?.component ?? '')) {
        await this.apiDeleteIgnoreMissing(`/api/v3/flows/bindings/${b.pk}/`);
        changed = true;
      }
    }

    const hasLogin = bindings.some(
      (b) => b.stage_obj?.component === RealAuthentikProvisionerService.LOGIN_STAGE_COMPONENT,
    );
    if (!hasLogin) {
      const loginStagePk = await this.resolveLoginStagePk();
      if (loginStagePk) {
        const keptMaxOrder = bindings
          .filter((b) => !RealAuthentikProvisionerService.STRAY_RECOVERY_STAGE_COMPONENTS.has(b.stage_obj?.component ?? ''))
          .reduce((max, b) => Math.max(max, b.order), -1);
        await this.api('POST', '/api/v3/flows/bindings/', {
          target: flowPk,
          stage: loginStagePk,
          order: keptMaxOrder + 1,
        });
        changed = true;
      } else {
        this.logger.warn('No Login stage found; recovery flow will set the password but not auto-sign-in', { flowPk });
      }
    }

    if (changed) this.logger.info('Repaired recovery flow auto-login bindings', { flowPk });
  }

  /**
   * Resolve the pk of Authentik's built-in Login (`user_login`) stage — the one
   * the default authentication flow ends with, which attaches the pending user
   * to a session.
   *
   * Uses the TYPED `/api/v3/stages/user_login/` endpoint, NOT the polymorphic
   * `/api/v3/stages/all/`: the latter ignores `name__iexact` and returns every
   * stage type, so taking `results[0]` there hands back whatever sorts first
   * (often a password stage). `/stages/user_login/` only ever returns user_login
   * stages, so even the fallback is a valid login stage.
   */
  private async resolveLoginStagePk(): Promise<string | undefined> {
    const stages = (await this.api<{ results: Array<{ pk: string; name?: string }> }>(
      'GET', '/api/v3/stages/user_login/'
    )).results ?? [];
    if (!stages.length) return undefined;
    const preferred = stages.find((s) => (s.name ?? '').toLowerCase() === 'default-authentication-login');
    return (preferred ?? stages[0]).pk;
  }

  /** Add a proxy provider to the embedded outpost; returns the outpost pk. */
  private async addProviderToEmbeddedOutpost(providerPk: number): Promise<number | undefined> {
    const list = await this.api<{
      results: Array<{ pk: number; providers: number[]; config?: Record<string, unknown> }>;
    }>(
      'GET',
      `/api/v3/outposts/instances/?name__iexact=${encodeURIComponent('authentik Embedded Outpost')}`
    );
    const outpost = list.results?.[0];
    if (!outpost) {
      this.logger.warn('Embedded outpost not found; forward-auth will not enforce until bound');
      return undefined;
    }
    const providers = Array.from(new Set([...(outpost.providers ?? []), providerPk]));
    const patch: Record<string, unknown> = { providers };

    // The embedded outpost defaults its browser-facing host to `http://0.0.0.0:9000`
    // (Authentik's internal bind address). That value is unroutable from a user's
    // browser, so every forward-auth app would 302 the OAuth `authorize` redirect to
    // a dead address. Pin the outpost's host to the public Authentik URL so the login
    // redirect resolves. Merge into the existing config (PATCH replaces it wholesale).
    const publicUrl = this.config.authentikPublicUrl;
    if (publicUrl) {
      patch.config = {
        ...(outpost.config ?? {}),
        authentik_host: publicUrl,
        authentik_host_browser: publicUrl,
      };
    } else {
      this.logger.warn(
        'authentikPublicUrl is not set; embedded outpost browser redirects may point at an unroutable host. Set HOLA_AUTHENTIK_PUBLIC_URL.',
      );
    }
    await this.api('PATCH', `/api/v3/outposts/instances/${outpost.pk}/`, patch);
    return outpost.pk;
  }

  private async removeProviderFromOutpost(outpostPk: number, providerPk: number): Promise<void> {
    try {
      const outpost = await this.api<{ providers: number[] }>('GET', `/api/v3/outposts/instances/${outpostPk}/`);
      const providers = (outpost.providers ?? []).filter(p => p !== providerPk);
      await this.api('PATCH', `/api/v3/outposts/instances/${outpostPk}/`, { providers });
    } catch (error) {
      this.logger.warn('Failed to detach provider from outpost; continuing', {
        outpostPk,
        providerPk,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---- native-ldap -------------------------------------------------------

  private async provisionLdap(input: ProvisionInput): Promise<ProvisionResult> {
    const ldap = input.ldap;
    if (!ldap) throw new ProvisioningError('native-ldap requires an ldap config block');

    const username = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}-ldap`);
    const password = randomBytes(24).toString('hex');
    const baseDn = this.config.ldapBaseDn;
    const bindDn = `cn=${username},ou=users,${baseDn}`;

    // Create the bind service account on first provision; reuse it on re-deploy.
    let bindAccountPk = input.existingRef?.mode === 'native-ldap' ? input.existingRef.bindAccountPk : undefined;
    if (bindAccountPk == null) {
      const user = await this.api<{ pk: number }>('POST', '/api/v3/core/users/', {
        username,
        name: `Hola ${input.appName} LDAP bind`,
        type: 'service_account',
        path: 'goauthentik.io/outposts/ldap',
        is_active: true,
      });
      bindAccountPk = user.pk;
      await this.grantLdapSearch(bindAccountPk);
    }
    // (Re)set the bind password and inject it fresh each deploy.
    await this.api('POST', `/api/v3/core/users/${bindAccountPk}/set_password/`, { password });

    this.logger.info('Provisioned LDAP bind account', { deploymentId: input.deploymentId, bindAccountPk });

    return {
      env: {
        [ldap.env.host]: this.config.ldapHost,
        [ldap.env.port]: this.config.ldapPort,
        [ldap.env.bindDn]: bindDn,
        [ldap.env.bindPassword]: password,
        [ldap.env.baseDn]: baseDn,
      },
      ref: { mode: 'native-ldap', bindAccountPk },
    };
  }

  /** Grant the bind account directory-search rights. Best-effort: the permission
   *  codename can vary by Authentik version, so a failure is logged, not fatal. */
  private async grantLdapSearch(userPk: number): Promise<void> {
    try {
      await this.api('POST', `/api/v3/rbac/permissions/assigned_by_users/${userPk}/assign/`, {
        permissions: ['authentik_providers_ldap.search_full_directory'],
      });
    } catch (error) {
      this.logger.warn('Could not assign LDAP search permission (verify codename for your Authentik version)', {
        userPk,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private oidcEnv(
    names: { issuer: string; clientId: string; clientSecret: string; redirectUri?: string } | undefined,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    slug: string
  ): Record<string, string> {
    if (!names) return {};
    return {
      [names.issuer]: this.issuerUrl(slug),
      [names.clientId]: clientId,
      [names.clientSecret]: clientSecret,
      // Only inject the literal redirect URI when the app exposes an env var for it.
      ...(names.redirectUri ? { [names.redirectUri]: redirectUri } : {}),
    };
  }

  /**
   * Resolve a flow pk by slug, falling back to the first flow of `designation`
   * when the default slug differs across Authentik versions (e.g. the provider
   * invalidation flow slug changed). `designation` is one of authentik's flow
   * designations, e.g. `authorization` or `invalidation`.
   */
  private async resolveFlowPk(slug: string, designation: string): Promise<string> {
    try {
      const flow = await this.api<{ pk: string }>('GET', `/api/v3/flows/instances/${encodeURIComponent(slug)}/`);
      return flow.pk;
    } catch (error) {
      const list = await this.api<{ results: Array<{ pk: string }> }>(
        'GET',
        `/api/v3/flows/instances/?designation=${encodeURIComponent(designation)}&ordering=slug`
      );
      if (list.results?.[0]?.pk) return list.results[0].pk;
      throw error;
    }
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

  // ---- scoped-token bootstrap -------------------------------------------

  /**
   * Resolve the Bearer token for API calls. If a scoped token is configured, use
   * it directly. Otherwise self-bootstrap a least-privilege service-account token
   * from the admin bootstrap token (once per process, memoized) so day-to-day
   * provisioning never runs as the superuser.
   */
  private async getApiToken(): Promise<string> {
    if (this.config.authentikApiToken) return this.config.authentikApiToken;
    if (this.config.authentikBootstrapToken) {
      this.scopedTokenPromise ??= this.bootstrapScopedToken(this.config.authentikBootstrapToken).catch(err => {
        // Don't cache a failed bootstrap — allow a later call to retry.
        this.scopedTokenPromise = undefined;
        throw err;
      });
      return this.scopedTokenPromise;
    }
    throw new ProvisioningError('no Authentik token configured (set HOLA_AUTHENTIK_API_TOKEN or HOLA_AUTHENTIK_BOOTSTRAP_TOKEN)');
  }
  private scopedTokenPromise?: Promise<string>;

  /** Idempotently ensure the provisioner service account + perms + API token. */
  private async bootstrapScopedToken(bootstrapToken: string): Promise<string> {
    const userPk = await this.ensureProvisionerUser(bootstrapToken);
    await this.request(bootstrapToken, 'POST', `/api/v3/rbac/permissions/assigned_by_users/${userPk}/assign/`, {
      permissions: PROVISIONER_PERMISSIONS,
    });
    const key = await this.ensureProvisionerToken(bootstrapToken, userPk);
    this.logger.info('Bootstrapped scoped provisioning token', { userPk });
    return key;
  }

  private async ensureProvisionerUser(bootstrapToken: string): Promise<number> {
    const existing = await this.request<{ results: Array<{ pk: number }> }>(
      bootstrapToken,
      'GET',
      `/api/v3/core/users/?username=${encodeURIComponent(PROVISIONER_USERNAME)}`
    );
    if (existing.results?.[0]?.pk != null) return existing.results[0].pk;
    const created = await this.request<{ user_pk: number }>(bootstrapToken, 'POST', '/api/v3/core/users/service_account/', {
      name: PROVISIONER_USERNAME,
      create_group: false,
    });
    return created.user_pk;
  }

  private async ensureProvisionerToken(bootstrapToken: string, userPk: number): Promise<string> {
    // The service_account endpoint's token isn't API-usable (wrong intent), so we
    // mint an explicit intent=api, non-expiring token and read its key back.
    const viewKey = `/api/v3/core/tokens/${encodeURIComponent(PROVISIONER_TOKEN_ID)}/view_key/`;
    try {
      const existing = await this.request<{ key: string }>(bootstrapToken, 'GET', viewKey);
      if (existing.key) return existing.key;
    } catch (error) {
      const status = error instanceof ProvisioningError ? (error.details as { status?: number })?.status : undefined;
      if (status !== 404) throw error;
    }
    await this.request(bootstrapToken, 'POST', '/api/v3/core/tokens/', {
      identifier: PROVISIONER_TOKEN_ID,
      user: userPk,
      intent: 'api',
      expiring: false,
    });
    const minted = await this.request<{ key: string }>(bootstrapToken, 'GET', viewKey);
    return minted.key;
  }

  // ---- HTTP --------------------------------------------------------------

  private async api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return this.request<T>(await this.getApiToken(), method, path, body);
  }

  private async request<T = unknown>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    if (!this.config.authentikUrl) throw new ProvisioningError('HOLA_AUTHENTIK_URL is not configured');

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
    try {
      const res = await fetch(`${this.config.authentikUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
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
      const issuer = `https://auth.mock/application/o/${slug}/`;
      const names = input.oidc.env;
      const env = names
        ? {
            [names.issuer]: issuer,
            [names.clientId]: clientId,
            [names.clientSecret]: clientSecret,
            ...(names.redirectUri ? { [names.redirectUri]: redirectUri } : {}),
          }
        : {};
      return {
        env,
        credentials: { clientId, clientSecret, issuer, redirectUri },
        ref: input.existingRef ?? { mode: 'native-oidc', providerPk: 1, applicationSlug: slug, clientId },
      };
    }
    if (input.mode === 'forward-auth') {
      const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);
      return {
        env: {},
        ref: input.existingRef ?? { mode: 'forward-auth', providerPk: 2, applicationSlug: slug, outpostPk: 1 },
        middleware: { name: `ak-${slug}`, outpostUrl: 'http://authentik-server:9000' },
      };
    }
    if (input.mode === 'native-ldap' && input.ldap) {
      const username = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}-ldap`);
      const e = input.ldap.env;
      return {
        env: {
          [e.host]: 'authentik-ldap',
          [e.port]: '3389',
          [e.bindDn]: `cn=${username},ou=users,dc=hola,dc=internal`,
          [e.bindPassword]: `mock-ldap-pw-${input.deploymentId.slice(0, 8)}`,
          [e.baseDn]: 'dc=hola,dc=internal',
        },
        ref: input.existingRef ?? { mode: 'native-ldap', bindAccountPk: 3 },
      };
    }
    // none / unimplemented modes: no-op so a deploy proceeds without auth wiring.
    return { env: {}, ref: { mode: input.mode } };
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    this.logger.debug('Mock deprovision', { deploymentId: input.deploymentId, mode: input.ref?.mode });
  }

  async provisionPlatformOidc(input: PlatformOidcInput): Promise<PlatformOidcResult> {
    const clientId = 'mock-dashboard-client';
    return {
      issuer: `https://auth.mock/application/o/${DASHBOARD_SLUG}/`,
      clientId,
      redirectUri: `https://${input.host}${input.redirectPath}`,
      audience: clientId,
    };
  }

  async ensureAdminGroup(name: string): Promise<void> {
    this.logger.debug('Mock ensureAdminGroup', { name });
  }

  async ensureBootstrapAdmin(adminGroup: string): Promise<{ created: boolean; recoveryLink?: string }> {
    this.logger.debug('Mock ensureBootstrapAdmin', { adminGroup });
    return { created: false };
  }
}
