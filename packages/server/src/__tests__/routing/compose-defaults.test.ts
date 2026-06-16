/**
 * Platform-defaults transform tests.
 *
 * applyPlatformDefaults injects install-wide operational defaults (restart, log
 * rotation, no-new-privileges, optional TZ/limits) onto EVERY service of a
 * deployed app's compose, with explicit precedence: the app wins for
 * fill-if-absent fields; no-new-privileges is additive.
 */

import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { applyPlatformDefaults } from '../../services/core/compose-defaults';
import type { ComposeDefaultsConfig } from '../../config/compose-defaults';

const ON: ComposeDefaultsConfig = {
  restartPolicy: 'unless-stopped',
  logMaxSize: '10m',
  logMaxFile: '3',
  noNewPrivileges: true,
};

const out = (yaml: string, opts: ComposeDefaultsConfig = ON) => parse(applyPlatformDefaults(yaml, opts));

describe('applyPlatformDefaults', () => {
  test('fills restart, logging, and no-new-privileges on a bare service', () => {
    const doc = out('services:\n  app:\n    image: app:1\n');
    expect(doc.services.app.restart).toBe('unless-stopped');
    expect(doc.services.app.logging).toEqual({
      driver: 'json-file',
      options: { 'max-size': '10m', 'max-file': '3' },
    });
    expect(doc.services.app.security_opt).toEqual(['no-new-privileges:true']);
  });

  test('app wins for restart and logging (fill-if-absent)', () => {
    const input = [
      'services:',
      '  app:',
      '    image: app:1',
      '    restart: "no"',
      '    logging:',
      '      driver: syslog',
      '',
    ].join('\n');
    const doc = out(input);
    expect(doc.services.app.restart).toBe('no');
    expect(doc.services.app.logging).toEqual({ driver: 'syslog' });
  });

  test('no-new-privileges is appended, preserving app security_opt and deduped', () => {
    const input = [
      'services:',
      '  app:',
      '    image: app:1',
      '    security_opt:',
      '      - seccomp:unconfined',
      '',
    ].join('\n');
    const doc = out(input);
    expect(doc.services.app.security_opt).toEqual(['seccomp:unconfined', 'no-new-privileges:true']);

    // Already present -> not duplicated.
    const already = out('services:\n  app:\n    image: app:1\n    security_opt:\n      - no-new-privileges:true\n');
    expect(already.services.app.security_opt).toEqual(['no-new-privileges:true']);
  });

  test('applies to every service, not just the first/ingress', () => {
    const input = 'services:\n  app:\n    image: app:1\n  db:\n    image: postgres:16\n';
    const doc = out(input);
    expect(doc.services.app.restart).toBe('unless-stopped');
    expect(doc.services.db.restart).toBe('unless-stopped');
    expect(doc.services.db.security_opt).toEqual(['no-new-privileges:true']);
  });

  test('TZ is added when configured, app wins if already set (array + map env)', () => {
    const opts: ComposeDefaultsConfig = { ...ON, tz: 'America/New_York' };

    const mapForm = out('services:\n  app:\n    image: app:1\n    environment:\n      FOO: bar\n', opts);
    expect(mapForm.services.app.environment).toEqual({ FOO: 'bar', TZ: 'America/New_York' });

    // App already sets TZ -> environment is left untouched (stays array form).
    const arrForm = out('services:\n  app:\n    image: app:1\n    environment:\n      - TZ=UTC\n', opts);
    expect(arrForm.services.app.environment).toEqual(['TZ=UTC']);
  });

  test('resource limits applied as service-level keys when set (fill-if-absent)', () => {
    const opts: ComposeDefaultsConfig = { ...ON, memLimit: '512m', cpus: '1.5' };
    const doc = out('services:\n  app:\n    image: app:1\n    mem_limit: 256m\n', opts);
    expect(doc.services.app.mem_limit).toBe('256m'); // app wins
    expect(doc.services.app.cpus).toBe('1.5'); // filled
  });

  test('disabled fields are skipped; all-off is a verbatim no-op', () => {
    const off: ComposeDefaultsConfig = { restartPolicy: '', logMaxSize: '', logMaxFile: '3', noNewPrivileges: false };
    const input = 'services:\n  app:\n    image: app:1\n';
    expect(applyPlatformDefaults(input, off)).toBe(input);
  });

  test('no services -> returns input unchanged', () => {
    const input = 'networks:\n  hola:\n    external: true\n';
    expect(applyPlatformDefaults(input, ON)).toBe(input);
  });
});
