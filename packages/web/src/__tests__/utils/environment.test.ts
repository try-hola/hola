import { describe, it, expect } from 'vitest';

describe('Environment Test', () => {
  it('should have document available', () => {
    expect(document).toBeDefined();
    expect(document.body).toBeDefined();
  });

  it('should have window available', () => {
    expect(window).toBeDefined();
  });
});
