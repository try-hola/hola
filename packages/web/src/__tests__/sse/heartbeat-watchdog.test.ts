/**
 * Regression test for the SSE heartbeat watchdog.
 *
 * The server emits keep-alives as a NAMED `heartbeat` SSE event. The client's
 * onmessage only fires for default `message` events, so heartbeats were
 * invisible to the watchdog and any idle stream (no log lines flowing) was torn
 * down — making streaming logs and live status updates appear never to work.
 * The client now listens for `heartbeat` and tolerates a generous window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSSEClient } from '../../utils/sse-client';
import { ControllableEventSource, eventSourceController } from '../utils/mocks/controllable-eventsource';

const STREAM_URL = 'http://localhost/api/deployments/x/logs/stream';

describe('SSE heartbeat watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    eventSourceController.reset();
  });
  afterEach(() => {
    vi.useRealTimers();
    eventSourceController.reset();
  });

  function makeClient(heartbeatTimeout: number) {
    return createSSEClient({
      reconnect: false,
      heartbeatTimeout,
      eventSourceFactory: (url) => new ControllableEventSource(url) as unknown as EventSource,
    });
  }

  it('named heartbeat events keep an idle stream connected past the watchdog window', () => {
    const client = makeClient(1000);
    client.updateUrl(STREAM_URL);
    client.connect();

    const es = eventSourceController.getLastInstance()!;
    es.simulateOpen();
    expect(client.getState().connectionState).toBe('connected');

    // No log lines, but heartbeats arrive every 800ms — under the 1000ms window.
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(800);
      es.simulateNamedEvent('heartbeat', '{}');
    }
    expect(client.getState().connectionState).toBe('connected');
  });

  it('still errors when the stream goes truly silent (no heartbeats)', () => {
    const client = makeClient(1000);
    client.updateUrl(STREAM_URL);
    client.connect();

    const es = eventSourceController.getLastInstance()!;
    es.simulateOpen();
    expect(client.getState().connectionState).toBe('connected');

    vi.advanceTimersByTime(1100);
    expect(client.getState().connectionState).toBe('error');
  });
});
