import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { INSTALL_SCHEMA, defaultFor, secretKeys, systemTimeZone } from '../install/schema';
import { parseEnv, renderEnv, schemaTemplate } from '../install/render-env';
import { interdependencyErrors, isDomain, isEmail, isEmailOrEmpty, optionalSecret } from '../install/validate';
import { toClackValidate } from '../install/prompter';

describe('install schema', () => {
  it('derives HOLA_DOMAIN/AUTHENTIK domains from the base domain', () => {
    const holaDomain = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_DOMAIN')!;
    const authDomain = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_AUTHENTIK_DOMAIN')!;
    // The dashboard lists the collection of apps → plural `apps.<base>`.
    expect(defaultFor(holaDomain, { HOLA_BASE_DOMAIN: 'hola.example.com' })).toBe('apps.hola.example.com');
    expect(defaultFor(authDomain, { HOLA_BASE_DOMAIN: 'hola.example.com' })).toBe('auth.hola.example.com');
  });

  it('defaults SSO to authentik (secure by default) with it listed first', () => {
    const authMode = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_AUTH_MODE')!;
    expect(defaultFor(authMode, {})).toBe('authentik');
    expect(authMode.options?.[0]?.value).toBe('authentik');
  });

  it('reuses the first email (Let\'s Encrypt) as the default for the admin email', () => {
    const adminEmail = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_ADMIN_EMAIL')!;
    expect(defaultFor(adminEmail, { LETSENCRYPT_EMAIL: 'me@x.io' })).toBe('me@x.io');
    // Blank when no email was given yet.
    expect(defaultFor(adminEmail, {})).toBe('');
  });

  it('does NOT prompt for the akadmin (break-glass) email — it stays internal', () => {
    // Asking for it led operators to reuse one email for akadmin AND their named
    // admin, which collapsed "you" into akadmin. akadmin's address is a compose default.
    expect(INSTALL_SCHEMA.find((f) => f.key === 'AUTHENTIK_BOOTSTRAP_EMAIL')).toBeUndefined();
  });

  it('marks the AWS credential fields as reusable from the environment', () => {
    const fromEnv = INSTALL_SCHEMA.filter((f) => f.fromEnv).map((f) => f.key);
    expect(fromEnv).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_HOSTED_ZONE_ID']);
  });

  it("defaults the timezone to this machine's timezone", () => {
    const tz = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_DEFAULT_TZ')!;
    expect(defaultFor(tz, {})).toBe(systemTimeZone());
    // Intl resolves a real IANA zone on any CI host, so the default is non-empty there.
    expect(defaultFor(tz, {})).toMatch(/^[A-Za-z]+\/[A-Za-z]/);
  });

  it('gates conditional fields with requiredWhen', () => {
    const cf = INSTALL_SCHEMA.find((f) => f.key === 'CF_DNS_API_TOKEN')!;
    const aws = INSTALL_SCHEMA.find((f) => f.key === 'AWS_SECRET_ACCESS_KEY')!;
    const authDomain = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_AUTHENTIK_DOMAIN')!;
    expect(cf.requiredWhen!({ ACME_DNS_PROVIDER: 'cloudflare' })).toBe(true);
    expect(cf.requiredWhen!({ ACME_DNS_PROVIDER: 'route53' })).toBe(false);
    expect(aws.requiredWhen!({ ACME_DNS_PROVIDER: 'route53' })).toBe(true);
    expect(authDomain.requiredWhen!({ HOLA_AUTH_MODE: 'authentik' })).toBe(true);
    expect(authDomain.requiredWhen!({ HOLA_AUTH_MODE: 'none' })).toBe(false);
  });

  it('prompts the named admin only under authentik; username/name only once an email is given', () => {
    const email = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_ADMIN_EMAIL')!;
    const username = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_ADMIN_USERNAME')!;
    const name = INSTALL_SCHEMA.find((f) => f.key === 'HOLA_ADMIN_NAME')!;

    expect(email.requiredWhen!({ HOLA_AUTH_MODE: 'authentik' })).toBe(true);
    expect(email.requiredWhen!({ HOLA_AUTH_MODE: 'none' })).toBe(false);

    // Username/name are skipped when no admin email was supplied.
    expect(username.requiredWhen!({ HOLA_AUTH_MODE: 'authentik' })).toBe(false);
    expect(username.requiredWhen!({ HOLA_AUTH_MODE: 'authentik', HOLA_ADMIN_EMAIL: 'me@x.io' })).toBe(true);
    expect(name.requiredWhen!({ HOLA_AUTH_MODE: 'authentik', HOLA_ADMIN_EMAIL: 'me@x.io' })).toBe(true);

    // Username defaults to the email local part.
    expect(defaultFor(username, { HOLA_ADMIN_EMAIL: 'paul@x.io' })).toBe('paul');
  });

  it('allows a blank named-admin email (use akadmin) but rejects malformed', () => {
    expect(isEmailOrEmpty('', {})).toBeUndefined();
    expect(isEmailOrEmpty('me@x.io', {})).toBeUndefined();
    expect(isEmailOrEmpty('nope', {})).toBeDefined();
  });

  it('marks secret fields for redaction', () => {
    const secrets = secretKeys();
    expect(secrets.has('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(secrets.has('CF_DNS_API_TOKEN')).toBe(true);
    expect(secrets.has('HOLA_BASE_DOMAIN')).toBe(false);
  });

  it('keeps every schema key present in .env.example', () => {
    const examplePath = join(__dirname, '../../../compose/.env.example');
    const example = parseEnv(readFileSync(examplePath, 'utf8'));
    for (const field of INSTALL_SCHEMA) {
      expect(example, `missing ${field.key} in .env.example`).toHaveProperty(field.key);
    }
  });
});

describe('validators', () => {
  it('accepts valid domains/emails and rejects bad ones', () => {
    expect(isDomain('gitea.hola.example.com', {})).toBeUndefined();
    expect(isDomain('https://x.com', {})).toBeDefined();
    expect(isDomain('', {})).toBeDefined();
    expect(isEmail('a@b.co', {})).toBeUndefined();
    expect(isEmail('nope', {})).toBeDefined();
  });

  it('flags interdependency gaps', () => {
    expect(interdependencyErrors({ ACME_DNS_PROVIDER: 'route53' })).toHaveLength(1);
    expect(interdependencyErrors({ ACME_DNS_PROVIDER: 'route53', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 'b' })).toHaveLength(0);
    expect(interdependencyErrors({ ACME_DNS_PROVIDER: 'cloudflare' })).toHaveLength(1);
    expect(interdependencyErrors({ HOLA_AUTH_MODE: 'authentik' })).toHaveLength(1);
    expect(interdependencyErrors({ HOLA_AUTH_MODE: 'none' })).toHaveLength(0);
  });

  // Regression: clack passes `undefined` (not '') when an optional field is
  // submitted blank. The prompter's coercion boundary must hand validators a
  // string so they don't crash on `v.trim()` of undefined.
  it('coerces a blank (undefined) optional submission before validating', () => {
    const validator = optionalSecret();
    const adapted = toClackValidate((v) => validator(v, {}));
    expect(adapted).toBeDefined();
    expect(adapted!(undefined)).toBeUndefined();
    expect(adapted!('')).toBeUndefined();
    expect(adapted!('secret')).toBeUndefined();
    expect(adapted!(' padded ')).toBeDefined();
  });
});

describe('renderEnv', () => {
  it('replaces a key in place and preserves comments + unmanaged keys', () => {
    const base = [
      '# domains',
      'HOLA_DOMAIN=app.local.hola',
      'HOLA_BASE_DOMAIN=local.hola',
      '# generated by install.sh',
      'AUTHENTIK_SECRET_KEY=keep-me',
    ].join('\n') + '\n';
    const out = renderEnv({ HOLA_DOMAIN: 'app.hola.example.com', HOLA_BASE_DOMAIN: 'hola.example.com' }, base);
    expect(out).toContain('# domains');
    expect(out).toContain('HOLA_DOMAIN=app.hola.example.com');
    expect(out).toContain('HOLA_BASE_DOMAIN=hola.example.com');
    expect(out).toContain('AUTHENTIK_SECRET_KEY=keep-me'); // host-generated secret preserved
    expect(out).not.toContain('app.local.hola');
  });

  it('appends keys absent from the base', () => {
    const out = renderEnv({ NEW_KEY: 'v' }, 'EXISTING=1\n');
    expect(out).toContain('EXISTING=1');
    expect(out).toContain('NEW_KEY=v');
  });

  it('does not interpret $ in values', () => {
    const out = renderEnv({ TOK: 'a$&b' }, 'TOK=old\n');
    expect(out).toContain('TOK=a$&b');
  });

  it('schemaTemplate emits a documented stub for off-repo runs', () => {
    const t = schemaTemplate();
    expect(t).toContain('HOLA_BASE_DOMAIN=');
    expect(t).toContain('ACME_DNS_PROVIDER=');
  });
});
