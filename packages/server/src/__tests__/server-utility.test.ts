/**
 * Test the new shared server utility
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, isServerRunning, waitForHealthz } from './utils/server';

const TEST_TIMEOUT = 30000;

describe('Server Utility Integration Test', () => {
  beforeAll(async () => {
    await setupTestServer();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('should have server running and healthy', async () => {
    expect(await isServerRunning()).toBe(true);
  });

  it('should respond to healthz endpoint', async () => {
    await expect(waitForHealthz(5000)).resolves.not.toThrow();
  });

  it('should be able to fetch from health endpoint', async () => {
    const response = await fetch('http://localhost:3001/healthz');
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'healthy');
  });
});