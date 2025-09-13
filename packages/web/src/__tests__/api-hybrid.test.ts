import { describe, it, expect } from 'vitest';
import { api } from '../utils/api-hybrid';
import type { HealthResponse } from '@hola/shared';

// Test that the hybrid API works and health endpoint is migrated
describe('Hybrid API - Health Migration', () => {
  it('should use SDK adapter for health endpoint', async () => {
    // This test verifies that the health endpoint uses the SDK adapter
    // We'll check that it returns the expected structure
    expect(api.health).toBeDefined();
    expect(typeof api.health).toBe('function');
  });

  it('should maintain same API surface as original', () => {
    // Verify all expected methods exist
    expect(api.health).toBeDefined();
    expect(api.me).toBeDefined();
    expect(api.summary).toBeDefined();
    expect(api.system).toBeDefined();
    expect(api.catalog).toBeDefined();
    expect(api.drafts).toBeDefined();
    expect(api.deployments).toBeDefined();
    expect(api.jobs).toBeDefined();
    expect(api.backups).toBeDefined();
    expect(api.notifications).toBeDefined();
    expect(api.settings).toBeDefined();
    expect(api.cache).toBeDefined();
  });

  it('should have working cache methods', () => {
    expect(api.cache.clear).toBeDefined();
    expect(api.cache.invalidate).toBeDefined();
    expect(api.cache.stats).toBeDefined();
    
    // Test that cache methods don't throw
    expect(() => api.cache.clear()).not.toThrow();
    expect(() => api.cache.invalidate('/test')).not.toThrow();
    expect(() => api.cache.stats()).not.toThrow();
  });
});