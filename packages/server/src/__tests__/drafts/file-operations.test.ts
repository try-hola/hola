/**
 * File Operations Test
 * 
 * Test file upload, delete, and preflight endpoints
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type {
  CreateDraftRequest,
  CreateDraftResponse,
  UploadDraftFileResponse,
  DeleteDraftFileResponse,
  EnhancedPreflightResponse,
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';

describe('Draft File Operations', () => {
  let baseURL: string;

  beforeAll(async () => {
    // Enable Phase 7 features for testing
    process.env.HOLA_ENABLE_DEV_API = 'true';
    process.env.HOLA_USE_REAL_DRAFTS = 'false'; // Start with mocks
    
    baseURL = 'http://localhost:3002';
    
    // Use centralized server setup
    await setupTestServer(3002, {
      HOLA_ENABLE_DEV_API: 'true',
      HOLA_USE_REAL_DRAFTS: 'false',
    });
  });

  afterAll(async () => {
    await teardownTestServer();
    
    // Clean up environment
    delete process.env.HOLA_ENABLE_DEV_API;
    delete process.env.HOLA_USE_REAL_DRAFTS;
  });

  test('should upload a file to draft', async () => {
    // Create a draft first
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
    
    const draft = createResponse.data!;
    expect(draft.draftId).toBeDefined();

    // Upload a file (JSON format)
    const uploadRequest = {
      name: 'test-config.yml',
      content: Buffer.from('version: "3.8"\nservices:\n  app:\n    image: test').toString('base64'),
      kind: 'composeOverride',
      path: 'config/docker-compose.yml'
    };

    const uploadResponse = await makeRequest<UploadDraftFileResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draft.draftId}/uploads`,
      body: uploadRequest
    });
    
    expect(uploadResponse.success).toBe(true);
    
    const uploadResult = uploadResponse.data!;
    expect(uploadResult.uploadId).toBeDefined();
    expect(uploadResult.name).toBe('test-config.yml');
    expect(uploadResult.kind).toBe('composeOverride');
  });

  test('should delete a file from draft', async () => {
    // Create a draft first
    const createRequest: CreateDraftRequest = {
      appId: 'postgres',
      version: '1.0.0'
    };

    const createResponse = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: createRequest
    });
    
    expect(createResponse.success).toBe(true);
    
    const draft = createResponse.data!;

    // Upload a file first
    const uploadRequest = {
      name: 'secret.txt',
      content: Buffer.from('secret-password').toString('base64'),
      kind: 'secret',
      path: 'secrets/password.txt'
    };

    const uploadResponse = await makeRequest<UploadDraftFileResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draft.draftId}/uploads`,
      body: uploadRequest
    });
    
    expect(uploadResponse.success).toBe(true);
    
    const uploadResult = uploadResponse.data!;

    // Delete the file
    const deleteResponse = await makeRequest<DeleteDraftFileResponse>({
      method: 'DELETE',
      url: `${baseURL}/api/drafts/${draft.draftId}/uploads/${uploadResult.uploadId}`
    });
    
    expect(deleteResponse.success).toBe(true);
    
    // DELETE returns 204 No Content, so we just check success
    expect(deleteResponse.data).toBeDefined();
  });

  test('should run preflight checks', async () => {
    // Create a draft first
    const createRequest: CreateDraftRequest = {
      appId: 'redis',
      version: '1.0.0'
    };

    const createResponse = await makeRequest<CreateDraftResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts`,
      body: createRequest
    });
    
    expect(createResponse.success).toBe(true);
    
    const draft = createResponse.data!;

    // Run preflight check
    const preflightResponse = await makeRequest<EnhancedPreflightResponse>({
      method: 'POST',
      url: `${baseURL}/api/drafts/${draft.draftId}/preflight`
    });
    
    expect(preflightResponse.success).toBe(true);
    
    const preflightResult = preflightResponse.data!;
    expect(preflightResult.ok).toBeDefined();
    expect(preflightResult.checks).toBeDefined();
    expect(Array.isArray(preflightResult.checks)).toBe(true);
  });
});