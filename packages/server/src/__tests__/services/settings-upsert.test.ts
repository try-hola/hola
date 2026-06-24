/**
 * Settings repository upsert test — updating settings must preserve the row's
 * created_at (and not churn it), proving it UPDATEs in place rather than the old
 * INSERT OR REPLACE (which deletes + reinserts, resetting created_at).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';
import { RealDatabaseService } from '../../services/core/database';
import { DatabaseSettingsRepository } from '../../services/core/repositories';

describe('DatabaseSettingsRepository upsert', () => {
  let dataRoot: string;
  let database: RealDatabaseService;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-settings-'));
    database = new RealDatabaseService(new RealStorageService({ holaDir: dataRoot }));
    await database.initialize();
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('preserves created_at across an update (UPDATE in place, not delete+reinsert)', async () => {
    const repo = new DatabaseSettingsRepository(database);

    // First save creates the row.
    const settings = await repo.getSystemSettings();
    // Pin created_at to a known past value so a REPLACE (which resets it to now)
    // is detectable.
    const PAST = '2000-01-01T00:00:00.000Z';
    await database.run("UPDATE settings SET created_at = ? WHERE type = 'system'", [PAST]);

    // Re-save: the conflict path runs.
    await repo.updateSystemSettings(settings);

    const row = await database.get<{ created_at: string }>(
      "SELECT created_at FROM settings WHERE type = 'system'",
    );
    expect(row?.created_at).toBe(PAST);
  });
});
