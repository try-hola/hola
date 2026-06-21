import { describe, it, expect } from 'vitest';

import { resultToAnswer, toClackValidate } from '../install/prompter';

describe('resultToAnswer', () => {
  it('maps a nullish secret submit to "" so the env-reuse fallback fires', () => {
    // clack.password() resolves to `undefined` on an empty submit. A naive
    // String(undefined) === "undefined" would be truthy and shadow the env value,
    // sending the literal "undefined" to AWS (→ SignatureDoesNotMatch).
    expect(resultToAnswer('secret', undefined)).toBe('');
    expect(resultToAnswer('secret', null)).toBe('');
  });

  it('passes a real secret through unchanged', () => {
    expect(resultToAnswer('secret', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).toBe(
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    );
  });

  it('stringifies text answers', () => {
    expect(resultToAnswer('text', 'apps.example.com')).toBe('apps.example.com');
    expect(resultToAnswer('text', '')).toBe('');
  });

  it('renders confirm booleans as "true"/"false"', () => {
    expect(resultToAnswer('confirm', true)).toBe('true');
    expect(resultToAnswer('confirm', false)).toBe('false');
  });
});

describe('toClackValidate', () => {
  it('coerces a nullish blank submit to "" before validating', () => {
    const validate = toClackValidate((v) => (v.trim() ? undefined : 'required'));
    expect(validate?.(undefined)).toBe('required');
    expect(validate?.('ok')).toBeUndefined();
  });

  it('returns undefined when there is no validator', () => {
    expect(toClackValidate(undefined)).toBeUndefined();
  });
});
