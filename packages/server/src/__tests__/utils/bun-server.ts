import { setupTestServer as setupInProcessServer, teardownTestServer as teardownInProcessServer } from './server';

export async function setupTestServer(_port: number = 3001, env: Record<string, string> = {}): Promise<void> {
  Object.assign(process.env, env);
  await setupInProcessServer();
}

export async function teardownTestServer(): Promise<void> {
  await teardownInProcessServer();
}

export async function stopServer(): Promise<void> {
  await teardownInProcessServer();
}
