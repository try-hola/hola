/**
 * compose-defaults config: honors HOLA_DEFAULT_* env with documented fallbacks.
 */

import { describe, test, expect, afterEach } from 'bun:test';

import { loadComposeDefaultsConfig } from '../../config/compose-defaults';

const KEYS = [
  'HOLA_DEFAULT_RESTART_POLICY',
  'HOLA_DEFAULT_LOG_MAX_SIZE',
  'HOLA_DEFAULT_LOG_MAX_FILE',
  'HOLA_DEFAULT_NO_NEW_PRIVILEGES',
  'HOLA_DEFAULT_TZ',
  'HOLA_DEFAULT_MEM_LIMIT',
  'HOLA_DEFAULT_CPUS',
];

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe('loadComposeDefaultsConfig', () => {
  test('defaults when env is unset', () => {
    for (const k of KEYS) delete process.env[k];
    expect(loadComposeDefaultsConfig()).toEqual({
      restartPolicy: 'unless-stopped',
      logMaxSize: '10m',
      logMaxFile: '3',
      noNewPrivileges: true,
      tz: undefined,
      memLimit: undefined,
      cpus: undefined,
    });
  });

  test('env overrides are honored; no-new-privileges disables on "false"', () => {
    process.env.HOLA_DEFAULT_RESTART_POLICY = '';
    process.env.HOLA_DEFAULT_NO_NEW_PRIVILEGES = 'false';
    process.env.HOLA_DEFAULT_TZ = 'UTC';
    process.env.HOLA_DEFAULT_MEM_LIMIT = '512m';
    process.env.HOLA_DEFAULT_CPUS = '1.5';

    const cfg = loadComposeDefaultsConfig();
    expect(cfg.restartPolicy).toBe('');
    expect(cfg.noNewPrivileges).toBe(false);
    expect(cfg.tz).toBe('UTC');
    expect(cfg.memLimit).toBe('512m');
    expect(cfg.cpus).toBe('1.5');
  });
});
