/**
 * Service-level validation tests (#13).
 *
 * Verifies that RealValidationService surfaces strict Compose issues through the
 * shared ValidationReport shape, and that RealDraftService rejects unparseable
 * compose overrides at ingestion with a 400-mapped ValidationError.
 */

import { describe, test, expect } from 'bun:test';
import type { Draft } from '@hola/shared';
import { RealValidationService } from '../../services/core/validation';
import { RealDraftService } from '../../services/core/draft';
import { MockStorageService } from '../../services/core/storage';
import { ValidationError } from '../../middleware/error-mapping';

function makeValidationService(): RealValidationService {
  // validateDraft only exercises env/port/compose checks — docker/system/routing
  // dependencies are unused on this path, so minimal stubs are sufficient.
  return new RealValidationService(
    {} as never,
    {} as never,
    new MockStorageService(),
  );
}

function draftWith(composeOverride: string): Draft {
  return {
    draftId: 'd1',
    appId: 'fixture',
    systemOverrides: {},
    appEnv: [],
    ports: [],
    composeOverride,
    files: [],
  };
}

describe('RealValidationService.validateDraft', () => {
  test('reports a host-port error with a prefixed field path', async () => {
    const svc = makeValidationService();
    const report = await svc.validateDraft(
      draftWith(`
services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
`),
    );

    expect(report.ok).toBe(false);
    const hostPort = report.errors.find((e) => e.code === 'HOST_PORT_NOT_ALLOWED');
    expect(hostPort).toBeDefined();
    expect(hostPort!.severity).toBe('error');
    expect(hostPort!.path).toBe('composeOverride.services.web.ports[0]');
  });

  test('a valid compose override passes clean', async () => {
    const svc = makeValidationService();
    const report = await svc.validateDraft(
      draftWith(`
services:
  web:
    image: nginx:1.27
    expose:
      - "80"
`),
    );

    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  test('warnings do not block (ok stays true)', async () => {
    const svc = makeValidationService();
    const report = await svc.validateDraft(
      draftWith(`
services:
  web:
    image: nginx:1.27
    environment:
      - KEY=a
      - KEY=b
`),
    );

    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.code === 'DUPLICATE_ENV_KEY')).toBe(true);
  });

  test('an unpinned image tag blocks the draft (ok is false)', async () => {
    const svc = makeValidationService();
    const report = await svc.validateDraft(
      draftWith(`
services:
  web:
    image: nginx
`),
    );

    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.code === 'IMAGE_MISSING_TAG')).toBe(true);
  });
});

describe('RealDraftService compose-override ingestion guard', () => {
  function makeDraftService(): RealDraftService {
    const svc = new RealDraftService(new MockStorageService(), {} as never, {} as never);
    // Seed a draft record directly so updateDraft has something to patch.
    const record = {
      draft: draftWith(''),
      status: 'draft',
      createdAt: 't',
      updatedAt: 't',
      fileChecksums: {},
      filePaths: {},
    };
    (svc as unknown as { drafts: Map<string, unknown> }).drafts.set('d1', record);
    return svc;
  }

  test('updateDraft rejects malformed YAML with a 400 ValidationError', async () => {
    const svc = makeDraftService();
    let thrown: unknown;
    try {
      await svc.updateDraft('d1', { composeOverride: 'services: [unclosed' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ValidationError);
    const err = thrown as ValidationError;
    expect(err.status).toBe(400);
    expect((err.details as { issues: Array<{ code: string }> }).issues[0].code).toBe('INVALID_YAML');
  });

  test('updateDraft accepts a parseable compose override', async () => {
    const svc = makeDraftService();
    const result = await svc.updateDraft('d1', {
      composeOverride: 'services:\n  web:\n    image: nginx:1.27\n',
    });
    expect(result.ok).toBe(true);
  });
});
