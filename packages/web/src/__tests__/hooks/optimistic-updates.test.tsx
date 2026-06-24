import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimisticUpdates } from '../../hooks/useOptimisticUpdates';
import { globalCache } from '../../utils/cache';

describe('useOptimisticUpdates rollback timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalCache.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    globalCache.clear();
  });

  it('re-applies the update on a slow-but-successful action even after the rollback timer fired', async () => {
    globalCache.set('k', { n: 1 });
    const { result } = renderHook(() => useOptimisticUpdates<{ n: number }>());

    let resolveAction!: (v: string) => void;
    const serverAction = () => new Promise<string>((r) => { resolveAction = r; });

    let actionPromise!: Promise<string>;
    act(() => {
      actionPromise = result.current.applyOptimisticUpdate(
        'k',
        () => ({ n: 2 }),
        serverAction,
        { rollbackTimeout: 100 },
      );
    });

    // Optimistic value applied immediately.
    expect(globalCache.get('k')).toEqual({ n: 2 });

    // The rollback timer fires while the (slow) action is still in flight.
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(globalCache.get('k')).toEqual({ n: 1 }); // rolled back

    // The action then resolves successfully — the cache must reflect the update,
    // not the stale rolled-back value (the divergence this fix prevents).
    await act(async () => { resolveAction('ok'); await actionPromise; });
    expect(globalCache.get('k')).toEqual({ n: 2 });
  });
});
