/**
 * Draft Management Tests
 * 
 * Tests the complete draft lifecycle including creation, updates, validation, and finalization.
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
} from '@hola/shared';
import { setupTestServer, teardownTestServer } from '../utils/bun-server';
import { makeRequest } from '../utils/phase7-helpers';

describe('Draft Management', () => {
  let baseURL: string;

  beforeAll(async () => {
    // Enable Phase 7 features for testing
    process.env.HOLA_ENABLE_DEV_API = 'true';
    process.env.HOLA_USE_REAL_DRAFTS = 'false'; // Start with mocks
    
    baseURL = 'http://localhost:3001';
    
    // Use centralized server setup
    await setupTestServer(3001, {
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
      method: 'PATCH',
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