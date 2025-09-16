import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type {
  GetSummaryResponse,
  HealthResponse,
  GetCatalogAppsResponse,
  GetCatalogAppVersionsResponse,
  GetDeploymentsResponse,
  CreateDraftResponse,
  GetDraftResponse,
  PatchDraftResponse,
  ValidateDraftResponse,
  PreflightResponse,
  FinalizeDraftResponse,
} from '@hola/shared';

// Do not inject React globally; rely on automatic JSX runtime and imports

// Mock fetch globally for tests with proper response handling
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Export mockFetch for use in individual tests
export { mockFetch };

// Helper to create a proper Response-like object used by api.ts
export const createMockResponse = (data: unknown, options: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}) => {
  const headers = options.headers || { 'content-type': 'application/json' };
  const base = {
    ok: options.ok ?? (options.status ? options.status >= 200 && options.status < 300 : true),
    status: options.status ?? 200,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    async json() {
      return data;
    },
    async text() {
      try { return JSON.stringify(data); } catch { return String(data); }
    },
  };
  return {
    ...base,
    clone() {
      // Return a shallow clone with the same data accessors
      return createMockResponse(data, options);
    },
  } as unknown as Response;
};

// Default mock implementations for common API calls
mockFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
  // Create base URL patterns to match
  const urlStr = typeof url === 'string' ? url : String(url);
  const method = (init?.method || 'GET').toUpperCase();
  
  // Health endpoint
  if (urlStr.includes('/api/health')) {
    const res: HealthResponse = { ok: true, ts: new Date().toISOString() };
    return createMockResponse(res);
  }
  
  // Summary endpoint
  if (urlStr.includes('/api/summary')) {
    const res: GetSummaryResponse = {
      deploymentsCount: 5,
      activeJobsCount: 1,
      alertsCount: 0,
      recentJobs: [],
      system: { docker: { ok: true, version: '24.0.5' }, disk: { freeBytes: 50_000_000_000, totalBytes: 100_000_000_000 }, version: { hola: '1.0.0', compose: '2.28.0' } },
    };
    return createMockResponse(res);
  }
  
  // Catalog apps endpoint with filtering and pagination for tests
  if (urlStr.includes('/api/catalog/apps') && !urlStr.includes('/versions')) {
    const urlObj = new URL(urlStr, 'http://localhost');
    const category = urlObj.searchParams.get('category') || undefined;
    const query = urlObj.searchParams.get('query') || undefined;
    const page = Number(urlObj.searchParams.get('page') || '1');
    const limit = Number(urlObj.searchParams.get('limit') || '12');

    const catalog = [
      {
        id: 'nextcloud',
        name: 'Nextcloud',
        description: 'File sharing and collaboration platform',
        icon: 'https://example.com/nextcloud-icon.png',
        category: 'Productivity',
        rating: 4.8,
        downloads: 12345,
        tags: ['files', 'collaboration'],
        featured: true,
      },
      {
        id: 'plex',
        name: 'Plex',
        description: 'Media server',
        icon: 'https://example.com/plex-icon.png',
        category: 'Media',
        rating: 4.6,
        downloads: 54321,
        tags: ['media', 'streaming'],
        featured: false,
      },
      {
        id: 'jellyfin',
        name: 'Jellyfin',
        description: 'Open-source media system',
        icon: 'https://example.com/jellyfin-icon.png',
        category: 'Media',
        rating: 4.5,
        downloads: 22334,
        tags: ['media', 'streaming'],
        featured: false,
      },
    ];

    let filtered = catalog;
    if (category) {
      filtered = filtered.filter(app => app.category === category);
    }
    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(app => app.name.toLowerCase().includes(q) || app.id.toLowerCase().includes(q));
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const end = start + limit;
    const items = filtered.slice(start, end);

    const res: GetCatalogAppsResponse = {
      items,
      page,
      limit,
      total,
    };
    return createMockResponse(res);
  }
  
  // Catalog app versions endpoint
  if (urlStr.includes('/api/catalog/apps/') && urlStr.includes('/versions')) {
    const res: GetCatalogAppVersionsResponse = {
      items: [
        { version: '28.0.0', createdAt: '2024-01-15T00:00:00Z' },
      ],
      total: 1,
    };
    return createMockResponse(res);
  }

  // Deployments list
  if (urlStr.endsWith('/api/deployments') || urlStr.includes('/api/deployments?')) {
    const res: GetDeploymentsResponse = {
      items: [
        {
          id: 'dep-1',
          name: 'Nextcloud',
          app: 'nextcloud',
          icon: '',
          status: 'running',
          ports: ['8080:80'],
          lastUpdated: new Date().toISOString(),
          url: 'http://localhost:8080',
        },
      ],
      page: 1,
      limit: 10,
      total: 1,
    };
    return createMockResponse(res);
  }

  // Drafts
  if (urlStr.endsWith('/api/drafts') && method === 'POST') {
    const res: CreateDraftResponse = {
      draftId: 'draft-1',
      app: { id: 'nextcloud', name: 'Nextcloud', icon: '' },
      systemEnv: [],
      appEnv: [],
      defaults: { ports: [], volumes: [] },
    };
    return createMockResponse(res);
  }
  const draftIdMatch = urlStr.match(/\/api\/drafts\/(.+?)(?:\/|$)/);
  if (draftIdMatch && method === 'GET') {
    const res: GetDraftResponse = {
      draftId: draftIdMatch[1],
      appId: 'nextcloud',
      version: '28.0.0',
      systemOverrides: {},
      appEnv: [],
      ports: [],
      files: [],
    };
    return createMockResponse(res);
  }
  if (draftIdMatch && method === 'PATCH') {
    const res: PatchDraftResponse = { ok: true, draft: {
      draftId: draftIdMatch[1], appId: 'nextcloud', version: '28.0.0', systemOverrides: {}, appEnv: [], ports: [], files: []
    } } as unknown as PatchDraftResponse; // minimal compliance
    return createMockResponse(res);
  }
  if (draftIdMatch && urlStr.endsWith('/validate') && method === 'POST') {
    const res: ValidateDraftResponse = { ok: true, errors: [], warnings: [] };
    return createMockResponse(res);
  }
  if (draftIdMatch && urlStr.endsWith('/preflight') && method === 'POST') {
    const res: PreflightResponse = { ok: true, checks: [] };
    return createMockResponse(res);
  }
  if (draftIdMatch && urlStr.endsWith('/finalize') && method === 'POST') {
    const res: FinalizeDraftResponse = { spec: { ok: true }, checksum: 'abc123' };
    return createMockResponse(res);
  }
  
  // Default response for other endpoints
  return createMockResponse({});
});

// Mock global cache clear function for test isolation
const originalConsoleWarn = console.warn;
beforeEach(() => {
  // Clear any caches between tests
  mockFetch.mockClear();
  
  // Suppress React StrictMode warnings in tests
  console.warn = (message: string, ...args: unknown[]) => {
    if (typeof message === 'string' && message.includes('act(...)')) {
      return; // Suppress act warnings in tests
    }
    originalConsoleWarn(message, ...args);
  };
});

afterEach(() => {
  // Restore console.warn
  console.warn = originalConsoleWarn;
});

// Mock the browser APIs that might be used in components
// Check if we're in a DOM environment (jsdom)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // deprecated
      removeListener: vi.fn(), // deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Mock URL.createObjectURL for file download tests
if (typeof URL !== 'undefined') {
  Object.defineProperty(URL, 'createObjectURL', {
    writable: true,
    value: vi.fn(() => 'mock-url'),
  });
}

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});
