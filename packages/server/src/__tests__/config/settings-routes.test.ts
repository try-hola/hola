/**
 * `/api/settings` route projections for `channels.showPrerelease` (spec 005):
 * GET defaults to `false`, PATCH round-trips it, and a non-boolean value is
 * rejected with 400 (the route comment already promised 400; R1 fixes the
 * plain-`Error` bug that made it a 500 in practice). Uses a `RealConfigService`
 * over a temp storage root swapped into the shared `getServices()` instance so
 * the validation path (permissive on `MockConfigService`) actually runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API } from '@hola/shared';
import type { GetSettingsResponse } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { getServices } from '../../services/simple-factory';
import { RealStorageService } from '../../services/core/storage';
import { RealConfigService } from '../../services/core/config';

const BASE_URL = TEST_BASE_URL;

describe('Settings routes — channels.showPrerelease', () => {
  let dataRoot: string;
  // The services container is a process-wide singleton and `teardownTestServer`
  // runs with `resetServicesOnClose: false`, so the swap below MUST be undone —
  // otherwise every later file in the same `bun test` process reads config from
  // a temp dir this file has already deleted.
  let originalConfig: ReturnType<typeof getServices>['config'];

  beforeAll(async () => {
    await setupTestServer();
    dataRoot = mkdtempSync(join(tmpdir(), 'hola-settings-routes-'));
    const storage = new RealStorageService({ holaDir: dataRoot });
    const config = new RealConfigService(storage);
    await config.initialize();
    originalConfig = getServices().config;
    getServices().config = config;
  });

  afterAll(async () => {
    getServices().config = originalConfig;
    await teardownTestServer();
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('GET returns channels.showPrerelease: false by default', async () => {
    const response = await fetch(`${BASE_URL}${API.settings.base}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as GetSettingsResponse;
    expect(body.channels?.showPrerelease).toBe(false);
  });

  it('PATCH returns the updated value and GET reflects it', async () => {
    const patchResponse = await fetch(`${BASE_URL}${API.settings.base}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: { showPrerelease: true } }),
    });
    expect(patchResponse.status).toBe(200);
    const patchBody = (await patchResponse.json()) as GetSettingsResponse;
    expect(patchBody.channels?.showPrerelease).toBe(true);

    const getResponse = await fetch(`${BASE_URL}${API.settings.base}`);
    const getBody = (await getResponse.json()) as GetSettingsResponse;
    expect(getBody.channels?.showPrerelease).toBe(true);
  });

  it('GET and PATCH responses never carry notifications.smtpPassword', async () => {
    const patchResponse = await fetch(`${BASE_URL}${API.settings.base}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notifications: { smtpHost: 'smtp.example', smtpUser: 'u', smtpPassword: 'hunter2' } }),
    });
    expect(patchResponse.status).toBe(200);
    const patchBody = (await patchResponse.json()) as GetSettingsResponse;
    expect(patchBody.notifications?.smtpHost).toBe('smtp.example');
    expect('smtpPassword' in (patchBody.notifications ?? {})).toBe(false);

    const getResponse = await fetch(`${BASE_URL}${API.settings.base}`);
    const getBody = (await getResponse.json()) as GetSettingsResponse;
    expect('smtpPassword' in (getBody.notifications ?? {})).toBe(false);
    // The value itself is retained by the service (only responses redact it).
    const stored = await getServices().config.getSystemSettings();
    expect(stored.notifications?.smtpPassword).toBe('hunter2');
  });

  it('PATCH with a non-boolean showPrerelease returns 400', async () => {
    const response = await fetch(`${BASE_URL}${API.settings.base}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channels: { showPrerelease: 'yes' } }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain('must be a boolean');
  });
});
