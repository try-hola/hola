/**
 * Compose log parser tests
 *
 * `parseComposeLogs` turns `docker compose logs --timestamps` output (each line
 * prefixed `<service>-<replica>  | <rfc3339> message`) into structured,
 * service-labelled, timestamp-sorted entries. See #167.
 */

import { describe, it, expect } from 'vitest';
import { parseComposeLogs } from '../../services/core/docker';

describe('parseComposeLogs', () => {
  it('parses service-prefixed, --timestamps lines', () => {
    const out = [
      'gitea-1  | 2024-01-01T00:00:01.000000000Z Starting Gitea',
      'gitea-1  | 2024-01-01T00:00:02.500000000Z [E] database error: boom',
    ].join('\n');

    const entries = parseComposeLogs(out);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      timestamp: '2024-01-01T00:00:01.000000000Z',
      service: 'gitea',
      level: 'info',
      message: 'Starting Gitea',
    });
    // "error" in the body → error level.
    expect(entries[1].level).toBe('error');
    expect(entries[1].message).toBe('[E] database error: boom');
  });

  it('drops the -<replica> suffix and keeps hyphenated service names', () => {
    const out = [
      'temporal-postgres-1  | 2024-01-01T00:00:00.000000000Z db ready',
      'postiz-1  | 2024-01-01T00:00:00.100000000Z app up',
    ].join('\n');

    const entries = parseComposeLogs(out);
    expect(entries.map(e => e.service)).toEqual(['temporal-postgres', 'postiz']);
  });

  it('merges multiple services and sorts by timestamp', () => {
    // Interleaved/out-of-order across services should come back chronological.
    const out = [
      'postgres-1  | 2024-01-01T00:00:03.000000000Z later',
      'redis-1  | 2024-01-01T00:00:01.000000000Z earliest',
      'postiz-1  | 2024-01-01T00:00:02.000000000Z middle',
    ].join('\n');

    const entries = parseComposeLogs(out);
    expect(entries.map(e => e.message)).toEqual(['earliest', 'middle', 'later']);
    expect(entries.map(e => e.service)).toEqual(['redis', 'postiz', 'postgres']);
  });

  it('labels prefix-less lines (e.g. "Attaching to …") as system', () => {
    const out = 'Attaching to gitea-1, postgres-1';
    const entries = parseComposeLogs(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].service).toBe('system');
    expect(entries[0].message).toBe('Attaching to gitea-1, postgres-1');
  });

  it('keeps a prefixed line that has no docker timestamp', () => {
    const out = 'gitea-1  | plain line without timestamp';
    const entries = parseComposeLogs(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].service).toBe('gitea');
    expect(entries[0].message).toBe('plain line without timestamp');
  });

  it('ignores blank lines and trailing carriage returns', () => {
    const out = 'gitea-1  | 2024-01-01T00:00:01.000000000Z hello\r\n\n';
    const entries = parseComposeLogs(out);
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe('hello');
  });

  it('returns an empty array for empty output', () => {
    expect(parseComposeLogs('')).toEqual([]);
  });
});
