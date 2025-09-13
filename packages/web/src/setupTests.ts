import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';

// Ensure React is available globally for hooks
globalThis.React = React;

// Also ensure React.useState is available directly  
if (!globalThis.React || !globalThis.React.useState) {
  console.error('React not properly initialized in test setup');
  globalThis.React = React;
}

// Mock fetch globally for tests with proper response handling
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Export mockFetch for use in individual tests
export { mockFetch };

// Helper to create a proper Response-like object
export const createMockResponse = (data: unknown, options: { status?: number; ok?: boolean; headers?: Record<string, string> } = {}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  headers: {
    get: (name: string) => options.headers?.[name.toLowerCase()] || (name.toLowerCase() === 'content-type' ? 'application/json' : null),
  },
  json: async () => data
});

// Default mock implementations for common API calls
mockFetch.mockImplementation(async (url: string) => {
  // Create base URL patterns to match
  const urlStr = typeof url === 'string' ? url : url.toString();
  
  // Health endpoint
  if (urlStr.includes('/api/health')) {
    return createMockResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  }
  
  // Summary endpoint
  if (urlStr.includes('/api/summary')) {
    return createMockResponse({
      deployments: { total: 5, running: 3, stopped: 2 },
      jobs: { total: 10, pending: 2, running: 1, completed: 7 },
      notifications: { total: 3, unread: 1 }
    });
  }
  
  // Catalog apps endpoint
  if (urlStr.includes('/api/catalog/apps')) {
    return createMockResponse({
      items: [
        {
          id: 'nextcloud',
          name: 'Nextcloud',
          category: 'Productivity',
          description: 'File sharing and collaboration platform',
          icon: 'https://example.com/nextcloud-icon.png',
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
  }
  
  // Catalog app versions endpoint
  if (urlStr.includes('/api/catalog/apps/') && urlStr.includes('/versions')) {
    return createMockResponse({
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
    });
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

// Mock URL.createObjectURL for file download tests
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'mock-url'),
});

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
