import { describe, it, expect } from 'vitest';

describe('cli smoke', () => {
  it('runs basic math', () => {
    expect(1 + 1).toBe(2);
  });
});
