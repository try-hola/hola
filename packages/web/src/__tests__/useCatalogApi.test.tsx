import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCatalogAppsApi, useCatalogAppVersionsApi } from '../hooks/useCatalogApi';

describe('Catalog API Hooks', () => {
  it('should fetch catalog apps with useCatalogAppsApi', async () => {
    const { result } = renderHook(() => 
      useCatalogAppsApi({ page: 1, limit: 12 })
    );

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    // Wait for the API call to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have data
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.items).toBeDefined();
    expect(Array.isArray(result.current.data?.items)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should fetch app versions with useCatalogAppVersionsApi', async () => {
    const { result } = renderHook(() => 
      useCatalogAppVersionsApi('nextcloud')
    );

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    // Wait for the API call to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have data
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.items).toBeDefined();
    expect(Array.isArray(result.current.data?.items)).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should handle search parameters', async () => {
    const { result } = renderHook(() => 
      useCatalogAppsApi({ 
        page: 1, 
        limit: 12, 
        query: 'nextcloud',
        category: 'Productivity'
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeDefined();
    expect(result.current.error).toBeNull();
    
    // Should find Nextcloud in results
    const hasNextcloud = result.current.data?.items.some(app => 
      app.id === 'nextcloud' && app.category === 'Productivity'
    );
    expect(hasNextcloud).toBe(true);
  });

  it('should use cache for repeated requests', async () => {
    const params = { page: 1, limit: 12 };
    
    // First render
    const { result: result1 } = renderHook(() => useCatalogAppsApi(params));
    
    await waitFor(() => {
      expect(result1.current.loading).toBe(false);
    });

    const firstData = result1.current.data;

    // Second render with same params should use cache
    const { result: result2 } = renderHook(() => useCatalogAppsApi(params));
    
    // Should immediately have data from cache
    expect(result2.current.loading).toBe(false);
    expect(result2.current.data).toEqual(firstData);
  });
});
