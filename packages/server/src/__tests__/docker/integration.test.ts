/**
 * Docker Service Integration Tests
 *
 * Validates that the system monitoring endpoint surfaces Docker status using the
 * configured monitoring service. Uses the mock service for deterministic
 * behaviour and avoids any dependency on a real Docker daemon.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import type { GetSystemStatusResponse } from '@hola/shared';
import { setupTestServer, teardownTestServer, TEST_BASE_URL } from '../utils/server';
import { getServices } from '../../services/simple-factory';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';

const BASE_URL = TEST_BASE_URL;
const TEST_TIMEOUT = 8000;

describe('Docker Monitoring via System Status', () => {
  let monitoringService: MockSystemMonitoringService;

  beforeAll(async () => {
    await setupTestServer();
    const services = getServices();
    const svc = services.systemMonitoring;
    if (!('emitTestStatus' in (svc as unknown))) {
      // Not a mock; environment misconfigured — soft-skip
      monitoringService = undefined as unknown as MockSystemMonitoringService;
      return;
    }
    monitoringService = svc as MockSystemMonitoringService;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('exposes docker state from monitoring service', async () => {
    monitoringService.emitTestStatus({
      docker: { ok: true, version: '25.0.0-test' },
      disk: { freeBytes: 40, totalBytes: 100 },
      version: { hola: '1.0.0-test', compose: '2.0.0-test' },
      oras: { ok: false },
      authentik: { ok: false },
    });

    const res = await fetch(`${BASE_URL}${API.system.status}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as GetSystemStatusResponse;
    expect(json.docker.ok).toBe(true);
    expect(json.docker.version).toBe('25.0.0-test');
  }, TEST_TIMEOUT);

  it('includes docker health in system health endpoint', async () => {
    const res = await fetch(`${BASE_URL}${API.system.health}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as {
      healthStatus: Record<string, { healthy: boolean; lastCheck: string }>;
      activatedServices: string[];
    };

    expect(json.activatedServices).toContain('system-monitoring');
    expect(json.healthStatus).toHaveProperty('system-monitoring');
  }, TEST_TIMEOUT);
});
