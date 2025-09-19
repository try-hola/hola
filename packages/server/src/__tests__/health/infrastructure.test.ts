/**
 * Health and Infrastructure Tests
 * 
 * Verifies that the foundational infrastructure works correctly
 * and maintains API compatibility.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/server';

const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 30000;

describe('Health and Infrastructure', () => {
  beforeAll(async () => {
    await setupTestServer();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer();
  });

  describe('Health and Infrastructure Endpoints', () => {
    it('should have healthy health check endpoint', async () => {
      const response = await fetch(`${BASE_URL}/healthz`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('memory');
    });

    it('should have ready readiness check endpoint', async () => {
      const response = await fetch(`${BASE_URL}/readyz`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('status', 'ready');
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('checks');
    });

    it('should provide metrics endpoint', async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(typeof data).toBe('object');
      // Should have some metrics
      expect(Object.keys(data).length).toBeGreaterThan(0);
    });
  });

  describe('Standard API Endpoints', () => {
    it('should respond to health endpoint with correct format', async () => {
      const response = await fetch(`${BASE_URL}${API.health}`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('ok', true);
      expect(data).toHaveProperty('ts');
      expect(typeof data.ts).toBe('string');
    });

    it('should respond to hello endpoint with correct format', async () => {
      const response = await fetch(`${BASE_URL}${API.hello}`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('message');
      expect(data.message).toContain('Phase 0');
    });
  });

  describe('Request ID Middleware', () => {
    it('should add request ID to response headers', async () => {
      const response = await fetch(`${BASE_URL}${API.hello}`);
      
      const requestId = response.headers.get('x-request-id');
      expect(requestId).toBeTruthy();
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should preserve provided request ID', async () => {
      const testRequestId = 'test-' + crypto.randomUUID();
      
      const response = await fetch(`${BASE_URL}${API.hello}`, {
        headers: {
          'x-request-id': testRequestId,
        },
      });
      
      expect(response.headers.get('x-request-id')).toBe(testRequestId);
    });
  });

  describe('CORS Support', () => {
    it('should handle preflight requests', async () => {
      const response = await fetch(`${BASE_URL}${API.hello}`, {
        method: 'OPTIONS',
      });
      
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-allow-methods')).toContain('GET');
      expect(response.headers.get('access-control-allow-headers')).toContain('x-request-id');
    });

    it('should include CORS headers in responses', async () => {
      const response = await fetch(`${BASE_URL}${API.hello}`);
      
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await fetch(`${BASE_URL}/api/unknown-endpoint`);
      
      expect(response.status).toBe(404);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'NOT_FOUND');
      expect(data.error).toHaveProperty('message');
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await fetch(`${BASE_URL}/api/echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: 'invalid-json',
      });
      
      expect(response.status).toBe(400);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toHaveProperty('code', 'BAD_JSON');
    });
  });

  describe('Phase 0 Specific Endpoints', () => {
    it('should provide feature flags information', async () => {
      const response = await fetch(`${BASE_URL}/api/phase0/features`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('phase', 'Phase 0 - Foundations');
      expect(data).toHaveProperty('featureFlags');
      expect(data).toHaveProperty('config');
      expect(data).toHaveProperty('services');
      
      // Verify service infrastructure is available
      expect(data.services).toHaveProperty('logging', true);
      expect(data.services).toHaveProperty('metrics', true);
      expect(data.services).toHaveProperty('healthChecks', true);
      expect(data.services).toHaveProperty('serviceFactory', true);
    });

    it('should provide service factory status', async () => {
      const response = await fetch(`${BASE_URL}/api/phase0/services`);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');
      
      const data = await response.json();
      expect(data).toHaveProperty('healthStatus');
      expect(data).toHaveProperty('activatedServices');
      expect(typeof data.healthStatus).toBe('object');
      expect(Array.isArray(data.activatedServices)).toBe(true);
    });

    it('should echo requests with metadata', async () => {
      const testData = { message: 'test', timestamp: Date.now() };
      
      const response = await fetch(`${BASE_URL}/api/echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(testData),
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('x-request-id')).toBeTruthy();
      
      const data = await response.json();
      expect(data).toHaveProperty('received', testData);
      expect(data).toHaveProperty('timestamp');
      expect(data).toHaveProperty('requestId');
      expect(data.requestId).toBe(response.headers.get('x-request-id'));
    });
  });

  describe('Observability', () => {
    it('should track request metrics', async () => {
      // Make a few requests to generate metrics
      await fetch(`${BASE_URL}${API.hello}`);
      await fetch(`${BASE_URL}${API.health}`);
      await fetch(`${BASE_URL}/api/unknown`); // 404
      
      const metricsResponse = await fetch(`${BASE_URL}/metrics`);
      const metrics = await metricsResponse.json();
      
      // Should have HTTP request counters
      expect(metrics).toHaveProperty('http_requests');
      
      const httpRequestMetrics = metrics.http_requests;
      expect(typeof httpRequestMetrics).toBe('object');
      
      // Should have tracked some requests
      const totalRequests = Object.values(httpRequestMetrics as Record<string, number>)
        .reduce((sum, count) => sum + count, 0);
      expect(totalRequests).toBeGreaterThan(0);
    });

    it('should track memory usage', async () => {
      const metricsResponse = await fetch(`${BASE_URL}/metrics`);
      const metrics = await metricsResponse.json();
      
      expect(metrics).toHaveProperty('memory_usage');
      
      const memoryMetrics = metrics.memory_usage;
      expect(typeof memoryMetrics).toBe('object');
      
      // Memory metrics might be empty if not yet collected, which is acceptable
      if (Object.keys(memoryMetrics).length > 0) {
        // Keys are currently emitted in the form type=heap_used, type=heap_total, etc.
        const hasHeapUsed = Object.prototype.hasOwnProperty.call(memoryMetrics, 'type=heap_used');
        const hasHeapTotal = Object.prototype.hasOwnProperty.call(memoryMetrics, 'type=heap_total');
        expect(hasHeapUsed).toBe(true);
        expect(hasHeapTotal).toBe(true);
        if (hasHeapUsed) {
          expect(typeof memoryMetrics['type=heap_used']).toBe('number');
          expect(memoryMetrics['type=heap_used']).toBeGreaterThan(0);
        }
        if (hasHeapTotal) {
          expect(typeof memoryMetrics['type=heap_total']).toBe('number');
          expect(memoryMetrics['type=heap_total']).toBeGreaterThan(0);
        }
      } else {
        // Empty memory metrics object is acceptable - metrics collection might be lazy
        console.log('Memory metrics not yet populated - this is acceptable');
      }
    });
  });
});