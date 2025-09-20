/**
 * Deployment Management Tests
 * 
 * Tests deployment creation from drafts, lifecycle management, actions, and rollbacks.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  CreateDeploymentFromDraftRequest,
  CreateDeploymentFromDraftResponse,
  GetDeploymentsResponse,
  GetDeploymentResponse,
  PostDeploymentActionRequest,
  PostDeploymentActionResponse,
  RollbackRequest,
  RollbackResponse,
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';

describe('Deployment Management', () => {
  let baseURL: string;

  beforeAll(async () => {
    // Enable Phase 7 features for testing
    process.env.HOLA_ENABLE_DEV_API = 'true';
    process.env.HOLA_USE_REAL_DEPLOYMENTS = 'false';
    process.env.HOLA_USE_REAL_VALIDATION = 'false';
    process.env.HOLA_USE_REAL_DRAFTS = 'false';
    
    baseURL = 'http://localhost:3001';
    
    // Use centralized server setup
    await setupTestServer(3001, {
      HOLA_ENABLE_DEV_API: 'true',
      HOLA_USE_REAL_DEPLOYMENTS: 'false',
      HOLA_USE_REAL_VALIDATION: 'false',
      HOLA_USE_REAL_DRAFTS: 'false',
    });
  });

  afterAll(async () => {
    await teardownTestServer();
    
    // Clean up environment
    delete process.env.HOLA_ENABLE_DEV_API;
    delete process.env.HOLA_USE_REAL_DEPLOYMENTS;
    delete process.env.HOLA_USE_REAL_VALIDATION;
    delete process.env.HOLA_USE_REAL_DRAFTS;
  });

  describe('Deployment Lifecycle', () => {
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
  });

  describe('Deployment Actions', () => {
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
});