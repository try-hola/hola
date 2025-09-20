/**
 * In-process server harness for tests.
 *
 * Replaces the old child-process based runner with a direct call into the
 * server request handler. Tests can rely on standard `fetch` semantics while
 * avoiding slow boot strapping and port contention.
 */

const TEST_BASE_URL = 'http://localhost:3001';

let testApp: { fetch: (req: Request) => Promise<Response>; close: () => Promise<void> } | null = null;
let handleRequestRef: ((req: Request) => Promise<Response>) | null = null;
const originalFetch = global.fetch;

function toAbsoluteUrl(raw: string): string {
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return new URL(raw, TEST_BASE_URL).toString();
}

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

async function inProcessFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!handleRequestRef) {
    throw new Error('Test server not started. Call setupTestServer() first.');
  }
  const request = toRequest(input, init);
  return handleRequestRef(request);
}

export async function setupTestServer(): Promise<void> {
  if (testApp) return;

  process.env.HOLA_DISABLE_AUTOSTART = 'true';
  const serverModule = await import('../../server');
  handleRequestRef = serverModule.handleRequest;
  testApp = await serverModule.createInProcessApp({ enableBackgroundTasks: false, resetServicesOnClose: false });
  global.fetch = inProcessFetch as typeof fetch;
}

export async function teardownTestServer(): Promise<void> {
  global.fetch = originalFetch;
  if (testApp) {
    await testApp.close();
    testApp = null;
  }
  handleRequestRef = null;
}

export function getTestFetch(): typeof fetch {
  return inProcessFetch as typeof fetch;
}

export { TEST_BASE_URL };
