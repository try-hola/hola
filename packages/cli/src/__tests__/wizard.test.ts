import { describe, it, expect } from 'vitest';

import { runWizard } from '../install/wizard';
import { scriptedPrompter } from '../install/prompter';

const noChecks = async () => [];

// Minimal answers for a route53 run; AWS_* are intentionally omitted so the
// wizard's env-reuse path supplies them.
const route53Base: Record<string, string> = {
  HOLA_BASE_DOMAIN: 'hola.example.com',
  HOLA_DOMAIN: 'apps.hola.example.com',
  TRAEFIK_DASHBOARD_DOMAIN: 'traefik.hola.example.com',
  LETSENCRYPT_EMAIL: 'me@example.com',
  ACME_DNS_PROVIDER: 'route53',
  HOLA_CATALOG_URL: 'https://example.com/catalog.json',
  HOLA_AUTH_MODE: 'none',
  HOLA_USE_AUTH: 'true',
  HOLA_API_KEY: '',
};

describe('runWizard — AWS credentials from the environment', () => {
  it('reuses AWS_* from the environment when the fields are accepted (left to default)', async () => {
    const env = { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: 'env-secret', AWS_REGION: 'eu-west-1' };
    const { config } = await runWizard({
      prompter: scriptedPrompter(route53Base),
      checks: noChecks,
      env,
    });
    expect(config.AWS_ACCESS_KEY_ID).toBe('AKIAENV');
    expect(config.AWS_SECRET_ACCESS_KEY).toBe('env-secret');
    expect(config.AWS_REGION).toBe('eu-west-1'); // env wins over the static us-east-1 default
  });

  it('accepts a blank answer for the masked secret as "use the detected value"', async () => {
    const env = { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: 'env-secret', AWS_REGION: 'us-east-1' };
    const { config } = await runWizard({
      // Explicitly submit the secret blank — the validator must not reject it.
      prompter: scriptedPrompter({ ...route53Base, AWS_SECRET_ACCESS_KEY: '' }),
      checks: noChecks,
      env,
    });
    expect(config.AWS_SECRET_ACCESS_KEY).toBe('env-secret');
  });

  it('ignores a corrupt "undefined" AWS secret in an existing .env and uses the env value', async () => {
    // A prior buggy release could write `AWS_SECRET_ACCESS_KEY=undefined` into .env.
    // On re-run that parsed value must not shadow the real environment credential.
    const env = { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: 'good-secret', AWS_REGION: 'us-east-1' };
    const { config } = await runWizard({
      prompter: scriptedPrompter(route53Base), // secret omitted → prompter returns the computed default
      initial: { AWS_SECRET_ACCESS_KEY: 'undefined' },
      checks: noChecks,
      env,
    });
    expect(config.AWS_SECRET_ACCESS_KEY).toBe('good-secret');
  });

  it('lets the live environment win over a stale AWS secret in an existing .env', async () => {
    // fromEnv fields are environment-sourced; the value the operator just exported
    // takes precedence over whatever an old .env still holds.
    const env = { AWS_ACCESS_KEY_ID: 'AKIAENV', AWS_SECRET_ACCESS_KEY: 'fresh-secret', AWS_REGION: 'us-east-1' };
    const { config } = await runWizard({
      prompter: scriptedPrompter(route53Base),
      initial: { AWS_SECRET_ACCESS_KEY: 'stale-old-secret', AWS_ACCESS_KEY_ID: 'AKIASTALE' },
      checks: noChecks,
      env,
    });
    expect(config.AWS_SECRET_ACCESS_KEY).toBe('fresh-secret');
    expect(config.AWS_ACCESS_KEY_ID).toBe('AKIAENV');
  });

  it('still prompts (and validates) when nothing is in the environment', async () => {
    await expect(
      runWizard({
        prompter: scriptedPrompter({ ...route53Base, AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '' }),
        checks: noChecks,
        env: {},
      })
    ).rejects.toThrow(/AWS access key ID is required/);
  });
});

describe('runWizard — new defaults flow through', () => {
  it('defaults your admin email to the first email and signs you in as yourself', async () => {
    // Provide only the base domain + first email; accept every other default.
    const { config } = await runWizard({
      prompter: scriptedPrompter({
        HOLA_BASE_DOMAIN: 'hola.example.com',
        LETSENCRYPT_EMAIL: 'paul@example.com',
        ACME_DNS_PROVIDER: '',
      }),
      checks: noChecks,
      env: {},
    });
    expect(config.HOLA_AUTH_MODE).toBe('authentik'); // secure by default
    expect(config.HOLA_DOMAIN).toBe('apps.hola.example.com'); // plural dashboard host
    expect(config.HOLA_ADMIN_EMAIL).toBe('paul@example.com');
    expect(config.HOLA_ADMIN_USERNAME).toBe('paul'); // local part of the admin email
    // The wizard does NOT set akadmin's email — it stays a separate internal account,
    // so your personal email never collides with the break-glass superuser.
    expect(config.AUTHENTIK_BOOTSTRAP_EMAIL).toBeUndefined();
  });
});
