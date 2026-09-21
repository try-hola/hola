/**
 * Documentation presence and scope-boundary checks for restore@1's provider
 * half (spec 008). Mechanical, file-content assertions — mirrors spec 007's
 * own quickstart §9 grep-shaped tests. No real-filesystem harness needed:
 * every check here reads files already checked into the repo.
 */
import { describe, test, expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../../../../..');

async function read(relPath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relPath), 'utf8');
}

// Quickstart scenario 14 (FR-018): the ADR exists and documents the
// writable-mount primitive, referenced from the Constitution-check
// discussion of Principle V.
describe('docs/adr/0006-restore-staging-grant.md (spec 008, FR-018)', () => {
  test('exists, documents the writable-mount primitive, and is referenced by plan.md\'s Principle V audit', async () => {
    const adrPath = 'docs/adr/0006-restore-staging-grant.md';
    expect(existsSync(join(REPO_ROOT, adrPath))).toBe(true);
    const adr = await read(adrPath);
    expect(adr).toMatch(/writable/i);
    expect(adr).toMatch(/least.privilege|least-privilege/i);
    expect(adr).toMatch(/restore-staging/);

    const plan = await read('specs/008-restore-provider/plan.md');
    expect(plan).toMatch(/Principle V/);
    expect(plan).toMatch(/ADR 0006/);
  });
});

// Quickstart scenario 66 (FR-004): the spec-007-FR-047 supersession is
// documented, in text, in both data-model.md and plan.md's Constitution Check.
describe('FR-004 — spec 007\'s FR-047 supersession is recorded in text', () => {
  test('spec.md (FR-004) and research.md (R1) both state the supersession and why it is safe', async () => {
    const spec = await read('specs/008-restore-provider/spec.md');
    expect(spec).toMatch(/FR-047/);
    expect(spec).toMatch(/supersed/i);

    const research = await read('specs/008-restore-provider/research.md');
    expect(research).toMatch(/FR-047/);
    expect(research).toMatch(/supersed/i);

    // data-model.md §1 records the SAME fact in its own words (no provider
    // existed when spec 007 wrote its marker; one exists now).
    const dataModel = await read('specs/008-restore-provider/data-model.md');
    expect(dataModel).toMatch(/no second party/);
  });
});

// Quickstart scenario 65 (FR-065): operator docs state plainly that recovery
// onto a fresh host requires installing the provider + supplying the
// repository password, and no UI copy implies otherwise.
describe('FR-065 — recovery-requires-the-provider is documented plainly', () => {
  test('docs/OPERATIONS.md or the ADR states the fresh-host recovery requirement', async () => {
    const ops = await read('docs/OPERATIONS.md');
    const adr = await read('docs/adr/0006-restore-staging-grant.md');
    const combined = ops + adr;
    expect(combined).toMatch(/install(ing)? the provider/i);
    expect(combined.toLowerCase()).toMatch(/password|secret/);
  });
});

// Quickstart scenarios 62, 63, 68 — the prepared (not submitted, FR-063)
// try-hola/apps catalog diff, checked against the diff ARTIFACT this
// feature's implementation phase produced (specs/008-restore-provider/
// catalog-diff.patch, catalog-backrest-notes.md), never against
// try-hola/apps directly — no PR was opened there.
describe('the prepared catalog diff (spec 008, FR-058, FR-063, T122/T123)', () => {
  test('scenario 62: the schema-enum, validator-flag, and prose gates are all present in the SAME prepared diff', async () => {
    const diff = await read('specs/008-restore-provider/catalog-diff.patch');
    // Gate 1: schemas/manifest.schema.json's provider-ref enum gains restore@1.
    expect(diff).toMatch(/schemas\/manifest\.schema\.json/);
    // Gate 2: bin/validate-manifest.mjs's appProvided flag flips to true.
    expect(diff).toMatch(/bin\/validate-manifest\.mjs/);
    expect(diff).toMatch(/appProvided:\s*true/);
    expect(diff).toMatch(/-\s*'restore@1':.*appProvided:\s*false/);
    // Gate 3: prose in both files describing the provider role.
    expect(diff.toLowerCase()).toMatch(/provider/);
    expect(diff).toMatch(/contracts\/manifest\.md/);
  });

  test('scenario 63: the diff is load-bearing — restore@1 in provides is new, not redundant with what already validates', async () => {
    const diff = await read('specs/008-restore-provider/catalog-diff.patch');
    // The validator's OLD row explicitly refused restore@1 as a provider
    // (`appProvided: false`) — proving a fixture declaring
    // `provides: ["restore@1"]` was rejected by TODAY's unmodified catalog,
    // and the diff is what flips it to accepted.
    expect(diff).toMatch(/appProvided:\s*false/); // the removed (old) line
    expect(diff).toMatch(/appProvided:\s*true/); // the added (new) line
  });

  test('scenario 68: the prepared diff adds the poller as a NEW component, not an extension of the reconciler or the hook script', async () => {
    const notes = await read('specs/008-restore-provider/catalog-backrest-notes.md');
    expect(notes.toLowerCase()).toMatch(/poller/);
    expect(notes).toMatch(/backrest-hola-autowire/);
    expect(notes).toMatch(/backup-prepare\.sh/);
    // States the reasoning research.md R16 records.
    expect(notes.toLowerCase()).toMatch(/condition_snapshot|snapshot-lifecycle/);
    expect(notes.toLowerCase()).toMatch(/reconcil/);
  });
});

// Quickstart scenario 61 (data-model.md §9b, a deliberate non-removal):
// JobType's 'restore' literal still exists, but is produced by ZERO code
// paths — this feature's requests are not Job records at all (§4d).
describe('JobType\'s unused restore literal (spec 008, FR-057, scenario 61)', () => {
  test('the literal still exists in the union...', async () => {
    const source = await read('packages/shared/src/index.ts');
    expect(source).toMatch(/JobType = .*'restore'/);
  });

  test('...but no server code ever constructs a job with type: \'restore\'', async () => {
    const serverSrc = join(REPO_ROOT, 'packages/server/src');
    // A job is always created with an explicit `type` field; search every
    // server source file for a literal `type: 'restore'` job construction.
    const { execSync } = await import('node:child_process');
    const hits = execSync(`grep -rn "type: 'restore'" "${serverSrc}" --exclude=restore-provider-scope.test.ts || true`, { encoding: 'utf8' });
    expect(hits.trim()).toBe('');
  });
});

// Quickstart scenarios 70-76 — the mechanical scope-boundary greps
// (plan.md's Principle V audit, mirroring spec 007's quickstart §9).
describe('scope-boundary greps (spec 008 quickstart §9)', () => {
  test('70: no app or datastore name leaked into spec 008\'s OWN new restore machinery', async () => {
    // The wholly-new modules this feature adds — clean by construction.
    const newFiles = [
      'packages/server/src/services/core/restore-candidates.ts',
      'packages/server/src/services/core/restore-broker-state.ts',
      'packages/server/src/services/core/restore-index.ts',
    ];
    const forbidden = /postgres|mealie|immich|gitea|paperless|backrest/i;
    for (const f of newFiles) {
      const source = await read(f);
      expect(source).not.toMatch(forbidden);
    }

    // shared/contracts.ts pre-dates this feature and already carries one
    // PRE-EXISTING illustrative mention of "backrest" in its ADR-0004-era
    // top-of-file doc comment ("backrest performs backups") — not per-app
    // branching logic, and not introduced by spec 008. What matters is that
    // spec 008's OWN addition (the `restore` CONTRACTS entry and
    // RESTORE_CONTRACT_REF) adds no NEW such name.
    const contractsSource = await read('packages/shared/src/contracts.ts');
    const restoreEntryMatch = contractsSource.match(/\{\s*id: 'restore',[\s\S]*?\},\s*\n\]/);
    expect(restoreEntryMatch).not.toBeNull();
    expect(restoreEntryMatch![0]).not.toMatch(forbidden);
    const restoreRefComment = contractsSource.match(/RESTORE_CONTRACT_REF[\s\S]{0,400}/);
    expect(restoreRefComment![0]).not.toMatch(forbidden);
  });

  test('71/72: the marker machinery and the coerceRefs carve-out are fully gone', async () => {
    const contractsTs = await read('packages/shared/src/contracts.ts');
    expect(contractsTs).not.toMatch(/PARTICIPATION_MARKERS|RESTORE_PARTICIPATION_REF|isParticipationMarker/);
    const serverContractsTs = await read('packages/server/src/services/core/contracts.ts');
    expect(serverContractsTs).not.toMatch(/PARTICIPATION_MARKERS|RESTORE_PARTICIPATION_REF|isParticipationMarker/);
  });

  test('73: the dead #484 restore-backup surface is gone from packages/', async () => {
    const files = [
      'packages/shared/src/index.ts',
      'packages/server/src/server.ts',
      'packages/web/src/hooks/useBackupsApi.ts',
      'packages/web/src/utils/sdk-adapter.ts',
      'packages/web/src/utils/api.ts',
      'packages/web/src/pages/Backups.tsx',
    ];
    for (const f of files) {
      const source = await read(f);
      expect(source).not.toMatch(/RestoreBackupRequest|RestoreBackupResponse/);
    }
    const serverTs = await read('packages/server/src/server.ts');
    expect(serverTs).not.toMatch(/backups\/:id\/restore|backupByIdMatch.*restore/);
  });

  test('74: no Buffer/base64/binary-shaped field on a restore-related type in shared/src/index.ts', async () => {
    const source = await read('packages/shared/src/index.ts');
    const restoreLines = source.split('\n').filter((l) => /restore/i.test(l));
    for (const line of restoreLines) {
      expect(line).not.toMatch(/Buffer|ArrayBuffer|base64|binary/i);
    }
  });

  test('75: "restore-staging" in deployment.ts never means the OLD (capture) staging concept', async () => {
    const source = await read('packages/server/src/services/core/deployment.ts');
    const hits = source.split('\n').filter((l) => l.includes('restore-staging'));
    // Every surviving hit must be the NEW provider-facing grant kind/root
    // (compose-mounts import, grantsInclude('restore-staging'), or this
    // ADR/doc-comment cross-reference) — never spec 007's renamed local dir,
    // which is now spelled "capture-staging" or "capture staging" everywhere.
    for (const line of hits) {
      expect(line).not.toMatch(/deployments\/\$\{deployment\.id\}\/restore-staging/);
    }
  });

  test('69: every research.md R22 follow-up has a tracked issue number recorded in tasks.md', async () => {
    const tasks = await read('specs/008-restore-provider/tasks.md');
    for (const t of ['T134', 'T135', 'T136', 'T137']) {
      const line = tasks.split('\n').find((l) => l.startsWith(`- [X] ${t} `));
      expect(line).toBeDefined();
      expect(line).toMatch(/#\d+/); // a real issue number, not the `#____` placeholder
    }
  });

  test('76: no inline TODO/FIXME/XXX marker in this feature\'s new restore modules', async () => {
    const files = [
      'packages/server/src/services/core/restore-broker-state.ts',
      'packages/server/src/services/core/restore-index.ts',
      'packages/server/src/services/core/restore-candidates.ts',
    ];
    for (const f of files) {
      const source = await read(f);
      expect(source).not.toMatch(/\b(TODO|FIXME|XXX)\b/);
    }
  });
});
