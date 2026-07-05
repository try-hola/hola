import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runDeploymentLogs } from '../commands/deployments/deployments';
import type { HolaSdk } from '@hola/sdk';
import type { streamSSE } from '../lib/sse';

describe('deployment logs', () => {
  let logs: string[];
  beforeEach(() => {
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => { logs.push(String(m)); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); process.exitCode = 0; });

  it('prints recent entries without --follow (one-shot GET)', async () => {
    const sdk = {
      deployments: { logs: vi.fn(async () => ({ entries: [{ timestamp: 't1', message: 'hello' }] })) },
    };
    await runDeploymentLogs('dep1', {}, { sdk: sdk as unknown as HolaSdk });
    expect(sdk.deployments.logs).toHaveBeenCalledWith('dep1');
    expect(logs.join('\n')).toContain('hello');
  });

  it('does not crash when the SDK returns undefined (non-JSON / empty 204 response)', async () => {
    const sdk = {
      deployments: { logs: vi.fn(async () => undefined as unknown as undefined) },
    };
    await runDeploymentLogs('dep1', {}, { sdk: sdk as unknown as HolaSdk });
    expect(process.exitCode).toBe(0);
    expect(logs.join('\n')).toContain('No logs.');
  });

  it('streams over SSE with --follow and prints message frames', async () => {
    const sdk = { deployments: { logs: vi.fn() } };
    const stream: typeof streamSSE = vi.fn(async (_url, _opts, onEvent) => {
      onEvent?.({ data: JSON.stringify({ data: { timestamp: 't1', message: 'streamed line' } }) } as never);
      onEvent?.({ data: 'heartbeat' } as never); // non-JSON ignored
    });
    await runDeploymentLogs('dep1', { follow: true }, { sdk: sdk as unknown as HolaSdk, stream });

    expect(stream).toHaveBeenCalledOnce();
    const url = (stream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(url).toContain('/api/deployments/dep1/logs/stream');
    expect(sdk.deployments.logs).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('streamed line');
  });
});
