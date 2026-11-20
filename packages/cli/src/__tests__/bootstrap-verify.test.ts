import { execFileSync } from 'child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildVerifyCommand, interpretVerify, verifyMessage } from '../commands/bootstrap/verify';

describe('bootstrap verify: the command', () => {
  it('targets the public health route, never the authenticated /api/health', () => {
    const cmd = buildVerifyCommand('apps.example.com');
    expect(cmd).toContain('https://apps.example.com/api/system/health');
    expect(cmd).not.toMatch(/\/api\/health\b/);
  });

  it('tries a verified request first and only falls back to -k', () => {
    const cmd = buildVerifyCommand('apps.example.com');
    const verified = cmd.indexOf('curl -s -o');
    const insecure = cmd.indexOf('curl -sk -o');
    expect(verified).toBeGreaterThanOrEqual(0);
    expect(insecure).toBeGreaterThan(verified);
  });
});

// The command runs on the remote host's shell, so its branching is exercised here
// against a fake `curl` on PATH. The fake decides its answer from whether it was
// called with -k, which is exactly the distinction the command relies on.
describe('bootstrap verify: the command under a real shell', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  function run(secureCode: string, insecureCode: string): string {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hola-verify-'));
    const fake = path.join(dir, 'curl');
    writeFileSync(
      fake,
      `#!/bin/sh\ncase " $* " in *" -sk "*) printf '%s' '${insecureCode}' ;; *) printf '%s' '${secureCode}' ;; esac\n`,
    );
    chmodSync(fake, 0o755);
    return execFileSync('sh', ['-c', buildVerifyCommand('apps.example.com')], {
      env: { PATH: `${dir}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
  }

  it('reports verified when the trusted request answers', () => {
    expect(run('200', 'unused').trim()).toBe('verified 200');
  });

  it('keeps a verified non-200 instead of retrying insecurely', () => {
    expect(run('502', '200').trim()).toBe('verified 502');
  });

  it('falls back to -k when the trusted request gets no HTTP response (000)', () => {
    expect(run('000', '200').trim()).toBe('insecure 200');
  });

  it('reports 000 when neither request gets a response', () => {
    expect(run('000', '000').trim()).toBe('insecure 000');
  });
});

describe('bootstrap verify: reading the result', () => {
  it.each([
    ['verified 200', 'ok'],
    ['insecure 200', 'untrusted-cert'],
    ['verified 401', 'not-ready'],
    ['insecure 000', 'not-ready'],
    ['', 'not-ready'],
    ['200', 'not-ready'], // the old bare format is not mistaken for success
  ])('%j → %s', (stdout, kind) => {
    expect(interpretVerify(stdout).kind).toBe(kind);
  });

  it('names the status code, or "no response" for 000/empty', () => {
    expect(verifyMessage(interpretVerify('verified 502'))).toContain('"502"');
    expect(verifyMessage(interpretVerify('insecure 000'))).toContain('"no response"');
    expect(verifyMessage(interpretVerify(''))).toContain('"no response"');
  });

  it('says the certificate is not trusted yet when only -k worked', () => {
    expect(verifyMessage(interpretVerify('insecure 200'))).toMatch(/certificate is not trusted yet/);
  });

  it('keeps the success line operators already know', () => {
    expect(verifyMessage(interpretVerify('verified 200'))).toBe('  UI is responding (200).');
  });
});
