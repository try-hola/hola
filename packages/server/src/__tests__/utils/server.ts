/**
 * Shared server utilities for contract tests
 * 
 * Centralizes server startup/teardown and health verification for all contract test suites.
 * Reduces flakiness and duplicated logic across test phases.
 */

import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';

let serverProcess: ChildProcess | null = null;
let serverPid: number | null = null;

/**
 * Start the server in background and capture PID
 * Uses `bun run dev &` as recommended in repo docs
 */
export async function startServer(): Promise<void> {
  if (serverProcess) {
    throw new Error('Server is already running. Call stopServer() first.');
  }

  console.log('Starting server with `bun run dev`...');
  
  // Start server process in background
  serverProcess = spawn('bun', ['run', 'dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: '3001', // Ensure consistent port
    },
    stdio: 'ignore', // Suppress server output in tests
    detached: true, // Run in background
  });

  serverPid = serverProcess.pid;
  console.log(`Server started with PID: ${serverPid}`);

  // Wait for server to be healthy before returning
  await waitForHealthz();
}

/**
 * Poll /healthz endpoint until healthy or timeout
 * @param timeoutMs - Maximum time to wait in milliseconds (default: 15000)
 */
export async function waitForHealthz(timeoutMs: number = 15000): Promise<void> {
  const startTime = Date.now();
  const baseUrl = 'http://localhost:3001';
  
  console.log(`Waiting for server health check (timeout: ${timeoutMs}ms)...`);
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        console.log('Server is healthy and ready');
        return;
      }
    } catch (error) {
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
export async function stopServer(): Promise<void> {
  if (serverProcess && serverPid) {
    console.log(`Stopping server (PID: ${serverPid})...`);
    
    try {
      // Kill the process and its children
      process.kill(serverPid, 'SIGTERM');
      console.log('Server stopped successfully');
    } catch (error) {
      console.warn('Error stopping server:', error);
    } finally {
      serverProcess = null;
      serverPid = null;
    }
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
 */
export async function setupTestServer(): Promise<void> {
  if (shouldSkipServerStart()) {
    console.log('Skipping server startup (HOLA_TEST_SKIP_SERVER_START=true)');
    
    // Verify existing server is healthy
    if (!(await isServerRunning())) {
      throw new Error(
        'HOLA_TEST_SKIP_SERVER_START=true but no healthy server found on port 3001. ' +
        'Start server manually or unset the environment variable.'
      );
    }
    
    console.log('Using existing healthy server');
    return;
  }

  // Check if server is already running
  if (await isServerRunning()) {
    console.log('Server already running, using existing instance');
    return;
  }

  // Start new server instance
  await startServer();
}

/**
 * Centralized server cleanup for contract tests
 * Only stops server if we started it (respects opt-out flag)
 */
export async function teardownTestServer(): Promise<void> {
  if (shouldSkipServerStart()) {
    console.log('Skipping server teardown (HOLA_TEST_SKIP_SERVER_START=true)');
    return;
  }

  await stopServer();
}