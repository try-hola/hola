/**
 * Opt-in private Tailscale ingress (spec 010): shared types, the pure input
 * validator and the pure operator guidance builder.
 *
 * Everything here is side-effect free so the server (which enforces it), the
 * CLI and the dashboard (which render it) cannot drift. The joining credential
 * is handled ONLY as a transient input value: no message produced here ever
 * contains it.
 */

/** Service name of the platform-injected companion container. Reserved. */
export const TAILSCALE_SERVICE = 'hola-tailscale';
/** Internal network containing only the companion and the chosen backend. Reserved. */
export const TAILSCALE_BACKEND_NETWORK = 'hola-ts-backend';
/** Outbound network for the companion's coordination/relay traffic. Reserved. */
export const TAILSCALE_EGRESS_NETWORK = 'hola-ts-egress';
/** Named volume holding the tailnet identity. Reserved. */
export const TAILSCALE_STATE_VOLUME = 'hola-ts-state';
export const DEFAULT_TAILSCALE_TAG = 'tag:hola-ingress';
export const DEFAULT_TAILSCALE_LISTEN_PORT = 443;

/** Platform services that can never be a forwarding backend. */
const PLATFORM_SERVICES: ReadonlySet<string> = new Set([TAILSCALE_SERVICE, 'hola-docker-proxy']);

const SERVICE_NAME_RE = /^svc:[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TAG_RE = /^tag:[a-zA-Z][a-zA-Z0-9-]*$/;
const CREDENTIAL_RE = /^tskey-(auth|client)-[A-Za-z0-9_-]+$/;

export type TailscaleIngressMode = 'https' | 'tcp';

export interface TailscaleIngressApplied {
  serviceName: string;
  mode: TailscaleIngressMode;
  listenPort: number;
  backendPort: number;
}

/** Persisted on the deployment record. Never contains the credential. */
export interface TailscaleIngressSetting {
  enabled: boolean;
  serviceName: string;
  tag: string;
  backend: { service: string; port: number };
  mode: TailscaleIngressMode;
  listenPort: number;
  forwardAuthAcknowledged: boolean;
  nodeName: string;
  applied?: TailscaleIngressApplied;
  enrolledAt?: string;
  removalPending?: boolean;
  updatedAt: string;
}

/** Summary exposed on the deployment detail read. */
export interface TailscaleIngressSummary {
  enabled: boolean;
  serviceName: string;
}

export type TailscaleIngressState =
  | 'off'
  | 'starting'
  | 'needs-sign-in'
  | 'waiting-for-approval'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface TailscaleIngressStatus {
  state: TailscaleIngressState;
  message: string;
  action?: string;
  dnsName?: string;
  addresses?: string[];
  port?: number;
  nodeName?: string;
  observedAt: string;
}

export interface TailscaleIngressGuidanceStep {
  title: string;
  detail: string;
  snippet?: string;
}

export interface TailscaleIngressGuidance {
  prerequisites: string[];
  steps: TailscaleIngressGuidanceStep[];
  exampleGrant: string;
  exampleAutoApprover: string;
  notes: string[];
}

export interface TailscaleIngressDefaults {
  /** `port` is null when the active release declares no port to default to. */
  backend: { service: string; port: number | null };
  services: string[];
  tag: string;
  mode: TailscaleIngressMode;
  listenPort: number;
  requiresForwardAuthAcknowledgement: boolean;
}

export interface TailscaleRemovalReport {
  nodeName: string;
  signedOut: boolean | null;
  message: string;
}

export interface GetTailscaleIngressResponse {
  setting: TailscaleIngressSetting | null;
  credentialHeld: boolean;
  defaults: TailscaleIngressDefaults;
  status: TailscaleIngressStatus;
  guidance: TailscaleIngressGuidance;
}

export interface SetTailscaleIngressRequest {
  serviceName: string;
  tag: string;
  backend?: { service?: string; port?: number };
  mode?: TailscaleIngressMode;
  listenPort?: number;
  acknowledgeForwardAuthBypass?: boolean;
  authKey?: string;
}

export interface SetTailscaleIngressResponse {
  ok: true;
  jobId?: string;
  setting: TailscaleIngressSetting;
  credentialHeld: boolean;
  warnings?: string[];
}

export interface DisableTailscaleIngressResponse {
  ok: true;
  jobId?: string;
  removal?: TailscaleRemovalReport;
}

export type TailscaleIngressErrorCode =
  | 'INVALID_TAILSCALE_INGRESS'
  | 'TAILSCALE_BACKEND_UNKNOWN'
  | 'TAILSCALE_BACKEND_UNSUPPORTED'
  | 'TAILSCALE_FORWARD_AUTH_ACK_REQUIRED'
  | 'TAILSCALE_CREDENTIAL_REQUIRED';

export interface TailscaleIngressFailure {
  ok: false;
  code: TailscaleIngressErrorCode;
  field?: string;
  /** Never contains a credential. */
  message: string;
  details?: Record<string, unknown>;
}

/** The validated, normalised setting (minus server-owned fields) and the transient credential. */
export interface ValidatedTailscaleIngress {
  ok: true;
  value: {
    serviceName: string;
    tag: string;
    backend: { service: string; port: number };
    mode: TailscaleIngressMode;
    listenPort: number;
    forwardAuthAcknowledged: boolean;
    nodeName: string;
    /** Trimmed credential, when one was supplied. Transient: never persist. */
    authKey?: string;
  };
}

export interface TailscaleIngressValidationContext {
  /** Services declared by the active release's compose. */
  services: Array<{ name: string; hasNetworkMode: boolean }>;
  /** Default backend: ingress service + first declared container port (null when none). */
  defaultBackend: { service: string; port: number | null };
  /** True when the active release's auth mode is forward-auth. */
  requiresForwardAuthAcknowledgement: boolean;
  /** True when this deployment already enrolled a tailnet identity. */
  identityEnrolled: boolean;
  /** True when a joining credential is already held on the server. */
  credentialHeld: boolean;
}

/** `svc:omnigraph` -> `hola-omnigraph`, truncated to a 63-character DNS label. */
export function nodeNameFor(serviceName: string): string {
  const label = serviceName.startsWith('svc:') ? serviceName.slice(4) : serviceName;
  return `hola-${label}`.slice(0, 63).replace(/-+$/, '');
}

const NODE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Re-check, at the point of use, every stored field that reaches the
 * companion's argv. A record is validated on write, but a hand-edited or
 * older record is read back as-is, and `backend.port` lands inside the upstream
 * URL: a port of `80@elsewhere` would make the upstream host `elsewhere`.
 * Returns the problem, or undefined when the setting is safe to execute.
 */
export function storedTailscaleSettingProblem(s: {
  serviceName: unknown; tag: unknown; mode: unknown; listenPort: unknown; nodeName: unknown; backend: { port: unknown };
}): string | undefined {
  if (typeof s.serviceName !== 'string' || !SERVICE_NAME_RE.test(s.serviceName)) return 'serviceName';
  if (typeof s.tag !== 'string' || !TAG_RE.test(s.tag)) return 'tag';
  if (s.mode !== 'https' && s.mode !== 'tcp') return 'mode';
  if (!isPort(s.listenPort)) return 'listenPort';
  if (!isPort(s.backend?.port)) return 'backend.port';
  if (typeof s.nodeName !== 'string' || !NODE_NAME_RE.test(s.nodeName)) return 'nodeName';
  return undefined;
}

export function isValidTailscaleCredential(value: string): boolean {
  return CREDENTIAL_RE.test(value);
}

function fail(
  code: TailscaleIngressErrorCode,
  message: string,
  field?: string,
  details?: Record<string, unknown>,
): TailscaleIngressFailure {
  return { ok: false, code, message, ...(field ? { field } : {}), ...(details ? { details } : {}) };
}

function isPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate an enable/replace request. Pure. Failure messages never include the
 * supplied credential (nor any other operator string beyond what is needed to
 * name the offending field).
 */
export function validateTailscaleIngressInput(
  input: unknown,
  ctx: TailscaleIngressValidationContext,
): ValidatedTailscaleIngress | TailscaleIngressFailure {
  if (!isRecord(input)) {
    return fail('INVALID_TAILSCALE_INGRESS', 'Request body must be a JSON object.');
  }

  const serviceName = input.serviceName;
  if (typeof serviceName !== 'string' || !SERVICE_NAME_RE.test(serviceName)) {
    return fail(
      'INVALID_TAILSCALE_INGRESS',
      "serviceName must be 'svc:' followed by a lowercase DNS label (letters, digits and hyphens, e.g. svc:omnigraph).",
      'serviceName',
    );
  }

  const tag = input.tag;
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) {
    return fail(
      'INVALID_TAILSCALE_INGRESS',
      "tag must be 'tag:' followed by a name that starts with a letter (e.g. tag:hola-ingress).",
      'tag',
    );
  }

  const mode = input.mode === undefined ? 'https' : input.mode;
  if (mode !== 'https' && mode !== 'tcp') {
    return fail('INVALID_TAILSCALE_INGRESS', "mode must be 'https' or 'tcp'.", 'mode');
  }

  const listenPort = input.listenPort === undefined ? DEFAULT_TAILSCALE_LISTEN_PORT : input.listenPort;
  if (!isPort(listenPort)) {
    return fail('INVALID_TAILSCALE_INGRESS', 'listenPort must be an integer from 1 to 65535.', 'listenPort');
  }

  let rawBackend: Record<string, unknown> = {};
  if (input.backend !== undefined) {
    if (!isRecord(input.backend)) {
      return fail('INVALID_TAILSCALE_INGRESS', 'backend must be an object.', 'backend');
    }
    rawBackend = input.backend;
  }
  if (rawBackend.service !== undefined && typeof rawBackend.service !== 'string') {
    return fail('INVALID_TAILSCALE_INGRESS', 'backend.service must be a string.', 'backend.service');
  }
  const backendService = (rawBackend.service as string | undefined) ?? ctx.defaultBackend.service;

  if (rawBackend.port !== undefined && !isPort(rawBackend.port)) {
    return fail('INVALID_TAILSCALE_INGRESS', 'backend.port must be an integer from 1 to 65535.', 'backend.port');
  }
  const backendPort = (rawBackend.port as number | undefined) ?? ctx.defaultBackend.port;
  if (backendPort === null || backendPort === undefined) {
    return fail(
      'INVALID_TAILSCALE_INGRESS',
      'This app declares no port to default to; supply backend.port.',
      'backend.port',
    );
  }

  const declared = ctx.services.map((s) => s.name);
  if (PLATFORM_SERVICES.has(backendService)) {
    return fail(
      'TAILSCALE_BACKEND_UNSUPPORTED',
      'The backend cannot be a platform-managed service.',
      'backend.service',
      { reason: 'platform-service', services: declared },
    );
  }
  const backend = ctx.services.find((s) => s.name === backendService);
  if (!backend) {
    return fail(
      'TAILSCALE_BACKEND_UNKNOWN',
      `The backend service is not declared by this app. Choose one of: ${declared.join(', ') || '(none)'}.`,
      'backend.service',
      { services: declared },
    );
  }
  if (backend.hasNetworkMode) {
    return fail(
      'TAILSCALE_BACKEND_UNSUPPORTED',
      'The backend service shares another service\'s network namespace (network_mode) and cannot be attached to a private ingress network. Choose a different service.',
      'backend.service',
      { reason: 'network-mode', services: declared },
    );
  }

  if (ctx.requiresForwardAuthAcknowledgement && input.acknowledgeForwardAuthBypass !== true) {
    return fail(
      'TAILSCALE_FORWARD_AUTH_ACK_REQUIRED',
      'This app is protected by forward-auth at its normal address. The private address does not pass through that gate; acknowledge this to continue.',
      'acknowledgeForwardAuthBypass',
    );
  }

  let authKey: string | undefined;
  if (input.authKey !== undefined && input.authKey !== null && input.authKey !== '') {
    if (typeof input.authKey !== 'string') {
      return fail('INVALID_TAILSCALE_INGRESS', 'authKey must be a string.', 'authKey');
    }
    const trimmed = input.authKey.trim();
    if (!CREDENTIAL_RE.test(trimmed)) {
      // Deliberately does not echo the value or any part of it.
      return fail(
        'INVALID_TAILSCALE_INGRESS',
        "authKey is not in a recognised form. Supply a Tailscale auth key (tskey-auth-...) or an OAuth client secret (tskey-client-...).",
        'authKey',
      );
    }
    authKey = trimmed;
  }
  if (!authKey && !ctx.identityEnrolled && !ctx.credentialHeld) {
    return fail(
      'TAILSCALE_CREDENTIAL_REQUIRED',
      'A Tailscale credential is required to enable private ingress for the first time.',
      'authKey',
    );
  }

  return {
    ok: true,
    value: {
      serviceName,
      tag,
      backend: { service: backendService, port: backendPort },
      mode,
      listenPort,
      forwardAuthAcknowledged: input.acknowledgeForwardAuthBypass === true,
      nodeName: nodeNameFor(serviceName),
      ...(authKey ? { authKey } : {}),
    },
  };
}

/** Inputs the guidance needs; a subset of the persisted setting. */
export interface TailscaleGuidanceInput {
  serviceName: string;
  tag: string;
  listenPort: number;
  mode?: TailscaleIngressMode;
}

/**
 * The Tailscale-side steps Hola cannot do for the operator, as text. Pure, so
 * the dashboard and the CLI show identical guidance.
 */
export function buildTailscaleGuidance(setting: TailscaleGuidanceInput): TailscaleIngressGuidance {
  const { serviceName, tag, listenPort } = setting;
  const exampleGrant = JSON.stringify(
    {
      grants: [{ src: ['tag:example-client'], dst: [serviceName], ip: [`tcp:${listenPort}`] }],
    },
    null,
    2,
  );
  const exampleAutoApprover = JSON.stringify(
    { autoApprovers: { services: { [serviceName]: [tag] } } },
    null,
    2,
  );
  const tagOwners = JSON.stringify({ tagOwners: { [tag]: ['autogroup:admin'] } }, null, 2);

  return {
    prerequisites: [
      'A Tailscale network (tailnet) with HTTPS certificates enabled if you use https mode.',
      `Either an auth key restricted to ${tag} (create it in the admin console under Settings, Keys; reusable is not needed), or an OAuth client with only the auth_keys scope and only ${tag}. Grant no other scope.`,
      'Permission to edit the tailnet policy file and to approve Services in the admin console.',
    ],
    steps: [
      {
        title: 'Let the tag be used',
        detail: `Make ${tag} an owned tag so devices can be tagged with it. Add it to tagOwners in the policy file.`,
        snippet: tagOwners,
      },
      {
        title: 'Define the Service',
        detail: `In the admin console, open Services and define ${serviceName} listening on port ${listenPort}.`,
      },
      {
        title: 'Approve the host',
        detail: `Approve this host for ${serviceName} in the admin console, or add an auto-approver so future hosts need no approval.`,
        snippet: exampleAutoApprover,
      },
      {
        title: 'Grant access',
        detail: `Add a grant letting the clients you choose reach ${serviceName} on port ${listenPort}. Replace tag:example-client with the identity that should connect.`,
        snippet: exampleGrant,
      },
    ],
    exampleGrant,
    exampleAutoApprover,
    notes: [
      'Tailnet policy is additive: the grant above adds access, it does not remove any existing access. Review your existing grants and ACLs for anything broader that already reaches this device.',
      `A grant to this host device is not a grant to the app. Only grants naming ${serviceName} reach the app; grant the Service, not the machine.`,
      'Clients that share one tailnet identity (for example several bots using one tag) cannot be told apart by the app or by policy. Give each client that needs separate access its own identity.',
      'Reachability is not authentication. Anyone allowed to reach the Service reaches the app as if on its private network; the app must still authenticate its own users where it needs to.',
      'The private name is a stable, tailnet-only hostname. The original Host header is preserved, so an app that restricts allowed hosts can be told to trust this name. Tailscale identity headers are empty for tagged callers.',
    ],
  };
}
