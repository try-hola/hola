/**
 * SSE stream teardown tests.
 *
 * The WHATWG Streams runtime tears down via cancel() (client disconnect), not via
 * start()'s return value — so cancel() must run the heartbeat-timer + onSubscribe
 * cleanup, otherwise every dropped connection leaks them.
 */
import { describe, it, expect } from 'bun:test';
import { createSSEStream, type SSEStreamController } from '../../utils/sse';

describe('createSSEStream teardown', () => {
  it('runs the onSubscribe cleanup when the reader cancels (client disconnect)', async () => {
    let cleaned = false;
    const stream = createSSEStream({
      heartbeatIntervalMs: 10,
      onSubscribe: (controller) => {
        controller.sendRaw({ event: 'hello', data: { ok: true } });
        return () => { cleaned = true; };
      },
    });

    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);

    await reader.cancel();
    expect(cleaned).toBe(true); // previously stayed false — cancel() was a no-op
  });

  it('runs the onSubscribe cleanup on an explicit controller.close()', async () => {
    let cleaned = false;
    let ctrl: SSEStreamController | undefined;
    const stream = createSSEStream({
      heartbeatIntervalMs: 0,
      onSubscribe: (controller) => {
        ctrl = controller;
        return () => { cleaned = true; };
      },
    });

    const reader = stream.getReader();
    ctrl?.close();
    expect(cleaned).toBe(true);
    await reader.cancel().catch(() => {});
  });
});
