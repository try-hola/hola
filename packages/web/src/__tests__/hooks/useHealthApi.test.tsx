import { describe, it, expect, beforeEach } from 'vitest';
import { sdkAdapter } from '../../utils/sdk-adapter';
import { mockFetch, createMockResponse } from '../../setupTests';

// Test the SDK adapter directly instead of through React hooks
describe('Health API - SDK Migration', () => {
  beforeEach(() => {
    // Clear the mock and any cached data between tests
    mockFetch.mockClear();
    sdkAdapter.clearCache();
  });

  it('should call health endpoint through SDK adapter', async () => {
    // Mock a successful health response
    mockFetch.mockResolvedValueOnce(createMockResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }));

    const result = await sdkAdapter.health();

    expect(result).toBeDefined();
    expect(result.status).toBe('healthy');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('should handle health API errors gracefully', async () => {
    // Mock an error response
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(sdkAdapter.health()).rejects.toThrow('Network error');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should cache health responses when requested', async () => {
    // Mock response
    mockFetch.mockResolvedValue(createMockResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }));

    // First call
    const result1 = await sdkAdapter.health(true); // Use cache
    
    // Clear mock to ensure cache is used
    mockFetch.mockClear();
    
    // Second call should use cache (though health() with cache=true is rarely used)
    const result2 = await sdkAdapter.health(true);
    
    expect(result1).toEqual(result2);
    // If properly cached, mockFetch should not be called again
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it('should not cache health responses by default', async () => {
    // Mock response
    mockFetch.mockResolvedValue(createMockResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    }));

    // First call
    await sdkAdapter.health(); // No cache by default
    
    // Second call should make new request
    await sdkAdapter.health();
    
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});