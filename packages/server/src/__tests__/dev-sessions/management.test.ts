/**
 * Dev Sessions Management Tests
 * 
 * Tests development session creation, listing, and management.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  CreateDevSessionRequest,
  CreateDevSessionResponse,
  GetDevSessionsResponse,
  DevSession,
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest, SystemConfig, SystemHealth } from '../utils/phase7-helpers';

describe('Dev Sessions Management', () => {
  let baseURL: string;

  beforeAll(async () => {
    // Enable Phase 7 features for testing
    process.env.HOLA_ENABLE_DEV_API = 'true';
    process.env.HOLA_USE_REAL_DEV_SESSIONS = 'false';
    
    baseURL = 'http://localhost:3001';
    
    // Use centralized server setup
    await setupTestServer(3001, {
      HOLA_ENABLE_DEV_API: 'true',
      HOLA_USE_REAL_DEV_SESSIONS: 'false',
    });
  });

  afterAll(async () => {
    await teardownTestServer();
    
    // Clean up environment
    delete process.env.HOLA_ENABLE_DEV_API;
    delete process.env.HOLA_USE_REAL_DEV_SESSIONS;
  });

  describe('Dev Sessions', () => {
    test('should create dev session', async () => {
      const request: CreateDevSessionRequest = {
        appId: 'nextcloud',
        version: '1.0.0',
        name: 'test-dev-session',
        autoStart: false
      };

      const response = await makeRequest<CreateDevSessionResponse>({
        method: 'POST',
        url: `${baseURL}/api/dev/sessions`,
        body: request
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data!.sessionId).toBeDefined();
      expect(response.data!.draftId).toBeDefined();
    });

    test('should list dev sessions', async () => {
      const response = await makeRequest<GetDevSessionsResponse>({
        method: 'GET',
        url: `${baseURL}/api/dev/sessions`
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(Array.isArray(response.data!.items)).toBe(true);
      expect(typeof response.data!.page).toBe('number');
      expect(typeof response.data!.limit).toBe('number');
      expect(typeof response.data!.total).toBe('number');
    });

    test('should get dev session by ID', async () => {
      // Create session first
      const createRequest: CreateDevSessionRequest = {
        appId: 'nextcloud',
        version: '1.0.0',
        name: 'test-dev-session-2',
        autoStart: false
      };

      const createResponse = await makeRequest<CreateDevSessionResponse>({
        method: 'POST',
        url: `${baseURL}/api/dev/sessions`,
        body: createRequest
      });

      const sessionId = createResponse.data!.sessionId;

      // Get the session
      const getResponse = await makeRequest<DevSession>({
        method: 'GET',
        url: `${baseURL}/api/dev/sessions/${sessionId}`
      });

      expect(getResponse.success).toBe(true);
      expect(getResponse.data).toBeDefined();
      expect(getResponse.data!.id).toBe(sessionId);
    });
  });

  describe('System Configuration', () => {
    test('should show dev API features in system config', async () => {
      const response = await makeRequest<SystemConfig>({
        method: 'GET',
        url: 'http://localhost:3001/api/system/config'
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      if (response.data) {
        expect(response.data.featureFlags.enableDevApi).toBe(true);
      }
    });

    test('should show dev session services in health check', async () => {
      // Ensure services have been instantiated before checking health
      await makeRequest({ method: 'GET', url: `${baseURL}/api/dev/sessions` });
      await makeRequest({ method: 'GET', url: `${baseURL}/api/deployments` });

      const response = await makeRequest<SystemHealth>({
        method: 'GET',
        url: 'http://localhost:3001/api/system/health'
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      if (response.data) {
        expect(response.data.activatedServices).toEqual(
          expect.arrayContaining(['drafts', 'validation'])
        );
        if (response.data.activatedServices.includes('deployments')) {
          expect(response.data.activatedServices).toContain('dev-sessions');
        }
      }
    });
  });
});
