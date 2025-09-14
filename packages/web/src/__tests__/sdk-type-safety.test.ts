import { describe, it, expect } from 'vitest';
import { sdkAdapter } from '../utils/sdk-adapter';
import type { 
  HealthResponse, 
  GetSummaryResponse, 
  GetMeResponse,
  GetSystemStatusResponse,
  GetCatalogAppsResponse,
  GetJobsResponse,
  GetBackupsResponse,
  GetNotificationsResponse,
  GetSettingsResponse
} from '@hola/shared';

describe('SDK Adapter Type Safety', () => {
  it('should have properly typed return types for all methods', () => {
    // These should all be properly typed now - no 'unknown' types
    
    // Health and basic endpoints
    const healthPromise: Promise<HealthResponse> = sdkAdapter.health();
    const mePromise: Promise<GetMeResponse> = sdkAdapter.me();
    const summaryPromise: Promise<GetSummaryResponse> = sdkAdapter.summary();
    
    // System status
    const systemStatusPromise: Promise<GetSystemStatusResponse> = sdkAdapter.system.status();
    
    // Catalog
    const catalogAppsPromise: Promise<GetCatalogAppsResponse> = sdkAdapter.catalog.apps();
    
    // Jobs
    const jobsPromise: Promise<GetJobsResponse> = sdkAdapter.jobs.list();
    
    // Backups
    const backupsPromise: Promise<GetBackupsResponse> = sdkAdapter.backups.list();
    
    // Notifications
    const notificationsPromise: Promise<GetNotificationsResponse> = sdkAdapter.notifications.list();
    
    // Settings
    const settingsPromise: Promise<GetSettingsResponse> = sdkAdapter.settings.get();
    
    // If we reach here without TypeScript errors, all types are properly defined
    expect(healthPromise).toBeDefined();
    expect(mePromise).toBeDefined();
    expect(summaryPromise).toBeDefined();
    expect(systemStatusPromise).toBeDefined();
    expect(catalogAppsPromise).toBeDefined();
    expect(jobsPromise).toBeDefined();
    expect(backupsPromise).toBeDefined();
    expect(notificationsPromise).toBeDefined();
    expect(settingsPromise).toBeDefined();
  });
  
  it('should have properly typed method parameters', () => {
    // Test that methods accept correct parameter types
    
    // Jobs with proper parameter typing
    const jobsWithParams: Promise<GetJobsResponse> = sdkAdapter.jobs.list({
      deploymentId: 'deployment-123',
      status: 'running',
      page: 1,
      limit: 10
    });
    
    // Catalog with proper parameter typing
    const catalogWithParams: Promise<GetCatalogAppsResponse> = sdkAdapter.catalog.apps({
      query: 'nginx',
      category: 'Web',
      page: 1,
      limit: 12
    });
    
    expect(jobsWithParams).toBeDefined();
    expect(catalogWithParams).toBeDefined();
  });
});