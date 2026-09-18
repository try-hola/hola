/**
 * Pre-release channel discovery enrolment (spec 005): `channels.showPrerelease`
 * on the system-settings document. Default off; round-trips through
 * get/update; a PATCH of another field preserves it; a PATCH of `channels`
 * deep-merges rather than replacing; a non-boolean value is rejected with the
 * same `ValidationError` (400) other settings fields use. `MockConfigService`
 * mirrors the default and the merge but stays permissive on validation
 * (Constitution IV).
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealStorageService } from '../../services/core/storage';
import { RealConfigService, MockConfigService } from '../../services/core/config';
import { ValidationError } from '../../middleware/error-mapping';

describe('RealConfigService — channels.showPrerelease', () => {
  let dataRoot: string;
  let config: RealConfigService;

  beforeEach(async () => {
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-config-'));
    const storage = new RealStorageService({ holaDir: dataRoot });
    config = new RealConfigService(storage);
    await config.initialize();
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('defaults to showPrerelease: false', async () => {
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(false);
  });

  it('round-trips a PATCH of channels.showPrerelease through getSystemSettings', async () => {
    await config.updateSystemSettings({ channels: { showPrerelease: true } });
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(true);
  });

  it('keeps channels when a PATCH touches another field', async () => {
    await config.updateSystemSettings({ channels: { showPrerelease: true } });
    await config.updateSystemSettings({ tls: { email: 'ops@example.com' } });
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(true);
    expect(settings.tls?.email).toBe('ops@example.com');
  });

  it('deep-merges a PATCH of channels rather than replacing the group', async () => {
    // channels currently only has one key, but the merge clause itself must
    // spread current.channels rather than assign updates.channels directly.
    await config.updateSystemSettings({ channels: { showPrerelease: true } });
    await config.updateSystemSettings({ channels: {} });
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(true);
  });

  it('rejects a non-boolean showPrerelease with a ValidationError (400)', async () => {
    await expect(
      config.updateSystemSettings({ channels: { showPrerelease: 'yes' as unknown as boolean } })
    ).rejects.toThrow(ValidationError);

    try {
      await config.updateSystemSettings({ channels: { showPrerelease: 'yes' as unknown as boolean } });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).status).toBe(400);
      expect((err as ValidationError).message).toContain('must be a boolean');
    }
  });
});

describe('MockConfigService — channels.showPrerelease', () => {
  it('defaults to showPrerelease: false', async () => {
    const config = new MockConfigService();
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(false);
  });

  it('mirrors the deep-merge on update', async () => {
    const config = new MockConfigService();
    await config.updateSystemSettings({ channels: { showPrerelease: true } });
    await config.updateSystemSettings({ tls: { email: 'ops@example.com' } });
    const settings = await config.getSystemSettings();
    expect(settings.channels?.showPrerelease).toBe(true);
  });

  it('stays permissive on validation (non-boolean does not throw)', async () => {
    const config = new MockConfigService();
    const errors = await config.validateSystemSettings({
      channels: { showPrerelease: 'yes' as unknown as boolean },
    });
    expect(errors).toEqual([]);
  });
});
