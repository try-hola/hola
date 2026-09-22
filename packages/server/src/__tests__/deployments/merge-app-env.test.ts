/**
 * Unit tests for `mergeAppEnv` — the per-key ("PATCH") merge that backs the
 * deployment config update (issue #332). Full-replace lived in `hardenAppEnv`;
 * this must instead preserve omitted vars, upsert listed ones (re-imposing the
 * stored spec), and delete only what `removeKeys` names.
 */

import { describe, test, expect } from 'bun:test';
import type { AppEnvVar } from '@hola/shared';

import { mergeAppEnv, hardenAppEnv } from '../../services/core/draft';
import { redactSecretEnvValues, restoreWithheldEnvValues } from '@hola/shared';

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

/**
 * A withheld secret survives a round trip (F03).
 *
 * This is the half of the redaction that makes it safe to apply to an EDITABLE
 * surface. The config read and the config write are the same rows: once the read
 * withholds a secret's value, a client that saves the form it was given is
 * sending `value: ''` back for that key. Without the rule below, redacting the
 * read would silently blank every app secret on the operator's next save — a
 * data-loss bug introduced by a confidentiality fix.
 *
 * `valueRedacted` is therefore read as "no new value supplied for this key", and
 * stripped either way so it never reaches a persisted manifest.
 */
describe('redacted rows on the write path (F03)', () => {
  /** Exactly what a client receives from a read it was not trusted with. */
  const asRead = redactSecretEnvValues(stored);

  test('mergeAppEnv: echoing the redacted row back keeps the stored secret', () => {
    const merged = mergeAppEnv(stored, asRead);
    expect(merged.find((e) => e.key === 'API_TOKEN')?.value).toBe('seed');
    // …and the marker is not persisted, or the row would read as withheld
    // forever, including for the operator who can see it.
    expect(merged.find((e) => e.key === 'API_TOKEN')?.valueRedacted).toBeUndefined();
    // Non-secret rows in the same request are applied normally.
    expect(merged.find((e) => e.key === 'ADMIN_USER')?.value).toBe('admin');
  });

  test('mergeAppEnv: a replacement value supplied for a secret still applies', () => {
    // The flag means "I am not supplying a value". A client that IS supplying
    // one drops it — otherwise a read-only-shaped response could make a secret
    // permanently unchangeable.
    const merged = mergeAppEnv(stored, [{ key: 'API_TOKEN', value: 'rotated', isSecret: true }]);
    expect(merged.find((e) => e.key === 'API_TOKEN')?.value).toBe('rotated');
  });

  test('mergeAppEnv: an explicit removal still wins over a redacted upsert', () => {
    // Withholding a value on read must not make the secret undeletable.
    const merged = mergeAppEnv(stored, asRead, ['API_TOKEN']);
    expect(merged.some((e) => e.key === 'API_TOKEN')).toBe(false);
  });

  test('mergeAppEnv: a forged marker on a brand-new key is stripped, not honoured', () => {
    const merged = mergeAppEnv(stored, [
      { key: 'NEW_SECRET', value: 'fresh', isSecret: true, valueRedacted: true },
    ]);
    const row = merged.find((e) => e.key === 'NEW_SECRET')!;
    expect(row.value).toBe('fresh');
    expect(row.valueRedacted).toBeUndefined();
  });

  test('hardenAppEnv: full replace keeps a withheld secret rather than blanking it', () => {
    // The draft wizard PATCHes its whole env set, so this is the path where a
    // redacted read would do the most damage: every secret at once.
    const hardened = hardenAppEnv(stored, asRead);
    expect(hardened.find((e) => e.key === 'API_TOKEN')?.value).toBe('seed');
    expect(hardened.find((e) => e.key === 'API_TOKEN')?.valueRedacted).toBeUndefined();
    expect(hardened.map((e) => e.key)).toEqual(['MAX_CONNECTIONS', 'ADMIN_USER', 'API_TOKEN']);
  });

  test('hardenAppEnv: clearing a secret stays possible, and is explicit', () => {
    // `value: ''` with NO marker is a deliberate clear, and must not be
    // confused with a value that was never shown.
    const hardened = hardenAppEnv(stored, [
      { key: 'API_TOKEN', value: '', isSecret: true },
    ]);
    expect(hardened.find((e) => e.key === 'API_TOKEN')?.value).toBe('');
  });
});

describe('redactSecretEnvValues', () => {
  test('withholds every secret value and leaves the rest of the row intact', () => {
    const redacted = redactSecretEnvValues(stored);
    const secret = redacted.find((e) => e.key === 'API_TOKEN')!;
    expect(secret).toEqual({ key: 'API_TOKEN', value: '', isSecret: true, valueRedacted: true });
    // The typed spec of a non-secret row is untouched — same object contents.
    expect(redacted.find((e) => e.key === 'MAX_CONNECTIONS')).toEqual(stored[0]!);
  });

  test('does not mutate the rows it was given', () => {
    // The same arrays feed the upgrade carry-forward and the restore-on-install
    // env merge, which run as the platform and need the real values.
    const input = stored.map((e) => ({ ...e }));
    redactSecretEnvValues(input);
    expect(input.find((e) => e.key === 'API_TOKEN')?.value).toBe('seed');
  });
});

/**
 * `restoreWithheldEnvValues` — the write-side rule for a row set whose PATCH
 * replaces everything, which is how host `systemEnv` works.
 */
describe('restoreWithheldEnvValues (F03)', () => {
  const host = [
    { key: 'DOMAIN', value: 'hola.example.com', isSecret: false },
    { key: 'SMTP_PASSWORD', value: 'stored-smtp', isSecret: true },
  ];

  test('a replayed form keeps every withheld value instead of blanking it', () => {
    const saved = restoreWithheldEnvValues(host, redactSecretEnvValues(host));
    expect(saved).toEqual(host);
  });

  test('a typed replacement wins — the marker is what defers, not the emptiness', () => {
    const edited = redactSecretEnvValues(host).map((e) =>
      e.key === 'SMTP_PASSWORD' ? { key: e.key, value: 'rotated', isSecret: true } : e,
    );
    expect(restoreWithheldEnvValues(host, edited).find((e) => e.key === 'SMTP_PASSWORD')?.value).toBe('rotated');
  });

  test('a marked row whose key is not stored resolves to empty, not undefined', () => {
    // Nothing to restore from. Writing `undefined` into a `value: string` would
    // put a malformed row into the persisted settings file.
    const [row] = restoreWithheldEnvValues(host, [{ key: 'GONE', value: '', isSecret: true, valueRedacted: true }]);
    expect(row).toEqual({ key: 'GONE', value: '', isSecret: true });
  });

  test('a deleted row stays deleted — restoring values is not restoring rows', () => {
    const saved = restoreWithheldEnvValues(host, redactSecretEnvValues(host).filter((e) => e.key === 'DOMAIN'));
    expect(saved.map((e) => e.key)).toEqual(['DOMAIN']);
  });
});
