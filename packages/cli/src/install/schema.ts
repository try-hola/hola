// The user-facing install configuration the `hola init` wizard collects. This is
// the source of truth for prompting + validation + .env rendering of the keys a
// human supplies. It deliberately covers ONLY user-facing keys — generated secrets
// (AUTHENTIK_*), derived values (HOLA_AUTHENTIK_PUBLIC_URL), and COMPOSE_PROFILES
// remain the responsibility of packages/compose/scripts/install.sh, which runs
// idempotently on the host so secrets are generated there and never leave it.
//
// Keep this in sync with packages/compose/.env.example (the documented template).

import { combine, isDomain, isEmail, isUrlOrEmpty, optionalSecret, required } from './validate';

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
  /** Static default, or one derived from answers so far (e.g. `app.<base>`). */
  default?: string | ((c: ConfigMap) => string);
  /** Choices for `select`. */
  options?: { value: string; label: string }[];
  /** Mask input and redact in JSON/dry-run output. */
  secret?: boolean;
  /** Returns an error message, or undefined when valid. */
  validate?: (v: string, c: ConfigMap) => string | undefined;
  /** When present and false for the current answers, the field is skipped. */
  requiredWhen?: (c: ConfigMap) => boolean;
}

const isRoute53 = (c: ConfigMap) => c.ACME_DNS_PROVIDER === 'route53';
const isCloudflare = (c: ConfigMap) => c.ACME_DNS_PROVIDER === 'cloudflare';
const isAuthentik = (c: ConfigMap) => c.HOLA_AUTH_MODE === 'authentik';

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
    prompt: 'Domain for the Hola UI/API',
    default: (c) => (c.HOLA_BASE_DOMAIN ? `app.${c.HOLA_BASE_DOMAIN}` : ''),
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
    help: 'DNS-01 is required for private/homelab hosts not reachable on :80',
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
    requiredWhen: isRoute53,
    validate: required('AWS access key ID'),
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    type: 'secret',
    prompt: 'AWS secret access key',
    secret: true,
    requiredWhen: isRoute53,
    validate: required('AWS secret access key'),
  },
  {
    key: 'AWS_REGION',
    type: 'text',
    prompt: 'AWS region',
    default: 'us-east-1',
    requiredWhen: isRoute53,
    validate: required('AWS region'),
  },
  {
    key: 'AWS_HOSTED_ZONE_ID',
    type: 'text',
    prompt: 'AWS hosted zone ID (optional — blank to auto-detect)',
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
    help: 'e.g. UTC or America/New_York; applied to apps that do not set TZ',
    default: '',
  },
  {
    key: 'HOLA_AUTH_MODE',
    type: 'select',
    prompt: 'SSO platform for catalog apps',
    help: 'authentik brings up the bundled Authentik stack (~2 GB RAM)',
    default: 'none',
    options: [
      { value: 'none', label: 'none — apps use their own auth' },
      { value: 'authentik', label: 'authentik — auto-provision per-app SSO' },
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
    default: 'admin@example.com',
    requiredWhen: isAuthentik,
    validate: isEmail,
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
