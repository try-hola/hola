/**
 * coerceManifestEnvVar — narrow-shape coercion of a manifest's `defaultEnv[]`
 * row into an `AppEnvVar`, including the typed-param spec fields added by
 * ADR 0003 (declarative-drifting-tiger PR 2). Mirrors the manifest-auth/
 * manifest-upgrade coercion tests: malformed/unknown fields are dropped, never
 * thrown, so a sloppy or newer-vocabulary manifest degrades gracefully instead
 * of failing the whole bundle load.
 */
import { describe, test, expect } from 'bun:test';

import { coerceManifestEnvVar, coerceManifestConnect } from '../../services/core/catalog';
import type { Logger, LogContext } from '../../lib/logger';
import type { AppEnvVar } from '@hola/shared';

/** Captures warn() calls so tests can assert on forward-compat degrade logging. */
function makeSpyLogger(): { logger: Logger; warnings: Array<{ message: string; context?: LogContext }> } {
  const warnings: Array<{ message: string; context?: LogContext }> = [];
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: (message, context) => warnings.push({ message, context }),
    error: () => {},
    child: () => logger,
  };
  return { logger, warnings };
}

const ctx = { appId: 'fixtureapp', version: '1.0.0' };

describe('coerceManifestEnvVar', () => {
  test('coerces the legacy key/value/isSecret/description fields unchanged', () => {
    const { logger } = makeSpyLogger();
    const row = coerceManifestEnvVar(
      { key: 'APP_ENV', value: 'production', isSecret: false, description: 'Environment name' },
      logger,
      ctx,
    );
    expect(row).toEqual({
      key: 'APP_ENV',
      value: 'production',
      isSecret: false,
      description: 'Environment name',
    });
  });

  test('never throws on a malformed/non-object row and returns sane defaults', () => {
    const { logger } = makeSpyLogger();
    expect(coerceManifestEnvVar(null, logger, ctx)).toEqual({ key: '', value: '', isSecret: false, description: undefined });
    expect(coerceManifestEnvVar(undefined, logger, ctx)).toEqual({ key: '', value: '', isSecret: false, description: undefined });
    expect(coerceManifestEnvVar('nonsense', logger, ctx)).toEqual({ key: '', value: '', isSecret: false, description: undefined });
  });

  test('an unknown/future type degrades to untyped and logs a warning, without throwing', () => {
    const { logger, warnings } = makeSpyLogger();
    const row = coerceManifestEnvVar(
      { key: 'WEIRD', value: 'x', isSecret: false, type: 'nonsense' },
      logger,
      ctx,
    );
    expect(row.type).toBeUndefined();
    expect(row.key).toBe('WEIRD');
    expect(warnings.some((w) => w.message.includes('Unknown env param type'))).toBe(true);
    expect(warnings.find((w) => w.message.includes('Unknown env param type'))?.context).toMatchObject({
      appId: 'fixtureapp',
      version: '1.0.0',
      key: 'WEIRD',
      type: 'nonsense',
    });
  });

  test('carries a full, valid typed spec through', () => {
    const { logger } = makeSpyLogger();
    const row = coerceManifestEnvVar(
      {
        key: 'DOMAIN',
        value: 'https://example.com',
        isSecret: false,
        label: 'Domain',
        type: 'url',
        required: true,
        advanced: false,
        placeholder: 'https://app.example.com',
        httpsOnly: true,
      },
      logger,
      ctx,
    );
    expect(row).toMatchObject({
      key: 'DOMAIN',
      value: 'https://example.com',
      label: 'Domain',
      type: 'url',
      required: true,
      advanced: false,
      placeholder: 'https://app.example.com',
      httpsOnly: true,
    });
  });

  test('required tri-state: only literal true/false survive, everything else stays undefined', () => {
    const { logger } = makeSpyLogger();
    expect(coerceManifestEnvVar({ key: 'A', value: '', isSecret: false, required: true }, logger, ctx).required).toBe(true);
    expect(coerceManifestEnvVar({ key: 'A', value: '', isSecret: false, required: false }, logger, ctx).required).toBe(false);
    expect(coerceManifestEnvVar({ key: 'A', value: '', isSecret: false, required: 'yes' }, logger, ctx).required).toBeUndefined();
    expect(coerceManifestEnvVar({ key: 'A', value: '', isSecret: false }, logger, ctx).required).toBeUndefined();
  });

  test('carries enum options, dropping malformed entries', () => {
    const { logger } = makeSpyLogger();
    const row = coerceManifestEnvVar(
      {
        key: 'LOG_LEVEL',
        value: 'info',
        isSecret: false,
        type: 'enum',
        options: [
          { value: 'debug', label: 'Debug' },
          { value: 'info' },
          { notValue: 'bad' },
          'also bad',
          { value: 42 },
        ],
      },
      logger,
      ctx,
    );
    expect(row.options).toEqual([
      { value: 'debug', label: 'Debug', description: undefined },
      { value: 'info', label: undefined, description: undefined },
    ]);
  });

  test('carries a generate recipe only when kind is a known value; drops the whole field otherwise', () => {
    const { logger } = makeSpyLogger();
    const good = coerceManifestEnvVar(
      { key: 'SECRET', value: '', isSecret: true, generate: { kind: 'hex', length: 32 } },
      logger,
      ctx,
    );
    expect(good.generate).toEqual({ kind: 'hex', length: 32 });

    const bad = coerceManifestEnvVar(
      { key: 'SECRET', value: '', isSecret: true, generate: { kind: 'rot13' } },
      logger,
      ctx,
    );
    expect(bad.generate).toBeUndefined();
  });

  test('logs a spec-lint warning (never throws) for an internally inconsistent spec', () => {
    const { logger, warnings } = makeSpyLogger();
    const row = coerceManifestEnvVar(
      { key: 'PORT', value: '80', isSecret: false, type: 'integer', min: 100, max: 10 },
      logger,
      ctx,
    );
    // The row itself is still returned (min/max carried as-is) — only a warning is logged.
    expect(row.min).toBe(100);
    expect(row.max).toBe(10);
    expect(warnings.some((w) => w.message.includes('Manifest env param spec has issues'))).toBe(true);
  });
});

describe('coerceManifestConnect (#356)', () => {
  const appEnv: AppEnvVar[] = [{ key: 'REMO_WEB_API_TOKEN', value: 'abc', isSecret: true }];

  test('keeps a valid block whose keyEnv names a real app-env var', () => {
    expect(
      coerceManifestConnect(
        { keyEnv: 'REMO_WEB_API_TOKEN', label: 'Adopt this instance', help: 'run {url} with {code}' },
        appEnv,
      ),
    ).toEqual({ keyEnv: 'REMO_WEB_API_TOKEN', label: 'Adopt this instance', help: 'run {url} with {code}' });
  });

  test('drops the block when keyEnv does not match any app-env var', () => {
    expect(coerceManifestConnect({ keyEnv: 'NOPE' }, appEnv)).toBeUndefined();
  });

  test('drops malformed/missing input', () => {
    expect(coerceManifestConnect(undefined, appEnv)).toBeUndefined();
    expect(coerceManifestConnect({}, appEnv)).toBeUndefined();
    expect(coerceManifestConnect({ keyEnv: 123 }, appEnv)).toBeUndefined();
    expect(coerceManifestConnect('nope', appEnv)).toBeUndefined();
  });

  test('omits optional label/help when absent', () => {
    expect(coerceManifestConnect({ keyEnv: 'REMO_WEB_API_TOKEN' }, appEnv)).toEqual({ keyEnv: 'REMO_WEB_API_TOKEN' });
  });
});
