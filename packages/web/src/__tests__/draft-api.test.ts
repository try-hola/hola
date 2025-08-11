import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api } from '../utils/api';
import type { 
  CreateDraftResponse, 
  GetDraftResponse, 
  PatchDraftResponse, 
  ValidateDraftResponse, 
  PreflightResponse,
  FinalizeDraftResponse 
} from '@hola/shared';

// Test the draft API methods work correctly
describe('Draft API Integration', () => {
  beforeEach(() => {
    // Reset any mocks before each test
    vi.clearAllMocks();
  });

  it('should create a draft successfully', async () => {
    const response = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    
    expect(response).toBeDefined();
    expect(response.draftId).toBeDefined();
    expect(response.app).toBeDefined();
    expect(response.app.id).toBe('nextcloud');
    expect(response.systemEnv).toBeDefined();
    expect(response.appEnv).toBeDefined();
    expect(response.defaults).toBeDefined();
  });

  it('should fetch draft by ID', async () => {
    // First create a draft
    const createResponse = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    const draftId = createResponse.draftId;
    
    // Then fetch it
    const response = await api.drafts.byId(draftId) as GetDraftResponse;
    
    expect(response).toBeDefined();
    expect(response.draftId).toBe(draftId);
    expect(response.appId).toBeDefined();
    expect(response.appEnv).toBeDefined();
    expect(response.ports).toBeDefined();
  });

  it('should update draft successfully', async () => {
    // First create a draft
    const createResponse = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    const draftId = createResponse.draftId;
    
    // Update it
    const updateData = {
      systemOverrides: { DOMAIN: 'example.com' },
      appEnv: [{ key: 'TEST_VAR', value: 'test_value', isSecret: false }],
      ports: [{ host: 8080, container: 80, protocol: 'tcp' as const }]
    };
    
    const response = await api.drafts.update(draftId, updateData) as PatchDraftResponse;
    
    expect(response).toBeDefined();
    expect(response.ok).toBe(true);
    expect(response.draft).toBeDefined();
  });

  it('should validate draft successfully', async () => {
    // First create a draft
    const createResponse = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    const draftId = createResponse.draftId;
    
    // Validate it
    const response = await api.drafts.validate(draftId) as ValidateDraftResponse;
    
    expect(response).toBeDefined();
    expect(response.ok).toBeDefined();
    expect(response.errors).toBeDefined();
    expect(response.warnings).toBeDefined();
  });

  it('should run preflight checks successfully', async () => {
    // First create a draft
    const createResponse = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    const draftId = createResponse.draftId;
    
    // Run preflight
    const response = await api.drafts.preflight(draftId) as PreflightResponse;
    
    expect(response).toBeDefined();
    expect(response.ok).toBeDefined();
    expect(response.checks).toBeDefined();
    expect(Array.isArray(response.checks)).toBe(true);
  });

  it('should finalize draft successfully', async () => {
    // First create a draft
    const createResponse = await api.drafts.create({ appId: 'nextcloud' }) as CreateDraftResponse;
    const draftId = createResponse.draftId;
    
    // Finalize it
    const response = await api.drafts.finalize(draftId) as FinalizeDraftResponse;
    
    expect(response).toBeDefined();
    expect(response.spec).toBeDefined();
    expect(response.checksum).toBeDefined();
  });
});
