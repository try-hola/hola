import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { runInit } from '../commands/init/init';
import { scriptedPrompter } from '../install/prompter';

const noChecks = async () => [];

const baseAnswers: Record<string, string> = {
  HOLA_BASE_DOMAIN: 'hola.example.com',
  HOLA_DOMAIN: 'app.hola.example.com',
  TRAEFIK_DASHBOARD_DOMAIN: 'traefik.hola.example.com',
  LETSENCRYPT_EMAIL: 'admin@example.com',
  ACME_DNS_PROVIDER: 'route53',
  AWS_ACCESS_KEY_ID: 'AKIA123',
  AWS_SECRET_ACCESS_KEY: 'secret123',
  AWS_REGION: 'us-east-1',
  HOLA_CATALOG_URL: 'https://example.com/catalog.json',
  HOLA_AUTH_MODE: 'none',
  HOLA_USE_AUTH: 'true',
  HOLA_API_KEY: '',
};

describe('hola init', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'hola-init-'));
    process.exitCode = 0;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('writes a .env with the resolved user-facing keys', async () => {
    const out = join(dir, '.env');
    const res = await runInit(
      { out, skipChecks: true, json: true },
      { prompter: scriptedPrompter(baseAnswers), checks: noChecks }
    );

    expect(res?.target).toBe(out);
    const env = await readFile(out, 'utf8');
    expect(env).toContain('HOLA_BASE_DOMAIN=hola.example.com');
    expect(env).toContain('ACME_DNS_PROVIDER=route53');
    expect(env).toContain('AWS_SECRET_ACCESS_KEY=secret123');
    expect(process.exitCode).toBe(0);
  });

  it('preserves a host-generated secret and comments on a --force re-run', async () => {
    const out = join(dir, '.env');
    await writeFile(out, '# my notes\nHOLA_BASE_DOMAIN=old.example.com\nAUTHENTIK_SECRET_KEY=keep-me\n');

    await runInit(
      { out, force: true, skipChecks: true, json: true },
      { prompter: scriptedPrompter(baseAnswers), checks: noChecks }
    );

    const env = await readFile(out, 'utf8');
    expect(env).toContain('# my notes');
    expect(env).toContain('AUTHENTIK_SECRET_KEY=keep-me');
    expect(env).toContain('HOLA_BASE_DOMAIN=hola.example.com');
    expect(env).not.toContain('old.example.com');
  });

  it('refuses to overwrite an existing .env without --force', async () => {
    const out = join(dir, '.env');
    await writeFile(out, 'HOLA_BASE_DOMAIN=keep.example.com\n');

    const res = await runInit(
      { out, skipChecks: true, json: true },
      { prompter: scriptedPrompter(baseAnswers), checks: noChecks }
    );

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
    expect(await readFile(out, 'utf8')).toContain('keep.example.com'); // untouched
  });

  it('aborts with exit 1 on an invalid answer', async () => {
    const out = join(dir, '.env');
    const res = await runInit(
      { out, skipChecks: true, json: true },
      { prompter: scriptedPrompter({ ...baseAnswers, HOLA_BASE_DOMAIN: 'not a domain' }), checks: noChecks }
    );

    expect(res).toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('skips conditional fields when not applicable (none/http-01)', async () => {
    const out = join(dir, '.env');
    await runInit(
      { out, skipChecks: true, json: true },
      {
        prompter: scriptedPrompter({ ...baseAnswers, ACME_DNS_PROVIDER: '', HOLA_AUTH_MODE: 'none' }),
        checks: noChecks,
      }
    );
    const env = await readFile(out, 'utf8');
    // AWS creds weren't prompted, so the rendered value stays the schema-stub default (empty).
    expect(env).toMatch(/AWS_SECRET_ACCESS_KEY=\s*$/m);
  });
});
