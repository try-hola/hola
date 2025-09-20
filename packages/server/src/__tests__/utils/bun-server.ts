/**
 * Shared server utilities for bun:test contract tests
 * 
 * Centralizes server startup/teardown and health verification for bun:test suites.
 * This is the Bun-compatible version of the server utility.
 */

let serverProcess: ReturnType<typeof Bun.spawn> | null = null;
let serverPid: number | null = null;
let serverRefCount = 0; // reference count of suites using primary port instance

/**
 * Start the server in background and capture PID
 * Uses `bun run dev` as recommended in repo docs
 * @param port - Port to start server on (default: 3001)
 * @param env - Additional environment variables
 */
export async function startServer(port: number = 3001, env: Record<string, string> = {}): Promise<void> {
  if (serverProcess) {
    serverRefCount++;
    return; // already started under this process context
  }

  // Resolve bun executable path robustly to avoid ENOENT in CI where PATH might differ.
  const resolvedBunPath = resolveBunPath();
  console.log(`Starting server with \`${resolvedBunPath} run dev\` on port ${port}...`);
  
  // Start server process in background
  const debug = process.env.HOLA_DEBUG_TEST_SERVER === 'true';
  serverProcess = Bun.spawn([
    resolvedBunPath,
    'run',
    'dev',
  ], {
    // Ensure we run the server package's dev script only (no workspace-level dev)
    cwd: `${process.cwd()}/packages/server`,
    env: {
      ...process.env,
      PORT: String(port),
      ...env, // Allow custom environment variables
    },
    stdout: debug ? 'inherit' : 'ignore',
    stderr: debug ? 'inherit' : 'ignore',
  });

  serverPid = serverProcess.pid;
  serverRefCount = 1;
  console.log(`Server started with PID: ${serverPid}`);

  // Wait for server to be healthy before returning
  await waitForHealthz(15000, port);
}

/**
 * Resolve bun executable path with multiple fallbacks.
 * Order:
 * 1. HOLA_TEST_BUN_PATH (explicit override for tests)
 * 2. BUN_BIN (common variable some environments export)
 * 3. Bun.which('bun')
 * 4. If current process is bun (process.argv[0] / Bun.version available), use process.execPath
 * Throws if none found.
 */
function resolveBunPath(): string {
  const fromEnv = process.env.HOLA_TEST_BUN_PATH || process.env.BUN_BIN;
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const which = Bun.which?.('bun');
    if (which) return which;
  } catch {
    // ignore
  }

  // Bun exposes process.execPath pointing to bun binary when executing under bun
  if (typeof Bun !== 'undefined' && 'version' in Bun && process.execPath) {
    return process.execPath;
  }

  throw new Error('Unable to resolve bun executable path. Set HOLA_TEST_BUN_PATH to override.');
}

/**
 * Poll /healthz endpoint until healthy or timeout
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 15000)
 * @param port - Port to check (default: 3001)
 */
export async function waitForHealthz(timeoutMs: number = 15000, port: number = 3001): Promise<void> {
  const startTime = Date.now();
  const baseUrl = `http://localhost:${port}`;
  
  console.log(`Waiting for server health check on port ${port} (timeout: ${timeoutMs}ms)...`);
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        console.log('Server is healthy and ready');
        return;
      }
    } catch {
      // Server not ready yet, continue polling
    }
    
    // Wait 300ms before next check
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  throw new Error(`Server failed to become healthy within ${timeoutMs}ms`);
}

/**
 * Kill the server process
 * Handles cleanup gracefully
 */
export async function stopServer(force = false): Promise<void> {
  if (!serverProcess || !serverPid) return;
  if (!force) {
    serverRefCount = Math.max(0, serverRefCount - 1);
    if (serverRefCount > 0) return; // other suites still using
  }
  console.log(`Stopping server (PID: ${serverPid})...`);
  try {
    serverProcess.kill();
    await serverProcess.exited;
    console.log('Server stopped successfully');
  } catch (error) {
    console.warn('Error stopping server:', error);
  } finally {
    serverProcess = null;
    serverPid = null;
    serverRefCount = 0;
  }
}

/**
 * Check if server is already running on the expected port
 * Used to detect if server was started externally (e.g., in CI)
 * @param port - Port to check (default: 3001)
 */
export async function isServerRunning(port: number = 3001): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/healthz`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if we should skip server startup based on environment variable
 * Use HOLA_TEST_SKIP_SERVER_START=true to opt-out when running against 
 * an already-started server
 */
export function shouldSkipServerStart(): boolean {
  return process.env.HOLA_TEST_SKIP_SERVER_START === 'true';
}

/**
 * Centralized server management for bun:test contract tests
 * Handles startup/shutdown with environment variable opt-out
 * @param port - Port to start server on (default: 3001)
 * @param env - Additional environment variables
 */
export async function setupTestServer(port: number = 3001, env: Record<string, string> = {}): Promise<void> {
  if (shouldSkipServerStart()) {
    console.log('Skipping server startup (HOLA_TEST_SKIP_SERVER_START=true)');
    
    // Verify existing server is healthy
    if (!(await isServerRunning(port))) {
      throw new Error(
        `HOLA_TEST_SKIP_SERVER_START=true but no healthy server found on port ${port}. ` +
        'Start server manually or unset the environment variable.'
      );
    }
    
    console.log('Using existing healthy server');
    return;
  }

  // Check if server is already running
  if (await isServerRunning(port)) {
    // If we didn't start it yet in this process, adopt it without ref counting (no stop)
    if (!serverProcess) {
      console.log(`Adopting externally started server on port ${port}`);
      serverRefCount = 0; // do not manage lifecycle we didn't start
      return;
    }
    console.log(`Server already running on port ${port}, incrementing ref count`);
    serverRefCount++;
    return;
  }

  // Start new server instance
  await startServer(port, { enableDevApi: 'true', ...env });
}

/**
 * Centralized server cleanup for bun:test contract tests
 * Only stops server if we started it (respects opt-out flag)
 */
export async function teardownTestServer(): Promise<void> {
  if (shouldSkipServerStart()) {
    console.log('Skipping server teardown (HOLA_TEST_SKIP_SERVER_START=true)');
    return;
  }
  if (process.env.HOLA_TEST_FORCE_SERVER_STOP === 'true') {
    await stopServer(true);
  } else {
    // Intentionally skipping server stop to prevent parallel worker race tearing down shared instance
    // Set HOLA_TEST_FORCE_SERVER_STOP=true to restore previous behavior.
    return;
  }
}