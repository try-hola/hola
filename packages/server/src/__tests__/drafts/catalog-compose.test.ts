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
      // A product name distinct from the id, to assert it flows through.
      name: appId === 'with-compose' ? 'With Compose' : appId,
      // A URL icon for one app, to assert the icon flows through unchanged.
      icon: appId === 'with-compose' ? 'https://cdn.example.com/with-compose.png' : '📦',
    }),
    // Resolve "latest"/unset to a concrete pinned version (what the real catalog
    // does), so a draft can persist a real version for display + update detection.
    getVersionDetail: async (appId: string, version?: string) => {
      const resolved = !version || version === 'latest' ? '1.4.1' : version;
      return appId === 'with-compose'
        ? { version: resolved, defaultEnv: [], defaults: { ports: [], volumes: [] }, composeOverride: WITH_COMPOSE }
        : { version: resolved, defaultEnv: [], defaults: { ports: [], volumes: [] } };
    },
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

  test('persists the concrete resolved version when the caller omits one', async () => {
    // No version supplied → the catalog resolves "latest" to a concrete pin, and
    // the draft stores THAT (not undefined), so the deployment record shows a real
    // version and update detection can compare against the catalog.
    const { draftId } = await drafts.createDraft({ appId: 'with-compose' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.4.1');
  });

  test('keeps an explicitly requested concrete version', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.3.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.version).toBe('1.3.0');
  });

  test('the seeded compose flows through finalize into the manifest', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.0.0' });
    const finalized = await drafts.finalizeDraft(draftId);
    expect(finalized.checksum).toBeTruthy();

    const artifacts = await drafts.getFinalizedArtifacts(draftId);
    expect(artifacts?.composeOverride).toContain('nginx:1.27');
  });

  test('persists the catalog icon + display name on the draft and carries them through finalize (#238)', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'with-compose', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.icon).toBe('https://cdn.example.com/with-compose.png');
    expect(draft.displayName).toBe('With Compose');

    await drafts.finalizeDraft(draftId);
    const artifacts = await drafts.getFinalizedArtifacts(draftId);
    expect(artifacts?.manifest.icon).toBe('https://cdn.example.com/with-compose.png');
    expect(artifacts?.manifest.displayName).toBe('With Compose');
  });

  test('falls back to empty composeOverride when the bundle has none', async () => {
    const { draftId } = await drafts.createDraft({ appId: 'no-compose', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.composeOverride).toBe('');
  });
});
