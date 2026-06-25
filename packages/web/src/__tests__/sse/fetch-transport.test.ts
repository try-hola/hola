import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSSEClient } from '../../utils/sse-client';
import { setAuthTokenGetter, setUnauthorizedHandler } from '../../utils/auth-token';
import type { SSEEvent } from '@hola/shared';

// The default (no eventSourceFactory) transport is fetch-based, because native
// EventSource can't send an Authorization header — which is what broke log
// streams under OIDC/Bearer auth. These tests exercise that path directly.

function streamResponse(frames: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      // Leave the stream open: closing would surface as a "Stream closed" error,
      // which is the disconnect path, not what these tests assert.
    },
  });
  return new Response(body, { status: 200, ...init });
}

afterEach(() => {
  setAuthTokenGetter(undefined);
  setUnauthorizedHandler(undefined);
  vi.unstubAllGlobals();
});

describe('SSE fetch transport', () => {
  it('attaches the Bearer token and dispatches a named message event', async () => {
    setAuthTokenGetter(() => 'tok-123');
    const fetchMock = vi.fn(async () =>
      streamResponse([
        'event: message\ndata: {"type":"log","data":{"timestamp":"t","service":"web","level":"info","message":"hello"}}\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createSSEClient({ reconnect: false });
    const events: SSEEvent[] = [];
    client.subscribe(e => events.push(e));

    client.updateUrl('http://localhost/api/deployments/x/logs/stream');
    client.connect();

    await vi.waitFor(() => expect(events).toHaveLength(1));

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(init.credentials).toBe('include');
    expect(events[0]).toMatchObject({ type: 'log', data: { message: 'hello' } });
    expect(client.getState().connectionState).toBe('connected');

    client.disconnect();
  });

  it('reports an error and notifies unauthorized on a 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    const client = createSSEClient({ reconnect: false });
    const states: string[] = [];
    client.subscribeState(s => states.push(s.connectionState));

    client.updateUrl('http://localhost/api/deployments/x/logs/stream');
    client.connect();

    await vi.waitFor(() => expect(states).toContain('error'));
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    client.disconnect();
  });
});
