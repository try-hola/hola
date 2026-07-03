import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { validateComposeDocument } from '@hola/shared/compose-validate';
import { RealStorageService } from '../../services/core/storage';
import { RealBundleService, bundleCacheKey, type CommandRunner } from '../../services/core/bundles';
import { RealCatalogService } from '../../services/core/catalog';
import { RealDraftService } from '../../services/core/draft';

// A pinned, rule-compliant compose the by-ref bundle can seed a draft from.
const COMPOSE = [
  'services:',
  '  web:',
  '    image: ghcr.io/try-hola/cms@sha256:' + 'a'.repeat(64),
  '    volumes:',
  '      - ${HOLA_APP_DATA}/data:/data',
].join('\n');

const MANIFEST = JSON.stringify({
  defaultEnv: [{ key: 'ADMIN_TOKEN', value: '', isSecret: true, description: 'Admin token' }],
  defaults: {},
});

// Minimal validation service — createDraft never calls it (only validate/finalize do).
const stubValidation = {
  async validateDraft() { return { ok: true, errors: [], warnings: [] }; },
  async preflightCheck() { return { ok: true, checks: [] } as never; },
};

describe('install from OCI reference', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function harness() {
    const holaDir = await mkdtemp(join(tmpdir(), 'hola-ref-test-'));
    dirs.push(holaDir);
    const storage = new RealStorageService({ holaDir });
    const cacheBase = join(holaDir, 'cache', 'bundles');
    const runner: CommandRunner = async () => ({ stdout: '', stderr: '' });
    const bundles = new RealBundleService(cacheBase, runner);
    const catalog = new RealCatalogService(bundles);
    const drafts = new RealDraftService(storage, catalog, stubValidation);
    return { cacheBase, drafts };
  }

  /** Pre-seed a bundle in the cache so ensurePulled treats it as already pulled. */
  async function seedBundle(cacheBase: string, appId: string, version: string, files: Record<string, string>) {
    const dir = join(cacheBase, bundleCacheKey('(ref)', appId), version);
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  }

  test('happy path: seeds a draft from the pulled bundle (bare appId, (ref) source)', async () => {
    const { cacheBase, drafts } = await harness();
    await seedBundle(cacheBase, 'cms', '0.1.0', { 'compose.yaml': COMPOSE, 'manifest.json': MANIFEST });

    const res = await drafts.createDraft({ ociRef: 'ghcr.io/try-hola/cms:0.1.0' });
    const draft = await drafts.getDraft(res.draftId);

    expect(draft.appId).toBe('cms');       // bare — never `sourceId/appId`
    expect(draft.source).toBe('(ref)');
    expect(draft.version).toBe('0.1.0');
    expect(draft.composeOverride).toContain('image: ghcr.io/try-hola/cms@sha256:');
    expect(draft.appEnv.find((e) => e.key === 'ADMIN_TOKEN')?.isSecret).toBe(true);
  });

  test('rejects a non-compliant package: a bundle missing manifest.json fails layout validation', async () => {
    const { cacheBase, drafts } = await harness();
    // compose only — no manifest.json → INVALID_BUNDLE_LAYOUT from the shared primitive.
    await seedBundle(cacheBase, 'broken', '0.1.0', { 'compose.yaml': COMPOSE });

    await expect(drafts.createDraft({ ociRef: 'ghcr.io/try-hola/broken:0.1.0' })).rejects.toThrow();
  });

  test('the strict compose rules that make custom packages safe still apply (host ports rejected)', () => {
    // Same validator the draft validate/finalize path runs for every source.
    const bad = 'services:\n  web:\n    image: nginx:1.2.3\n    ports:\n      - "8080:80"\n';
    const issues = validateComposeDocument(bad);
    expect(issues.some((i) => /port/i.test(i.code) || /port/i.test(i.message))).toBe(true);
  });
});
