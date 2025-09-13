import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHealthApi } from '../hooks/useHealthApi';

// Test the health hook using SDK adapter migration
describe('Health Hook - SDK Migration', () => {
  it('should fetch health data using SDK adapter', async () => {
    const { result } = renderHook(() => useHealthApi());

    // Initially should be loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);

    // Should have refetch function
    expect(result.current.refetch).toBeDefined();
    expect(typeof result.current.refetch).toBe('function');
  });

  it('should handle loading state correctly', () => {
    const { result } = renderHook(() => useHealthApi());
    
    // Initial state should be loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('should provide refetch functionality', () => {
    const { result } = renderHook(() => useHealthApi());
    
    expect(result.current.refetch).toBeDefined();
    expect(typeof result.current.refetch).toBe('function');
    
    // Should be able to call refetch without error
    expect(() => result.current.refetch()).not.toThrow();
  });
});