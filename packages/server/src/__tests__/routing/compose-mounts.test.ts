/**
 * apps-data read-only mount injection (ADR 0002, backup Phase 2).
 *
 * The server grants a trusted app read-only access to all app data roots by
 * injecting an identity-mapped `<base>:<base>:ro` mount into every service.
 */

import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { injectReadonlyMount } from '../../services/core/compose-mounts';

const ROOT = '/srv/hola/apps';
const out = (yaml: string) => parse(injectReadonlyMount(yaml, { hostPath: ROOT }));

describe('injectReadonlyMount', () => {
  test('adds the read-only mount to every service, preserving existing volumes', () => {
    const input = [
      'services:',
      '  backrest:',
      '    image: garethgeorge/backrest:v1',
      '    volumes:',
      '      - ${HOLA_APP_DATA}/config:/config',
      '  helper:',
      '    image: alpine:3',
      '',
    ].join('\n');
    const doc = out(input);

    expect(doc.services.backrest.volumes).toEqual([
      '${HOLA_APP_DATA}/config:/config',
      `${ROOT}:${ROOT}:ro`,
    ]);
    expect(doc.services.helper.volumes).toEqual([`${ROOT}:${ROOT}:ro`]);
  });

  test('is idempotent (no duplicate mount)', () => {
    const once = injectReadonlyMount('services:\n  app:\n    image: app:1\n', { hostPath: ROOT });
    const twice = injectReadonlyMount(once, { hostPath: ROOT });
    expect(parse(twice).services.app.volumes).toEqual([`${ROOT}:${ROOT}:ro`]);
  });

  test('no services -> returns input unchanged', () => {
    const input = 'networks:\n  hola:\n    external: true\n';
    expect(injectReadonlyMount(input, { hostPath: ROOT })).toBe(input);
  });
});
