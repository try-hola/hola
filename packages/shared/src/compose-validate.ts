/**
 * Strict Docker Compose schema + semantic validation (issue #13).
 *
 * Pure, dependency-light validator that turns a Compose document into a list of
 * structured {@link ValidationIssue}s with stable codes, severity, and field
 * paths. It is intentionally free of any server/service coupling so it can be
 * reused by the server's ValidationService, and (optionally) by the SDK/CLI.
 *
 * Architecture note: Hola routes all application ingress through Traefik, so
 * publishing host ports is unsupported. Any `ports:` entry is therefore an
 * error (`HOST_PORT_NOT_ALLOWED`); use `expose:` for container-internal ports.
 * `network_mode: host` is rejected for the same reason — it publishes every
 * container port on the host, bypassing the `ports:` rule
 * (`HOST_NETWORK_MODE_NOT_ALLOWED`).
 *
 * Images must be pinned for reproducible deploys: an explicit, immutable tag or
 * an `@sha256:` digest. A missing tag (implicitly `:latest`) or a known mutable
 * tag (`latest`, `stable`, …) is an error (`IMAGE_MISSING_TAG` /
 * `IMAGE_MUTABLE_TAG`).
 *
 * The document is parsed with YAML merge keys resolved (`merge: true`) so that
 * fields pulled in via an anchor (`<<: *anchor`) are validated exactly as Docker
 * Compose sees them — otherwise a host port hidden behind a merge would slip past.
 */

import { parse as parseYAML } from 'yaml';
import type { ValidationIssue, ValidationSeverity, ComposeIssueCode } from './index';

// Loose structural shapes — we validate them, so they are deliberately permissive.
interface RawService {
  image?: unknown;
  build?: unknown;
  ports?: unknown;
  expose?: unknown;
  network_mode?: unknown;
  environment?: unknown;
  volumes?: unknown;
  networks?: unknown;
  secrets?: unknown;
  [key: string]: unknown;
}

interface RawCompose {
  version?: unknown;
  name?: unknown;
  services?: unknown;
  volumes?: unknown;
  networks?: unknown;
  secrets?: unknown;
  configs?: unknown;
  [key: string]: unknown;
}

const SUPPORTED_TOP_LEVEL_KEYS = new Set([
  'version',
  'name',
  'services',
  'volumes',
  'networks',
  'secrets',
  'configs',
]);

// Compose service names: start alphanumeric, then alphanumerics, `_`, `.`, `-`.
const SERVICE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
// Permissive image reference: optional registry[:port]/, path, optional :tag, optional @sha256:digest.
const IMAGE_REF_RE =
  /^([a-z0-9.-]+(:[0-9]+)?\/)?[a-z0-9][a-z0-9._/-]*(:[\w][\w.-]*)?(@sha256:[a-f0-9]{64})?$/i;
// Floating tags that move over time — pinning to them defeats reproducible
// deploys, so they are rejected unless the reference is also digest-pinned.
const MUTABLE_IMAGE_TAGS = new Set([
  'latest', 'stable', 'edge', 'nightly', 'rolling', 'current', 'lts',
  'dev', 'devel', 'develop', 'main', 'master', 'mainline', 'trunk',
  'release', 'beta', 'alpha', 'rc', 'canary', 'next', 'unstable',
]);
// Env var keys: POSIX-ish (letter/underscore start).
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function issue(
  code: ComposeIssueCode,
  severity: ValidationSeverity,
  message: string,
  path?: string,
): ValidationIssue {
  // `field` is kept in sync with `path` for back-compat with existing consumers.
  return { code, severity, message, path, field: path };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names of top-level resources that count as "defined" (including external ones). */
function definedNames(block: unknown): Set<string> {
  const names = new Set<string>();
  if (isPlainObject(block)) {
    for (const key of Object.keys(block)) names.add(key);
  }
  return names;
}

function validateEnvironment(env: unknown, basePath: string, issues: ValidationIssue[]): void {
  if (env === undefined || env === null) return;

  if (Array.isArray(env)) {
    const seen = new Set<string>();
    env.forEach((entry, i) => {
      if (typeof entry !== 'string') {
        issues.push(
          issue('INVALID_ENV_FORM', 'error', 'Environment entries must be "KEY=value" strings', `${basePath}[${i}]`),
        );
        return;
      }
      const key = entry.split('=', 1)[0];
      if (!ENV_KEY_RE.test(key)) {
        issues.push(
          issue('INVALID_ENV_FORM', 'error', `Invalid environment variable name '${key}'`, `${basePath}[${i}]`),
        );
        return;
      }
      if (seen.has(key)) {
        issues.push(issue('DUPLICATE_ENV_KEY', 'warning', `Duplicate environment key '${key}'`, `${basePath}[${i}]`));
      }
      seen.add(key);
    });
    return;
  }

  if (isPlainObject(env)) {
    for (const key of Object.keys(env)) {
      if (!ENV_KEY_RE.test(key)) {
        issues.push(issue('INVALID_ENV_FORM', 'error', `Invalid environment variable name '${key}'`, `${basePath}.${key}`));
      }
    }
    return;
  }

  issues.push(issue('INVALID_ENV_FORM', 'error', 'environment must be a list or a mapping', basePath));
}

/**
 * The single host mount root every app's persistent storage must live under.
 * Hola resolves this token to one stable per-install directory at deploy time,
 * so all of an app's data lands in one backup-friendly folder. Apps mount
 * sub-dirs of it (e.g. `${HOLA_APP_DATA}/data:/data`).
 */
export const APP_DATA_TOKEN = '${HOLA_APP_DATA}';

/**
 * Install-specific values the server resolves into an app's compose at deploy
 * time, so the catalog stays free of hardcoded per-install values:
 *   ${HOLA_APP_HOST}     the app's public host (`<app>.<base-domain>`)
 *   ${HOLA_BASE_DOMAIN}  the install's base domain
 * Apps reference these (e.g. `DOMAIN: https://${HOLA_APP_HOST}`); each app still
 * names its own env key, only the value is a token.
 */
export const APP_HOST_TOKEN = '${HOLA_APP_HOST}';
export const BASE_DOMAIN_TOKEN = '${HOLA_BASE_DOMAIN}';

/**
 * The email of the dashboard user who installed the app, resolved at deploy time
 * so an app can seed its own admin account with the operator's identity (e.g.
 * `ADMIN_EMAIL: "${HOLA_USER_EMAIL}"`). Only populated when the dashboard user
 * authenticated via OIDC (SSO) — admin-key and CLI installs have no user email,
 * so it resolves to an empty string. Apps that need a value regardless MUST carry
 * a compose fallback (e.g. `"${ADMIN_EMAIL:-admin@example.com}"`).
 */
export const USER_EMAIL_TOKEN = '${HOLA_USER_EMAIL}';

/** Every `${HOLA_*}` token the server knows how to resolve. */
export const KNOWN_PLATFORM_TOKENS: readonly string[] = [
  APP_DATA_TOKEN,
  APP_HOST_TOKEN,
  BASE_DOMAIN_TOKEN,
  USER_EMAIL_TOKEN,
];

/**
 * Warn on `${HOLA_*}` tokens the server won't resolve — almost always a typo
 * (e.g. `${HOLA_APP_HSOT}`) that would otherwise silently deploy as an empty
 * string. Reserved prefix: only the platform mints `HOLA_*` tokens.
 */
function validatePlatformTokens(yamlText: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  for (const match of yamlText.matchAll(/\$\{(HOLA_[A-Z0-9_]+)\}/g)) {
    const token = `\${${match[1]}}`;
    if (seen.has(token) || KNOWN_PLATFORM_TOKENS.includes(token)) continue;
    seen.add(token);
    issues.push(issue('UNKNOWN_PLATFORM_TOKEN', 'warning',
      `Unknown platform token '${token}'; the server won't resolve it (known: ${KNOWN_PLATFORM_TOKENS.join(', ')})`));
  }
}

function validateVolumes(
  vols: unknown,
  basePath: string,
  _defined: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(vols)) return;
  vols.forEach((entry, i) => {
    const path = `${basePath}[${i}]`;
    let source: string | undefined;
    let isNamed = false;
    if (typeof entry === 'string') {
      source = entry.split(':')[0];
      // A named volume has no path separators and is not relative/absolute/interpolated.
      isNamed =
        !!source &&
        !source.includes('/') &&
        !source.startsWith('.') &&
        !source.startsWith('~') &&
        !source.startsWith('$');
    } else if (isPlainObject(entry)) {
      const type = entry.type;
      if (type === 'tmpfs') return; // ephemeral; no host storage to anchor
      source = typeof entry.source === 'string' ? entry.source : undefined;
      isNamed = type === 'volume' && !!source;
    }

    // Contract: persistent storage is bind-mounted under a single per-app root.
    if (isNamed) {
      issues.push(issue('NAMED_VOLUME_NOT_ALLOWED', 'error',
        `Named volume '${source}' is not allowed; mount persistent storage under '${APP_DATA_TOKEN}' instead (e.g. '${APP_DATA_TOKEN}/data:/data')`, path));
      return;
    }
    if (source !== undefined && !source.startsWith(APP_DATA_TOKEN)) {
      issues.push(issue('VOLUME_NOT_UNDER_APP_DATA', 'error',
        `Bind source '${source}' must be under '${APP_DATA_TOKEN}' so all of an app's data lives in one root`, path));
    }
  });
}

function validateNetworks(
  nets: unknown,
  basePath: string,
  defined: Set<string>,
  issues: ValidationIssue[],
): void {
  if (nets === undefined || nets === null) return;
  const refs: string[] = Array.isArray(nets)
    ? nets.filter((n): n is string => typeof n === 'string')
    : isPlainObject(nets)
      ? Object.keys(nets)
      : [];
  refs.forEach((name) => {
    if (name === 'default') return; // implicit network
    if (!defined.has(name)) {
      issues.push(issue('UNDEFINED_NETWORK', 'error', `Network '${name}' is not defined under top-level 'networks'`, basePath));
    }
  });
}

function validateSecrets(
  secs: unknown,
  basePath: string,
  defined: Set<string>,
  issues: ValidationIssue[],
): void {
  if (!Array.isArray(secs)) return;
  secs.forEach((entry, i) => {
    const name = typeof entry === 'string' ? entry : isPlainObject(entry) && typeof entry.source === 'string' ? entry.source : undefined;
    if (name && !defined.has(name)) {
      issues.push(issue('UNDEFINED_SECRET', 'error', `Secret '${name}' is not defined under top-level 'secrets'`, `${basePath}[${i}]`));
    }
  });
}

/**
 * Extract the tag from an image reference, ignoring the registry-port colon
 * (`registry:5000/img`) and any `@sha256:` digest. Returns undefined when no
 * tag is present (an implicit `:latest`).
 */
function imageTag(ref: string): string | undefined {
  const withoutDigest = ref.split('@', 1)[0];
  const lastSegment = withoutDigest.slice(withoutDigest.lastIndexOf('/') + 1);
  const colon = lastSegment.indexOf(':');
  return colon === -1 ? undefined : lastSegment.slice(colon + 1);
}

function validateImage(svc: RawService, name: string, issues: ValidationIssue[]): void {
  const hasImage = typeof svc.image === 'string' && svc.image.trim().length > 0;
  const hasBuild = svc.build !== undefined && svc.build !== null;

  if (hasImage && hasBuild) {
    issues.push(issue('IMAGE_AND_BUILD_CONFLICT', 'error', `Service '${name}' sets both 'image' and 'build'`, `services.${name}`));
  } else if (!hasImage && !hasBuild) {
    issues.push(issue('MISSING_IMAGE_OR_BUILD', 'error', `Service '${name}' must define 'image' or 'build'`, `services.${name}`));
  }

  if (hasImage) {
    const ref = (svc.image as string).trim();
    if (!IMAGE_REF_RE.test(ref)) {
      issues.push(issue('INVALID_IMAGE_REF', 'error', `Invalid image reference '${ref}'`, `services.${name}.image`));
    } else if (!ref.includes('@')) {
      // Not digest-pinned — require a specific, immutable tag.
      const tag = imageTag(ref);
      if (tag === undefined) {
        issues.push(issue('IMAGE_MISSING_TAG', 'error',
          `Image '${ref}' has no tag (implicitly ':latest', which is mutable); pin a specific version or an '@sha256:' digest`,
          `services.${name}.image`));
      } else if (MUTABLE_IMAGE_TAGS.has(tag.toLowerCase())) {
        issues.push(issue('IMAGE_MUTABLE_TAG', 'error',
          `Image '${ref}' uses mutable tag '${tag}'; pin a specific version or an '@sha256:' digest`,
          `services.${name}.image`));
      }
    }
  }
}

function validateNetworkMode(svc: RawService, name: string, issues: ValidationIssue[]): void {
  // `network_mode: host` shares the host network namespace and publishes every
  // listening port on the host — the same exposure `ports:` is forbidden for.
  if (typeof svc.network_mode === 'string' && svc.network_mode.trim().toLowerCase() === 'host') {
    issues.push(issue('HOST_NETWORK_MODE_NOT_ALLOWED', 'error',
      `Service '${name}' uses 'network_mode: host', which publishes all of its ports on the host; ingress is handled by Traefik. Remove it and use 'expose' for container-internal ports.`,
      `services.${name}.network_mode`));
  }
}

function validatePorts(svc: RawService, name: string, issues: ValidationIssue[]): void {
  // Any `ports:` entry publishes to the host, which is unsupported (Traefik-only ingress).
  if (!Array.isArray(svc.ports)) return;
  svc.ports.forEach((_entry, i) => {
    issues.push(
      issue(
        'HOST_PORT_NOT_ALLOWED',
        'error',
        `Host port publishing is not supported; ingress is handled by Traefik. Use 'expose' for container-internal ports.`,
        `services.${name}.ports[${i}]`,
      ),
    );
  });
}

/**
 * Validate a parsed Compose object. Returns all issues found (errors + warnings).
 */
export function validateComposeObject(parsed: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(parsed)) {
    issues.push(issue('INVALID_YAML', 'error', 'Compose document must be a mapping at the top level'));
    return issues;
  }

  const doc = parsed as RawCompose;

  // Unsupported top-level keys → advisory warnings.
  for (const key of Object.keys(doc)) {
    if (!SUPPORTED_TOP_LEVEL_KEYS.has(key)) {
      issues.push(issue('UNSUPPORTED_KEY', 'warning', `Unsupported top-level key '${key}'`, key));
    }
  }

  if (!isPlainObject(doc.services) || Object.keys(doc.services).length === 0) {
    issues.push(issue('NO_SERVICES', 'error', "Compose document must define at least one service under 'services'", 'services'));
    return issues;
  }

  const volumeNames = definedNames(doc.volumes);
  const networkNames = definedNames(doc.networks);
  const secretNames = definedNames(doc.secrets);

  for (const [name, rawSvc] of Object.entries(doc.services)) {
    if (!SERVICE_NAME_RE.test(name)) {
      issues.push(issue('INVALID_SERVICE_NAME', 'error', `Invalid service name '${name}'`, `services.${name}`));
    }
    if (!isPlainObject(rawSvc)) {
      issues.push(issue('INVALID_SERVICE', 'error', `Service '${name}' must be a mapping`, `services.${name}`));
      continue;
    }
    const svc = rawSvc as RawService;
    validateImage(svc, name, issues);
    validatePorts(svc, name, issues);
    validateNetworkMode(svc, name, issues);
    validateEnvironment(svc.environment, `services.${name}.environment`, issues);
    validateVolumes(svc.volumes, `services.${name}.volumes`, volumeNames, issues);
    validateNetworks(svc.networks, `services.${name}.networks`, networkNames, issues);
    validateSecrets(svc.secrets, `services.${name}.secrets`, secretNames, issues);
  }

  return issues;
}

/**
 * Parse and validate a Compose YAML document.
 *
 * @param yamlText raw Compose YAML
 * @returns all validation issues; a YAML parse failure yields a single
 *          `INVALID_YAML` error and no further checks are attempted.
 */
export function validateComposeDocument(yamlText: string): ValidationIssue[] {
  let parsed: unknown;
  try {
    // Resolve YAML merge keys (`<<: *anchor`) so fields inherited via an anchor
    // are validated exactly as Docker Compose materializes them; otherwise a
    // host port (or any guarded field) hidden behind a merge would slip past.
    parsed = parseYAML(yamlText, { merge: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse error';
    return [issue('INVALID_YAML', 'error', `Invalid Compose YAML: ${message}`)];
  }
  if (parsed === null || parsed === undefined) {
    return [issue('NO_SERVICES', 'error', "Compose document is empty; define at least one service under 'services'", 'services')];
  }
  const issues = validateComposeObject(parsed);
  validatePlatformTokens(yamlText, issues);
  return issues;
}
