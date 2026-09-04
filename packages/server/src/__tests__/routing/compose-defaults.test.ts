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

  describe('privilege escalation opt-out', () => {
    const withEscalation = (yaml: string, services: string[], opts: ComposeDefaultsConfig = ON) =>
      parse(applyPlatformDefaults(yaml, opts, { allowPrivilegeEscalationServices: services }));

    test('granted service does NOT get no-new-privileges (so sudo works)', () => {
      const doc = withEscalation('services:\n  webtop:\n    image: webtop:1\n', ['webtop']);
      // no security_opt key at all (Docker default no_new_privs unset).
      expect(doc.services.webtop.security_opt).toBeUndefined();
      // other platform defaults still apply.
      expect(doc.services.webtop.restart).toBe('unless-stopped');
    });

    test('grant strips an app-declared no-new-privileges:true, keeps other opts', () => {
      const input = [
        'services:',
        '  webtop:',
        '    image: webtop:1',
        '    security_opt:',
        '      - no-new-privileges:true',
        '      - seccomp:unconfined',
        '',
      ].join('\n');
      const doc = withEscalation(input, ['webtop']);
      expect(doc.services.webtop.security_opt).toEqual(['seccomp:unconfined']);
    });

    test('escalation is scoped to the named service; siblings stay hardened', () => {
      const input = 'services:\n  webtop:\n    image: webtop:1\n  db:\n    image: postgres:16\n';
      const doc = withEscalation(input, ['webtop']);
      expect(doc.services.webtop.security_opt).toBeUndefined();
      expect(doc.services.db.security_opt).toEqual(['no-new-privileges:true']);
    });

    test('escalation applies even when the install-wide config is a no-op', () => {
      const off: ComposeDefaultsConfig = { restartPolicy: '', logMaxSize: '', logMaxFile: '3', noNewPrivileges: false };
      const input = 'services:\n  webtop:\n    image: webtop:1\n    security_opt:\n      - no-new-privileges:true\n';
      const doc = parse(applyPlatformDefaults(input, off, { allowPrivilegeEscalationServices: ['webtop'] }));
      expect(doc.services.webtop.security_opt).toBeUndefined();
    });

    test('no escalation list -> hardening applied as usual', () => {
      const doc = withEscalation('services:\n  webtop:\n    image: webtop:1\n', []);
      expect(doc.services.webtop.security_opt).toEqual(['no-new-privileges:true']);
    });
  });
});

describe('platform labels (spec 004, FR-030/031)', () => {
  const OFF: ComposeDefaultsConfig = { restartPolicy: '', logMaxSize: '', logMaxFile: '3', noNewPrivileges: false };
  const LABELS = { 'sh.hola.app': 'postiz', 'sh.hola.deployment': 'postiz-1a2b', 'sh.hola.name': 'Postiz' };

  test('adds the three labels to every service, map form when labels are absent', () => {
    const doc = parse(applyPlatformDefaults('services:\n  app:\n    image: app:1\n  db:\n    image: postgres:16\n', ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual(LABELS);
    expect(doc.services.db.labels).toEqual(LABELS);
  });

  test('map-form labels merge, preserving user keys', () => {
    const input = 'services:\n  app:\n    image: app:1\n    labels:\n      com.example.x: "1"\n';
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual({ 'com.example.x': '1', ...LABELS });
  });

  test('list-form labels stay a list; entries appended, a duplicate key replaced', () => {
    const input = [
      'services:',
      '  app:',
      '    image: app:1',
      '    labels:',
      '      - com.example.x=1',
      '      - sh.hola.app=other',
      '',
    ].join('\n');
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual([
      'com.example.x=1',
      'sh.hola.app=postiz',
      'sh.hola.deployment=postiz-1a2b',
      'sh.hola.name=Postiz',
    ]);
  });

  test('a user-authored value under sh.hola. is overwritten; other user labels survive', () => {
    const input = 'services:\n  app:\n    image: app:1\n    labels:\n      sh.hola.app: bogus\n      com.example.x: "1"\n';
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual({ 'com.example.x': '1', ...LABELS });
  });

  test('a list-form user label named after an Object.prototype key survives untouched', () => {
    // `key in labels` would match `constructor`/`toString` through the prototype
    // chain and rewrite the entry to `<key>=undefined`, silently corrupting a
    // label the platform has no business touching.
    const input = 'services:\n  app:\n    image: app:1\n    labels:\n      - constructor=mine\n      - toString=also-mine\n';
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual([
      'constructor=mine',
      'toString=also-mine',
      'sh.hola.app=postiz',
      'sh.hola.deployment=postiz-1a2b',
      'sh.hola.name=Postiz',
    ]);
  });

  test('a user-authored label elsewhere under the reserved namespace is dropped, not kept', () => {
    // ADR 0004 §13 calls `sh.hola.` reserved. Leaving an app-authored key there
    // would let a bundle feed a collector that groups on the namespace whatever
    // it liked, under a prefix the platform vouches for.
    const input = [
      'services:',
      '  app:',
      '    image: app:1',
      '    labels:',
      '      sh.hola.app.origin: spoofed',
      '      com.example.x: "1"',
      '',
    ].join('\n');
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual({ 'com.example.x': '1', ...LABELS });
    expect(doc.services.app.labels['sh.hola.app.origin']).toBeUndefined();
  });

  test('the same holds for list form, and unparseable entries are preserved verbatim', () => {
    const input = [
      'services:',
      '  app:',
      '    image: app:1',
      '    labels:',
      '      - sh.hola.spoof=nope',
      '      - com.example.x=1',
      '      - 5',
      '',
    ].join('\n');
    const doc = parse(applyPlatformDefaults(input, ON, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual([
      'com.example.x=1',
      5,
      'sh.hola.app=postiz',
      'sh.hola.deployment=postiz-1a2b',
      'sh.hola.name=Postiz',
    ]);
  });

  test('an all-disabled install-wide config still rewrites when labels are present', () => {
    const doc = parse(applyPlatformDefaults('services:\n  app:\n    image: app:1\n', OFF, { labels: LABELS }));
    expect(doc.services.app.labels).toEqual(LABELS);
  });

  test('no labels runtime -> unchanged behaviour (no labels key added)', () => {
    const doc = parse(applyPlatformDefaults('services:\n  app:\n    image: app:1\n', ON));
    expect(doc.services.app.labels).toBeUndefined();
  });

  test('an empty labels object changes nothing', () => {
    const yaml = 'services:\n  app:\n    image: app:1\n';
    expect(applyPlatformDefaults(yaml, OFF, { labels: {} })).toBe(yaml);
  });
});
