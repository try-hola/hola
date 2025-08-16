/**
 * Phase 4 Contract Tests - Docker + System Monitoring + SSE Status
 * 
 * Tests real Docker service, system monitoring service, and enhanced SSE status streaming
 * with graceful degradation when Docker is unavailable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { API } from '@hola/shared';
import type { 
  GetSystemStatusResponse,
  GetSummaryResponse,
  SystemHealthResponse
} from '@hola/shared';

const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 30000;

describe('Phase 4 Contract Tests - Docker + System Monitoring + SSE', () => {
  beforeAll(async () => {
    // Wait for server to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        const response = await fetch(`${BASE_URL}/healthz`);
        if (response.ok) break;
      } catch {
        // Server not ready yet
      }
      retries--;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (retries === 0) {
      throw new Error('Server failed to start within timeout');
    }
  }, TEST_TIMEOUT);

  describe('System Status with Real Monitoring', () => {
    it('returns real system data from monitoring service', async () => {
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      expect(data).toHaveProperty('docker');
      expect(data).toHaveProperty('disk');
      expect(data).toHaveProperty('version');
      
      // Docker status should be boolean and include version if available
      expect(typeof data.docker.ok).toBe('boolean');
      if (data.docker.ok) {
        expect(data.docker.version).toBeDefined();
        expect(typeof data.docker.version).toBe('string');
      }
      
      // Disk usage should have realistic values
      expect(data.disk.freeBytes).toBeGreaterThan(0);
      expect(data.disk.totalBytes).toBeGreaterThan(data.disk.freeBytes);
      expect(typeof data.disk.freeBytes).toBe('number');
      expect(typeof data.disk.totalBytes).toBe('number');
      
      // Version info should be present
      expect(data.version.hola).toBeDefined();
      expect(typeof data.version.hola).toBe('string');
      
      // Optional fields may be present
      if (data.oras) {
        expect(typeof data.oras.ok).toBe('boolean');
        if (data.oras.ok && data.oras.version) {
          expect(typeof data.oras.version).toBe('string');
        }
      }
      
      if (data.authentik) {
        expect(typeof data.authentik.ok).toBe('boolean');
      }
    }, TEST_TIMEOUT);

    it('includes real system status in summary', async () => {
      const response = await fetch(`${BASE_URL}${API.summary}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSummaryResponse;
      expect(data).toHaveProperty('system');
      expect(data).toHaveProperty('deploymentsCount');
      expect(data).toHaveProperty('activeJobsCount');
      expect(data).toHaveProperty('alertsCount');
      expect(data).toHaveProperty('recentJobs');
      
      // System status should match the same structure as standalone endpoint
      const systemStatus = data.system;
      expect(systemStatus).toHaveProperty('docker');
      expect(systemStatus).toHaveProperty('disk');
      expect(systemStatus).toHaveProperty('version');
      
      expect(typeof systemStatus.docker.ok).toBe('boolean');
      expect(systemStatus.disk.freeBytes).toBeGreaterThan(0);
      expect(systemStatus.disk.totalBytes).toBeGreaterThan(systemStatus.disk.freeBytes);
    }, TEST_TIMEOUT);

    it('includes Phase 4 services in health status', async () => {
      const response = await fetch(`${BASE_URL}${API.system.health}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as SystemHealthResponse;
      expect(data).toHaveProperty('healthStatus');
      expect(data).toHaveProperty('activatedServices');
      
      // Should include new Phase 4 services
      const services = data.activatedServices;
      const healthStatus = data.healthStatus;
      
      // Docker service should be present (may be healthy or not depending on Docker availability)
      expect(services).toContain('docker');
      expect(healthStatus).toHaveProperty('docker');
      expect(typeof healthStatus.docker.healthy).toBe('boolean');
      expect(healthStatus.docker.lastCheck).toBeDefined();
      
      // System monitoring service should be present
      expect(services).toContain('system-monitoring');
      expect(healthStatus).toHaveProperty('system-monitoring');
      expect(typeof healthStatus['system-monitoring'].healthy).toBe('boolean');
      expect(healthStatus['system-monitoring'].lastCheck).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Docker Service Integration', () => {
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

    it('detects ORAS tool availability', async () => {
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      // ORAS status is optional but should be valid if present
      if (data.oras) {
        expect(typeof data.oras.ok).toBe('boolean');
        if (data.oras.ok && data.oras.version) {
          expect(typeof data.oras.version).toBe('string');
        }
      }
    }, TEST_TIMEOUT);
  });

  describe('Real-time System Monitoring SSE', () => {
    it('provides SSE system status stream', async () => {
      // This is a simplified test for SSE - tests the response headers and status
      const response = await fetch(`${BASE_URL}/api/system/status/stream`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
    }, TEST_TIMEOUT);
  });

  describe('Disk Usage Monitoring', () => {
    it('returns realistic disk usage values', async () => {
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      const disk = data.disk;
      
      // Realistic disk sizes (should be at least 1GB total)
      expect(disk.totalBytes).toBeGreaterThan(1024 * 1024 * 1024); // > 1GB
      expect(disk.freeBytes).toBeGreaterThan(0);
      expect(disk.freeBytes).toBeLessThanOrEqual(disk.totalBytes);
      
      // Calculate percentage used
      const usedBytes = disk.totalBytes - disk.freeBytes;
      const percentUsed = (usedBytes / disk.totalBytes) * 100;
      
      // Should be a reasonable percentage (0-100%)
      expect(percentUsed).toBeGreaterThanOrEqual(0);
      expect(percentUsed).toBeLessThanOrEqual(100);
    }, TEST_TIMEOUT);

    it('tracks filesystem appropriately', async () => {
      // This test assumes the system monitoring service is checking the filesystem
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      // Should return valid disk usage data
      expect(typeof data.disk.freeBytes).toBe('number');
      expect(typeof data.disk.totalBytes).toBe('number');
      expect(data.disk.freeBytes).toBeGreaterThan(0);
      expect(data.disk.totalBytes).toBeGreaterThan(data.disk.freeBytes);
    }, TEST_TIMEOUT);
  });

  describe('External Tool Detection', () => {
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

    it('handles multiple independent tool detection', async () => {
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      // Each tool's availability should be independent
      // Docker, ORAS, and Authentik can each be available or not
      expect(typeof data.docker.ok).toBe('boolean');
      
      if (data.oras) {
        expect(typeof data.oras.ok).toBe('boolean');
      }
      
      if (data.authentik) {
        expect(typeof data.authentik.ok).toBe('boolean');
      }
      
      // System should work even if all external tools are unavailable
      expect(data.disk.freeBytes).toBeGreaterThan(0);
      expect(data.version.hola).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Performance and Resource Monitoring', () => {
    it('responds quickly for system status', async () => {
      const startTime = Date.now();
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      const endTime = Date.now();
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      // Response should be fast (under 5 seconds even with real system checks)
      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(5000);
    }, TEST_TIMEOUT);

    it('maintains performance for summary with system status', async () => {
      const startTime = Date.now();
      const response = await fetch(`${BASE_URL}${API.summary}`);
      const endTime = Date.now();
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      // Summary should still be fast even with real system monitoring
      const responseTime = endTime - startTime;
      expect(responseTime).toBeLessThan(5000);
      
      const data = await response.json() as GetSummaryResponse;
      expect(data.system).toBeDefined();
    }, TEST_TIMEOUT);
  });

  describe('Error Handling and Fallbacks', () => {
    it('falls back gracefully on system monitoring errors', async () => {
      // Even if some monitoring components fail, we should get a response
      const response = await fetch(`${BASE_URL}${API.system.status}`);
      
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      
      const data = await response.json() as GetSystemStatusResponse;
      
      // Core fields should always be present
      expect(data).toHaveProperty('docker');
      expect(data).toHaveProperty('disk');
      expect(data).toHaveProperty('version');
      
      // Even if monitoring fails, we should get some kind of values
      expect(typeof data.docker.ok).toBe('boolean');
      expect(typeof data.disk.freeBytes).toBe('number');
      expect(typeof data.disk.totalBytes).toBe('number');
      expect(typeof data.version.hola).toBe('string');
    }, TEST_TIMEOUT);

    it('maintains service factory fallback functionality', async () => {
      // Test that the service factory can fall back to mock implementations
      const healthResponse = await fetch(`${BASE_URL}${API.system.health}`);
      expect(healthResponse.ok).toBe(true);
      expect(healthResponse.status).toBe(200);
      
      const healthData = await healthResponse.json() as SystemHealthResponse;
      
      // All services should report some health status, even if using mocks
      expect(healthData.activatedServices.length).toBeGreaterThan(0);
      expect(Object.keys(healthData.healthStatus).length).toBeGreaterThan(0);
    }, TEST_TIMEOUT);
  });
});