import { describe, it, expect } from 'vitest';

import { camelKeys } from '../lib/opts';

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
