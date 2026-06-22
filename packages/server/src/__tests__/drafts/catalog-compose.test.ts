/**
 * Catalog → draft compose wiring (#82)
 *
 * A draft created from a catalog app must seed its composeOverride from the
 * bundle's compose.yaml (surfaced via CatalogService.getVersionDetail), so the
 * app can be deployed without the user pasting compose. There is no bundled
 * catalog — these tests inject a small CatalogService stub standing in for what
 * the remote catalog (try-hola/apps) would return.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const WITH_COMPOSE = 'services:\n  app:\n    image: nginx:1.27\n';

// Stand-in for the remote catalog: one app ships a compose, one doesn't.
function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({
      id: appId,
      name: appId,
      // A URL icon for one app, to assert the icon flows through unchanged.
      icon: appId === 'with-compose' ? 'https://cdn.example.com/with-compose.png' : '📦',
    }),
    getVersionDetail: async (appId: string) =>
      appId === 'with-compose'
        ? { defaultEnv: [], defaults: { ports: [], volumes: [] }, composeOverride: WITH_COMPOSE }
        : { defaultEnv: [], defaults: { ports: [], volumes: [] } },
  } as unknown as CatalogArg;
}

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
    drafts = new RealDraftService(storage, makeCatalog(), makeValidation());
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('seeds composeOverride from the catalog bundle', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);

    expect(draft.composeOverride).toBe(WITH_COMPOSE);
    expect(draft.composeOverride).toContain('nginx:1.27');
  });

  test('the seeded compose flows through finalize into the manifest', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.0.0' });
    const finalized = await drafts.finalizeDraft(draftId);
    expect(finalized.checksum).toBeTruthy();

    const artifacts = await drafts.getFinalizedArtifacts(draftId);
    expect(artifacts?.composeOverride).toContain('nginx:1.27');
  });

  test('persists the catalog icon on the draft and carries it through finalize (#238)', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.icon).toBe('https://cdn.example.com/with-compose.png');

    await drafts.finalizeDraft(draftId);
    const artifacts = await drafts.getFinalizedArtifacts(draftId);
    expect(artifacts?.manifest.icon).toBe('https://cdn.example.com/with-compose.png');
  });

  test('falls back to empty composeOverride when the bundle has none', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'no-compose', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.composeOverride).toBe('');
  });
});
