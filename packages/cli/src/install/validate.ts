// Pure, offline validators for install fields. Each returns an error message
// string when invalid, or undefined when valid. No network — live checks live in
// checks.ts.

import type { ConfigMap } from './schema';

type Validator = (v: string, c: ConfigMap) => string | undefined;

// A hostname like app.hola.example.com: dot-separated labels, alnum + hyphen,
// no leading/trailing hyphen, at least two labels.
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isDomain: Validator = (v) => {
  const t = v.trim();
  if (!t) return 'A domain is required';
  if (t.includes('://') || t.includes('/')) return 'Enter a bare hostname (no scheme or path)';
  if (!DOMAIN_RE.test(t)) return 'Not a valid domain name';
  return undefined;
};

export const isEmail: Validator = (v) => {
  const t = v.trim();
  if (!t) return 'An email is required';
  if (!EMAIL_RE.test(t)) return 'Not a valid email address';
  return undefined;
};

/** A URL is fine, and so is empty (blank disables the catalog). */
export const isUrlOrEmpty: Validator = (v) => {
  const t = v.trim();
  if (!t) return undefined;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'URL must be http(s)';
    return undefined;
  } catch {
    return 'Not a valid URL';
  }
};

/** Required non-empty field with a friendly label. */
export function required(label: string): Validator {
  return (v) => (v.trim() ? undefined : `${label} is required`);
}

/** Optional secret: empty allowed; otherwise no whitespace. */
export function optionalSecret(): Validator {
  return (v) => (v.trim() === v ? undefined : 'Value must not have leading/trailing whitespace');
}

/** Run several validators in order, returning the first error. */
export function combine(...validators: Validator[]): Validator {
  return (v, c) => {
    for (const fn of validators) {
      const err = fn(v, c);
      if (err) return err;
    }
    return undefined;
  };
}

/**
 * Cross-field interdependency checks run as a final batch before writing. Returns
 * a list of error messages (empty when the config is internally consistent).
 */
export function interdependencyErrors(c: ConfigMap): string[] {
  const errors: string[] = [];
  if (c.ACME_DNS_PROVIDER === 'route53') {
    if (!c.AWS_ACCESS_KEY_ID?.trim() || !c.AWS_SECRET_ACCESS_KEY?.trim()) {
      errors.push('DNS-01 via Route 53 requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }
  }
  if (c.ACME_DNS_PROVIDER === 'cloudflare' && !c.CF_DNS_API_TOKEN?.trim()) {
    errors.push('DNS-01 via Cloudflare requires CF_DNS_API_TOKEN');
  }
  if (c.HOLA_AUTH_MODE === 'authentik' && !c.HOLA_AUTHENTIK_DOMAIN?.trim()) {
    errors.push('HOLA_AUTH_MODE=authentik requires HOLA_AUTHENTIK_DOMAIN');
  }
  return errors;
}
