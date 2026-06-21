import { describe, it, expect } from 'vitest';

import { runChecks, type CheckDeps, type CheckResult } from '../install/checks';

// A CheckDeps whose DNS/fetch are inert; only `exec` matters for the route53 path.
function deps(over: Partial<CheckDeps>): CheckDeps {
  return {
    lookup: async () => [],
    fetchImpl: (async () => new Response('{}', { status: 200 })) as typeof fetch,
    exec: async () => ({ code: 0, stderr: '' }),
    ...over,
  };
}

const ROUTE53 = {
  ACME_DNS_PROVIDER: 'route53',
  AWS_ACCESS_KEY_ID: 'AKIATESTTESTTEST1234',
  AWS_SECRET_ACCESS_KEY: 'shhh',
  AWS_REGION: 'us-east-1',
} as Record<string, string>;

const awsCheck = (results: CheckResult[]) => results.find((r) => r.name === 'AWS credentials');

describe('runChecks — route53 AWS credentials', () => {
  it('passes when the aws CLI exits 0', async () => {
    const results = await runChecks(ROUTE53, deps({ exec: async () => ({ code: 0, stderr: '' }) }));
    expect(awsCheck(results)).toEqual({ name: 'AWS credentials', status: 'pass' });
  });

  it('surfaces the real AWS error even when stderr has leading blank lines', async () => {
    // The aws CLI writes `\n\naws: [ERROR]: An error occurred (SignatureDoesNotMatch) ...`.
    // The detail must be that line, not the useless "aws exited 254" fallback.
    const stderr = '\n\naws: [ERROR]: An error occurred (SignatureDoesNotMatch) when calling the GetCallerIdentity operation: ...\n';
    const results = await runChecks(ROUTE53, deps({ exec: async () => ({ code: 254, stderr }) }));
    const aws = awsCheck(results)!;
    expect(aws.status).toBe('fail');
    expect(aws.detail).toContain('SignatureDoesNotMatch');
    expect(aws.detail).not.toBe('aws exited 254');
  });

  it('falls back to the exit code only when stderr is truly empty', async () => {
    const results = await runChecks(ROUTE53, deps({ exec: async () => ({ code: 254, stderr: '' }) }));
    expect(awsCheck(results)!.detail).toBe('aws exited 254');
  });

  it('warns (not fails) when the aws CLI is missing', async () => {
    const results = await runChecks(ROUTE53, deps({
      exec: async () => { throw Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' }); },
    }));
    expect(awsCheck(results)!.status).toBe('warn');
  });
});
