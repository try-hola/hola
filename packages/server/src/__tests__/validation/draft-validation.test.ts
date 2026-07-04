/**
 * Service-level validation tests (#13).
 *
 * Verifies that RealValidationService surfaces strict Compose issues through the
 * shared ValidationReport shape, and that RealDraftService rejects unparseable
 * compose overrides at ingestion with a 400-mapped ValidationError.
 */

import { describe, test, expect } from 'bun:test';
import type { AppEnvVar, Draft } from '@hola/shared';
import { RealValidationService } from '../../services/core/validation';
import { RealDraftService } from '../../services/core/draft';
import { MockStorageService } from '../../services/core/storage';
import { ValidationError, DraftValidationError } from '../../middleware/error-mapping';

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

// PR2 (declarative-drifting-tiger): `validateEnvironment` now delegates to the
// shared `validateParams` instead of an inline `MISSING_SECRET_VALUE` check —
// this both fixes the optional-secret bug (a secret with an explicit
// `required: false` no longer force-blocks on empty) and preserves the legacy
// isSecret-implies-required rule (now surfaced as `PARAM_REQUIRED_MISSING`).
describe('RealValidationService.validateEnvironment (typed params, #ADR-0003)', () => {
  test('an empty secret with required: false passes clean (the optional-secret bug fix)', async () => {
    const svc = makeValidationService();
    const issues = await svc.validateEnvironment([
      { key: 'ADMIN_PASSWORD', value: '', isSecret: true, required: false },
    ]);
    expect(issues).toEqual([]);
  });

  test('an empty secret with required left unset still blocks (legacy rule preserved)', async () => {
    const svc = makeValidationService();
    const issues = await svc.validateEnvironment([
      { key: 'ADMIN_PASSWORD', value: '', isSecret: true },
    ]);
    expect(issues.some((i) => i.code === 'PARAM_REQUIRED_MISSING')).toBe(true);
    // The old ad hoc code must not also fire (would double-report the same row).
    expect(issues.some((i) => i.code === 'MISSING_SECRET_VALUE')).toBe(false);
  });

  test('a typed param violation (bad integer) is reported', async () => {
    const svc = makeValidationService();
    const issues = await svc.validateEnvironment([
      { key: 'PUID', value: 'not-a-number', isSecret: false, type: 'integer' },
    ]);
    expect(issues.some((i) => i.code === 'PARAM_INVALID_INTEGER')).toBe(true);
  });

  test('INVALID_ENV_KEY still fires for a badly-cased key (unrelated concern, unchanged)', async () => {
    const svc = makeValidationService();
    const issues = await svc.validateEnvironment([
      { key: 'lower_case', value: 'x', isSecret: false },
    ]);
    expect(issues.some((i) => i.code === 'INVALID_ENV_KEY')).toBe(true);
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

// PR2 (declarative-drifting-tiger): a client only owns `value` per env row — the
// typed spec (type/label/required/pattern/…) is seeded from the catalog at
// draft-creation time and must survive a PATCH untouched.
describe('RealDraftService.updateDraft — appEnv spec hardening (PR2, ADR 0003)', () => {
  const seededEnv: AppEnvVar[] = [
    {
      key: 'DOMAIN',
      value: 'https://example.com',
      isSecret: false,
      label: 'Domain',
      type: 'url',
      required: true,
      httpsOnly: true,
    },
    { key: 'CUSTOM_VAR', value: 'custom', isSecret: false },
  ];

  function makeDraftServiceWithEnv(appEnv: AppEnvVar[]): RealDraftService {
    const svc = new RealDraftService(new MockStorageService(), {} as never, {} as never);
    const record = {
      draft: { ...draftWith(''), appEnv },
      status: 'draft',
      createdAt: 't',
      updatedAt: 't',
      fileChecksums: {},
      filePaths: {},
    };
    (svc as unknown as { drafts: Map<string, unknown> }).drafts.set('d1', record);
    return svc;
  }

  test("a client PATCH can only change a seeded row's value — spec fields are restored", async () => {
    const svc = makeDraftServiceWithEnv(seededEnv);
    const forged: AppEnvVar = {
      key: 'DOMAIN',
      value: 'https://changed.example.com',
      isSecret: true, // forged
      type: 'string', // forged
      required: false, // forged
      httpsOnly: false, // forged
      label: 'Forged label', // forged
    };
    const result = await svc.updateDraft('d1', { appEnv: [forged] });
    const domain = result.draft.appEnv.find((e) => e.key === 'DOMAIN')!;
    expect(domain.value).toBe('https://changed.example.com'); // client's value wins
    expect(domain.isSecret).toBe(false); // restored
    expect(domain.type).toBe('url'); // restored
    expect(domain.required).toBe(true); // restored
    expect(domain.httpsOnly).toBe(true); // restored
    expect(domain.label).toBe('Domain'); // restored
  });

  test('a custom/unknown key passes through PATCH unmodified (no spec to protect)', async () => {
    const svc = makeDraftServiceWithEnv(seededEnv);
    const result = await svc.updateDraft('d1', {
      appEnv: [{ key: 'NEW_CUSTOM_VAR', value: 'hello', isSecret: false }],
    });
    const custom = result.draft.appEnv.find((e) => e.key === 'NEW_CUSTOM_VAR');
    expect(custom).toEqual({ key: 'NEW_CUSTOM_VAR', value: 'hello', isSecret: false });
  });

  test('a PATCH that omits appEnv entirely leaves the stored env untouched', async () => {
    const svc = makeDraftServiceWithEnv(seededEnv);
    const result = await svc.updateDraft('d1', { systemOverrides: { FOO: 'bar' } });
    expect(result.draft.appEnv).toEqual(seededEnv);
  });
});

// PR2 (declarative-drifting-tiger): finalize surfaces a structured 422 (code +
// per-issue `details.issues`) instead of a message-only Error, so wizard/CLI/
// promote callers can name the offending key(s).
describe('RealDraftService.finalizeDraft — structured validation error (PR2)', () => {
  type ValidationArg = ConstructorParameters<typeof RealDraftService>[2];

  function makeDraftServiceWithValidation(result: { ok: boolean; errors: Array<{ code: string; severity: 'error' | 'warning'; message: string }>; warnings: unknown[] }): RealDraftService {
    const validation = {
      validateDraft: async () => result,
      preflightCheck: async () => ({ ok: true, checks: [] }),
    } as unknown as ValidationArg;
    const svc = new RealDraftService(new MockStorageService(), {} as never, validation);
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

  test('finalizeDraft throws a DraftValidationError (422) carrying the validation issues', async () => {
    const issues = [
      { code: 'PARAM_REQUIRED_MISSING', severity: 'error' as const, field: 'env.TOKEN', path: 'env.TOKEN', message: "'Token' is required" },
    ];
    const svc = makeDraftServiceWithValidation({ ok: false, errors: issues, warnings: [] });

    let thrown: unknown;
    try {
      await svc.finalizeDraft('d1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DraftValidationError);
    const err = thrown as DraftValidationError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('DRAFT_VALIDATION_FAILED');
    expect((err.details as { issues: unknown[] }).issues).toEqual(issues);
    expect(err.issues).toEqual(issues);
  });
});
