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
 *
 * Privilege-bearing keys are refused (F02b). Nothing in Hola grants an app a
 * host namespace, a host device, an extra capability, a host file read, or an
 * externally-defined service body, so there is no grant to check against and
 * the honest answer is a refusal naming the key and the service. See
 * {@link PRIVILEGE_BEARING_KEYS} for the per-key reasoning — and
 * {@link validatePrivileges} for the one exception, `privileged`, which warns
 * rather than errors because shipped catalog apps depend on it.
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
// Service names reserved for platform-injected components (spec 004): a
// user-authored service of this name is a validation error, never silently
// shadowed or merged. Currently just the container-logs proxy sidecar.
export const RESERVED_SERVICE_NAMES: ReadonlySet<string> = new Set(['hola-docker-proxy']);
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
 *
 * A bind source must be the token exactly, or the token followed by `/` and a
 * path that stays inside it — see {@link appDataContainment}. The token is a
 * containment boundary, not a prefix.
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

/**
 * Where a bind source sits relative to the app data root:
 *  - `contained` — the root itself, or a path that stays inside it;
 *  - `outside`   — not rooted at the token at all (an absolute host path, a
 *                  relative path, or a string that merely *starts with* the
 *                  token but continues without a separator, e.g.
 *                  `${HOLA_APP_DATA}-sneaky` → a sibling directory);
 *  - `escapes`   — rooted at the token but walking back out of it with `..`
 *                  (`${HOLA_APP_DATA}/../.hola`, `${HOLA_APP_DATA}/../../../etc`);
 *  - `interpolated` — rooted at the token but continuing with a Compose
 *                  variable reference, so what it resolves to is not decidable
 *                  here (`${HOLA_APP_DATA}/${ESCAPE}`).
 */
type AppDataContainment =
  | { kind: 'contained' }
  | { kind: 'outside' }
  | { kind: 'escapes'; position: number }
  | { kind: 'interpolated' };

/**
 * The Compose variable reference in a bind source, or undefined when there is
 * none (F02a).
 *
 * Containment is proved by walking literal `/`-separated segments, which is
 * only a proof when every segment IS literal. `${HOLA_APP_DATA}/${ESCAPE}:/data`
 * walks as a single depth-1 segment and passes — and then the server substitutes
 * the app data root and hands the rest to Compose, which interpolates `${ESCAPE}`
 * from `deployments/<id>/runtime/.env`. That file legitimately carries the app's
 * OWN environment (operator-supplied values, manifest defaults), so
 * `ESCAPE=../../../../var/run` is an app-controlled bind source pointing at the
 * Docker socket's directory. F01's allowlisted Compose environment does not
 * close this: it stops `${HOLA_*}` from resolving to a platform credential, but
 * the app's own env still reaches Compose by design, through that `.env`.
 *
 * So the rule is: after the leading `${HOLA_APP_DATA}` token — the platform's
 * own substitution, performed by the server before Compose ever sees the file —
 * a bind source must be literal. `$` is checked rather than `${`: Compose also
 * honours the unbraced `$VAR` form. `$$` (an escaped literal `$`) is refused
 * too; no catalog app needs a dollar sign in a directory name, and accepting it
 * would mean re-implementing Compose's escaping rules to stay safe.
 *
 * Only the SOURCE is constrained. Interpolation in the container-side target,
 * in the mode, and everywhere else in the document stays untouched: the target
 * is a path inside the container, with no host reach to contain.
 */
function sourceInterpolation(source: string): string | undefined {
  const suffix = source.startsWith(APP_DATA_TOKEN) ? source.slice(APP_DATA_TOKEN.length) : source;
  const at = suffix.indexOf('$');
  if (at === -1) return undefined;
  // Report the reference itself where it is recognisable, else the bare `$`.
  const braced = suffix.slice(at).match(/^\$\{[^}]*\}/)?.[0];
  const unbraced = suffix.slice(at).match(/^\$[A-Za-z_][A-Za-z0-9_]*/)?.[0];
  return braced ?? unbraced ?? '$';
}

/**
 * Prove a bind source is really *inside* the app data root (#482).
 *
 * A `startsWith(APP_DATA_TOKEN)` test is a string comparison, not a containment
 * proof: the server materialises the token by textual substitution
 * (`content.replaceAll(APP_DATA_TOKEN, appRoot)`), so `${HOLA_APP_DATA}/../..`
 * reaches any host path the daemon can bind — including `/var/run`, which holds
 * the Docker socket the `${HOLA_APP_DATA}` rule exists to keep out of app
 * compose. So: accept the token exactly or followed by `/`, then walk the
 * remainder and require the depth never to fall below the root.
 *
 * Normalisation is deliberately **lexical** — `.` and empty segments dropped,
 * `..` popping one level — and uses no `node:path`/`node:fs`: `@hola/shared` is
 * bundled into the browser build (`packages/web`), so it must stay
 * dependency-free. Lexical is also the *right* semantics here: the source is a
 * token plus a catalog-authored suffix, evaluated before any of it exists on
 * disk, so there is nothing to `realpath`. Symlinks planted inside a data root
 * are a separate (post-deploy) concern, handled for manifest-declared write
 * targets by `resolveContainedDir` in the server.
 */
function appDataContainment(source: string): AppDataContainment {
  if (source === APP_DATA_TOKEN) return { kind: 'contained' };
  if (!source.startsWith(`${APP_DATA_TOKEN}/`)) return { kind: 'outside' };
  // Containment is proved against literal path segments, so the suffix has to
  // BE literal (F02a) — see `sourceInterpolation`.
  if (sourceInterpolation(source) !== undefined) return { kind: 'interpolated' };

  let depth = 0;
  const segments = source.slice(APP_DATA_TOKEN.length + 1).split('/');
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === '' || segment === '.') continue; // `a//b`, `a/./b` — no movement
    if (segment !== '..') {
      depth++;
      continue;
    }
    if (depth === 0) return { kind: 'escapes', position: i + 1 };
    depth--;
  }
  return { kind: 'contained' };
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
    if (source !== undefined) {
      const containment = appDataContainment(source);
      if (containment.kind === 'outside') {
        issues.push(issue('VOLUME_NOT_UNDER_APP_DATA', 'error',
          `Bind source '${source}' must be under '${APP_DATA_TOKEN}' so all of an app's data lives in one root`, path));
      } else if (containment.kind === 'escapes') {
        issues.push(issue('VOLUME_ESCAPES_APP_DATA', 'error',
          `Bind source '${source}' traverses out of '${APP_DATA_TOKEN}': the '..' segment at position ${containment.position} walks above the app data root. A bind source may not traverse out of the app data root — mount a sub-directory of '${APP_DATA_TOKEN}' instead`, path));
      } else if (containment.kind === 'interpolated') {
        issues.push(issue('VOLUME_SOURCE_INTERPOLATED', 'error',
          `Bind source '${source}' interpolates '${sourceInterpolation(source)}'. Containment under '${APP_DATA_TOKEN}' is proved against literal path segments, and a variable's value comes from the app's own environment at deploy time — '../..' in it would relocate the mount outside the app data root. Write the sub-directory literally (e.g. '${APP_DATA_TOKEN}/data:/data'); interpolation in the container-side path is still fine`, path));
      }
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
  if (typeof svc.network_mode !== 'string') return;
  const mode = svc.network_mode.trim().toLowerCase();
  // `network_mode: host` shares the host network namespace and publishes every
  // listening port on the host — the same exposure `ports:` is forbidden for.
  if (mode === 'host') {
    issues.push(issue('HOST_NETWORK_MODE_NOT_ALLOWED', 'error',
      `Service '${name}' uses 'network_mode: host', which publishes all of its ports on the host; ingress is handled by Traefik. Remove it and use 'expose' for container-internal ports.`,
      `services.${name}.network_mode`));
    return;
  }
  // `container:<id>` joins the network namespace of ANY container on the host —
  // including another app's, or the platform's own — reaching services that are
  // only bound to localhost inside it. The `service:<name>` form is confined to
  // this app's own compose project and stays allowed, as do `none`/`bridge` and
  // a named network.
  if (mode.startsWith('container:')) {
    issues.push(issue('FOREIGN_NETWORK_MODE_NOT_ALLOWED', 'error',
      `Service '${name}' uses '${svc.network_mode}', joining the network namespace of a container outside this app. Use 'service:<name>' for a sibling service in this compose, or a shared network.`,
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
 * Service keys that hand a container authority beyond its own namespaces, its
 * own images and its own data root — refused outright, with the reason each
 * one is refused recorded next to it.
 *
 * None of these is grantable in Hola today: no manifest declares them, no
 * contract provisions them, and the platform's own injections (the
 * `hola-docker-proxy` sidecar, the apps-data and restore-staging mounts) are
 * added to the compose AFTER validation, so a refusal here never touches them.
 *
 * `security_opt`, `network_mode` and `privileged` are handled separately
 * below — each has a narrow permitted form, or (for `privileged`) a shipped
 * catalog dependency that makes a flat refusal a regression.
 */
const PRIVILEGE_BEARING_KEYS: ReadonlyArray<{ key: string; why: string }> = [
  // Namespace sharing. `pid: host` makes every host process visible and
  // signalable (and /proc/1/root reachable); `ipc: host` shares host shared
  // memory; `uts: host` shares the host hostname namespace; `cgroup: host`
  // the host cgroup namespace. The `container:<id>` form of each reaches ANY
  // container on the host, including the platform's own. Every value is
  // refused, including the `service:<name>` form: nothing in the catalog
  // needs it, so allowing it would widen the rule for no one.
  { key: 'pid', why: 'shares a PID namespace outside the container' },
  { key: 'ipc', why: 'shares an IPC namespace outside the container' },
  { key: 'uts', why: 'shares the host UTS (hostname) namespace' },
  { key: 'cgroup', why: 'shares the host cgroup namespace' },
  // Direct device access. `devices` passes a host device node through (e.g.
  // `/dev/sda:/dev/sda` — the host disk); `device_cgroup_rules` grants the
  // same at the cgroup layer (`c 10:200 rwm`) without naming a path.
  { key: 'devices', why: 'passes a host device through to the container' },
  { key: 'device_cgroup_rules', why: 'grants raw host device access at the cgroup layer' },
  // Capability and identity widening. `cap_add` re-adds what Docker dropped
  // (CAP_SYS_ADMIN → mount; CAP_SYS_PTRACE → cross-container inspection);
  // `group_add` joins a host group by gid, which is how a container is
  // handed the `docker` group. `cap_drop` is a NARROWING and stays allowed.
  { key: 'cap_add', why: 'adds a Linux capability Docker drops by default' },
  { key: 'group_add', why: 'joins a supplementary host group by gid' },
  // Host file reads. `env_file` reads an arbitrary host path relative to the
  // compose project directory (`deployments/<id>/runtime/`), so
  // `../../<other-id>/runtime/.env` is another app's secrets and
  // `../../../../..` is anything the server can read. Hola's own env
  // injection is the sanctioned path (`materializeCompose`).
  { key: 'env_file', why: 'reads an arbitrary host file into the container environment' },
  // Definition smuggling. `extends` pulls a service body out of another file
  // — including one outside the bundle — so everything validated here can be
  // overridden by content this validator never saw.
  { key: 'extends', why: 'pulls a service definition out of an unvalidated file' },
  // Kernel/runtime surface. `userns_mode: host` opts out of user-namespace
  // remapping (a no-op on a daemon without remapping configured, but it
  // pre-authorises the escape on one that has it); `sysctls` writes kernel
  // tunables; `cgroup_parent` places the container in an operator-chosen
  // cgroup, escaping the platform's own resource accounting; `runtime`
  // selects a different OCI runtime altogether.
  { key: 'userns_mode', why: 'opts out of user-namespace remapping' },
  { key: 'sysctls', why: 'writes kernel tunables from the app compose' },
  { key: 'cgroup_parent', why: "places the container outside the platform's cgroup" },
  { key: 'runtime', why: 'selects a non-default OCI runtime' },
  // Mount smuggling. `volumes_from` copies another container's mounts
  // wholesale, so a bind source this validator proved contained can be
  // sidestepped by inheriting one that never was.
  { key: 'volumes_from', why: "inherits another container's mounts, bypassing bind-source containment" },
];

/** The one `security_opt` entry an app may state: the platform's own hardening. */
const ALLOWED_SECURITY_OPT = 'no-new-privileges:true';

/**
 * True when a guarded key actually carries a value. `cap_add:` with nothing
 * after it parses to `null` and grants nothing, and an empty list is the same;
 * refusing those would reject a comment-shaped no-op rather than a privilege.
 */
function carriesValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== false;
}

function validatePrivileges(svc: RawService, name: string, issues: ValidationIssue[]): void {
  for (const { key, why } of PRIVILEGE_BEARING_KEYS) {
    if (!carriesValue(svc[key])) continue;
    issues.push(issue('PRIVILEGED_KEY_NOT_ALLOWED', 'error',
      `Service '${name}' sets '${key}', which ${why}. Apps run with the platform's default confinement; this key is not available.`,
      `services.${name}.${key}`));
  }

  // `security_opt` is the one privilege key with a legitimate app-authored
  // form: an app may restate the platform's own `no-new-privileges:true`.
  // Everything else here WIDENS (`seccomp:unconfined`,
  // `apparmor:unconfined`, `systempaths=unconfined`, `label:disable`,
  // `no-new-privileges:false`), so the check is an allowlist of one rather
  // than a deny-list of the forms known today.
  //
  // A bare string instead of a list is checked too. Compose's own schema wants
  // a list and would reject it, but a rule that only looks at the shape it
  // expects is not a rule.
  if (carriesValue(svc.security_opt)) {
    const entries = Array.isArray(svc.security_opt) ? svc.security_opt : [svc.security_opt];
    const suffix = Array.isArray(svc.security_opt) ? (i: number) => `[${i}]` : () => '';
    entries.forEach((entry, i) => {
      if (typeof entry === 'string' && entry.trim() === ALLOWED_SECURITY_OPT) return;
      issues.push(issue('SECURITY_OPT_NOT_ALLOWED', 'error',
        `Service '${name}' sets security_opt '${String(entry)}'; the only permitted entry is '${ALLOWED_SECURITY_OPT}' (the platform applies it anyway). Loosening seccomp/AppArmor/system paths is not available.`,
        `services.${name}.security_opt${suffix(i)}`));
    });
  }

  // `privileged: true` disables essentially all confinement. It is NOT an
  // error, deliberately: two shipped catalog apps (Gitea's Actions runner and
  // running-man's Docker-in-Docker sidecar) depend on it precisely because the
  // rules above forbid them the host socket, and refusing it here would
  // uninstallably break them. Warning so it is visible in catalog CI, in the
  // draft `/validate` report, and to the operator — and so the eventual
  // declared-and-consented grant has something to replace.
  if (svc.privileged !== undefined && svc.privileged !== null && svc.privileged !== false) {
    issues.push(issue('PRIVILEGED_SERVICE', 'warning',
      `Service '${name}' runs privileged, which disables container confinement (all capabilities, all host devices). Only apps that genuinely cannot work otherwise (e.g. Docker-in-Docker) should do this.`,
      `services.${name}.privileged`));
  }
}

/**
 * A top-level `secrets`/`configs` definition whose source is a host file mounts
 * that file's content into the container.
 * `file: /data/apps/<other-app>/config/admin-api-key` is a cross-app secret
 * read with no bind mount to show for it, so the bind-source containment rules
 * never see it.
 *
 * Only `file:` is refused. `environment:` and inline `content:` carry no host
 * path, and `external: true` names an object the platform never creates — it
 * resolves to nothing rather than to host content, and has always been accepted
 * here, so refusing it now would be a rule about a different problem.
 */
function validateFileSources(
  block: unknown,
  kind: 'secrets' | 'configs',
  issues: ValidationIssue[],
): void {
  if (!isPlainObject(block)) return;
  for (const [name, def] of Object.entries(block)) {
    if (!isPlainObject(def)) continue;
    if (typeof def.file === 'string' && def.file.trim().length > 0) {
      issues.push(issue('FILE_SOURCE_NOT_ALLOWED', 'error',
        `Top-level ${kind} '${name}' reads host file '${def.file}'. A file-backed ${kind.slice(0, -1)} mounts host content into the container outside the '${APP_DATA_TOKEN}' containment rules; use an 'environment:' source instead.`,
        `${kind}.${name}.file`));
    }
  }
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

  // Host-file-backed secrets/configs are a container read of host content that
  // no bind-source rule sees — checked once, at the top level where they are
  // defined, rather than per reference.
  validateFileSources(doc.secrets, 'secrets', issues);
  validateFileSources(doc.configs, 'configs', issues);

  for (const [name, rawSvc] of Object.entries(doc.services)) {
    if (!SERVICE_NAME_RE.test(name)) {
      issues.push(issue('INVALID_SERVICE_NAME', 'error', `Invalid service name '${name}'`, `services.${name}`));
    }
    if (RESERVED_SERVICE_NAMES.has(name)) {
      // The container-logs proxy sidecar (spec 004) is the platform's own
      // post-validation injection; a user-authored service under this name
      // would either collide with it or spoof its identity to a collector.
      issues.push(issue('RESERVED_SERVICE_NAME', 'error', `Service name '${name}' is reserved for a platform-injected component`, `services.${name}`));
    }
    if (!isPlainObject(rawSvc)) {
      issues.push(issue('INVALID_SERVICE', 'error', `Service '${name}' must be a mapping`, `services.${name}`));
      continue;
    }
    const svc = rawSvc as RawService;
    validateImage(svc, name, issues);
    validatePorts(svc, name, issues);
    validateNetworkMode(svc, name, issues);
    validatePrivileges(svc, name, issues);
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
