/**
 * Shared server utilities for contract tests
 * 
 * Centralizes server startup/teardown and health verification for all contract test suites.
 * Reduces flakiness and duplicated logic across test phases.
 */

import { spawn, execSync } from 'child_process';
import type { ChildProcess } from 'child_process';

// Support multiple concurrent servers keyed by port to avoid cross-suite interference
const serverProcesses = new Map<number, ChildProcess>();

/**
 * Start the server in background and capture PID
 * Uses `bun run dev &` as recommended in repo docs
 * @param port - Port to start server on (default: 3001)
 * @param env - Additional environment variables
 */
export async function startServer(port: number = 3001, env: Record<string, string> = {}): Promise<void> {
  if (serverProcesses.has(port)) {
    throw new Error(`Server is already running on port ${port}. Call stopServer(${port}) first.`);
  }

  console.log(`Starting server with \`bun run dev\` on port ${port}...`);
  
  // Start server process in background
  const proc = spawn('bun', ['run', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...env, // Allow custom environment variables
    },
    stdio: 'ignore', // Suppress server output in tests
    detached: true, // Run in background
  });
  serverProcesses.set(port, proc);
  const serverPid = proc.pid ?? null;
  console.log(`Server started with PID: ${serverPid}`);

  // Wait for server to be healthy before returning
  await waitForHealthz(15000, port);
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
 * Attempt to terminate any process listening on the given port.
 * Best-effort: sends SIGTERM first, then SIGKILL if still present.
 */
async function freePort(port: number): Promise<void> {
  try {
    // Find PIDs using lsof and send SIGTERM
    execSync(
      `bash -lc 'PIDS=$(lsof -ti :${port} || true); if [ -n "$PIDS" ]; then kill -TERM $PIDS || true; sleep 0.3; PIDS2=$(lsof -ti :${port} || true); if [ -n "$PIDS2" ]; then kill -KILL $PIDS2 || true; fi; fi'`,
      { stdio: 'ignore' }
    );
  } catch {
    // Ignore errors; we'll verify via health check below
  }
  // Wait briefly for port to be released
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!(await isServerRunning(port))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Kill the server process
 * Handles cleanup gracefully
 */
export async function stopServer(port?: number): Promise<void> {
  // Stop a specific port if provided, otherwise stop all
  const stopOne = (p: number, proc: ChildProcess) => {
    const pid = proc.pid ?? null;
    if (!pid) return;
    console.log(`Stopping server on port ${p} (PID: ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
      console.log('Server stopped successfully');
    } catch (error) {
      console.warn('Error stopping server:', error);
    } finally {
      serverProcesses.delete(p);
    }
  };

  if (typeof port === 'number') {
    const proc = serverProcesses.get(port);
    if (proc) stopOne(port, proc);
    return;
  }

  // Stop all running servers
  for (const [p, proc] of Array.from(serverProcesses.entries())) {
    stopOne(p, proc);
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
 * Centralized server management for contract tests
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

  // Ensure we own the server on the target port to avoid cross-run interference
  if (await isServerRunning(port)) {
    console.log(`Port ${port} is already in use. Attempting to free it before tests...`);
    await freePort(port);
  }

  // Start new server instance
  await startServer(port, env);
}

/**
 * Centralized server cleanup for contract tests
 * Only stops server if we started it (respects opt-out flag)
 */
export async function teardownTestServer(port?: number): Promise<void> {
  if (shouldSkipServerStart()) {
    console.log('Skipping server teardown (HOLA_TEST_SKIP_SERVER_START=true)');
    return;
  }

  await stopServer(port);
}