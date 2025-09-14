import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sdkAdapter } from '../../utils/sdk-adapter';

// Test the SDK adapter with basic functionality
describe('SDK Adapter', () => {
  beforeAll(() => {
    // Ensure the adapter is properly initialized
    expect(sdkAdapter).toBeDefined();
  });

  afterAll(() => {
    // Clean up any cached requests
    sdkAdapter.clearCache();
  });

  it('should be instantiated and have expected methods', () => {
    expect(sdkAdapter.health).toBeDefined();
    expect(sdkAdapter.me).toBeDefined();
    expect(sdkAdapter.summary).toBeDefined();
    expect(sdkAdapter.catalog).toBeDefined();
    expect(sdkAdapter.drafts).toBeDefined();
    expect(sdkAdapter.deployments).toBeDefined();
    expect(sdkAdapter.jobs).toBeDefined();
    expect(sdkAdapter.backups).toBeDefined();
    expect(sdkAdapter.notifications).toBeDefined();
    expect(sdkAdapter.settings).toBeDefined();
  });

  it('should have cache management methods', () => {
    expect(sdkAdapter.cache.clear).toBeDefined();
    expect(sdkAdapter.cache.invalidate).toBeDefined();
    expect(sdkAdapter.cache.stats).toBeDefined();
  });

  it('should have utility methods', () => {
    expect(sdkAdapter.buildQuery).toBeDefined();
    expect(sdkAdapter.clearCache).toBeDefined();
    expect(sdkAdapter.cancelPendingRequests).toBeDefined();
  });

  it('should build query strings correctly', () => {
    expect(sdkAdapter.buildQuery({})).toBe('');
    expect(sdkAdapter.buildQuery({ page: 1 })).toBe('?page=1');
    expect(sdkAdapter.buildQuery({ page: 1, limit: 10 })).toBe('?page=1&limit=10');
    expect(sdkAdapter.buildQuery({ page: 1, limit: 10, status: undefined })).toBe('?page=1&limit=10');
  });
});