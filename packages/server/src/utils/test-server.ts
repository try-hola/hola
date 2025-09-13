/**
 * Test server utilities for contract tests
 * 
 * Provides helper functions to start and stop the server in background
 * for tests that need it to be running.
 */

export interface TestServerManager {
  /** Start the server in background */
  start(): Promise<void>;
  /** Stop the background server */
  stop(): Promise<void>;
  /** Check if server is healthy */
  isHealthy(): Promise<boolean>;
}

interface TestServerOptions {
  /** Port to run server on (default: 3001) */
  port?: number;
  /** Timeout in ms to wait for server to be healthy (default: 15000) */
  timeout?: number;
  /** Environment variables to set */
  env?: Record<string, string>;
}

class BunTestServerManager implements TestServerManager {
  private child: ReturnType<typeof Bun.spawn> | null = null;
  private readonly port: number;
  private readonly timeout: number;
  private readonly env: Record<string, string>;

  constructor(options: TestServerOptions = {}) {
    this.port = options.port ?? 3001;
    this.timeout = options.timeout ?? 15000;
    this.env = options.env ?? {};
  }

  async start(): Promise<void> {
    if (this.child) {
      throw new Error('Server is already running');
    }

    // Start the server process
    this.child = Bun.spawn([
      'bun',
      'run',
      'src/server.ts',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(this.port),
        ...this.env,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    // Wait for server to be healthy
    await this.waitForHealthy();
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        // Ignore kill errors
      }
      this.child = null;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.port}/healthz`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForHealthy(): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < this.timeout) {
      if (await this.isHealthy()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    throw new Error(`Server failed to become healthy within ${this.timeout}ms`);
  }
}

/**
 * Create a test server manager for contract tests
 */
export function createTestServer(options?: TestServerOptions): TestServerManager {
  return new BunTestServerManager(options);
}

/**
 * Check if a server is already running on the expected port
 * This allows tests to work in CI where server is already started
 */
export async function isServerRunning(port = 3001): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for server to be ready with retries
 * Used by tests that don't manage their own server
 */
export async function waitForServer(port = 3001, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  throw new Error(`Server failed to start within ${timeoutMs}ms`);
}