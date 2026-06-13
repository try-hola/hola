/**
 * Compose network attachment tests (#15/#16 routing last-mile).
 *
 * The ingress service of a deployed app must join the external Traefik network
 * with an alias equal to the routing service name, so Traefik can reach it.
 */

import { describe, test, expect } from 'bun:test';
import { parse } from 'yaml';

import { attachToHolaNetwork } from '../../services/core/compose-network';

describe('attachToHolaNetwork', () => {
  test('attaches a single-service app to the hola network with the alias and keeps default', () => {
    const input = 'services:\n  gitea:\n    image: gitea/gitea\n';
    const out = parse(attachToHolaNetwork(input, { alias: 'gitea-abc123', ingressService: 'gitea' }));

    expect(out.networks.hola).toEqual({ external: true });
    expect(out.services.gitea.networks.hola).toEqual({ aliases: ['gitea-abc123'] });
    // No declared networks -> preserve implicit default connectivity.
    expect(out.services.gitea.networks.default).toEqual({});
  });

  test('exposes the named ingress service in a multi-service app, not the first', () => {
    const input = [
      'services:',
      '  db:',
      '    image: postgres',
      '  gitea:',
      '    image: gitea/gitea',
      '',
    ].join('\n');
    const out = parse(attachToHolaNetwork(input, { alias: 'gitea-xyz', ingressService: 'gitea' }));

    expect(out.services.gitea.networks.hola).toEqual({ aliases: ['gitea-xyz'] });
    expect(out.services.db.networks).toBeUndefined(); // db not exposed
  });

  test('preserves an explicitly declared network and adds hola', () => {
    const input = 'services:\n  app:\n    image: app\n    networks:\n      - backend\nnetworks:\n  backend: {}\n';
    const out = parse(attachToHolaNetwork(input, { alias: 'app-1' }));

    expect(out.services.app.networks.backend).toEqual({});
    expect(out.services.app.networks.hola).toEqual({ aliases: ['app-1'] });
    // Did not force the default network onto a service that declared its own.
    expect(out.services.app.networks.default).toBeUndefined();
  });

  test('falls back to the first service when the named ingress is absent', () => {
    const input = 'services:\n  web:\n    image: web\n';
    const out = parse(attachToHolaNetwork(input, { alias: 'a-1', ingressService: 'missing' }));
    expect(out.services.web.networks.hola).toEqual({ aliases: ['a-1'] });
  });

  test('returns the input unchanged when there are no services', () => {
    const input = 'networks:\n  x: {}\n';
    expect(attachToHolaNetwork(input, { alias: 'a-1' })).toBe(input);
  });
});
