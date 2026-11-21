import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TAILSCALE_IMAGE, parseTailscaleImagePin, tailscaleImage } from '../../services/core/platform-images';

const PIN = 'tailscale/tailscale:v1.104.7@sha256:' + 'a'.repeat(64);

describe('platform images (spec 010)', () => {
  test('the default is an exact tag@digest pin', () => {
    expect(DEFAULT_TAILSCALE_IMAGE).toMatch(/^tailscale\/tailscale:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(tailscaleImage({})).toBe(DEFAULT_TAILSCALE_IMAGE);
    expect(tailscaleImage({ HOLA_TAILSCALE_IMAGE: '  ' })).toBe(DEFAULT_TAILSCALE_IMAGE);
  });

  test('the default is the FROM reference of the pin file Dependabot updates (#592)', () => {
    const file = readFileSync(join(import.meta.dir, '../../../platform-images/tailscale/Dockerfile'), 'utf8');
    const from = file.split('\n').filter((line) => line.startsWith('FROM '));
    expect(from).toHaveLength(1);
    expect(DEFAULT_TAILSCALE_IMAGE).toBe(from[0].slice('FROM '.length));
    expect(parseTailscaleImagePin(file)).toBe(DEFAULT_TAILSCALE_IMAGE);
  });

  test('the pin parser accepts comments, blank lines and CRLF around one FROM', () => {
    expect(parseTailscaleImagePin(`# header\r\n\r\nFROM ${PIN}\r\n`)).toBe(PIN);
  });

  test.each([
    ['a missing digest', 'FROM tailscale/tailscale:v1.104.7\n'],
    ['a latest tag', `FROM tailscale/tailscale:latest@sha256:${'a'.repeat(64)}\n`],
    ['a short digest', 'FROM tailscale/tailscale:v1.104.7@sha256:abc\n'],
    ['a two-part version', `FROM tailscale/tailscale:v1.104@sha256:${'a'.repeat(64)}\n`],
    ['an unstable tag', `FROM tailscale/tailscale:unstable-v1.105.3@sha256:${'a'.repeat(64)}\n`],
    ['two FROM lines', `FROM ${PIN}\nFROM ${PIN}\n`],
    ['no FROM line', '# only a comment\n'],
    ['a different repository', `FROM evil/tailscale:v1.104.7@sha256:${'a'.repeat(64)}\n`],
    ['a registry prefix', `FROM ghcr.io/tailscale/tailscale:v1.104.7@sha256:${'a'.repeat(64)}\n`],
    ['a stage name', `FROM ${PIN} AS ts\n`],
    ['a platform flag', `FROM --platform=linux/amd64 ${PIN}\n`],
    ['another instruction', `FROM ${PIN}\nRUN true\n`],
  ])('the pin parser rejects %s', (_name, text) => {
    expect(() => parseTailscaleImagePin(text)).toThrow(/platform-images\/tailscale\/Dockerfile must/);
  });

  test.each(['foo/bar', 'foo/bar:latest', 'host:5000/foo/bar', 'foo/bar:latest@sha256:' + 'a'.repeat(64), 'a b:v1'])(
    'refuses unpinned override %s',
    (v) => {
      expect(() => tailscaleImage({ HOLA_TAILSCALE_IMAGE: v })).toThrow(/HOLA_TAILSCALE_IMAGE/);
    },
  );

  test.each(['mirror/ts:v1.104.7', 'registry.local:5000/ts:v1.104.7', 'foo/bar@sha256:' + 'b'.repeat(64)])(
    'accepts pinned override %s',
    (v) => {
      expect(tailscaleImage({ HOLA_TAILSCALE_IMAGE: v })).toBe(v);
    },
  );
});
