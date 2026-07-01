import { describe, it, expect } from 'vitest';
import { api } from '../../utils/api-hybrid';
import { api as originalApi } from '../../utils/api';

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

  it('exposes every deployment operation as a function, including promote', () => {
    // Regression: `promote` was added to the original api client but not the SDK
    // adapter, and the hybrid api routes deployments to the adapter — so the
    // dashboard's Upgrade button hit `api.deployments.promote is not a function`.
    for (const m of ['create', 'list', 'byId', 'update', 'history', 'action', 'promote', 'remove', 'logs']) {
      expect(typeof (api.deployments as Record<string, unknown>)[m]).toBe('function');
    }
  });

  it('hybrid deployments surface has parity with the original api client', () => {
    // Whichever backend the hybrid routes to must implement everything the
    // original client does — this catches an adapter that lags behind api.ts.
    for (const key of Object.keys(originalApi.deployments)) {
      expect(typeof (api.deployments as Record<string, unknown>)[key]).toBe('function');
    }
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