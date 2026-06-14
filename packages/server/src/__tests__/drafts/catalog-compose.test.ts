/**
 * Catalog → draft compose wiring (#82)
 *
 * A draft created from a catalog app must seed its composeOverride from the
 * bundle's compose.yaml (surfaced via CatalogService.getVersionDetail), so the
 * app can be deployed without the user pasting compose. These tests exercise the
 * real wiring (RealDraftService + MockCatalogService → mock-data) without Docker
 * or ORAS — MockCatalogService returns the same composeOverride a real bundle would.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { MockCatalogService } from '../../services/core/catalog';
import { RealStorageService } from '../../services/core/storage';
import { getCatalogAppVersionDetail } from '../../mock-data/catalog';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

// createDraft doesn't call the validation service (it uses the module-level
// assertComposeParses guard), so a minimal stub suffices.
function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

describe('Catalog → draft compose (#82)', () => {
  let dataRoot: string;
  let drafts: RealDraftService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-draft-'));
    const storage = new RealStorageService({ holaDir: dataRoot });
    drafts = new RealDraftService(storage, new MockCatalogService() as unknown as CatalogArg, makeValidation());
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('seeds composeOverride from the catalog bundle', async () => {
    const expected = getCatalogAppVersionDetail('nextcloud', '28.0.2')?.composeOverride;
    expect(expected).toBeTruthy();

    const { draftId } = await drafts.createDraft({ appId: 'nextcloud', version: '28.0.2' });
    const draft = await drafts.getDraft(draftId);

    expect(draft.composeOverride).toBe(expected!);
    expect(draft.composeOverride).toContain('nextcloud:30-apache');
  });

  test('the seeded compose flows through finalize into the manifest', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'nextcloud', version: '28.0.2' });
    const finalized = await drafts.finalizeDraft(draftId);
    expect(finalized.checksum).toBeTruthy();

    // The finalized release artifacts carry the bundle compose forward.
    const artifacts = await drafts.getFinalizedArtifacts(draftId);
    expect(artifacts?.composeOverride).toContain('nextcloud:30-apache');
  });

  test('falls back to empty composeOverride when the bundle has none', async () => {
    // homeassistant has catalog defaults but no composeOverride in mock-data.
    const detail = getCatalogAppVersionDetail('homeassistant', '2024.1.5');
    expect(detail?.composeOverride).toBeUndefined();

    const { draftId } = await drafts.createDraft({ appId: 'homeassistant', version: '2024.1.5' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.composeOverride).toBe('');
  });
});
