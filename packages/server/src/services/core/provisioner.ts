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
import { DEFAULT_ADMIN_GROUP } from '../../config/oidc';
import type { AuthMode, ProvisionedAuthRef, ForwardAuthMiddleware } from '@hola/shared';
import { APP_HOST_TOKEN } from '@hola/shared/compose-validate';
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
     *  no env var for the literal callback. `authUrl`/`tokenUrl`/`userinfoUrl` are
     *  for apps that need the IdP's explicit endpoints instead of discovery. */
    env?: {
      issuer: string;
      clientId: string;
      clientSecret: string;
      redirectUri?: string;
      authUrl?: string;
      tokenUrl?: string;
      userinfoUrl?: string;
    };
    /** Literal env injected only when OIDC is provisioned (enable flag, button label). */
    staticEnv?: Record<string, string>;
    /** Extra redirect URIs (beyond redirectPath) to register on the client. May
     *  contain the ${HOLA_APP_HOST} token or a non-http scheme (mobile callback). */
    extraRedirectUris?: string[];
    /** Admin-by-group via a scalar role claim (e.g. Immich's `immich_role`). The
     *  provisioner emits `claim`=`adminValue` for `adminGroup` members else
     *  `memberValue`, riding on `scope` (default `profile`). */
    roleClaim?: { claim: string; adminGroup?: string; adminValue?: string; memberValue?: string; scope?: string };
  };
  ldap?: {
    env: { host: string; port: string; bindDn: string; bindPassword: string; baseDn: string };
  };
  forwardAuth?: { allowedGroups?: string[]; bypassPaths?: string[] };
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
   * Synchronously assert this backend CAN provision `mode` for `appName`, with no
   * side effects. Lets the deploy path preflight an app's declared auth requirement
   * BEFORE any deployment record/job is created, so a mode that needs a backend
   * which isn't configured (e.g. `forward-auth` under `HOLA_AUTH_MODE=none`) is
   * rejected up front with a clear, actionable error — instead of tombstoning a
   * deployment in `error` state when provisioning throws inside the deploy job.
   * Backends with a real auth provider support every mode (no-op); the None
   * backend throws for the modes that need a backend.
   */
  assertCanProvisionAuthMode(mode: AuthMode, appName: string): void;
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
  // Create/update a custom OAuth2 scope mapping for admin-by-group role claims
  // (e.g. Immich's immich_role). view_scopemapping is the typed-endpoint read perm.
  'authentik_providers_oauth2.add_scopemapping',
  'authentik_providers_oauth2.change_scopemapping',
  'authentik_providers_oauth2.view_scopemapping',
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
  // Read certificate-keypairs to pick a signing key for the dashboard and per-app
  // OIDC clients (RS256 id_tokens + a populated JWKS).
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

/**
 * Build the Authentik `redirect_uris` list: the primary URI (from redirectPath)
 * plus any manifest-declared extras, with the `${HOLA_APP_HOST}` token expanded
 * to the app's public host. Extras may be full https URLs or a non-http scheme
 * (e.g. a mobile callback `app.immich:///oauth-callback`). De-duplicated; all
 * registered with strict matching. A manifest with no extras yields exactly the
 * single strict URI Hola has always emitted.
 */
function buildRedirectUris(
  host: string,
  primary: string,
  extras?: string[]
): Array<{ matching_mode: 'strict'; url: string }> {
  const urls = [primary, ...(extras ?? []).map(u => u.replaceAll(APP_HOST_TOKEN, host))];
  const seen = new Set<string>();
  const deduped = urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
  return deduped.map(url => ({ matching_mode: 'strict', url }));
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

  assertCanProvisionAuthMode(mode: AuthMode, appName: string): void {
    // Authentik backs every supported mode.
    void mode;
    void appName;
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
    const redirectUris = buildRedirectUris(input.host, redirectUri, oidc.extraRedirectUris);
    const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);

    // Idempotent re-provision: reuse the existing client, refresh its redirect URIs.
    const existing = input.existingRef;
    if (existing && existing.mode === 'native-oidc' && existing.providerPk != null) {
      const provider = await this.api<AuthentikOAuth2Provider>('GET', `/api/v3/providers/oauth2/${existing.providerPk}/`);
      const reuseSlug = existing.applicationSlug ?? slug;
      // Self-heal on every redeploy: re-resolve the standard scope mappings and the
      // role-claim mapping and (re)attach them. An app first provisioned during a
      // transient scope-listing failure (empty property_mappings) would otherwise
      // stay permanently degraded — the dashboard path already self-heals this way.
      // Union with what's already attached so a transient re-failure can't wipe a
      // provider's mappings, and mappings we don't manage aren't dropped.
      const [scopePks, roleClaimPk, signingKey] = await Promise.all([
        this.resolveScopeMappingPks(oidc.scopes),
        this.ensureRoleClaimMapping(oidc.roleClaim, reuseSlug, oidc.scopes),
        this.resolveSigningKeyPk(),
      ]);
      const desired = new Set<string>([...(provider.property_mappings ?? []), ...scopePks]);
      if (roleClaimPk) desired.add(roleClaimPk);
      // (Re)attach an asymmetric signing key so ID tokens are RS256-signed and the
      // provider publishes a populated JWKS — a client first provisioned before this
      // fix (or during a transient crypto-listing failure) would otherwise stay on
      // Authentik's HS256 default with an empty JWKS, which breaks JWKS-verifying
      // OIDC clients (authlib et al.) at id_token validation.
      await this.api('PATCH', `/api/v3/providers/oauth2/${existing.providerPk}/`, {
        redirect_uris: redirectUris,
        property_mappings: [...desired],
        ...(signingKey ? { signing_key: signingKey } : {}),
      });
      this.logger.info('Reused existing OIDC client', { deploymentId: input.deploymentId, providerPk: existing.providerPk });
      return {
        env: this.oidcEnv(oidc, provider.client_id, provider.client_secret, redirectUri, reuseSlug),
        credentials: { clientId: provider.client_id, clientSecret: provider.client_secret, issuer: this.issuerUrl(reuseSlug), redirectUri },
        ref: existing,
      };
    }

    // Fresh provision: pre-generate credentials so injection needs no read-back.
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('hex');

    const [authFlow, invalidationFlow, propertyMappings, roleClaimPk, signingKey] = await Promise.all([
      this.resolveFlowPk(AUTHZ_FLOW_SLUG, 'authorization'),
      this.resolveFlowPk(INVALIDATION_FLOW_SLUG, 'invalidation'),
      this.resolveScopeMappingPks(oidc.scopes),
      this.ensureRoleClaimMapping(oidc.roleClaim, slug, oidc.scopes),
      this.resolveSigningKeyPk(),
    ]);
    // Attach the admin-by-group role claim alongside the standard scope mappings.
    const allMappings = roleClaimPk ? [...propertyMappings, roleClaimPk] : propertyMappings;

    // Attach an asymmetric signing key so ID tokens are RS256-signed and the provider
    // publishes a populated JWKS. Without it Authentik defaults to HS256 with an empty
    // JWKS, and standards-compliant OIDC clients that verify the id_token via JWKS
    // (e.g. authlib — Hangar) fail with `KeyError: 'keys'`. Mirrors the dashboard path.
    const provider = await this.api<AuthentikOAuth2Provider>('POST', '/api/v3/providers/oauth2/', {
      name: `hola-${input.appName}-${input.deploymentId.slice(0, 8)}`,
      authorization_flow: authFlow,
      invalidation_flow: invalidationFlow,
      client_type: 'confidential',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: redirectUris,
      property_mappings: allMappings,
      sub_mode: 'hashed_user_id',
      ...(signingKey ? { signing_key: signingKey } : {}),
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
      env: this.oidcEnv(oidc, clientId, clientSecret, redirectUri, slug),
      credentials: { clientId, clientSecret, issuer: this.issuerUrl(slug), redirectUri },
      ref: { mode: 'native-oidc', providerPk: provider.pk, applicationSlug: slug, clientId },
    };
  }

  private issuerUrl(slug: string): string {
    return `${this.oauthBase()}/application/o/${slug}/`;
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
      this.logger.warn('Could not resolve a signing key for the OIDC client; id_tokens may fall back to HS256 with an empty JWKS', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  // ---- forward-auth ------------------------------------------------------

  private forwardAuthMiddleware(slug: string, bypassPaths?: string[]): ForwardAuthMiddleware {
    return {
      name: `ak-${slug}`,
      outpostUrl: this.config.authentikUrl ?? '',
      ...(bypassPaths && bypassPaths.length > 0 ? { bypassPaths } : {}),
    };
  }

  private async provisionForwardAuth(input: ProvisionInput): Promise<ProvisionResult> {
    const externalHost = `https://${input.host}`;
    const slug = slugify(`hola-${input.appName}-${input.deploymentId.slice(0, 8)}`);

    // Idempotent re-provision: reuse the existing proxy provider, refresh its host.
    const existing = input.existingRef;
    if (existing && existing.mode === 'forward-auth' && existing.providerPk != null) {
      // Always resend `mode`: Authentik's ProxyProvider serializer validates the
      // payload against `attrs.get("mode", ProxyMode.PROXY)`, so a partial update
      // that omits `mode` is validated as PROXY mode — which then rejects the
      // (correctly empty) `internal_host` of a forward-auth provider with HTTP 400.
      // Sending `forward_single` (matching the create call) makes the update
      // validate in forward-auth mode. Without this, every restart of a
      // forward-auth app fails in provisionAuth before the container is recreated,
      // leaving the deployment stuck in `error`.
      await this.api('PATCH', `/api/v3/providers/proxy/${existing.providerPk}/`, {
        mode: 'forward_single',
        external_host: externalHost,
      });
      const reuseSlug = existing.applicationSlug ?? slug;
      // Re-reconcile the group restriction so it tracks manifest changes across redeploys.
      await this.reconcileForwardAuthGroups(reuseSlug, input.forwardAuth?.allowedGroups ?? []);
      this.logger.info('Reused existing forward-auth provider', { deploymentId: input.deploymentId, providerPk: existing.providerPk });
      return { env: {}, ref: existing, middleware: this.forwardAuthMiddleware(reuseSlug, input.forwardAuth?.bypassPaths) };
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

    let applicationPk: string;
    try {
      const app = await this.api<{ pk: string }>('POST', '/api/v3/core/applications/', {
        name: `${input.appName} (${input.deploymentId.slice(0, 8)})`,
        slug,
        provider: provider.pk,
        meta_launch_url: externalHost,
      });
      applicationPk = app.pk;
    } catch (error) {
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/proxy/${provider.pk}/`);
      throw new ProvisioningError('failed to create Authentik application', error);
    }

    // Bind the provider to the embedded outpost so it actually enforces auth.
    const outpostPk = await this.addProviderToEmbeddedOutpost(provider.pk);

    // Restrict access to the declared groups (if any). Fail closed: if the
    // restriction can't be applied, tear the app down rather than ship it open
    // to every authenticated user.
    try {
      await this.reconcileForwardAuthGroups(slug, input.forwardAuth?.allowedGroups ?? [], applicationPk);
    } catch (error) {
      if (outpostPk != null) await this.removeProviderFromOutpost(outpostPk, provider.pk);
      await this.apiDeleteIgnoreMissing(`/api/v3/core/applications/${encodeURIComponent(slug)}/`);
      await this.apiDeleteIgnoreMissing(`/api/v3/providers/proxy/${provider.pk}/`);
      throw new ProvisioningError('failed to apply forward-auth group restriction', error);
    }

    this.logger.info('Provisioned forward-auth provider', { deploymentId: input.deploymentId, providerPk: provider.pk, slug, outpostPk });

    return {
      env: {},
      ref: { mode: 'forward-auth', providerPk: provider.pk, applicationSlug: slug, outpostPk },
      middleware: this.forwardAuthMiddleware(slug, input.forwardAuth?.bypassPaths),
    };
  }

  /**
   * Reconcile an app's Authentik access policy to exactly the declared groups.
   * Hola owns these per-app applications, so it manages all group bindings on
   * them: missing groups are bound, groups no longer declared are unbound, and
   * an empty list leaves the app open to any authenticated user (the default).
   * Named groups are created if absent (empty), which fails closed until an
   * operator populates them.
   */
  private async reconcileForwardAuthGroups(
    slug: string,
    groupNames: string[],
    applicationPk?: string,
  ): Promise<void> {
    const names = groupNames.map((g) => g.trim()).filter(Boolean);
    // No group restriction declared → nothing to reconcile; leave the app open to
    // any authenticated user (the documented default). Return BEFORE querying
    // existing bindings. This matters on the reuse path (restart/redeploy), which
    // calls us WITHOUT an applicationPk: the binding lookup is
    // `GET /api/v3/policies/bindings/`, which the least-privilege scoped provisioner
    // token cannot read (403) — so the old `&& applicationPk` guard let a no-groups
    // RESTART of a forward-auth app fail in provisionAuth (install worked because the
    // create path passes applicationPk and returned here). Skipping the lookup when
    // there are no desired groups also can't drop a real restriction: a forward-auth
    // app that previously had groups and now declares none would simply stay on its
    // (more-restrictive) bindings — fail-safe, not access-widening.
    if (names.length === 0) return;

    const appPk =
      applicationPk ??
      (await this.api<{ pk: string }>('GET', `/api/v3/core/applications/${encodeURIComponent(slug)}/`)).pk;

    const desired = new Set<string>();
    for (const name of names) desired.add(await this.findOrCreateGroupPk(name));

    // Existing group-type bindings on this application (ignore policy/user bindings).
    const bindings =
      (await this.api<{ results: Array<{ pk: string; group: string | null }> }>(
        'GET',
        `/api/v3/policies/bindings/?target=${encodeURIComponent(appPk)}`,
      )).results ?? [];
    const boundGroups = new Map<string, string>(); // groupPk -> bindingPk
    for (const b of bindings) if (b.group) boundGroups.set(b.group, b.pk);

    let order = bindings.length;
    for (const groupPk of desired) {
      if (!boundGroups.has(groupPk)) {
        await this.api('POST', '/api/v3/policies/bindings/', {
          target: appPk,
          group: groupPk,
          order: order++,
          enabled: true,
        });
      }
    }
    for (const [groupPk, bindingPk] of boundGroups) {
      if (!desired.has(groupPk)) {
        await this.apiDeleteIgnoreMissing(`/api/v3/policies/bindings/${bindingPk}/`);
      }
    }

    if (desired.size > 0) {
      this.logger.info('Applied forward-auth group restriction', { slug, groups: names });
    }
  }

  /** Find a group by exact name, creating it (empty) if absent; returns its pk. */
  private async findOrCreateGroupPk(name: string): Promise<string> {
    const found = await this.api<{ results: Array<{ pk: string }> }>(
      'GET',
      `/api/v3/core/groups/?name=${encodeURIComponent(name)}`,
    );
    const existing = found.results?.[0];
    if (existing) return existing.pk;
    const created = await this.api<{ pk: string }>('POST', '/api/v3/core/groups/', { name });
    this.logger.info('Created Authentik group for forward-auth restriction', { name, pk: created.pk });
    return created.pk;
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
   * Reads the polymorphic `/api/v3/stages/all/` endpoint and filters CLIENT-SIDE
   * by the user_login `component`. Two pitfalls this avoids:
   *  - `/stages/all/` IGNORES `?name__iexact=…` and returns every stage type, so
   *    `results[0]` is whatever sorts first (often a password stage) — never
   *    trust the server-side name filter here.
   *  - The TYPED `/api/v3/stages/user_login/` endpoint would be cleaner, but the
   *    least-privilege scoped provisioning token gets 403 on it; `/stages/all/`
   *    is readable with the token (it's what the rest of provisioning uses).
   * Each listed stage carries its admin `component`, so match `ak-stage-user-login-form`
   * and prefer the one named `default-authentication-login`.
   */
  private async resolveLoginStagePk(): Promise<string | undefined> {
    const all = (await this.api<{ results: Array<{ pk: string; name?: string; component?: string }> }>(
      'GET', '/api/v3/stages/all/'
    )).results ?? [];
    const logins = all.filter((s) => s.component === RealAuthentikProvisionerService.LOGIN_STAGE_COMPONENT);
    if (!logins.length) return undefined;
    const preferred = logins.find((s) => (s.name ?? '').toLowerCase() === 'default-authentication-login');
    return (preferred ?? logins[0]).pk;
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
    oidc: ProvisionInput['oidc'],
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    slug: string
  ): Record<string, string> {
    const out: Record<string, string> = {};
    const names = oidc?.env;
    if (names) {
      out[names.issuer] = this.issuerUrl(slug);
      out[names.clientId] = clientId;
      out[names.clientSecret] = clientSecret;
      // Only inject the literal redirect URI when the app exposes an env var for it.
      if (names.redirectUri) out[names.redirectUri] = redirectUri;
      // Explicit IdP endpoints for apps that don't discover from the issuer.
      // These are Authentik's global OIDC endpoints (not per-application).
      const base = this.oauthBase();
      if (names.authUrl) out[names.authUrl] = `${base}/application/o/authorize/`;
      if (names.tokenUrl) out[names.tokenUrl] = `${base}/application/o/token/`;
      if (names.userinfoUrl) out[names.userinfoUrl] = `${base}/application/o/userinfo/`;
    }
    // Literal env to set only when OIDC is provisioned (enable flag, button label).
    if (oidc?.staticEnv) Object.assign(out, oidc.staticEnv);
    return out;
  }

  /** Public Authentik base URL for building OIDC endpoint URLs. */
  private oauthBase(): string {
    return this.config.authentikPublicUrl || this.config.authentikUrl || '';
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

  /**
   * Resolve scope-mapping pks for the requested scope names so the provisioned
   * OIDC provider releases the standard `openid`/`profile`/`email` claims.
   *
   * Reads the polymorphic `/api/v3/propertymappings/all/` endpoint and filters
   * CLIENT-SIDE — the TYPED `/api/v3/propertymappings/provider/scope/` endpoint
   * needs the `authentik_providers_oauth2.view_scopemapping` model permission the
   * least-privilege scoped token is denied (403), so providers ended up with no
   * scope mappings and degraded SSO (issue #144). The polymorphic endpoint only
   * needs the generic `authentik_core.view_propertymapping` the token already
   * holds — the same pattern resolveLoginStagePk() uses for the login stage.
   *
   * Matches each scope by its stable `managed` identifier (Authentik's default
   * scope mappings are `goauthentik.io/providers/oauth2/scope-<scope>`) or, when
   * the serializer exposes it, by `scope_name`. Best-effort: a list failure logs
   * and returns nothing rather than aborting the whole provision.
   */
  private async resolveScopeMappingPks(scopes: string[]): Promise<string[]> {
    type ScopeMapping = { pk: string; managed?: string | null; scope_name?: string };
    let mappings: ScopeMapping[];
    try {
      mappings = (await this.api<{ results: ScopeMapping[] }>('GET', '/api/v3/propertymappings/all/')).results ?? [];
    } catch (error) {
      this.logger.warn('Could not list OIDC scope mappings; provider will have none', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
    const pks: string[] = [];
    for (const scope of scopes) {
      const managed = `goauthentik.io/providers/oauth2/scope-${scope}`;
      const match = mappings.find((m) => m.scope_name === scope || m.managed === managed);
      if (match) pks.push(match.pk);
      else this.logger.warn('No OIDC scope mapping found for scope; continuing', { scope });
    }
    return pks;
  }

  /**
   * Ensure an Authentik scope mapping that emits an app's admin-by-group role
   * claim (e.g. Immich's `immich_role` = "admin"/"user"), and return its pk to
   * attach to the provider. The mapping must ride on a scope the client actually
   * requests — Authentik intersects requested∩configured scopes, so a claim on an
   * unrequested scope is silently dropped. So the default scope is chosen from the
   * app's own requested scopes (preferring `profile`/`email`) rather than a fixed
   * `profile` the app may not request.
   *
   * Idempotent via a stable `managed` key (queried on the polymorphic endpoint the
   * scoped token can read; written via the typed scope endpoint). Best-effort: a
   * failure logs and returns undefined rather than aborting the deploy — the app
   * then needs a manual admin promotion, surfaced in logs.
   */
  /**
   * Pick a scope the client actually requests to carry the admin-by-group role
   * claim. Authentik only emits a scope's mappings when the client asks for that
   * scope, so the claim must ride on a requested scope. Prefer profile/email;
   * otherwise any requested non-openid scope; else openid (or profile if the list
   * is somehow empty).
   */
  private defaultRoleClaimScope(requestedScopes: string[]): string {
    for (const preferred of ['profile', 'email']) {
      if (requestedScopes.includes(preferred)) return preferred;
    }
    return requestedScopes.find((s) => s !== 'openid') ?? requestedScopes[0] ?? 'profile';
  }

  private async ensureRoleClaimMapping(
    roleClaim: NonNullable<ProvisionInput['oidc']>['roleClaim'],
    slug: string,
    requestedScopes: string[]
  ): Promise<string | undefined> {
    if (!roleClaim) return undefined;
    const claim = roleClaim.claim;
    const adminGroup = roleClaim.adminGroup ?? DEFAULT_ADMIN_GROUP;
    const adminValue = roleClaim.adminValue ?? 'admin';
    const memberValue = roleClaim.memberValue ?? 'user';
    const scopeName = roleClaim.scope ?? this.defaultRoleClaimScope(requestedScopes);
    const managed = `goauthentik.io/hola/${slug}-roleclaim`;
    // JSON.stringify yields double-quoted literals that are also valid Python strings.
    const expression =
      `return {${JSON.stringify(claim)}: ${JSON.stringify(adminValue)} ` +
      `if ak_is_group_member(request.user, name=${JSON.stringify(adminGroup)}) ` +
      `else ${JSON.stringify(memberValue)}}`;
    const body = {
      name: `hola ${claim} (${slug})`,
      scope_name: scopeName,
      description: 'Hola: role claim derived from group membership',
      expression,
      managed,
    };
    try {
      const found = await this.api<{ results: Array<{ pk: string }> }>(
        'GET',
        `/api/v3/propertymappings/all/?managed=${encodeURIComponent(managed)}`
      );
      const existing = found.results?.[0];
      if (existing) {
        await this.api('PATCH', `/api/v3/propertymappings/provider/scope/${existing.pk}/`, body);
        return existing.pk;
      }
      const created = await this.api<{ pk: string }>('POST', '/api/v3/propertymappings/provider/scope/', body);
      return created.pk;
    } catch (error) {
      this.logger.warn('Could not ensure role-claim mapping; app may need a manual admin promotion', {
        slug,
        claim,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
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
  property_mappings?: string[];
}

// ---------------------------------------------------------------------------
// Mock backend — no network. Used in test/dev and when HOLA_AUTH_MODE=none.
// ---------------------------------------------------------------------------

export class MockProvisionerService implements ProvisionerService {
  private logger = getLogger().child({ service: 'MockProvisionerService' });

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  assertCanProvisionAuthMode(mode: AuthMode, appName: string): void {
    // Mock backend (test/dev) accepts every mode.
    void mode;
    void appName;
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

// ---------------------------------------------------------------------------
// None backend — a real no-op used in PRODUCTION when HOLA_AUTH_MODE != authentik.
// ---------------------------------------------------------------------------

/**
 * Auth modes that cannot run without a real auth backend: a `forward-auth` route
 * would be gated by a non-existent outpost and a `native-ldap` app would have no
 * bind account. The None backend refuses these.
 */
const MODES_REQUIRING_BACKEND: ReadonlySet<AuthMode> = new Set(['forward-auth', 'native-ldap']);

/**
 * Single source of truth for the None backend's "this mode needs a backend"
 * rejection, used both as an up-front preflight (`assertCanProvisionAuthMode`,
 * before any deployment state exists) and at provision time (defense in depth).
 * Throws the same actionable error so the wording never diverges.
 */
function assertModeRunnableWithoutBackend(mode: AuthMode, appName: string): void {
  if (MODES_REQUIRING_BACKEND.has(mode)) {
    throw new ProvisioningError(
      `App "${appName}" requires auth mode "${mode}", which needs an auth backend. Set HOLA_AUTH_MODE=authentik to install it.`
    );
  }
}

/**
 * No-op provisioner for production deployments without an auth backend
 * (`HOLA_AUTH_MODE != authentik`). Issue #110: the Mock provisioner is for
 * test/dev and injects *fake* OIDC creds / a dead forward-auth middleware, which
 * is wrong on a real host — it gave native-oidc apps junk `auth.mock` values and
 * pointed forward-auth apps at a non-existent outpost.
 *
 * Instead this injects NOTHING for modes that can safely run without SSO, and
 * REFUSES the ones that can't:
 *  - `native-oidc` / `none`: no-op — the app keeps its own login.
 *  - `forward-auth` / `native-ldap`: throw — a forward-auth route would be gated
 *    by a dead outpost (unreachable) and an LDAP app would have no bind account,
 *    so fail the deploy loudly with an actionable error rather than ship a broken
 *    app. The operator must enable Authentik for these.
 */
export class NoneProvisionerService implements ProvisionerService {
  private logger = getLogger().child({ service: 'NoneProvisionerService' });

  async healthCheck(): Promise<ServiceHealth> {
    return { healthy: true, lastCheck: new Date() };
  }

  assertCanProvisionAuthMode(mode: AuthMode, appName: string): void {
    assertModeRunnableWithoutBackend(mode, appName);
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    // Defense in depth: callers should preflight via assertCanProvisionAuthMode,
    // but never start a stack we can't actually gate.
    assertModeRunnableWithoutBackend(input.mode, input.appName);
    if (input.mode === 'native-oidc') {
      this.logger.info('No auth backend; skipping native-oidc provisioning — app keeps its own login', {
        deploymentId: input.deploymentId,
        appName: input.appName,
      });
    }
    return { env: {}, ref: { mode: input.mode } };
  }

  async deprovision(input: DeprovisionInput): Promise<void> {
    // Nothing was ever provisioned.
    this.logger.debug('No-op deprovision', { deploymentId: input.deploymentId, mode: input.ref?.mode });
  }

  async provisionPlatformOidc(): Promise<PlatformOidcResult> {
    // Never reached in production: initializePlatformAuth() bails when mode != authentik.
    throw new ProvisioningError('Dashboard OIDC requires HOLA_AUTH_MODE=authentik');
  }

  async ensureAdminGroup(): Promise<void> {
    // No auth backend to hold a group.
  }

  async ensureBootstrapAdmin(): Promise<{ created: boolean; recoveryLink?: string }> {
    return { created: false };
  }
}
