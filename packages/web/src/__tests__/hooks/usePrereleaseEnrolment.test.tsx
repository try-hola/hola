import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePrereleaseEnrolment } from '../../hooks/usePrereleaseEnrolment';
import { globalCache } from '../../utils/cache';
import { mockFetch, createMockResponse } from '../../setupTests';

describe('usePrereleaseEnrolment', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    globalCache.clear();
  });

  it('returns false while the settings read is loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    const { result } = renderHook(() => usePrereleaseEnrolment());
    expect(result.current).toBe(false);
  });

  it('returns true once settings load with channels.showPrerelease === true', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ channels: { showPrerelease: true } }));
    const { result } = renderHook(() => usePrereleaseEnrolment());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false once settings load with channels.showPrerelease === false', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({ channels: { showPrerelease: false } }));
    const { result } = renderHook(() => usePrereleaseEnrolment());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('returns false when the settings response has no channels field', async () => {
    mockFetch.mockResolvedValueOnce(createMockResponse({}));
    const { result } = renderHook(() => usePrereleaseEnrolment());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('fails closed (false) when the settings fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => usePrereleaseEnrolment());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
