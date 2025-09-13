/**
 * Phase 7 Contract Tests - Drafts, Validation, and Deployments
 * 
 * Tests the complete Phase 7 API endpoints including drafts, validation, 
 * deployments, and dev sessions.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  GetDraftResponse,
  PatchDraftRequest,
  PatchDraftResponse,
  ValidateDraftResponse,
  FinalizeDraftResponse,
  ValidationComposeRequest,
  ValidationComposeResponse,
  CreateDeploymentFromDraftRequest,
  CreateDeploymentFromDraftResponse,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  RollbackRequest,
  RollbackResponse,
  CreateDevSessionRequest,
  CreateDevSessionResponse,
  GetDevSessionsResponse,
  DevSession
} from '@hola/shared';

// Additional type definitions for system config and health endpoints
interface FeatureFlags {
  enableDevApi: boolean;
  useRealDrafts: boolean;
  useRealValidation: boolean;
  useRealDeployments: boolean;
  useRealDevSessions: boolean;
}

interface SystemConfig {
  featureFlags: FeatureFlags;
}

interface SystemHealth {
  activatedServices: string[];
}

// Test server management for bun:test
class BunTestServer {
  private child: ReturnType<typeof Bun.spawn> | null = null;
  private readonly port: number = 3001;

  async start(): Promise<void> {
    if (this.child) return;

    this.child = Bun.spawn([
      'bun',
      'run',
      'src/server.ts',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(this.port),
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    // Wait for server to be healthy
    await this.waitForHealthy();
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // Ignore kill errors
      }
      this.child = null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.port}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealthy(): Promise<void> {
    const start = Date.now();
    const timeout = 15000;
    
    while (Date.now() - start < timeout) {
      if (await this.isHealthy()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    throw new Error(`Server failed to become healthy within ${timeout}ms`);
  }
}

// Test infrastructure
interface TestResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function makeRequest<T = unknown>(options: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<TestResponse<T>> {
  const headers = {
    'content-type': 'application/json',
    'x-user-id': 'test-user',
    'x-user-email': 'test@example.com',
    'x-user-name': 'Test User',
    ...options.headers,
  };

  const requestOptions: RequestInit = {
    method: options.method,
    headers,
  };

  if (options.body && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
    requestOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(options.url, requestOptions);
  
  if (!response.headers.get('content-type')?.includes('application/json')) {
    return {
      success: response.ok,
      data: (await response.text()) as T,
    };
  }
  
  const data = await response.json();
  return {
    success: response.ok,
    data: response.ok ? data : undefined,
    error: !response.ok ? data.error : undefined,
  };
}

describe('Phase 7: Drafts, Validation, and Deployments', () => {
  let baseURL: string;
  let testServer: BunTestServer | null = null;

  beforeAll(async () => {
    // Enable Phase 7 features for testing
    process.env.HOLA_ENABLE_DEV_API = 'true';
    process.env.HOLA_USE_REAL_DRAFTS = 'false'; // Start with mocks
    process.env.HOLA_USE_REAL_VALIDATION = 'false';
    process.env.HOLA_USE_REAL_DEPLOYMENTS = 'false';
    process.env.HOLA_USE_REAL_DEV_SESSIONS = 'false';
    
    baseURL = 'http://localhost:3001';
    
    // Check if server is already running (e.g., in CI)
    testServer = new BunTestServer();
    if (!(await testServer.isHealthy())) {
      console.log('Starting test server for contract tests');
      await testServer.start();
    } else {
      console.log('Using existing server for contract tests');
      // Don't manage the server if it's already running
      testServer = null;
    }
  });

  afterAll(async () => {
    // Clean up test server
    if (testServer) {
      await testServer.stop();
      testServer = null;
    }
    
    // Clean up environment
    delete process.env.HOLA_ENABLE_DEV_API;
    delete process.env.HOLA_USE_REAL_DRAFTS;
    delete process.env.HOLA_USE_REAL_VALIDATION;
    delete process.env.HOLA_USE_REAL_DEPLOYMENTS;
    delete process.env.HOLA_USE_REAL_DEV_SESSIONS;
  });

  describe('Draft Management', () => {
    test('should create a new draft', async () => {
      const request: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const response = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: request
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(response.data!.draftId).toBeDefined();
      expect(response.data!.app.id).toBe('nextcloud');
      expect(response.data!.systemEnv).toBeDefined();
      expect(response.data!.appEnv).toBeDefined();
      expect(response.data!.defaults).toBeDefined();
    });

    test('should get a draft by ID', async () => {
      // First create a draft
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      expect(createResponse.success).toBe(true);
      const draftId = createResponse.data!.draftId;

      // Then get it
      const getResponse = await makeRequest<GetDraftResponse>({
        method: 'GET',
        url: `${baseURL}/api/drafts/${draftId}`
      });

      expect(getResponse.success).toBe(true);
      expect(getResponse.data).toBeDefined();
      expect(getResponse.data!.draftId).toBe(draftId);
      expect(getResponse.data!.appId).toBe('nextcloud');
    });

    test('should update a draft', async () => {
      // First create a draft
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      // Update the draft
      const updateRequest: PatchDraftRequest = {
        systemOverrides: { DOMAIN: 'example.com' },
        ports: [{ host: 8080, container: 80, protocol: 'tcp' }]
      };

      const updateResponse = await makeRequest<PatchDraftResponse>({
        method: 'PUT',
        url: `${baseURL}/api/drafts/${draftId}`,
        body: updateRequest
      });

      expect(updateResponse.success).toBe(true);
      expect(updateResponse.data).toBeDefined();
      expect(updateResponse.data!.ok).toBe(true);
    });

    test('should validate a draft', async () => {
      // First create a draft
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      // Validate the draft
      const validateResponse = await makeRequest<ValidateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts/${draftId}/validate`
      });

      expect(validateResponse.success).toBe(true);
      expect(validateResponse.data).toBeDefined();
      expect(typeof validateResponse.data!.ok).toBe('boolean');
      expect(Array.isArray(validateResponse.data!.errors)).toBe(true);
      expect(Array.isArray(validateResponse.data!.warnings)).toBe(true);
    });

    test('should finalize a draft', async () => {
      // First create a draft
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      // Finalize the draft
      const finalizeResponse = await makeRequest<FinalizeDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts/${draftId}/finalize`
      });

      expect(finalizeResponse.success).toBe(true);
      expect(finalizeResponse.data).toBeDefined();
      expect(finalizeResponse.data!.spec).toBeDefined();
      expect(finalizeResponse.data!.checksum).toBeDefined();
    });
  });

  describe('Validation Service', () => {
    test('should validate compose configuration', async () => {
      const request: ValidationComposeRequest = {
        composeYaml: `
version: '3.8'
services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
    environment:
      - ENV=production
        `,
        env: { ENV: 'production' }
      };

      const response = await makeRequest<ValidationComposeResponse>({
        method: 'POST',
        url: `${baseURL}/api/validation/compose`,
        body: request
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(typeof response.data!.ok).toBe('boolean');
      expect(Array.isArray(response.data!.errors)).toBe(true);
      expect(Array.isArray(response.data!.warnings)).toBe(true);
    });
  });

  describe('Deployment Management', () => {
    test('should create deployment from draft', async () => {
      // First create and finalize a draft
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      // Create deployment from draft
      const deploymentRequest: CreateDeploymentFromDraftRequest = {
        draftId,
        name: 'test-deployment',
        options: { autoStart: false }
      };

      const deploymentResponse = await makeRequest<CreateDeploymentFromDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments`,
        body: deploymentRequest
      });

      expect(deploymentResponse.success).toBe(true);
      expect(deploymentResponse.data).toBeDefined();
      expect(deploymentResponse.data!.deploymentId).toBeDefined();
      expect(deploymentResponse.data!.releaseId).toBeDefined();
    });

    test('should list deployments', async () => {
      const response = await makeRequest<GetDeploymentsResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments`
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(Array.isArray(response.data!.items)).toBe(true);
      expect(typeof response.data!.page).toBe('number');
      expect(typeof response.data!.limit).toBe('number');
      expect(typeof response.data!.total).toBe('number');
    });

    test('should get deployment by ID', async () => {
      // Create a deployment first
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      const deploymentRequest: CreateDeploymentFromDraftRequest = {
        draftId,
        name: 'test-deployment-2'
      };

      const deploymentResponse = await makeRequest<CreateDeploymentFromDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments`,
        body: deploymentRequest
      });

      const deploymentId = deploymentResponse.data!.deploymentId;

      // Get the deployment
      const getResponse = await makeRequest<GetDeploymentResponse>({
        method: 'GET',
        url: `${baseURL}/api/deployments/${deploymentId}`
      });

      expect(getResponse.success).toBe(true);
      expect(getResponse.data).toBeDefined();
      expect(getResponse.data!.id).toBe(deploymentId);
    });

    test('should execute deployment actions', async () => {
      // Create a deployment first
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      const deploymentRequest: CreateDeploymentFromDraftRequest = {
        draftId,
        name: 'test-deployment-3'
      };

      const deploymentResponse = await makeRequest<CreateDeploymentFromDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments`,
        body: deploymentRequest
      });

      const deploymentId = deploymentResponse.data!.deploymentId;

      // Execute start action
      const actionRequest: PostDeploymentActionRequest = {
        action: 'start'
      };

      const actionResponse = await makeRequest<PostDeploymentActionResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments/${deploymentId}/actions`,
        body: actionRequest
      });

      expect(actionResponse.success).toBe(true);
      expect(actionResponse.data).toBeDefined();
      expect(actionResponse.data!.ok).toBe(true);
      expect(actionResponse.data!.jobId).toBeDefined();
    });

    test('should rollback deployment', async () => {
      // Create a deployment first
      const createRequest: CreateDraftRequest = {
        appId: 'nextcloud',
        version: '1.0.0'
      };

      const createResponse = await makeRequest<CreateDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/drafts`,
        body: createRequest
      });

      const draftId = createResponse.data!.draftId;

      const deploymentRequest: CreateDeploymentFromDraftRequest = {
        draftId,
        name: 'test-deployment-rollback'
      };

      const deploymentResponse = await makeRequest<CreateDeploymentFromDraftResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments`,
        body: deploymentRequest
      });

      const deploymentId = deploymentResponse.data!.deploymentId;

      // Rollback
      const rollbackRequest: RollbackRequest = {
        targetReleaseId: 'mock-release-1',
        reason: 'Test rollback'
      };

      const rollbackResponse = await makeRequest<RollbackResponse>({
        method: 'POST',
        url: `${baseURL}/api/deployments/${deploymentId}/rollback`,
        body: rollbackRequest
      });

      expect(rollbackResponse.success).toBe(true);
      expect(rollbackResponse.data).toBeDefined();
      expect(rollbackResponse.data!.jobId).toBeDefined();
      expect(rollbackResponse.data!.targetReleaseId).toBeDefined();
    });
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
    test('should show Phase 7 features in system config', async () => {
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

    test('should show Phase 7 services in health check', async () => {
      const response = await makeRequest<SystemHealth>({
        method: 'GET',
        url: 'http://localhost:3001/api/system/health'
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      if (response.data) {
        expect(response.data.activatedServices).toContain('drafts');
        expect(response.data.activatedServices).toContain('validation');
        expect(response.data.activatedServices).toContain('deployments');
        expect(response.data.activatedServices).toContain('dev-sessions');
      }
    });
  });
});
