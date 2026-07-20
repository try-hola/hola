/**
 * A blocked/failed bundle pull must fail draft creation with the REAL reason.
 *
 * Regression for the reported bug: adding a custom catalog source without
 * `allowRegistries` and installing from it produced a draft anyway. The
 * REF_NOT_ALLOWED thrown by the allowlist was swallowed by getDraftDefaults'
 * blanket catch, which substituted placeholder defaults (APP_PORT=8080, ports
 * 8080:80, no defaultEnv, empty composeOverride). That bogus draft finalized,
 * a release was cut with no compose, and the operator's first sign of trouble
 * was the deploy job failing with "Active release has no compose file" —
 * nine seconds after the real cause had been logged as a WARN.
 *
 * The rule: only "this app has no bundle" (BundleUnavailableError) may fall
 * back. Every hard failure (blocked registry, denied/unreachable pull, bad
 * credential, malformed bundle) propagates.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { BundleError, BundleUnavailableError } from '../../middleware/error-mapping';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const APP = { id: 'get2know-cms', name: 'get2know CMS', icon: '📝' };

/** Catalog whose getVersionDetail fails the way the reported install did. */
function makeCatalog(failure: unknown): CatalogArg {
  return {
    getApp: async () => APP,
    getVersionDetail: async () => { throw failure; },
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

describe('bundle pull failures surface at draft creation', () => {
  let dataRoot: string;

  beforeEach(async () => { dataRoot = await mkdtemp(join(tmpdir(), 'hola-bundlefail-')); });
  afterEach(async () => { await rm(dataRoot, { recursive: true, force: true }); });

  const makeDrafts = (failure: unknown) =>
    new RealDraftService(new RealStorageService({ holaDir: dataRoot }), makeCatalog(failure), makeValidation());

  test('a blocked registry fails the install instead of producing a placeholder draft', async () => {
    const blocked = new BundleError(
      'REF_NOT_ALLOWED',
      'REF_NOT_ALLOWED: ghcr.io/pofallon/hola-get2know-cms:0.1.13 is not covered by the registry allowlist (ghcr.io/try-hola/*).',
      { status: 403 },
    );
    const drafts = makeDrafts(blocked);

    let err: unknown;
    try {
      await drafts.createDraft({ appId: 'get2know-cms', version: '0.1.13', source: 'pofallon' });
    } catch (e) { err = e; }

    // The real reason reaches the caller, naming the ref and the allowlist.
    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).code).toBe('REF_NOT_ALLOWED');
    expect((err as BundleError).status).toBe(403);
    expect((err as Error).message).toContain('hola-get2know-cms:0.1.13');
    expect((err as Error).message).toContain('allowlist');
  });

  test.each([
    ['ORAS_PULL_FAILED', new BundleError('ORAS_PULL_FAILED', 'ORAS_PULL_FAILED: could not pull x: 401 Unauthorized')],
    ['CREDENTIAL_NOT_FOUND', new BundleError('CREDENTIAL_NOT_FOUND', 'CREDENTIAL_NOT_FOUND: gone', { status: 400 })],
    ['INVALID_BUNDLE_LAYOUT', new BundleError('INVALID_BUNDLE_LAYOUT', 'INVALID_BUNDLE_LAYOUT: no manifest.json', { status: 422 })],
    ['MANIFEST_UNAVAILABLE', new BundleError('MANIFEST_UNAVAILABLE', 'MANIFEST_UNAVAILABLE: bad json', { status: 422 })],
    ['SIGNATURE_VERIFICATION_FAILED', new BundleError('SIGNATURE_VERIFICATION_FAILED', 'SIGNATURE_VERIFICATION_FAILED: x')],
  ])('%s propagates rather than falling back', async (_label, failure) => {
    const drafts = makeDrafts(failure);
    await expect(
      drafts.createDraft({ appId: 'get2know-cms', source: 'pofallon' }),
    ).rejects.toBeInstanceOf(BundleError);
  });

  test('an unexpected error still propagates — the fallback is opt-in, not default', async () => {
    // Anything not explicitly marked "no bundle here" is treated as a hard
    // failure. A new failure mode added later fails loudly by default.
    const drafts = makeDrafts(new Error('something nobody anticipated'));
    await expect(
      drafts.createDraft({ appId: 'get2know-cms', source: 'pofallon' }),
    ).rejects.toThrow('something nobody anticipated');
  });

  test('a genuinely bundle-less app still falls back to generic defaults', async () => {
    // The legitimate case this catch existed for: no OCI ref / unpublished
    // version, where the operator supplies their own compose. Must keep working.
    const drafts = makeDrafts(new BundleUnavailableError('NO_OCI_REF: get2know-cms@1.0.0', 'NO_OCI_REF'));

    const res = await drafts.createDraft({ appId: 'get2know-cms', source: 'pofallon' });

    expect(res.draftId).toBeTruthy();
    expect(res.appEnv.map(e => e.key)).toContain('APP_PORT');
    expect(res.defaults.ports).toEqual([{ host: 8080, container: 80, protocol: 'tcp' }]);
  });
});
