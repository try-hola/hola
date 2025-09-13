import { describe, it, expect, beforeEach } from 'vitest';
import { sdkAdapter } from '../utils/sdk-adapter';
import { mockFetch, createMockResponse } from '../setupTests';

// Test catalog API through SDK adapter directly
describe('Catalog API - SDK Migration', () => {
  beforeEach(() => {
    // Clear mock between tests
    mockFetch.mockClear();
    sdkAdapter.clearCache();
  });

  it('should fetch catalog apps through SDK adapter', async () => {
    // Mock catalog apps response
    mockFetch.mockResolvedValueOnce(createMockResponse({
      items: [
        {
          id: 'nextcloud',
          name: 'Nextcloud',
          category: 'Productivity',
          description: 'File sharing platform',
          icon: 'https://example.com/icon.png',
          verified: true
        }
      ],
      pagination: {
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1
      }
    }));

    const result = await sdkAdapter.catalog.apps({ page: 1, limit: 12 });

    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBe(1);
    expect(result.items[0].id).toBe('nextcloud');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/catalog/apps?page=1&limit=12',
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('should fetch app versions through SDK adapter', async () => {
    // Mock versions response
    mockFetch.mockResolvedValueOnce(createMockResponse({
      items: [
        {
          version: '28.0.0',
          releaseDate: '2024-01-15',
          changelog: 'Latest stable release',
          recommended: true
        }
      ],
      pagination: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1
      }
    }));

    const result = await sdkAdapter.catalog.versions('nextcloud');

    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items[0].version).toBe('28.0.0');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/catalog/apps/nextcloud/versions',
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('should handle search parameters correctly', async () => {
    // Mock filtered results
    mockFetch.mockResolvedValueOnce(createMockResponse({
      items: [
        {
          id: 'nextcloud',
          name: 'Nextcloud',
          category: 'Productivity',
          description: 'File sharing platform',
          icon: 'https://example.com/icon.png',
          verified: true
        }
      ],
      pagination: {
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1
      }
    }));

    const result = await sdkAdapter.catalog.apps({ 
      page: 1, 
      limit: 12, 
      query: 'nextcloud',
      category: 'Productivity'
    });

    expect(result).toBeDefined();
    expect(result.items[0].id).toBe('nextcloud');
    expect(result.items[0].category).toBe('Productivity');
    
    // Verify the URL includes query parameters
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/catalog/apps?page=1&limit=12&query=nextcloud&category=Productivity',
      expect.objectContaining({
        method: 'GET'
      })
    );
  });

  it('should use cache for repeated requests', async () => {
    const params = { page: 1, limit: 12 };
    
    // Mock response for first call
    const mockResponse = createMockResponse({
      items: [
        {
          id: 'nextcloud',
          name: 'Nextcloud',
          category: 'Productivity',
          description: 'File sharing platform',
          icon: 'https://example.com/icon.png',
          verified: true
        }
      ],
      pagination: {
        page: 1,
        limit: 12,
        total: 1,
        totalPages: 1
      }
    });
    
    mockFetch.mockResolvedValue(mockResponse);
    
    // First call
    const result1 = await sdkAdapter.catalog.apps(params);
    
    // Clear the mock to ensure cache is being used
    mockFetch.mockClear();

    // Second call with same params should use cache
    const result2 = await sdkAdapter.catalog.apps(params);
    
    // Results should be the same (from cache)
    expect(result1).toEqual(result2);
    
    // Mock should not have been called again (cache hit)
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it('should build query strings correctly', () => {
    expect(sdkAdapter.buildQuery({})).toBe('');
    expect(sdkAdapter.buildQuery({ page: 1 })).toBe('?page=1');
    expect(sdkAdapter.buildQuery({ page: 1, limit: 10 })).toBe('?page=1&limit=10');
    expect(sdkAdapter.buildQuery({ page: 1, limit: 10, status: undefined })).toBe('?page=1&limit=10');
  });

  it('should handle API errors in catalog endpoints', async () => {
    // Mock an error response
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(sdkAdapter.catalog.apps({ page: 1, limit: 12 })).rejects.toThrow('Network error');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
