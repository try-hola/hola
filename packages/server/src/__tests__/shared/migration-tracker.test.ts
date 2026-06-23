/**
 * Regression: generateChangelog() must not mutate the shared API_VERSION_HISTORY.
 * It once iterated `API_VERSION_HISTORY.reverse()` (in place), permanently
 * reversing the shared array so getLatestVersion() returned the oldest version
 * and the call was non-idempotent.
 */
import { describe, it, expect } from 'bun:test';
import { generateChangelog, getLatestVersion } from '@hola/shared';

describe('generateChangelog', () => {
  it('does not reverse API_VERSION_HISTORY (getLatestVersion stays stable, idempotent)', () => {
    const latestBefore = getLatestVersion().version;

    const first = generateChangelog();
    expect(getLatestVersion().version).toBe(latestBefore);

    // Idempotent: a second call produces identical output and still doesn't
    // corrupt the ordering.
    const second = generateChangelog();
    expect(second).toBe(first);
    expect(getLatestVersion().version).toBe(latestBefore);
  });
});
