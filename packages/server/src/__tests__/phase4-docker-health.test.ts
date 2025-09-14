/**
 * Phase 4 - Docker Health Reporting (Real Service) Tests
 *
 * Starts a dedicated server instance with HOLA_USE_REAL_DOCKER=true on a test port
 * and verifies that system endpoints report Docker service information correctly.
 *
 * These tests are resilient whether Docker is actually available or not on the host.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import { setupTestServer, teardownTestServer } from './utils/server';

const TEST_PORT = 3010;
const BASE_URL = `http://localhost:${TEST_PORT}`;

describe('Real Docker service reporting via system endpoints', () => {
  beforeAll(async () => {
    // Start a dedicated server with real docker flag enabled
    await setupTestServer(TEST_PORT, {
      HOLA_USE_REAL_DOCKER: 'true',
    });
  }, 30000);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('exposes feature flag useRealDocker=true in system config', async () => {
    const res = await fetch(`${BASE_URL}${API.system.config}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as { featureFlags: Record<string, boolean> };
    expect(json.featureFlags?.useRealDocker).toBe(true);
  });

  it('reports docker health in /api/system/health with lastCheck timestamp', async () => {
    const res = await fetch(`${BASE_URL}${API.system.health}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as {
      healthStatus: Record<string, { healthy: boolean; lastCheck: string }>;
      activatedServices: string[];
    };

    expect(json.activatedServices).toContain('docker');
    expect(json.healthStatus).toHaveProperty('docker');

    const dockerHealth = json.healthStatus['docker'];
    expect(typeof dockerHealth.healthy).toBe('boolean');
    expect(typeof dockerHealth.lastCheck).toBe('string');
    // ISO-like format check (basic)
    expect(dockerHealth.lastCheck.length).toBeGreaterThan(10);
  });

  it('reflects docker availability and version in /api/system/status', async () => {
    const res = await fetch(`${BASE_URL}${API.system.status}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as {
      docker: { ok: boolean; version?: string };
      version: { compose: string };
    };

    // ok is a boolean; when ok is true, version should be present
    expect(typeof json.docker.ok).toBe('boolean');
    if (json.docker.ok) {
      expect(typeof json.docker.version).toBe('string');
      expect((json.docker.version ?? '').length).toBeGreaterThan(0);
    }

    // compose version should be a string (may be 'unknown' if not available)
    expect(typeof json.version.compose).toBe('string');
    expect(json.version.compose.length).toBeGreaterThan(0);
  });
});
