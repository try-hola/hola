/**
 * Unit tests for `mergeAppEnv` — the per-key ("PATCH") merge that backs the
 * deployment config update (issue #332). Full-replace lived in `hardenAppEnv`;
 * this must instead preserve omitted vars, upsert listed ones (re-imposing the
 * stored spec), and delete only what `removeKeys` names.
 */

import { describe, test, expect } from 'bun:test';
import type { AppEnvVar } from '@hola/shared';

import { mergeAppEnv } from '../../services/core/draft';

const stored: AppEnvVar[] = [
  { key: 'MAX_CONNECTIONS', value: '10', isSecret: false, type: 'integer', min: 1, max: 100 },
  { key: 'ADMIN_USER', value: 'admin', isSecret: false },
  { key: 'API_TOKEN', value: 'seed', isSecret: true },
];

describe('mergeAppEnv', () => {
  test('a partial upsert leaves omitted vars untouched (the #332 fix)', () => {
    const merged = mergeAppEnv(stored, [{ key: 'ADMIN_USER', value: 'root', isSecret: false }]);
    expect(merged.find((e) => e.key === 'ADMIN_USER')?.value).toBe('root');
    // Omitted vars survive, unlike the old full-replace.
    expect(merged.find((e) => e.key === 'MAX_CONNECTIONS')?.value).toBe('10');
    expect(merged.find((e) => e.key === 'API_TOKEN')?.value).toBe('seed');
  });

  test('an upsert re-imposes the stored spec — a client only owns value', () => {
    const merged = mergeAppEnv(stored, [
      // A forged spec (wrong type/max, and trying to flip isSecret) must be ignored.
      { key: 'MAX_CONNECTIONS', value: '50', isSecret: true, type: 'string', max: 999999 } as AppEnvVar,
    ]);
    const row = merged.find((e) => e.key === 'MAX_CONNECTIONS')!;
    expect(row.value).toBe('50'); // value is honored
    expect(row.type).toBe('integer'); // spec preserved from stored
    expect(row.max).toBe(100);
    expect(row.isSecret).toBe(false);
  });

  test('removeKeys drops vars; unknown keys are ignored (idempotent)', () => {
    const merged = mergeAppEnv(stored, [], ['API_TOKEN', 'NOPE']);
    expect(merged.some((e) => e.key === 'API_TOKEN')).toBe(false);
    expect(merged.map((e) => e.key)).toEqual(['MAX_CONNECTIONS', 'ADMIN_USER']);
  });

  test('a brand-new key is appended after the stored rows, in upsert order', () => {
    const merged = mergeAppEnv(stored, [
      { key: 'B_NEW', value: '2', isSecret: false },
      { key: 'A_NEW', value: '1', isSecret: false },
    ]);
    expect(merged.map((e) => e.key)).toEqual(['MAX_CONNECTIONS', 'ADMIN_USER', 'API_TOKEN', 'B_NEW', 'A_NEW']);
  });

  test('a key in both upserts and removeKeys is removed (delete wins)', () => {
    const merged = mergeAppEnv(stored, [{ key: 'ADMIN_USER', value: 'root', isSecret: false }], ['ADMIN_USER']);
    expect(merged.some((e) => e.key === 'ADMIN_USER')).toBe(false);
  });

  test('empty request returns the stored env unchanged', () => {
    expect(mergeAppEnv(stored, [])).toEqual(stored);
  });
});
