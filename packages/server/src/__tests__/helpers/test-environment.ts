/**
 * Standardized Test Environment
 * 
 * Provides a reliable, isolated test environment that eliminates brittle
 * background process management. All tests should use this utility for
 * consistent, predictable test execution.
 * 
 * Key Benefits:
 * - No background processes or port conflicts
 * - In-process server for fast, reliable tests
 * - Consistent environment setup across all tests
 * - Automatic cleanup and isolation
 */

const TEST_BASE_URL = 'http://localhost:3001';

let testApp: { fetch: (req: Request) => Promise<Response>; close: () => Promise<void> } | null = null;
let handleRequestRef: ((req: Request) => Promise<Response>) | null = null;
const originalFetch = global.fetch;

interface TestEnvironmentOptions {
  /** Custom environment variables for this test session */
  env?: Record<string, string>;
  /** Custom port (for testing) - defaults to 3001 */
  port?: number;
  /** Enable background tasks (usually disabled for tests) */
  enableBackgroundTasks?: boolean;
}

/**
 * Convert relative URLs to absolute test URLs
 */
function toAbsoluteUrl(raw: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return new URL(raw, TEST_BASE_URL).toString();
}

/**
 * Convert various input types to a proper Request object
 */
function toRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (input instanceof Request) {
    const url = toAbsoluteUrl(input.url);
    return new Request(url, input);
  }
  if (input instanceof URL) {
    return new Request(toAbsoluteUrl(input.toString()), init);
  }
  return new Request(toAbsoluteUrl(String(input)), init);
}

/**
 * In-process fetch implementation that routes requests directly to the test server
 */
async function inProcessFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!handleRequestRef) {
    throw new Error('Test server not started. Call setupTestEnvironment() first.');
  }
  const request = toRequest(input, init);
  return handleRequestRef(request);
}

/**
 * Setup the test environment with in-process server
 * 
 * This creates an isolated test environment that doesn't require external processes,
 * ports, or manual server management. All requests are handled in-process for
 * maximum reliability and speed.
 */
export async function setupTestEnvironment(options: TestEnvironmentOptions = {}): Promise<void> {
  if (testApp) {
    return; // Already setup
  }

  // Set environment variables
  if (options.env) {
    Object.assign(process.env, options.env);
  }
  
  if (options.port) {
    process.env.PORT = String(options.port);
  }

  // Disable autostart to prevent external server conflicts
  process.env.HOLA_DISABLE_AUTOSTART = 'true';

  // Import and setup server
  const serverModule = await import('../../server');
  handleRequestRef = serverModule.handleRequest;
  
  testApp = await serverModule.createInProcessApp({ 
    enableBackgroundTasks: options.enableBackgroundTasks ?? false, 
    resetServicesOnClose: false 
  });

  // Replace global fetch with in-process version
  global.fetch = inProcessFetch as typeof fetch;
}

/**
 * Cleanup the test environment
 * 
 * Properly closes the test server and restores global state.
 * Should be called in afterAll() or afterEach() hooks.
 */
export async function teardownTestEnvironment(): Promise<void> {
  // Restore original fetch
  global.fetch = originalFetch;
  
  // Close test app
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
  
  // Clear request handler
  handleRequestRef = null;
}

/**
 * Get the test fetch function for making HTTP requests to the test server
 * 
 * This is useful when you need to pass the fetch function to other utilities
 * or want to be explicit about using the test environment.
 */
export function getTestFetch(): typeof fetch {
  if (!handleRequestRef) {
    throw new Error('Test server not started. Call setupTestEnvironment() first.');
  }
  return inProcessFetch as typeof fetch;
}

/**
 * Make a request to the test server
 * 
 * Convenience function for making HTTP requests within tests.
 * Uses the in-process fetch automatically.
 */
export async function makeTestRequest(
  path: string, 
  init?: RequestInit
): Promise<Response> {
  const fetch = getTestFetch();
  return fetch(path, init);
}

/**
 * Create a test environment for a specific feature set
 * 
 * Pre-configured environments for common testing scenarios.
 */
export async function setupFeatureTestEnvironment(
  feature: 'drafts' | 'deployments' | 'docker' | 'auth' | 'system',
  options: TestEnvironmentOptions = {}
): Promise<void> {
  const featureEnv: Record<string, Record<string, string>> = {
    drafts: {
      NODE_ENV: 'test', // Force test environment
    },
    deployments: {
      NODE_ENV: 'test', // Force test environment
    },
    docker: {
      NODE_ENV: 'test', // Force test environment
    },
    auth: {
      NODE_ENV: 'test', // Force test environment
      HOLA_USE_AUTH: 'false', // Explicitly disable auth for testing
    },
    system: {
      NODE_ENV: 'test', // Force test environment
    },
  };

  const env = {
    ...featureEnv[feature],
    ...options.env,
  };

  await setupTestEnvironment({ ...options, env });
}

// Export constants for external use
export { TEST_BASE_URL };

// Legacy compatibility - redirect old imports to new functions
export const setupTestServer = setupTestEnvironment;
export const teardownTestServer = teardownTestEnvironment;