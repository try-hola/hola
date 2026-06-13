/**
 * Draft Persistence Tests (real service)
 *
 * Verifies that RealDraftService is durable: drafts, edits, and uploaded files
 * survive a simulated process restart (a fresh service instance pointed at the
 * same data root), and that finalized artifacts are staged deterministically
 * with stable, idempotent checksums. Uses a temporary data root so the suite
 * passes without a writable home directory.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Test App', icon: '📦' }),
    getVersionDetail: async () => ({
      defaultEnv: [{ key: 'APP_PORT', value: '8080', isSecret: false, description: 'port' }],
      defaults: {
        ports: [{ host: 8080, container: 80, protocol: 'tcp' as const }],
        volumes: [{ hostPath: './data', containerPath: '/data', readOnly: false }],
      },
    }),
  } as unknown as CatalogArg;
}

function makeValidation(ok = true): ValidationArg {
  return {
    validateDraft: async () => ({ ok, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

describe('Draft persistence (real service)', () => {
  let dataRoot: string;
  let storage: RealStorageService;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-draft-'));
    storage = new RealStorageService({ holaDir: dataRoot });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  /** A fresh service instance over the same storage simulates a restart. */
  const newService = () => new RealDraftService(storage, makeCatalog(), makeValidation());

  test('a created draft survives a restart', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud', version: '1.0.0' });

    const b = newService();
    const draft = await b.getDraft(draftId);
    expect(draft.draftId).toBe(draftId);
    expect(draft.appId).toBe('nextcloud');
    expect(draft.version).toBe('1.0.0');
  });

  test('updates survive a restart', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud' });
    await a.updateDraft(draftId, {
      systemOverrides: { DOMAIN: 'example.com' },
      appEnv: [{ key: 'SECRET', value: 'hunter2', isSecret: true }],
    });

    const b = newService();
    const draft = await b.getDraft(draftId);
    expect(draft.systemOverrides.DOMAIN).toBe('example.com');
    expect(draft.appEnv.find(e => e.key === 'SECRET')?.value).toBe('hunter2');
  });

  test('uploaded files survive a restart and remain associated', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud' });
    const upload = await a.uploadFile(draftId, {
      name: 'docker-compose.override.yml',
      content: Buffer.from('services: {}\n'),
      kind: 'composeOverride',
    });

    const b = newService();
    const draft = await b.getDraft(draftId);
    expect(draft.files).toHaveLength(1);
    expect(draft.files[0].uploadId).toBe(upload.uploadId);
    expect(draft.files[0].name).toBe('docker-compose.override.yml');
  });

  test('deleting a draft removes it from durable storage', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud' });
    await a.deleteDraft(draftId);

    const b = newService();
    await expect(b.getDraft(draftId)).rejects.toThrow(/not found/i);
  });

  test('finalization stages artifacts with a stable, idempotent checksum', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud' });
    await a.updateDraft(draftId, { composeOverride: 'services:\n  app:\n    image: nextcloud\n' });
    await a.uploadFile(draftId, {
      name: 'config.json',
      content: Buffer.from('{"k":"v"}'),
      kind: 'additionalFile',
      path: '/app/config.json',
    });

    const first = await a.finalizeDraft(draftId);
    expect(first.checksum).toMatch(/^[0-9a-f]{64}$/);

    // Idempotent: re-finalizing identical input yields the identical checksum.
    const second = await a.finalizeDraft(draftId);
    expect(second.checksum).toBe(first.checksum);

    // Deterministic across instances (a "restart").
    const b = newService();
    const third = await b.finalizeDraft(draftId);
    expect(third.checksum).toBe(first.checksum);

    // Staged artifacts exist and the persisted record is marked finalized.
    expect(await storage.fileExists(`drafts/${draftId}/finalized/manifest.json`)).toBe(true);
    expect(await storage.fileExists(`drafts/${draftId}/finalized/compose-override.yml`)).toBe(true);

    const record = JSON.parse(await storage.readFileAsString(`drafts/${draftId}/draft.json`));
    expect(record.status).toBe('finalized');
    expect(record.checksum).toBe(first.checksum);

    const manifest = JSON.parse(await storage.readFileAsString(`drafts/${draftId}/finalized/manifest.json`));
    expect(manifest.checksum).toBe(first.checksum);
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files[0].path).toBe('/app/config.json');
  });

  test('changing input between finalizations changes the checksum', async () => {
    const a = newService();
    const { draftId } = await a.createDraft({ appId: 'nextcloud' });
    const before = await a.finalizeDraft(draftId);

    await a.updateDraft(draftId, { composeOverride: 'services:\n  app:\n    image: changed\n' });
    const after = await a.finalizeDraft(draftId);

    expect(after.checksum).not.toBe(before.checksum);
  });
});
