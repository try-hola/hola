import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api, apiClient } from '../utils/api';
import type { 
  HealthResponse, 
  GetSummaryResponse, 
  GetDeploymentsResponse,
  GetCatalogAppsResponse 
} from '@hola/shared';

// Test the API client infrastructure
describe('API Client', () => {
  beforeAll(() => {
    // Ensure we're testing against the development server
    expect(apiClient).toBeDefined();
  });

  afterAll(() => {
    // Clean up any cached requests
    apiClient.clearCache();
  });

  it('should fetch health status', async () => {
    const health = await api.health() as HealthResponse;
    
    expect(health).toBeDefined();
    expect(health.ok).toBe(true);
    expect(health.ts).toBeDefined();
    expect(typeof health.ts).toBe('string');
  });

  it('should fetch summary data', async () => {
    const summary = await api.summary() as GetSummaryResponse;
    
    expect(summary).toBeDefined();
    expect(typeof summary.deploymentsCount).toBe('number');
    expect(typeof summary.activeJobsCount).toBe('number');
    expect(typeof summary.alertsCount).toBe('number');
    expect(Array.isArray(summary.recentJobs)).toBe(true);
    expect(summary.system).toBeDefined();
    expect(typeof summary.system.docker.ok).toBe('boolean');
  });

  it('should fetch deployments list', async () => {
    const deployments = await api.deployments.list() as GetDeploymentsResponse;
    
    expect(deployments).toBeDefined();
    expect(Array.isArray(deployments.items)).toBe(true);
    expect(typeof deployments.total).toBe('number');
    expect(typeof deployments.page).toBe('number');
    expect(typeof deployments.limit).toBe('number');
  });

  it('should fetch catalog apps', async () => {
    const catalog = await api.catalog.apps() as GetCatalogAppsResponse;
    
    expect(catalog).toBeDefined();
    expect(Array.isArray(catalog.items)).toBe(true);
    expect(typeof catalog.total).toBe('number');
    
    if (catalog.items.length > 0) {
      const app = catalog.items[0];
      expect(app.id).toBeDefined();
      expect(app.name).toBeDefined();
      expect(app.description).toBeDefined();
      expect(app.category).toBeDefined();
    }
  });

  it('should handle query parameters correctly', async () => {
    const query = apiClient.buildQuery({
      page: 1,
      limit: 10,
      q: 'test',
      status: 'running',
      undefined: undefined,
    });

    expect(query).toBe('?page=1&limit=10&q=test&status=running');
  });

  it('should handle empty query parameters', async () => {
    const query = apiClient.buildQuery({});
    expect(query).toBe('');
  });

  it('should clear cache when requested', () => {
    expect(() => apiClient.clearCache()).not.toThrow();
  });
});
