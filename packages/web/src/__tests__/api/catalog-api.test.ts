import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { api } from '../../utils/api';
import type { GetCatalogAppsResponse, GetCatalogAppVersionsResponse } from '@hola/shared';

describe('Catalog API Integration', () => {
  beforeAll(() => {
    // Set the API base URL for testing
    process.env.VITE_API_BASE_URL = 'http://localhost:3001';
  });

  afterAll(() => {
    delete process.env.VITE_API_BASE_URL;
  });

  it('should fetch catalog apps successfully', async () => {
    const response = await api.catalog.apps() as GetCatalogAppsResponse;
    
    expect(response).toBeDefined();
    expect(response.items).toBeDefined();
    expect(Array.isArray(response.items)).toBe(true);
    expect(response.page).toBe(1);
    expect(response.limit).toBe(12);
    expect(response.total).toBeGreaterThan(0);
    
    // Check that we have the expected app structure
    if (response.items.length > 0) {
      const app = response.items[0];
      expect(app).toHaveProperty('id');
      expect(app).toHaveProperty('name');
      expect(app).toHaveProperty('description');
      expect(app).toHaveProperty('icon');
      expect(app).toHaveProperty('category');
      expect(app).toHaveProperty('rating');
      expect(app).toHaveProperty('downloads');
      expect(app).toHaveProperty('tags');
      expect(app).toHaveProperty('featured');
    }
  });

  it('should filter apps by category', async () => {
    const response = await api.catalog.apps({ category: 'Media' }) as GetCatalogAppsResponse;
    
    expect(response).toBeDefined();
    expect(response.items).toBeDefined();
    expect(Array.isArray(response.items)).toBe(true);
    
    // All returned apps should be in the Media category
    response.items.forEach(app => {
      expect(app.category).toBe('Media');
    });
  });

  it('should search apps by query', async () => {
    const response = await api.catalog.apps({ query: 'nextcloud' }) as GetCatalogAppsResponse;
    
    expect(response).toBeDefined();
    expect(response.items).toBeDefined();
    expect(Array.isArray(response.items)).toBe(true);
    
    // Should find Nextcloud app
    const nextcloudApp = response.items.find(app => app.id === 'nextcloud');
    expect(nextcloudApp).toBeDefined();
    expect(nextcloudApp?.name).toBe('Nextcloud');
  });

  it('should fetch app versions successfully', async () => {
    const response = await api.catalog.versions('nextcloud') as GetCatalogAppVersionsResponse;
    
    expect(response).toBeDefined();
    expect(response.items).toBeDefined();
    expect(Array.isArray(response.items)).toBe(true);
    expect(response.total).toBeGreaterThan(0);
    
    // Check version structure
    if (response.items.length > 0) {
      const version = response.items[0];
      expect(version).toHaveProperty('version');
      expect(version).toHaveProperty('createdAt');
    }
  });

  it('should handle pagination', async () => {
    const page1 = await api.catalog.apps({ page: 1, limit: 5 }) as GetCatalogAppsResponse;
    const page2 = await api.catalog.apps({ page: 2, limit: 5 }) as GetCatalogAppsResponse;
    
    expect(page1.page).toBe(1);
    expect(page2.page).toBe(2);
    expect(page1.limit).toBe(5);
    expect(page2.limit).toBe(5);
    
    // Pages should have different items (if there are enough apps)
    if (page1.total > 5) {
      expect(page1.items).not.toEqual(page2.items);
    }
  });
});
