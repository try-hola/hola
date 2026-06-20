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

  it('offers to install, hands the .env to bootstrap, and deletes it on success', async () => {
    const out = join(dir, '.env');
    const calls: Array<{ host?: string; envFile?: string }> = [];
    const res = await runInit(
      { out, skipChecks: true }, // interactive (no json) → the install offer runs
      {
        prompter: scriptedPrompter({ ...baseAnswers, _bootstrap: 'true', _host: 'paul@vm' }),
        checks: noChecks,
        bootstrap: async (o) => { calls.push(o); return { host: o.host!, dir: '/opt/hola', ref: 'cli-v9', steps: [] }; },
      }
    );

    expect(res?.target).toBe(out);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ host: 'paul@vm', envFile: out });
    // .env removed once its secrets are on the host.
    await expect(readFile(out, 'utf8')).rejects.toThrow();
  });

  it('keeps the .env with --keep-env after a successful install', async () => {
    const out = join(dir, '.env');
    await runInit(
      { out, skipChecks: true, keepEnv: true },
      {
        prompter: scriptedPrompter({ ...baseAnswers, _bootstrap: 'true', _host: 'paul@vm' }),
        checks: noChecks,
        bootstrap: async (o) => ({ host: o.host!, dir: '/opt/hola', ref: 'cli-v9', steps: [] }),
      }
    );
    expect(await readFile(out, 'utf8')).toContain('HOLA_BASE_DOMAIN=hola.example.com'); // still there
  });

  it('keeps the .env when bootstrap fails so the user can retry', async () => {
    const out = join(dir, '.env');
    await runInit(
      { out, skipChecks: true },
      {
        prompter: scriptedPrompter({ ...baseAnswers, _bootstrap: 'true', _host: 'paul@vm' }),
        checks: noChecks,
        bootstrap: async () => undefined, // bootstrap reported an error
      }
    );
    expect(await readFile(out, 'utf8')).toContain('HOLA_BASE_DOMAIN='); // preserved
  });

  it('does not call bootstrap when the install offer is declined', async () => {
    const out = join(dir, '.env');
    let called = false;
    await runInit(
      { out, skipChecks: true },
      {
        prompter: scriptedPrompter({ ...baseAnswers, _bootstrap: 'false', _host: 'paul@vm' }),
        checks: noChecks,
        bootstrap: async () => { called = true; return undefined; },
      }
    );
    expect(called).toBe(false);
    expect(await readFile(out, 'utf8')).toContain('HOLA_BASE_DOMAIN='); // kept for later
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
