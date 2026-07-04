/**
 * Typed app-parameter validation tests (ADR 0003, declarative-drifting-tiger PR 1).
 *
 * Exercises the pure validator in @hola/shared/param-validate: per-type value
 * checks, the `required` tri-state matrix (incl. the optional-secret bug
 * regression), unresolved-platform-token skipping, spec linting, and the
 * secret generator's output shape.
 */

import { describe, test, expect } from 'bun:test';
import {
  validateParamValue,
  validateParams,
  validateParamSpec,
  generateSecretValue,
} from '@hola/shared/param-validate';
import type { AppEnvVar } from '@hola/shared';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

function baseVar(overrides: Partial<AppEnvVar> = {}): AppEnvVar {
  return { key: 'MY_VAR', value: '', isSecret: false, ...overrides };
}

describe('validateParamValue — required tri-state', () => {
  test('required: true + empty value → PARAM_REQUIRED_MISSING', () => {
    const spec = baseVar({ required: true, isSecret: false });
    expect(codes(validateParamValue(spec, ''))).toEqual(['PARAM_REQUIRED_MISSING']);
  });

  test('required: false + empty value + isSecret → OK (the optional-secret bug fix)', () => {
    const spec = baseVar({ required: false, isSecret: true });
    expect(validateParamValue(spec, '')).toEqual([]);
  });

  test('required: undefined + isSecret + empty → error (legacy rule preserved)', () => {
    const spec = baseVar({ isSecret: true });
    expect(codes(validateParamValue(spec, ''))).toEqual(['PARAM_REQUIRED_MISSING']);
  });

  test('required: undefined + non-secret + empty → OK (legacy rule preserved)', () => {
    const spec = baseVar({ isSecret: false });
    expect(validateParamValue(spec, '')).toEqual([]);
  });

  test('required: false + empty + non-secret → OK', () => {
    const spec = baseVar({ required: false, isSecret: false });
    expect(validateParamValue(spec, '')).toEqual([]);
  });

  test('required: true overrides isSecret: false being empty-optional', () => {
    const spec = baseVar({ required: true, isSecret: false });
    expect(codes(validateParamValue(spec, ''))).toEqual(['PARAM_REQUIRED_MISSING']);
  });
});

describe('validateParamValue — unresolved platform tokens', () => {
  test('a value that is exactly a known platform token skips type checks', () => {
    const spec = baseVar({ type: 'url', required: true });
    expect(validateParamValue(spec, '${HOLA_APP_HOST}')).toEqual([]);
  });

  test('a value that merely contains a token substring is still type-checked', () => {
    const spec = baseVar({ type: 'url', required: true });
    expect(codes(validateParamValue(spec, 'prefix-${HOLA_APP_HOST}'))).toEqual(['PARAM_INVALID_URL']);
  });
});

describe('validateParamValue — integer', () => {
  const cases: Array<[string, string, string[]]> = [
    ['plain integer', '42', []],
    ['negative integer', '-7', []],
    ['non-numeric', 'abc', ['PARAM_INVALID_INTEGER']],
    ['float', '3.14', ['PARAM_INVALID_INTEGER']],
    ['leading zero still parses', '007', []],
  ];
  for (const [name, value, expected] of cases) {
    test(name, () => {
      const spec = baseVar({ type: 'integer' });
      expect(codes(validateParamValue(spec, value))).toEqual(expected);
    });
  }

  test('out of declared range → PARAM_INTEGER_OUT_OF_RANGE', () => {
    const spec = baseVar({ type: 'integer', min: 1, max: 10 });
    expect(codes(validateParamValue(spec, '11'))).toEqual(['PARAM_INTEGER_OUT_OF_RANGE']);
    expect(validateParamValue(spec, '5')).toEqual([]);
  });
});

describe('validateParamValue — port', () => {
  test('valid port', () => {
    const spec = baseVar({ type: 'port' });
    expect(validateParamValue(spec, '8080')).toEqual([]);
  });

  test('0 is out of the implied 1-65535 range', () => {
    const spec = baseVar({ type: 'port' });
    expect(codes(validateParamValue(spec, '0'))).toEqual(['PARAM_INVALID_PORT']);
  });

  test('65536 is out of range', () => {
    const spec = baseVar({ type: 'port' });
    expect(codes(validateParamValue(spec, '65536'))).toEqual(['PARAM_INVALID_PORT']);
  });

  test('non-numeric → PARAM_INVALID_PORT (not PARAM_INVALID_INTEGER)', () => {
    const spec = baseVar({ type: 'port' });
    expect(codes(validateParamValue(spec, 'nope'))).toEqual(['PARAM_INVALID_PORT']);
  });

  test('spec min/max may only narrow, not widen, the 1-65535 range', () => {
    // spec tries to widen to 0-100000; effective range should clamp to 1-65535.
    const spec = baseVar({ type: 'port', min: 0, max: 100_000 });
    expect(validateParamValue(spec, '65535')).toEqual([]);
    expect(codes(validateParamValue(spec, '65536'))).toEqual(['PARAM_INVALID_PORT']);
    expect(codes(validateParamValue(spec, '0'))).toEqual(['PARAM_INVALID_PORT']);
  });

  test('spec min/max narrowing is honored', () => {
    const spec = baseVar({ type: 'port', min: 8000, max: 9000 });
    expect(codes(validateParamValue(spec, '7999'))).toEqual(['PARAM_INVALID_PORT']);
    expect(validateParamValue(spec, '8000')).toEqual([]);
  });
});

describe('validateParamValue — boolean', () => {
  test('default vocabulary true/false', () => {
    const spec = baseVar({ type: 'boolean' });
    expect(validateParamValue(spec, 'true')).toEqual([]);
    expect(validateParamValue(spec, 'false')).toEqual([]);
    expect(codes(validateParamValue(spec, 'yes'))).toEqual(['PARAM_INVALID_BOOLEAN']);
  });

  test('custom trueValue/falseValue vocabulary', () => {
    const spec = baseVar({ type: 'boolean', trueValue: 'on', falseValue: 'off' });
    expect(validateParamValue(spec, 'on')).toEqual([]);
    expect(validateParamValue(spec, 'off')).toEqual([]);
    expect(codes(validateParamValue(spec, 'true'))).toEqual(['PARAM_INVALID_BOOLEAN']);
  });
});

describe('validateParamValue — enum', () => {
  const options = [{ value: 'a' }, { value: 'b' }];

  test('value in options → OK', () => {
    const spec = baseVar({ type: 'enum', options });
    expect(validateParamValue(spec, 'a')).toEqual([]);
  });

  test('value not in options → PARAM_INVALID_ENUM_VALUE', () => {
    const spec = baseVar({ type: 'enum', options });
    expect(codes(validateParamValue(spec, 'c'))).toEqual(['PARAM_INVALID_ENUM_VALUE']);
  });

  test('missing options skips the value check (spec problem, not value problem)', () => {
    const spec = baseVar({ type: 'enum' });
    expect(validateParamValue(spec, 'anything')).toEqual([]);
  });
});

describe('validateParamValue — url', () => {
  test('valid url', () => {
    const spec = baseVar({ type: 'url' });
    expect(validateParamValue(spec, 'https://example.com')).toEqual([]);
  });

  test('invalid url → PARAM_INVALID_URL', () => {
    const spec = baseVar({ type: 'url' });
    expect(codes(validateParamValue(spec, 'not a url'))).toEqual(['PARAM_INVALID_URL']);
  });

  test('httpsOnly rejects http', () => {
    const spec = baseVar({ type: 'url', httpsOnly: true });
    expect(codes(validateParamValue(spec, 'http://example.com'))).toEqual(['PARAM_URL_NOT_HTTPS']);
    expect(validateParamValue(spec, 'https://example.com')).toEqual([]);
  });
});

describe('validateParamValue — email', () => {
  test('valid email', () => {
    const spec = baseVar({ type: 'email' });
    expect(validateParamValue(spec, 'a@b.com')).toEqual([]);
  });

  test('invalid email → PARAM_INVALID_EMAIL', () => {
    const spec = baseVar({ type: 'email' });
    expect(codes(validateParamValue(spec, 'not-an-email'))).toEqual(['PARAM_INVALID_EMAIL']);
  });
});

describe('validateParamValue — timezone', () => {
  test('valid IANA zone', () => {
    const spec = baseVar({ type: 'timezone' });
    expect(validateParamValue(spec, 'America/New_York')).toEqual([]);
    expect(validateParamValue(spec, 'UTC')).toEqual([]);
  });

  test('invalid zone → PARAM_INVALID_TIMEZONE', () => {
    const spec = baseVar({ type: 'timezone' });
    expect(codes(validateParamValue(spec, 'Not/AZone'))).toEqual(['PARAM_INVALID_TIMEZONE']);
  });
});

describe('validateParamValue — string with pattern/length', () => {
  test('pattern match', () => {
    const spec = baseVar({ type: 'string', pattern: '^[a-z]+$' });
    expect(validateParamValue(spec, 'abc')).toEqual([]);
    expect(codes(validateParamValue(spec, 'ABC'))).toEqual(['PARAM_PATTERN_MISMATCH']);
  });

  test('a broken pattern is silently skipped, not thrown', () => {
    const spec = baseVar({ type: 'string', pattern: '(unclosed' });
    expect(() => validateParamValue(spec, 'anything')).not.toThrow();
    expect(validateParamValue(spec, 'anything')).toEqual([]);
  });

  test('pattern check is skipped above the ReDoS guard length', () => {
    const spec = baseVar({ type: 'string', pattern: '^[a-z]+$' });
    const huge = 'A'.repeat(10_001);
    expect(validateParamValue(spec, huge)).toEqual([]);
  });

  test('minLength / maxLength', () => {
    const spec = baseVar({ type: 'string', minLength: 3, maxLength: 5 });
    expect(codes(validateParamValue(spec, 'ab'))).toEqual(['PARAM_TOO_SHORT']);
    expect(codes(validateParamValue(spec, 'abcdef'))).toEqual(['PARAM_TOO_LONG']);
    expect(validateParamValue(spec, 'abcd')).toEqual([]);
  });
});

describe('validateParams', () => {
  test('validates every row by default, including legacy rows', () => {
    const env: AppEnvVar[] = [
      { key: 'A', value: '', isSecret: true }, // legacy secret, empty → required-missing
      { key: 'B', value: 'x', isSecret: false }, // legacy custom var, fine
    ];
    const issues = validateParams(env);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('PARAM_REQUIRED_MISSING');
    expect(issues[0].path).toBe('env.A');
  });

  test('skipCustom skips rows with no typed-spec fields at all', () => {
    const env: AppEnvVar[] = [
      { key: 'A', value: '', isSecret: true }, // no spec fields → skipped
      { key: 'B', value: '', isSecret: true, required: true }, // has a spec → validated
    ];
    const issues = validateParams(env, { skipCustom: true });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe('env.B');
  });
});

describe('validateParamSpec', () => {
  test('unknown type → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'not-a-real-type' as never });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('broken pattern → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ pattern: '(unclosed' });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('min > max → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'integer', min: 10, max: 1 });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('minLength > maxLength → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'string', minLength: 10, maxLength: 1 });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('enum with no options → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'enum' });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('enum default value not among options → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'enum', options: [{ value: 'a' }], value: 'z' });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('enum with empty default value is fine even with options set', () => {
    const spec = baseVar({ type: 'enum', options: [{ value: 'a' }], value: '' });
    expect(validateParamSpec(spec)).toEqual([]);
  });

  test('generate set without isSecret → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ isSecret: false, generate: { kind: 'hex' } });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('generate set with isSecret is fine', () => {
    const spec = baseVar({ isSecret: true, generate: { kind: 'hex' } });
    expect(validateParamSpec(spec)).toEqual([]);
  });

  test('boolean trueValue === falseValue → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'boolean', trueValue: 'x', falseValue: 'x' });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('boolean default value not in vocabulary → PARAM_INVALID_SPEC', () => {
    const spec = baseVar({ type: 'boolean', value: 'maybe' });
    expect(codes(validateParamSpec(spec))).toContain('PARAM_INVALID_SPEC');
  });

  test('a well-formed spec produces no issues', () => {
    const spec = baseVar({
      type: 'integer', min: 0, max: 100, value: '50', required: true,
    });
    expect(validateParamSpec(spec)).toEqual([]);
  });
});

describe('generateSecretValue', () => {
  test('hex: length is 2x bytes and matches [0-9a-f]+', () => {
    const value = generateSecretValue({ kind: 'hex', length: 16 });
    expect(value).toMatch(/^[0-9a-f]+$/);
    expect(value).toHaveLength(32);
  });

  test('hex: default length is 32 bytes → 64 chars', () => {
    const value = generateSecretValue({ kind: 'hex' });
    expect(value).toHaveLength(64);
  });

  test('base64: base64url charset, no padding', () => {
    const value = generateSecretValue({ kind: 'base64', length: 16 });
    expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(value).not.toContain('=');
    expect(value).not.toContain('+');
    expect(value).not.toContain('/');
  });

  test('fernet: always exactly 32 bytes regardless of length input', () => {
    const short = generateSecretValue({ kind: 'fernet', length: 4 });
    const long = generateSecretValue({ kind: 'fernet', length: 128 });
    // 32 raw bytes → 43 base64url chars with no padding (ceil(32*4/3) - padding).
    expect(short).toHaveLength(43);
    expect(long).toHaveLength(43);
    expect(short).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('successive calls are not identical (random)', () => {
    const a = generateSecretValue({ kind: 'hex' });
    const b = generateSecretValue({ kind: 'hex' });
    expect(a).not.toBe(b);
  });
});
