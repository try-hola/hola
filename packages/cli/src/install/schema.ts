// The user-facing install configuration the `hola init` wizard collects. This is
// the source of truth for prompting + validation + .env rendering of the keys a
// human supplies. It deliberately covers ONLY user-facing keys — generated secrets
// (AUTHENTIK_*), derived values (HOLA_AUTHENTIK_PUBLIC_URL), and COMPOSE_PROFILES
// remain the responsibility of packages/compose/scripts/install.sh, which runs
// idempotently on the host so secrets are generated there and never leave it.
//
// Keep this in sync with packages/compose/.env.example (the documented template).

import { combine, isDomain, isEmail, isEmailOrEmpty, isUrlOrEmpty, optionalSecret, required } from './validate';

export type FieldType = 'text' | 'select' | 'secret' | 'confirm';

export type ConfigMap = Record<string, string>;

export interface InstallField {
  /** The .env key this field writes. */
  key: string;
  type: FieldType;
  /** Question shown to the user. */
  prompt: string;
  /** Extra one-line guidance. */
  help?: string;
  /** Static default, or one derived from answers so far (e.g. `apps.<base>`). */
  default?: string | ((c: ConfigMap) => string);
  /** Choices for `select`. */
  options?: { value: string; label: string }[];
  /** Mask input and redact in JSON/dry-run output. */
  secret?: boolean;
  /**
   * Offer a value already present in the process environment (read from the env
   * var named by this field's `key`) so the user can accept it instead of
   * pasting it in. For a `secret` field a blank answer means "use the detected
   * value". Used for the AWS_* credentials.
   */
  fromEnv?: boolean;
  /** Returns an error message, or undefined when valid. */
  validate?: (v: string, c: ConfigMap) => string | undefined;
  /** When present and false for the current answers, the field is skipped. */
  requiredWhen?: (c: ConfigMap) => boolean;
}

const isRoute53 = (c: ConfigMap) => c.ACME_DNS_PROVIDER === 'route53';
const isCloudflare = (c: ConfigMap) => c.ACME_DNS_PROVIDER === 'cloudflare';
const isAuthentik = (c: ConfigMap) => c.HOLA_AUTH_MODE === 'authentik';

/** IANA timezone of the machine running the wizard (e.g. America/New_York), or '' if undetectable. Honors $TZ. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export const INSTALL_SCHEMA: InstallField[] = [
  {
    key: 'HOLA_BASE_DOMAIN',
    type: 'text',
    prompt: 'Base domain for deployed apps',
    help: 'Apps are served at <app>.<base>, e.g. gitea.hola.example.com',
    validate: isDomain,
  },
  {
    key: 'HOLA_DOMAIN',
    type: 'text',
    prompt: 'Domain for the Hola dashboard/API',
    // The dashboard lists the collection of installed apps, so default to the
    // plural `apps.<base>` rather than the singular `app.<base>`.
    default: (c) => (c.HOLA_BASE_DOMAIN ? `apps.${c.HOLA_BASE_DOMAIN}` : ''),
    validate: isDomain,
  },
  {
    key: 'TRAEFIK_DASHBOARD_DOMAIN',
    type: 'text',
    prompt: 'Domain for the Traefik dashboard',
    default: (c) => (c.HOLA_BASE_DOMAIN ? `traefik.${c.HOLA_BASE_DOMAIN}` : ''),
    validate: isDomain,
  },
  {
    key: 'LETSENCRYPT_EMAIL',
    type: 'text',
    prompt: "Let's Encrypt contact email",
    validate: isEmail,
  },
  {
    key: 'ACME_DNS_PROVIDER',
    type: 'select',
    prompt: 'TLS certificate challenge',
    help: 'Note: DNS-01 is required for private/homelab hosts not reachable on :80',
    default: '',
    options: [
      { value: '', label: 'HTTP-01 (host is internet-reachable on port 80)' },
      { value: 'route53', label: 'DNS-01 via AWS Route 53 (wildcard, private host ok)' },
      { value: 'cloudflare', label: 'DNS-01 via Cloudflare (wildcard, private host ok)' },
    ],
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    type: 'text',
    prompt: 'AWS access key ID',
    fromEnv: true,
    requiredWhen: isRoute53,
    validate: required('AWS access key ID'),
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    type: 'secret',
    prompt: 'AWS secret access key',
    secret: true,
    fromEnv: true,
    requiredWhen: isRoute53,
    validate: required('AWS secret access key'),
  },
  {
    key: 'AWS_REGION',
    type: 'text',
    prompt: 'AWS region',
    default: 'us-east-1',
    fromEnv: true,
    requiredWhen: isRoute53,
    validate: required('AWS region'),
  },
  {
    key: 'AWS_HOSTED_ZONE_ID',
    type: 'text',
    prompt: 'AWS hosted zone ID (optional — blank to auto-detect)',
    fromEnv: true,
    requiredWhen: isRoute53,
    // optional: empty is allowed.
  },
  {
    key: 'CF_DNS_API_TOKEN',
    type: 'secret',
    prompt: 'Cloudflare API token (Zone:DNS:Edit)',
    secret: true,
    requiredWhen: isCloudflare,
    validate: required('Cloudflare API token'),
  },
  {
    key: 'HOLA_CATALOG_URL',
    type: 'text',
    prompt: 'App catalog URL (blank to disable the catalog)',
    default: 'https://raw.githubusercontent.com/try-hola/apps/main/catalog.json',
    validate: isUrlOrEmpty,
  },
  {
    key: 'HOLA_DEFAULT_TZ',
    type: 'text',
    prompt: 'Default timezone for deployed apps (TZ, blank to leave unset)',
    help: 'Applied to apps that do not set TZ; defaults to this machine\'s timezone',
    // Prefill the timezone of the machine running `hola init`.
    default: () => systemTimeZone(),
  },
  {
    key: 'HOLA_AUTH_MODE',
    type: 'select',
    prompt: 'SSO platform for catalog apps',
    help: 'Note: authentik brings up the bundled Authentik stack (~2 GB RAM)',
    // Secure by default: provision per-app SSO unless the operator opts out.
    default: 'authentik',
    options: [
      { value: 'authentik', label: 'authentik — auto-provision per-app SSO' },
      { value: 'none', label: 'none — apps use their own auth' },
    ],
  },
  {
    key: 'HOLA_AUTHENTIK_DOMAIN',
    type: 'text',
    prompt: 'Authentik login domain',
    default: (c) => (c.HOLA_BASE_DOMAIN ? `auth.${c.HOLA_BASE_DOMAIN}` : ''),
    requiredWhen: isAuthentik,
    validate: isDomain,
  },
  {
    key: 'AUTHENTIK_BOOTSTRAP_EMAIL',
    type: 'text',
    prompt: 'Authentik admin email',
    // Reuse the first email the operator gave (Let's Encrypt contact) as the default.
    default: (c) => c.LETSENCRYPT_EMAIL || 'admin@example.com',
    requiredWhen: isAuthentik,
    validate: isEmail,
  },
  {
    key: 'HOLA_ADMIN_EMAIL',
    type: 'text',
    prompt: 'Your admin email (sign in as yourself)',
    help: 'Blank to just use the built-in akadmin account',
    // Default to the first email given, so you sign in as yourself out of the box.
    default: (c) => c.LETSENCRYPT_EMAIL || '',
    requiredWhen: isAuthentik,
    validate: isEmailOrEmpty,
  },
  {
    key: 'HOLA_ADMIN_USERNAME',
    type: 'text',
    prompt: 'Your username',
    default: (c) => (c.HOLA_ADMIN_EMAIL ? c.HOLA_ADMIN_EMAIL.split('@')[0] : ''),
    // Only asked once a named admin email is given.
    requiredWhen: (c) => isAuthentik(c) && !!c.HOLA_ADMIN_EMAIL?.trim(),
  },
  {
    key: 'HOLA_ADMIN_NAME',
    type: 'text',
    prompt: 'Your display name (optional)',
    requiredWhen: (c) => isAuthentik(c) && !!c.HOLA_ADMIN_EMAIL?.trim(),
  },
  {
    key: 'HOLA_USE_AUTH',
    type: 'confirm',
    prompt: 'Require an admin API key for the Hola API?',
    help: 'Recommended on. A key is generated on first boot if you leave one unset.',
    default: 'true',
  },
  {
    key: 'HOLA_API_KEY',
    type: 'secret',
    prompt: 'Fixed admin API key (optional — blank to auto-generate on first boot)',
    secret: true,
    requiredWhen: (c) => c.HOLA_USE_AUTH === 'true',
    validate: combine(optionalSecret()),
  },
];

/** Resolve a field's default against the answers gathered so far. */
export function defaultFor(field: InstallField, config: ConfigMap): string {
  if (typeof field.default === 'function') return field.default(config);
  return field.default ?? '';
}

/** Keys that hold secrets, for redaction in JSON / dry-run output. */
export function secretKeys(): Set<string> {
  return new Set(INSTALL_SCHEMA.filter((f) => f.secret).map((f) => f.key));
}
