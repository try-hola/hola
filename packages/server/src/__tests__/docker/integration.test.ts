/**
 * Docker Service Tests
 *
 * Tests Docker service integration and health reporting with real and mock services.
 * Covers graceful degradation when Docker is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import type { GetSystemStatusResponse } from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/server';

const BASE_URL = 'http://localhost:3001';
const BASE_URL_REAL = 'http://localhost:3010';
const TEST_PORT_MOCK = 3001;
const TEST_PORT_REAL = 3010;
const TEST_TIMEOUT = 30000;

describe('Docker Service Integration', () => {
  beforeAll(async () => {
    await setupTestServer(TEST_PORT_MOCK);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer(TEST_PORT_MOCK);
  });

  describe('Docker Graceful Degradation', () => {
    it('handles Docker graceful degradation', async () => {
      // This test verifies that the system works whether Docker is available or not
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      if (data.docker.ok) {
        // If Docker is available, version should be present
        expect(data.docker.version).toBeDefined();
        expect(data.docker.version).toMatch(/^\d+\.\d+/); // Should start with version number
      } else {
        // If Docker is not available, should still return valid response
        expect(data.docker.ok).toBe(false);
        // Version may or may not be present (client might be installed but server not running)
      }
      
      // System should continue to work regardless of Docker status
      expect(data.disk.freeBytes).toBeGreaterThan(0);
      expect(data.version.hola).toBeDefined();
    }, TEST_TIMEOUT);

    it('detects Docker in various states', async () => {
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      // Docker detection should work in all states:
      // 1. Not installed at all (ok: false, no version)
      // 2. Installed but daemon not running (ok: false, may have version)
      // 3. Installed and running (ok: true, has version)
      expect(typeof data.docker.ok).toBe('boolean');
      
      if (data.docker.version) {
        expect(typeof data.docker.version).toBe('string');
        expect(data.docker.version.length).toBeGreaterThan(0);
      }
    }, TEST_TIMEOUT);

    it('includes Docker service in health status', async () => {
      const response = await fetch(`${BASE_URL}${API.system.health}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('healthStatus');
      expect(data).toHaveProperty('activatedServices');
      
      // Docker service should be present (may be healthy or not depending on Docker availability)
      const services = data.activatedServices;
      const healthStatus = data.healthStatus;
      
      expect(services).toContain('docker');
      expect(healthStatus).toHaveProperty('docker');
      expect(typeof healthStatus.docker.healthy).toBe('boolean');
      expect(healthStatus.docker.lastCheck).toBeDefined();
    }, TEST_TIMEOUT);
  });
});

describe('Real Docker Service Health Reporting', () => {
  beforeAll(async () => {
    // Start a dedicated server with real docker flag enabled  
    await setupTestServer(TEST_PORT_REAL, {
      HOLA_USE_REAL_DOCKER: 'true',
    });
  }, 30000);

  afterAll(async () => {
    await teardownTestServer(TEST_PORT_REAL);
  });

  it('exposes feature flag useRealDocker=true in system config', async () => {
    const res = await fetch(`${BASE_URL_REAL}${API.system.config}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as { featureFlags: Record<string, boolean> };
    expect(json.featureFlags?.useRealDocker).toBe(true);
  });

  it('reports docker health in /api/system/health with lastCheck timestamp', async () => {
    const res = await fetch(`${BASE_URL_REAL}${API.system.health}`);
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
    expect(dockerHealth.lastCheck).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('integrates real docker status in /api/system/status', async () => {
    const res = await fetch(`${BASE_URL_REAL}${API.system.status}`);
    expect(res.ok).toBe(true);
    const json = await res.json() as GetSystemStatusResponse;

    expect(json).toHaveProperty('docker');
    expect(typeof json.docker.ok).toBe('boolean');
    
    // If Docker is actually available, should have version
    if (json.docker.ok && json.docker.version) {
      expect(typeof json.docker.version).toBe('string');
      expect(json.docker.version.length).toBeGreaterThan(0);
    }
  });
});