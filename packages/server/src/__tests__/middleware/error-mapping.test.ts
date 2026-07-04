/**
 * Structured finalize/promote validation errors (declarative-drifting-tiger PR 2).
 *
 * `finalizeDraft` throws `DraftValidationError` (422, `details.issues`) instead
 * of a message-only `Error` when `validateDraft` reports errors — this is
 * generic and covers the install wizard / CLI finalize call sites automatically
 * via `mapErrorToResponse`'s `'status' in error && 'code' in error` branch.
 * `asPromoteValidationError` relabels the SAME error's `code` to
 * `PROMOTE_VALIDATION_FAILED` for the promote endpoint specifically, so a
 * client can tell an upgrade-triggered validation failure apart from a plain
 * draft finalize failure, while keeping the same `details.issues`.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { mapErrorToResponse, DraftValidationError, asPromoteValidationError } from '../../middleware/error-mapping';
import { RealDraftService } from '../../services/core/draft';
import { RealValidationService } from '../../services/core/validation';
import { RealStorageService } from '../../services/core/storage';
import { RealRoutingService } from '../../services/core/routing';
import { MockDockerService } from '../../services/core/docker';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';

type CatalogArg = ConstructorParameters<typeof RealDraftService>[1];

describe('DraftValidationError → mapErrorToResponse', () => {
  test('maps to a 422 with the structured issue list attached', () => {
    const issues = [
      { code: 'PARAM_REQUIRED_MISSING' as const, severity: 'error' as const, field: 'env.TOKEN', path: 'env.TOKEN', message: "'Token' is required" },
    ];
    const err = new DraftValidationError('Draft validation failed: Token is required', issues);

    const { status, body } = mapErrorToResponse(err);

    expect(status).toBe(422);
    expect(body.error.code).toBe('DRAFT_VALIDATION_FAILED');
    expect((body.error.details as { issues: unknown[] }).issues).toEqual(issues);
  });
});

describe('asPromoteValidationError', () => {
  test('relabels a DraftValidationError to PROMOTE_VALIDATION_FAILED, keeping the same issues', () => {
    const issues = [
      { code: 'PARAM_REQUIRED_MISSING' as const, severity: 'error' as const, field: 'env.API_TOKEN', path: 'env.API_TOKEN', message: "'API token' is required" },
    ];
    const err = new DraftValidationError('Draft validation failed', issues);

    const relabeled = asPromoteValidationError(err);
    const { status, body } = mapErrorToResponse(relabeled);

    expect(status).toBe(422);
    expect(body.error.code).toBe('PROMOTE_VALIDATION_FAILED');
    expect((body.error.details as { issues: unknown[] }).issues).toEqual(issues);
    // Names the offending key so a client can render/highlight it.
    expect((body.error.details as { issues: Array<{ path?: string }> }).issues[0].path).toBe('env.API_TOKEN');
  });

  test('passes a non-DraftValidationError through unchanged', () => {
    const plain = new Error('boom');
    expect(asPromoteValidationError(plain)).toBe(plain);
    const { status, body } = mapErrorToResponse(asPromoteValidationError(plain));
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('End-to-end: a required typed param with no value fails finalize with a promote-flavored 422', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'hola-promote-422-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeCatalogWithRequiredToken(): CatalogArg {
    return {
      getApp: async (appId: string) => ({ id: appId, name: 'Gitea', icon: '🍵' }),
      getVersionDetail: async () => ({
        version: '1.1.0',
        // A new required typed param this version introduces, with no default —
        // simulating a promote where the operator's carried-forward config has
        // no value for a newly-required key.
        defaultEnv: [{ key: 'API_TOKEN', value: '', isSecret: true, type: 'string', required: true, minLength: 32 }],
        defaults: { ports: [], volumes: [] },
      }),
    } as unknown as CatalogArg;
  }

  test('finalizeDraft rejects with DraftValidationError naming the key; asPromoteValidationError relabels it for promote', async () => {
    const storage = new RealStorageService({ holaDir: dataRoot });
    const routing = new RealRoutingService(storage, { baseDomain: 'local.hola' });
    const validation = new RealValidationService(new MockDockerService(), new MockSystemMonitoringService(), storage, routing);
    const drafts = new RealDraftService(storage, makeCatalogWithRequiredToken(), validation);

    const { draftId } = await drafts.createDraft({ appId: 'gitea', version: '1.1.0' });
    await drafts.updateDraft(draftId, {
      composeOverride: 'services:\n  gitea:\n    image: gitea/gitea:1.1.0\n',
    });

    let thrown: unknown;
    try {
      await drafts.finalizeDraft(draftId);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DraftValidationError);
    const draftErr = thrown as DraftValidationError;
    expect(draftErr.issues.some((i) => i.code === 'PARAM_REQUIRED_MISSING' && i.path === 'env.API_TOKEN')).toBe(true);

    // The promote handler relabels the same error before it reaches mapErrorToResponse.
    const promoted = asPromoteValidationError(draftErr);
    const { status, body } = mapErrorToResponse(promoted);
    expect(status).toBe(422);
    expect(body.error.code).toBe('PROMOTE_VALIDATION_FAILED');
    expect((body.error.details as { issues: Array<{ path?: string }> }).issues.some((i) => i.path === 'env.API_TOKEN')).toBe(true);
  });
});
