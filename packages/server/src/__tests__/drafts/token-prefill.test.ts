/**
 * Seed-time platform-token prefill (declarative-drifting-tiger PR 2).
 *
 * A catalog manifest can default an env var to a value containing
 * `${HOLA_APP_HOST}`/`${HOLA_BASE_DOMAIN}` (e.g. vaultwarden's
 * `DOMAIN: "https://${HOLA_APP_HOST}"`). At draft-creation time the server
 * resolves these to THIS install's concrete host/domain (`<appId>.<baseDomain>`,
 * the same pattern `RoutingService.generateRule` uses), so the wizard shows a
 * real prefilled URL rather than a raw token. `RoutingService` is optional on
 * `RealDraftService` (back-compat for existing wiring/tests) — when absent, the
 * literal token survives (deploy-time resolution in deployment.ts is the
 * belt-and-braces fallback, covered separately in
 * __tests__/deployments/token-prefill.test.ts).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { RealDraftService } from '../../services/core/draft';
import { RealStorageService } from '../../services/core/storage';
import { MockRoutingService } from '../../services/core/routing';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];
type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

const TOKENIZED_ENV = [
  { key: 'DOMAIN', value: 'https://${HOLA_APP_HOST}', isSecret: false },
  { key: 'INSTANCE_DOMAIN', value: '${HOLA_BASE_DOMAIN}', isSecret: false },
  { key: 'UNRELATED', value: 'plain-value', isSecret: false },
];

function makeCatalog(): CatalogArg {
  return {
    getApp: async (appId: string) => ({ id: appId, name: 'Vaultwarden', icon: '🔐' }),
    getVersionDetail: async () => ({
      version: '1.0.0',
      defaultEnv: TOKENIZED_ENV,
      defaults: { ports: [], volumes: [] },
    }),
    getVersionDetailByRef: async () => ({
      appId: 'vaultwarden',
      version: '1.0.0',
      defaultEnv: TOKENIZED_ENV,
      defaults: { ports: [], volumes: [] },
    }),
  } as unknown as CatalogArg;
}

function makeValidation(): ValidationArg {
  return {
    validateDraft: async () => ({ ok: true, errors: [], warnings: [] }),
    preflightCheck: async () => ({ ok: true, checks: [] }),
  } as unknown as ValidationArg;
}

describe('Seed-time platform-token prefill (PR2)', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-token-prefill-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  test('createDraft resolves ${HOLA_APP_HOST}/${HOLA_BASE_DOMAIN} to this install\'s concrete host/domain', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const routing = new MockRoutingService({ baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation(), undefined, routing);

    const { draftId } = await drafts.createDraft({ appId: 'vaultwarden', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);

    expect(draft.appEnv.find((e) => e.key === 'DOMAIN')?.value).toBe('https://vaultwarden.example.com');
    expect(draft.appEnv.find((e) => e.key === 'INSTANCE_DOMAIN')?.value).toBe('example.com');
    // An unrelated value is untouched.
    expect(draft.appEnv.find((e) => e.key === 'UNRELATED')?.value).toBe('plain-value');
  });

  test('the CreateDraftResponse (used to seed the wizard) also carries the resolved values', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const routing = new MockRoutingService({ baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation(), undefined, routing);

    const response = await drafts.createDraft({ appId: 'vaultwarden', version: '1.0.0' });
    expect(response.appEnv.find((e) => e.key === 'DOMAIN')?.value).toBe('https://vaultwarden.example.com');
  });

  test('install-by-ref (createDraftFromRef) also resolves platform tokens', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const routing = new MockRoutingService({ baseDomain: 'example.com' });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation(), undefined, routing);

    const response = await drafts.createDraft({ ociRef: 'ghcr.io/try-hola/vaultwarden:1.0.0' });
    expect(response.appEnv.find((e) => e.key === 'DOMAIN')?.value).toBe('https://vaultwarden.example.com');
  });

  test('without a routing service (back-compat), the literal token survives unresolved', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const drafts = new RealDraftService(storage, makeCatalog(), makeValidation());

    const { draftId } = await drafts.createDraft({ appId: 'vaultwarden', version: '1.0.0' });
    const draft = await drafts.getDraft(draftId);
    expect(draft.appEnv.find((e) => e.key === 'DOMAIN')?.value).toBe('https://${HOLA_APP_HOST}');
  });
});
