import { setupTestServer as setupInProcessServer, teardownTestServer as teardownInProcessServer } from './server';

export async function setupTestServer(port: number = 3001, env: Record<string, string> = {}): Promise<void> {
  if (port) {
    process.env.PORT = String(port);
  }

  Object.assign(process.env, env);
  await setupInProcessServer();
}

export async function teardownTestServer(): Promise<void> {
  await teardownInProcessServer();
}

export async function stopServer(): Promise<void> {
  await teardownInProcessServer();
}
