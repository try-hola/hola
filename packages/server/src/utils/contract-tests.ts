/**
 * Contract test harness for API compatibility verification
 * 
 * Tests that the same endpoints return compatible responses
 * in both mock and real modes.
 */

import { expect, describe, it, beforeAll, afterAll } from 'vitest';
import { API } from '@hola/shared';

interface TestServer {
  port: number;
  baseUrl: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ContractTestOptions {
  mockServer: TestServer;
  realServer?: TestServer;
  endpoints: EndpointTest[];
  timeout?: number;
}

interface EndpointTest {
  name: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  expectedStatus?: number;
  skipRealMode?: boolean; // Skip in real mode if not implemented yet
}

class ContractTestRunner {
  constructor(private options: ContractTestOptions) {}

  /**
   * Run contract tests against both mock and real servers
   */
  async runTests(): Promise<void> {
    const { mockServer, realServer, endpoints, timeout = 30000 } = this.options;

    describe('API Contract Tests', () => {
      describe('Mock Mode', () => {
        beforeAll(async () => {
          await mockServer.start();
        }, timeout);

        afterAll(async () => {
          await mockServer.stop();
        });

        for (const endpoint of endpoints) {
          it(`${endpoint.method} ${endpoint.path} - ${endpoint.name}`, async () => {
            const response = await this.makeRequest(mockServer, endpoint);
            
            // Basic assertions that all endpoints should pass
            expect(response.status).toBeGreaterThanOrEqual(200);
            expect(response.status).toBeLessThan(600);
            
            if (endpoint.expectedStatus) {
              expect(response.status).toBe(endpoint.expectedStatus);
            }
            
            // All responses should have request ID header
            expect(response.headers.get('x-request-id')).toBeTruthy();
            
            // JSON responses should parse correctly
            if (response.headers.get('content-type')?.includes('application/json')) {
              const data = await response.json();
              expect(data).toBeDefined();
              
              // Error responses should have standard shape
              if (response.status >= 400) {
                expect(data).toHaveProperty('error');
                expect(data.error).toHaveProperty('code');
                expect(data.error).toHaveProperty('message');
              }
            }
          });
        }
      });

      if (realServer) {
        describe('Real Mode', () => {
          beforeAll(async () => {
            await realServer.start();
          }, timeout);

          afterAll(async () => {
            await realServer.stop();
          });

          for (const endpoint of endpoints) {
            if (endpoint.skipRealMode) {
              it.skip(`${endpoint.method} ${endpoint.path} - ${endpoint.name} (real mode not implemented)`, () => {});
              continue;
            }

            it(`${endpoint.method} ${endpoint.path} - ${endpoint.name}`, async () => {
              const [mockResponse, realResponse] = await Promise.all([
                this.makeRequest(mockServer, endpoint),
                this.makeRequest(realServer, endpoint),
              ]);

              // Responses should have same status code
              expect(realResponse.status).toBe(mockResponse.status);

              // Both should have request ID
              expect(realResponse.headers.get('x-request-id')).toBeTruthy();
              expect(mockResponse.headers.get('x-request-id')).toBeTruthy();

              // For successful JSON responses, structure should be compatible
              if (mockResponse.status < 400 && 
                  mockResponse.headers.get('content-type')?.includes('application/json')) {
                
                const mockData = await mockResponse.json();
                const realData = await realResponse.json();
                
                // Check that all required fields from mock exist in real response
                this.validateResponseStructure(mockData, realData, endpoint.path);
              }
            });
          }
        });
      }
    });
  }

  /**
   * Make HTTP request to server
   */
  private async makeRequest(server: TestServer, endpoint: EndpointTest): Promise<Response> {
    const url = `${server.baseUrl}${endpoint.path}`;
    const headers = {
      'content-type': 'application/json',
      'x-request-id': crypto.randomUUID(),
      ...endpoint.headers,
    };

    const options: RequestInit = {
      method: endpoint.method,
      headers,
    };

    if (endpoint.body && ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      options.body = JSON.stringify(endpoint.body);
    }

    return fetch(url, options);
  }

  /**
   * Validate that real response has same structure as mock response
   */
  private validateResponseStructure(mockData: unknown, realData: unknown, path: string): void {
    if (typeof mockData !== typeof realData) {
      throw new Error(`Type mismatch for ${path}: mock=${typeof mockData}, real=${typeof realData}`);
    }

    if (Array.isArray(mockData)) {
      expect(realData).toBeInstanceOf(Array);
      if (mockData.length > 0 && (realData as unknown[]).length > 0) {
        this.validateResponseStructure(mockData[0], (realData as unknown[])[0], `${path}[0]`);
      }
      return;
    }

    if (mockData && typeof mockData === 'object') {
      expect(realData).toBeTypeOf('object');
      expect(realData).not.toBeNull();

      const mockObj = mockData as Record<string, unknown>;
      const realObj = realData as Record<string, unknown>;

      // Check that all mock properties exist in real response
      for (const key of Object.keys(mockObj)) {
        if (!(key in realObj)) {
          throw new Error(`Missing property '${key}' in real response for ${path}`);
        }
        
        // Recursively validate nested objects
        if (mockObj[key] && typeof mockObj[key] === 'object') {
          this.validateResponseStructure(mockObj[key], realObj[key], `${path}.${key}`);
        }
      }
    }
  }
}

/**
 * Standard endpoint tests that should work in both modes
 */
export const standardEndpointTests: EndpointTest[] = [
  // Health and basic endpoints
  {
    name: 'Health check',
    method: 'GET',
    path: API.health,
    expectedStatus: 200,
  },
  {
    name: 'Hello endpoint',
    method: 'GET',
    path: API.hello,
    expectedStatus: 200,
  },
  {
    name: 'System status',
    method: 'GET',
    path: API.system.status,
    expectedStatus: 200,
  },
  
  // Summary and user info
  {
    name: 'Summary data',
    method: 'GET',
    path: API.summary,
    expectedStatus: 200,
  },
  {
    name: 'User identity',
    method: 'GET',
    path: API.me,
    headers: {
      'x-user-id': 'test-user',
      'x-user-email': 'test@example.com',
      'x-user-name': 'Test User',
    },
    expectedStatus: 200,
  },
  
  // Catalog endpoints
  {
    name: 'Catalog apps list',
    method: 'GET',
    path: `${API.catalog.apps}?page=1&limit=10`,
    expectedStatus: 200,
  },
  {
    name: 'Catalog app detail',
    method: 'GET',
    path: API.catalog.appById('nextcloud'),
    expectedStatus: 200,
  },
  
  // Settings endpoints
  {
    name: 'System settings',
    method: 'GET',
    path: API.settings.base,
    expectedStatus: 200,
  },
  {
    name: 'Backup settings',
    method: 'GET',
    path: API.settings.backup,
    expectedStatus: 200,
  },
  
  // Deployments (basic listing)
  {
    name: 'Deployments list',
    method: 'GET',
    path: `${API.deployments.base}?page=1&limit=10`,
    expectedStatus: 200,
  },
  
  // Jobs listing
  {
    name: 'Jobs list',
    method: 'GET',
    path: `${API.jobs.base}?page=1&limit=10`,
    expectedStatus: 200,
  },
  
  // Backups listing
  {
    name: 'Backups list',
    method: 'GET',
    path: `${API.backups.base}?page=1&limit=10`,
    expectedStatus: 200,
  },
  
  // Notifications listing
  {
    name: 'Notifications list',
    method: 'GET',
    path: `${API.notifications.base}?page=1&limit=10`,
    expectedStatus: 200,
  },
];

/**
 * Create contract test runner for the standard test suite
 */
export function createStandardContractTests(options: Omit<ContractTestOptions, 'endpoints'>): ContractTestRunner {
  return new ContractTestRunner({
    ...options,
    endpoints: standardEndpointTests,
  });
}

/**
 * Create a test server wrapper for Bun server
 */
export function createTestServer(port: number): TestServer {
  return {
    port,
    baseUrl: `http://localhost:${port}`,
    
    async start() {
      // In Phase 0, we'll use the existing server
      // Later phases will create dedicated test server instances
    },
    
    async stop() {
      // Cleanup logic here
    },
  };
}

export { ContractTestRunner, type EndpointTest, type ContractTestOptions };
