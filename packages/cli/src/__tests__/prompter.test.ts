import { PassThrough } from 'node:stream';

import { describe, it, expect } from 'vitest';
import * as clack from '@clack/prompts';
import { PasswordPrompt } from '@clack/core';

import { resultToAnswer, toClackValidate, passwordWithDefault, type PromptSpec } from '../install/prompter';

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

describe('passwordWithDefault — prefilled masked secret', () => {
  // Fake TTY streams so the real @clack prompt runs headless.
  function fakeStdin() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s: any = new PassThrough();
    s.isTTY = true;
    s.setRawMode = () => {};
    return s;
  }
  function fakeStdout(captured: string[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = new PassThrough();
    o.isTTY = true;
    o.columns = 80;
    o.on('data', (d: Buffer) => captured.push(String(d)));
    return o;
  }

  async function run(def: string, keys: string[]) {
    const input = fakeStdin();
    const captured: string[] = [];
    const output = fakeStdout(captured);
    const spec: PromptSpec = { key: 'AWS_SECRET_ACCESS_KEY', type: 'secret', message: 'AWS secret access key', default: def };
    const validate = (v: string | undefined) => (v?.trim() ? undefined : 'required');
    const p = passwordWithDefault(clack, PasswordPrompt, spec, validate, { input, output });
    setTimeout(() => keys.forEach((k) => input.write(k)), 30);
    const result = await p;
    return { result, rendered: captured.join('') };
  }

  it('submits the real default value (not "undefined" or "") when Enter is pressed', async () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const { result, rendered } = await run(secret, ['\r']);
    expect(result).toBe(secret);
    expect(rendered).not.toContain(secret); // shown as dots, never echoed in plaintext
  });

  it('lets the user edit the prefilled value before submitting', async () => {
    // Prefill "abc", backspace all three, type "ZY", Enter.
    const { result } = await run('abc', ['\x7f', '\x7f', '\x7f', 'Z', 'Y', '\r']);
    expect(result).toBe('ZY');
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
