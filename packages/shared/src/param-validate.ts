/**
 * Typed app-install parameter validation (ADR 0003).
 *
 * Catalog manifests can attach optional typed-constraint fields to an
 * `AppEnvVar` (see `index.ts`) — `type`, `required`, `pattern`, `min`/`max`,
 * `options`, etc. This module is the single, pure implementation of what
 * those fields mean, mirroring `compose-validate.ts`'s style: no server/service
 * coupling, so the server, web, and CLI can all import it and agree on the
 * same rules and issue codes.
 *
 * Design note on `validateParams` and legacy rows: there is deliberately no
 * "does this row carry a typed spec" heuristic. `validateParamValue` is run
 * over every row unconditionally, typed or not. For a legacy row (no fields
 * beyond `key`/`value`/`isSecret`) this reduces to exactly one check — the
 * `required` tri-state's `undefined` branch, which reproduces today's
 * `isSecret` ⇒ required rule — because every type-specific check is a no-op
 * without its trigger field (no `pattern`/`minLength`/etc means the `'string'`
 * branch never flags anything). That means this module's `PARAM_REQUIRED_MISSING`
 * is a drop-in replacement for the server's own ad hoc `MISSING_SECRET_VALUE`
 * check on empty secrets. PR 2 (server integration) should delete that inline
 * check and call `validateParams` instead, rather than running both — the
 * `required: false` escape hatch on a secret only works if the server's own
 * hardcoded rule stops overriding it.
 */

import type { AppEnvVar, ParamGenerate, ParamType, ValidationIssue, ValidationSeverity } from './index';
import { KNOWN_PLATFORM_TOKENS } from './compose-validate';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ReDoS guard: skip the (author-supplied, potentially pathological) `pattern`
// check above this length rather than run a regex against arbitrarily large
// input. Not an error — just a skip, since the value may well be valid.
const MAX_PATTERN_VALUE_LENGTH = 10_000;

const PARAM_TYPES: ReadonlySet<string> = new Set<ParamType>([
  'string', 'integer', 'port', 'boolean', 'enum', 'url', 'email', 'timezone',
]);

function issue(
  code: 'PARAM_REQUIRED_MISSING' | 'PARAM_INVALID_INTEGER' | 'PARAM_INTEGER_OUT_OF_RANGE'
    | 'PARAM_INVALID_PORT' | 'PARAM_INVALID_BOOLEAN' | 'PARAM_INVALID_ENUM_VALUE'
    | 'PARAM_INVALID_URL' | 'PARAM_URL_NOT_HTTPS' | 'PARAM_INVALID_EMAIL'
    | 'PARAM_INVALID_TIMEZONE' | 'PARAM_PATTERN_MISMATCH' | 'PARAM_TOO_SHORT'
    | 'PARAM_TOO_LONG' | 'PARAM_INVALID_SPEC',
  severity: ValidationSeverity,
  message: string,
  path?: string,
): ValidationIssue {
  // `field` is kept in sync with `path` for back-compat with existing consumers.
  return { code, severity, message, path, field: path };
}

// --- timezone support -------------------------------------------------

/** Sentinel meaning "this runtime has no `Intl.supportedValuesOf`". */
const TIMEZONE_LOOKUP_UNSUPPORTED = Symbol('timezone-lookup-unsupported');
let cachedTimezones: Set<string> | typeof TIMEZONE_LOOKUP_UNSUPPORTED | undefined;

function isValidTimezone(value: string): boolean {
  if (cachedTimezones === undefined) {
    // Not present in all runtimes (older browsers); cache the outcome (Set or
    // "unsupported") once at first use rather than probing every call.
    const supportedValuesOf = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    cachedTimezones = typeof supportedValuesOf === 'function'
      ? new Set(supportedValuesOf('timeZone'))
      : TIMEZONE_LOOKUP_UNSUPPORTED;
  }
  if (cachedTimezones !== TIMEZONE_LOOKUP_UNSUPPORTED) {
    return cachedTimezones.has(value);
  }
  try {
    void new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a single value against its typed spec. Pure and side-effect free.
 *
 * Order of operations (back-compat critical, see `AppEnvVar.required` doc):
 * 1. Empty value → required check (tri-state) and return; no point
 *    type-checking an empty string.
 * 2. An unresolved `${HOLA_*}` platform token → skip type checks entirely.
 *    Drafts may legitimately carry one before deploy-time substitution.
 * 3. Otherwise dispatch on `type ?? 'string'`.
 */
export function validateParamValue(spec: AppEnvVar, value: string, path?: string): ValidationIssue[] {
  const at = path ?? `env.${spec.key}`;
  const label = spec.label ?? spec.key;
  const effectivelyRequired = spec.required ?? spec.isSecret;

  if (value === '') {
    if (effectivelyRequired) {
      return [issue('PARAM_REQUIRED_MISSING', 'error', `${label} is required`, at)];
    }
    return [];
  }

  if (KNOWN_PLATFORM_TOKENS.includes(value)) return [];

  const issues: ValidationIssue[] = [];
  const type = spec.type ?? 'string';

  switch (type) {
    case 'string': {
      if (spec.pattern !== undefined && value.length < MAX_PATTERN_VALUE_LENGTH) {
        try {
          const re = new RegExp(spec.pattern);
          if (!re.test(value)) {
            issues.push(issue('PARAM_PATTERN_MISMATCH', 'error', `${label} does not match the required format`, at));
          }
        } catch {
          // A broken pattern is a spec problem (see validateParamSpec), not a
          // value problem — don't throw or flag the value for it.
        }
      }
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        issues.push(issue('PARAM_TOO_SHORT', 'error', `${label} must be at least ${spec.minLength} characters`, at));
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        issues.push(issue('PARAM_TOO_LONG', 'error', `${label} must be at most ${spec.maxLength} characters`, at));
      }
      break;
    }
    case 'integer': {
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        issues.push(issue('PARAM_INVALID_INTEGER', 'error', `${label} must be a whole number`, at));
        break;
      }
      const n = Number(value);
      if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max)) {
        issues.push(issue('PARAM_INTEGER_OUT_OF_RANGE', 'error',
          `${label} must be between ${spec.min ?? '-∞'} and ${spec.max ?? '∞'}`, at));
      }
      break;
    }
    case 'port': {
      // Port is an integer with an implied 1-65535 range; spec min/max may
      // only narrow that range, never widen it (see AppEnvVar doc).
      if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        issues.push(issue('PARAM_INVALID_PORT', 'error', `${label} must be a valid port number`, at));
        break;
      }
      const n = Number(value);
      const effectiveMin = Math.max(1, spec.min ?? 1);
      const effectiveMax = Math.min(65535, spec.max ?? 65535);
      if (n < effectiveMin || n > effectiveMax) {
        issues.push(issue('PARAM_INVALID_PORT', 'error', `${label} must be a port between ${effectiveMin} and ${effectiveMax}`, at));
      }
      break;
    }
    case 'boolean': {
      const trueValue = spec.trueValue ?? 'true';
      const falseValue = spec.falseValue ?? 'false';
      if (value !== trueValue && value !== falseValue) {
        issues.push(issue('PARAM_INVALID_BOOLEAN', 'error', `${label} must be '${trueValue}' or '${falseValue}'`, at));
      }
      break;
    }
    case 'enum': {
      // No options is a spec problem (validateParamSpec), not a value problem.
      if (spec.options && spec.options.length > 0 && !spec.options.some((o) => o.value === value)) {
        issues.push(issue('PARAM_INVALID_ENUM_VALUE', 'error',
          `${label} must be one of: ${spec.options.map((o) => o.value).join(', ')}`, at));
      }
      break;
    }
    case 'url': {
      try {
        const u = new URL(value);
        if (spec.httpsOnly && u.protocol !== 'https:') {
          issues.push(issue('PARAM_URL_NOT_HTTPS', 'error', `${label} must use https`, at));
        }
      } catch {
        issues.push(issue('PARAM_INVALID_URL', 'error', `${label} must be a valid URL`, at));
      }
      break;
    }
    case 'email': {
      if (!EMAIL_RE.test(value)) {
        issues.push(issue('PARAM_INVALID_EMAIL', 'error', `${label} must be a valid email address`, at));
      }
      break;
    }
    case 'timezone': {
      if (!isValidTimezone(value)) {
        issues.push(issue('PARAM_INVALID_TIMEZONE', 'error', `${label} must be a valid IANA timezone`, at));
      }
      break;
    }
  }

  return issues;
}

/** Whether a row carries any typed-spec field at all (vs. a plain legacy/custom var). */
function hasParamSpec(spec: AppEnvVar): boolean {
  return (
    spec.type !== undefined ||
    spec.required !== undefined ||
    spec.pattern !== undefined ||
    spec.minLength !== undefined ||
    spec.maxLength !== undefined ||
    spec.min !== undefined ||
    spec.max !== undefined ||
    spec.options !== undefined ||
    spec.trueValue !== undefined ||
    spec.falseValue !== undefined ||
    spec.httpsOnly !== undefined ||
    spec.generate !== undefined
  );
}

/**
 * Validate every row's stored `value` against its own spec.
 *
 * By default every row is validated (including legacy/custom rows — see the
 * module doc comment for why that's safe and intentional). Pass
 * `skipCustom: true` to skip rows with no typed-spec field at all, for
 * callers that only want to surface issues for manifest-declared params.
 */
export function validateParams(env: AppEnvVar[], opts?: { skipCustom?: boolean }): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const spec of env) {
    if (opts?.skipCustom && !hasParamSpec(spec)) continue;
    issues.push(...validateParamValue(spec, spec.value));
  }
  return issues;
}

/**
 * Lint a param spec itself (not a value) for internal inconsistencies —
 * typos and impossible constraints a manifest author would want caught in CI.
 * The apps repo's manifest CI treats every result as build-failing; the
 * server only logs these as warnings at catalog-load time (an old manifest
 * with a stale/typo'd spec should never fail to install).
 *
 * Deliberately NOT the place for "unknown type" runtime degrade-to-untyped
 * behavior — that's the server's catalog coercion (PR 2). This function just
 * reports the spec as malformed so CI can catch the typo at authoring time.
 */
export function validateParamSpec(spec: AppEnvVar): ValidationIssue[] {
  const at = `env.${spec.key}`;
  const issues: ValidationIssue[] = [];

  if (spec.type !== undefined && !PARAM_TYPES.has(spec.type)) {
    issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: unknown param type '${spec.type}'`, at));
  }

  if (spec.pattern !== undefined) {
    try {
      new RegExp(spec.pattern);
    } catch {
      issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: 'pattern' does not compile as a regular expression`, at));
    }
  }

  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: 'min' (${spec.min}) is greater than 'max' (${spec.max})`, at));
  }

  if (spec.minLength !== undefined && spec.maxLength !== undefined && spec.minLength > spec.maxLength) {
    issues.push(issue('PARAM_INVALID_SPEC', 'error',
      `${spec.key}: 'minLength' (${spec.minLength}) is greater than 'maxLength' (${spec.maxLength})`, at));
  }

  if (spec.type === 'enum') {
    if (!spec.options || spec.options.length === 0) {
      issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: type 'enum' requires at least one option`, at));
    } else if (spec.value !== '' && !spec.options.some((o) => o.value === spec.value)) {
      issues.push(issue('PARAM_INVALID_SPEC', 'error',
        `${spec.key}: default value '${spec.value}' is not one of the declared options`, at));
    }
  }

  if (spec.generate !== undefined && spec.isSecret !== true) {
    issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: 'generate' is only meaningful when isSecret is true`, at));
  }

  if (spec.type === 'boolean') {
    if (spec.trueValue !== undefined && spec.trueValue === spec.falseValue) {
      issues.push(issue('PARAM_INVALID_SPEC', 'error', `${spec.key}: 'trueValue' and 'falseValue' must differ`, at));
    }
    if (spec.value !== '') {
      const trueValue = spec.trueValue ?? 'true';
      const falseValue = spec.falseValue ?? 'false';
      if (spec.value !== trueValue && spec.value !== falseValue) {
        issues.push(issue('PARAM_INVALID_SPEC', 'error',
          `${spec.key}: default value '${spec.value}' is neither trueValue nor falseValue`, at));
      }
    }
  }

  return issues;
}

// --- secret generation --------------------------------------------------
//
// Web Crypto (`crypto.getRandomValues`) rather than Node's `crypto` module —
// this file is bundled into the browser (web's install wizard "generate"
// wand) as well as run under Bun (server/CLI), and only Web Crypto works in
// both. Base64 is hand-rolled for the same reason: `Buffer` isn't available
// in a browser bundle.

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Mint a secret value per a manifest's `generate` recipe, for the install
 * wizard's wand and non-interactive CLI installs.
 */
export function generateSecretValue(gen: ParamGenerate): string {
  if (gen.kind === 'fernet') {
    // Fernet keys are a fixed 32-byte key; `length` doesn't apply.
    return bytesToBase64Url(randomBytes(32));
  }
  const length = gen.length ?? 32;
  const bytes = randomBytes(length);
  return gen.kind === 'hex' ? bytesToHex(bytes) : bytesToBase64Url(bytes);
}
