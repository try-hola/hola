import { describe, it, expect } from 'vitest';

import { camelKeys, streamOpts } from '../lib/opts';

describe('camelKeys', () => {
  it('camelCases kebab-case flag keys (the sade/mri multi-word fix)', () => {
    const out = camelKeys({
      'env-file': '/tmp/x',
      'skip-checks': true,
      'tarball-url': 'https://e/x.tgz',
      'dry-run': true,
    });
    expect(out).toEqual({
      envFile: '/tmp/x',
      skipChecks: true,
      tarballUrl: 'https://e/x.tgz',
      dryRun: true,
    });
  });

  it('leaves single-word keys (and mri --no-x → {x:false}) untouched', () => {
    const out = camelKeys({ host: 'me@vm', json: false, stream: false, _: ['a'] });
    expect(out).toEqual({ host: 'me@vm', json: false, stream: false, _: ['a'] });
  });
});

describe('streamOpts (--no-stream normalization)', () => {
  it('sets noStream=true when sade parsed --no-stream into {stream:false}', () => {
    // Reproduces sade/mri: `--no-stream` becomes `{ stream: false }`, never `noStream`.
    expect(streamOpts({ stream: false }).noStream).toBe(true);
  });

  it('leaves noStream=false when the flag is absent', () => {
    expect(streamOpts({}).noStream).toBe(false);
    expect(streamOpts({ stream: true }).noStream).toBe(false);
  });

  it('still honors an explicit noStream:true', () => {
    expect(streamOpts({ noStream: true }).noStream).toBe(true);
  });
});
