import { describe, test, expect } from 'bun:test';
import { DEFAULT_TAILSCALE_IMAGE, tailscaleImage } from '../../services/core/platform-images';

describe('platform images (spec 010)', () => {
  test('the default is an exact tag@digest pin', () => {
    expect(DEFAULT_TAILSCALE_IMAGE).toMatch(/^tailscale\/tailscale:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
    expect(tailscaleImage({})).toBe(DEFAULT_TAILSCALE_IMAGE);
    expect(tailscaleImage({ HOLA_TAILSCALE_IMAGE: '  ' })).toBe(DEFAULT_TAILSCALE_IMAGE);
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
