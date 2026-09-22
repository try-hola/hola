/**
 * Bundle signature verification (F05).
 *
 * The finding: `verifySignature` ran `cosign version` and returned
 * `verified: true` — it never verified a signature, a trusted identity, a key
 * or an artifact digest. Worse, the failure mode was INVERTED: cosign absent
 * meant "not verified" (so `required` failed closed), while cosign present
 * meant "verified" (so `required` passed having checked nothing). Installing
 * cosign — the remediation an operator performs when `required` starts
 * failing — was what turned a safe error into a false pass.
 *
 * Every test here drives RealBundleService through its `CommandRunner` seam, so
 * none of them need a network or a cosign binary. That seam is how the review's
 * evidence was produced, and it is what makes these assertions revert-proof:
 * with the fix reverted, the "not verified" ones fail because the old code
 * answered `verified: true` to a stubbed `cosign version`.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  RealBundleService,
  resolveSignatureSettings,
  type CommandRunner,
  type SignatureSettings,
} from '../../services/core/bundles';
import {
  buildCosignVerifyCommand,
  classifyCosignFailure,
  evaluateSignatureConfig,
  isTrustConfigured,
  pinRefToDigest,
  trustFingerprint,
} from '../../services/core/bundle-signature';
import { parseSignaturePolicy, resolveSignatureTrust } from '../../config/catalog';
import { BundleError } from '../../middleware/error-mapping';

const DIGEST_A = 'sha256:' + 'a'.repeat(64);
const DIGEST_B = 'sha256:' + 'b'.repeat(64);
const REF = 'ghcr.io/try-hola/app:1.0';
const KEY_TRUST = { keyPath: '/etc/hola/cosign.pub' };

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeCache(prefix = 'hola-sig-') {
  const base = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(base);
  return base;
}

function settings(policy: SignatureSettings['policy'], trust: SignatureSettings['trust'] = {}): SignatureSettings {
  return { policy, trust, configError: evaluateSignatureConfig(policy, trust) };
}

/** Seeds a cache dir as if a prior `ensurePulled` already pulled this version. */
function seedCachedBundle(base: string, appId: string, version: string, digest: string) {
  const dest = join(base, appId, version);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, 'compose.yaml'), 'services: {}');
  writeFileSync(join(dest, 'manifest.json'), '{}');
  writeFileSync(join(dest, '.oras-digest'), digest);
  return dest;
}

/**
 * A runner that logs every command. `cosign` behaviour is selectable, which is
 * the whole point: the bug was that the two cosign outcomes were backwards.
 */
function stubRunner(
  log: string[],
  opts: { digest?: string; cosign?: 'present-ok' | 'present-unsigned' | 'missing' } = {},
): CommandRunner {
  return async (cmd) => {
    log.push(cmd);
    if (cmd.includes('oras resolve')) return { stdout: (opts.digest ?? DIGEST_A) + '\n', stderr: '' };
    if (cmd.startsWith('oras pull')) {
      // Land the bundle files a real pull would, so the NEXT call takes the
      // cache-hit path (which is where the missing policy check lived).
      const out = cmd.match(/-o (\S+)/)?.[1];
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'compose.yaml'), 'services: {}');
        writeFileSync(join(out, 'manifest.json'), '{}');
      }
      return { stdout: '', stderr: '' };
    }
    if (cmd.includes('cosign')) {
      // `cosign version` always succeeds here — that is precisely the stub the
      // review used, and the old code took it as proof of a valid signature.
      if (cmd.includes('cosign version')) return { stdout: 'cosign 2.4.1', stderr: '' };
      if (opts.cosign === 'missing') throw new Error('/bin/sh: 1: cosign: command not found');
      if (opts.cosign === 'present-unsigned') throw new Error('Error: no matching signatures:\nmain.go:74');
      return { stdout: '[{"critical":{}}]', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
}

describe('F05 · the review\'s own evidence: an unsigned bundle must not come back verified', () => {
  test('a bundle with no signature is NOT verified, whatever cosign says about itself', async () => {
    // The exact reproduction: a stubbed runner where `cosign version` succeeds
    // and the artifact carries no trusted signature. The old code ran only
    // `cosign version` and answered `verified: true`.
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-unsigned' }), settings('optional', KEY_TRUST));

    const verdict = await svc.verifySignature({ ociRef: REF, digest: DIGEST_A });

    // A determinate negative, not a boolean that can be read as success.
    expect(verdict.status).toBe('unsigned');
    expect(verdict.reason).toContain('no signature over this digest');
    // The artifact itself was actually interrogated, pinned to its digest —
    // `cosign version` is not evidence of anything about the artifact.
    expect(log.some((c) => c.includes('cosign verify') && c.includes(DIGEST_A))).toBe(true);
    expect(log.some((c) => c.includes('cosign version'))).toBe(false);
  });

  test('with no trust root configured the verdict is `unverifiable`, never `verified`', async () => {
    const base = await makeCache();
    const svc = new RealBundleService(base, stubRunner([]), settings('optional', {}));

    const verdict = await svc.verifySignature({ ociRef: REF, digest: DIGEST_A });

    expect(verdict.status).toBe('unverifiable');
    expect(verdict.reason).toContain('no signing trust root is configured');
    // No invented trust root: nothing is even attempted, so nothing can pass.
    expect(verdict.trust).toBeUndefined();
  });

  test('the inversion is gone: installing cosign does not turn a refusal into a pass', async () => {
    // Pre-fix: cosign absent => fail closed; cosign present => false pass. So
    // the operator's own remediation (install cosign) broke the guarantee.
    // Post-fix: with no trust root, both are `unverifiable`.
    const base = await makeCache();
    const absent = await new RealBundleService(base, stubRunner([], { cosign: 'missing' }), settings('optional', {}))
      .verifySignature({ ociRef: REF, digest: DIGEST_A });
    const present = await new RealBundleService(base, stubRunner([]), settings('optional', {}))
      .verifySignature({ ociRef: REF, digest: DIGEST_A });

    expect(absent.status).toBe('unverifiable');
    expect(present.status).toBe('unverifiable');
  });

  test('`required` refuses an unsigned bundle on a FRESH pull and leaves nothing cached', async () => {
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-unsigned' }), settings('required', KEY_TRUST));

    let err: unknown;
    try {
      await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).code).toBe('SIGNATURE_VERIFICATION_FAILED');
    expect((err as BundleError).message).toContain('unsigned');
    // A refused bundle must not be left on disk looking cached.
    expect(existsSync(join(base, 'app', '1.0', 'compose.yaml'))).toBe(false);
  });

  test('`required` refuses on a CACHE HIT too — a policy change on a warm cache enforces', async () => {
    // The half most likely to be missed. Pre-fix, the cache hit returned before
    // the signature block ran, so tightening the policy on a host that had
    // already pulled the bundle changed nothing at all.
    const base = await makeCache();
    const dest = seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-unsigned' }), settings('required', KEY_TRUST));

    let err: unknown;
    try {
      await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    } catch (e) { err = e; }

    expect(err).toBeInstanceOf(BundleError);
    expect((err as BundleError).code).toBe('SIGNATURE_VERIFICATION_FAILED');
    // It really was the cache path: nothing was re-pulled.
    expect(log.some((c) => c.startsWith('oras pull'))).toBe(false);
    // And verification was actually attempted against the cached digest.
    expect(log.some((c) => c.includes('cosign verify') && c.includes(DIGEST_A))).toBe(true);
    expect(existsSync(dest)).toBe(false);
  });

  test('`required` with no trust root refuses every install, naming the missing configuration', async () => {
    // The honest outcome of "required" on a host that cannot verify anything:
    // installs stop, and the message says exactly which variable to set.
    const base = await makeCache();
    const svc = new RealBundleService(base, stubRunner([]), settings('required', {}));

    let err: unknown;
    try {
      await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    } catch (e) { err = e; }

    expect((err as BundleError).code).toBe('SIGNATURE_VERIFICATION_FAILED');
    expect((err as BundleError).message).toContain('HOLA_SIGNATURE_TRUST_KEY');
    // Structured, so a client can render the cause rather than regex the prose.
    const details = (err as BundleError).details as Record<string, unknown>;
    expect(details.status).toBe('unverifiable');
    expect(details.policy).toBe('required');
  });
});

describe('F05 · what each policy value does', () => {
  test('`none` attempts nothing and claims nothing', async () => {
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log), settings('none', KEY_TRUST));

    await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });

    expect(log.some((c) => c.includes('cosign'))).toBe(false);
  });

  test('`optional` reports the verdict but never blocks', async () => {
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-unsigned' }), settings('optional', KEY_TRUST));

    // Same bundle that `required` refuses above: here it installs.
    const info = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });

    expect(info.localPath).toBe(join(base, 'app', '1.0'));
    expect(log.some((c) => c.includes('cosign verify'))).toBe(true);
    // Unverified => no provenance is persisted, so nothing can later be
    // mistaken for a verified decision.
    expect(existsSync(join(base, 'app', '1.0', '.signature-verdict.json'))).toBe(false);
  });

  test('a trusted digest verifies, and that is the only thing `required` accepts', async () => {
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-ok' }), settings('required', KEY_TRUST));

    const info = await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });

    expect(info.digest).toBe(DIGEST_A);
    // Verification is pinned to the digest, never the mutable tag.
    const verify = log.find((c) => c.includes('cosign verify'))!;
    expect(verify).toContain(`ghcr.io/try-hola/app@${DIGEST_A}`);
    expect(verify).not.toContain('app:1.0');
    expect(verify).toContain('--key /etc/hola/cosign.pub');
  });
});

describe('F05 · persisted provenance and what invalidates it', () => {
  test('a verified decision is persisted and reused on a later cache hit', async () => {
    const base = await makeCache();
    const log: string[] = [];
    const svc = new RealBundleService(base, stubRunner(log, { cosign: 'present-ok' }), settings('required', KEY_TRUST));

    await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    const marker = JSON.parse(readFileSync(join(base, 'app', '1.0', '.signature-verdict.json'), 'utf8'));
    expect(marker.status).toBe('verified');
    expect(marker.digest).toBe(DIGEST_A);
    expect(marker.trust).toBe(trustFingerprint(KEY_TRUST));

    const verifiesBefore = log.filter((c) => c.includes('cosign verify')).length;
    await svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    expect(log.filter((c) => c.includes('cosign verify')).length).toBe(verifiesBefore);
  });

  test('a changed trust root invalidates the persisted decision', async () => {
    const base = await makeCache();
    const log: string[] = [];
    // First install verifies against key A and stamps provenance.
    await new RealBundleService(base, stubRunner(log, { cosign: 'present-ok' }), settings('required', KEY_TRUST))
      .ensurePulled({ appId: 'app', version: '1.0', ociRef: REF });
    expect(existsSync(join(base, 'app', '1.0', '.signature-verdict.json'))).toBe(true);

    // The operator rotates to a different trust root. The bundle is still
    // cached and its digest unchanged, so ONLY the trust fingerprint can
    // invalidate the stamped verdict — and against the new root this artifact
    // has no signature.
    const log2: string[] = [];
    const rotated = new RealBundleService(
      base,
      stubRunner(log2, { cosign: 'present-unsigned' }),
      settings('required', { keyPath: '/etc/hola/other.pub' }),
    );

    await expect(rotated.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF }))
      .rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    expect(log2.some((c) => c.startsWith('oras pull'))).toBe(false); // it was a cache hit
    expect(log2.some((c) => c.includes('cosign verify'))).toBe(true); // re-evaluated anyway
  });

  test('a changed bundle digest invalidates the persisted decision', async () => {
    const base = await makeCache();
    const dest = seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    writeFileSync(
      join(dest, '.signature-verdict.json'),
      JSON.stringify({ status: 'verified', digest: DIGEST_A, trust: trustFingerprint(KEY_TRUST), verifiedAt: 'x' }),
    );

    // The publisher re-pushed the same tag: the registry now resolves DIGEST_B,
    // so the cached provenance is about a different artifact.
    const log: string[] = [];
    const svc = new RealBundleService(
      base,
      stubRunner(log, { digest: DIGEST_B, cosign: 'present-unsigned' }),
      settings('required', KEY_TRUST),
    );

    await expect(svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF }))
      .rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
    expect(log.some((c) => c.startsWith('oras pull'))).toBe(true); // stale cache re-pulled
  });

  test('a forged provenance marker cannot pass off an unverified bundle', async () => {
    // The marker is server-written, but the bundle cache is on disk; a marker
    // whose trust fingerprint does not match the live trust root is worthless.
    const base = await makeCache();
    const dest = seedCachedBundle(base, 'app', '1.0', DIGEST_A);
    writeFileSync(
      join(dest, '.signature-verdict.json'),
      JSON.stringify({ status: 'verified', digest: DIGEST_A, trust: 'sha256:deadbeef', verifiedAt: 'x' }),
    );
    const svc = new RealBundleService(base, stubRunner([], { cosign: 'present-unsigned' }), settings('required', KEY_TRUST));

    await expect(svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF }))
      .rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
  });

  test('an unresolvable digest is `unverifiable`, not a free pass', async () => {
    // Offline registry on a first pull: there is no digest to pin verification
    // to, and a tag is not a verifiable identity.
    const base = await makeCache();
    const runner: CommandRunner = async (cmd) => {
      if (cmd.includes('oras resolve')) throw new Error('network unreachable');
      return { stdout: '', stderr: '' };
    };
    const svc = new RealBundleService(base, runner, settings('required', KEY_TRUST));

    await expect(svc.ensurePulled({ appId: 'app', version: '1.0', ociRef: REF }))
      .rejects.toThrow('SIGNATURE_VERIFICATION_FAILED');
  });
});

describe('F05 · configuration is validated rather than silently downgraded', () => {
  test('an unrecognised HOLA_SIGNATURE_POLICY resolves to the strictest reading, not the loosest', () => {
    // Pre-fix this was `process.env.X as SignaturePolicy`, so `requird`
    // behaved as `optional` — a typo silently disabled enforcement.
    expect(parseSignaturePolicy(undefined).policy).toBe('optional');
    expect(parseSignaturePolicy('').policy).toBe('optional');
    expect(parseSignaturePolicy('none').policy).toBe('none');
    expect(parseSignaturePolicy('required').policy).toBe('required');
    const typo = parseSignaturePolicy('requird');
    expect(typo.policy).toBe('required');
    expect(typo.configError).toContain('requird');
  });

  test('`required` with no trust root is reported as unsatisfiable, and the service is unhealthy', async () => {
    const base = await makeCache();
    const svc = new RealBundleService(base, stubRunner([]), settings('required', {}));
    const health = await svc.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.error).toContain('no signing trust root is configured');
  });

  test('half-configured keyless trust is refused rather than half-honoured', () => {
    // An identity with no issuer would accept a certificate for that identity
    // from ANY issuer; an issuer with no identity accepts anything it signed.
    expect(isTrustConfigured({ identity: 'a@b.com' })).toBe(false);
    expect(isTrustConfigured({ issuer: 'https://accounts.example' })).toBe(false);
    expect(isTrustConfigured({ identity: 'a@b.com', issuer: 'https://accounts.example' })).toBe(true);
    expect(isTrustConfigured({ keyPath: '/k.pub' })).toBe(true);
    expect(isTrustConfigured({})).toBe(false);

    expect(evaluateSignatureConfig('optional', { identity: 'a@b.com' })).toContain('without HOLA_SIGNATURE_TRUST_ISSUER');
    expect(evaluateSignatureConfig('optional', { issuer: 'https://x' })).toContain('without HOLA_SIGNATURE_TRUST_IDENTITY');
    expect(evaluateSignatureConfig('optional', { keyPath: '/k.pub', identity: 'a@b.com' })).toContain('one or the other');
    expect(evaluateSignatureConfig('optional', {})).toBeUndefined();
    // Under `none` the trust root is inert, so a confused one is not a health
    // problem — nothing was going to be attempted with it.
    expect(evaluateSignatureConfig('none', {})).toBeUndefined();
    expect(evaluateSignatureConfig('none', { keyPath: '/k.pub', identity: 'a@b.com' })).toBeUndefined();
  });

  test('trust is read from the environment with no built-in default', () => {
    expect(resolveSignatureTrust({})).toEqual({ keyPath: undefined, identity: undefined, issuer: undefined });
    expect(resolveSignatureTrust({ HOLA_SIGNATURE_TRUST_KEY: '  ' })).toEqual({
      keyPath: undefined, identity: undefined, issuer: undefined,
    });
    expect(resolveSignatureTrust({
      HOLA_SIGNATURE_TRUST_IDENTITY: 'https://github.com/try-hola/apps/.github/workflows/release.yml@refs/heads/main',
      HOLA_SIGNATURE_TRUST_ISSUER: 'https://token.actions.githubusercontent.com',
    })).toEqual({
      keyPath: undefined,
      identity: 'https://github.com/try-hola/apps/.github/workflows/release.yml@refs/heads/main',
      issuer: 'https://token.actions.githubusercontent.com',
    });
  });

  test('the shipped default is `optional` with no trust root — i.e. nothing is claimed verified', () => {
    // Stated as a test so the default cannot drift into implying verification.
    const resolved = resolveSignatureSettings({
      signaturePolicy: 'optional', signatureTrust: {}, signaturePolicyConfigError: undefined,
    });
    expect(resolved.policy).toBe('optional');
    expect(isTrustConfigured(resolved.trust)).toBe(false);
    expect(resolved.configError).toBeUndefined(); // honest, not misconfigured
  });
});

describe('F05 · cosign command construction and failure classification', () => {
  test('the ref is pinned to the digest, tags and ports handled', () => {
    expect(pinRefToDigest('ghcr.io/try-hola/app:1.0', DIGEST_A)).toBe(`ghcr.io/try-hola/app@${DIGEST_A}`);
    expect(pinRefToDigest('ghcr.io/try-hola/app', DIGEST_A)).toBe(`ghcr.io/try-hola/app@${DIGEST_A}`);
    expect(pinRefToDigest(`ghcr.io/try-hola/app@${DIGEST_B}`, DIGEST_A)).toBe(`ghcr.io/try-hola/app@${DIGEST_A}`);
    // A registry port is not a tag.
    expect(pinRefToDigest('registry.example.com:5000/ns/app:2.1', DIGEST_A))
      .toBe(`registry.example.com:5000/ns/app@${DIGEST_A}`);
    expect(pinRefToDigest('registry.example.com:5000/ns/app', DIGEST_A))
      .toBe(`registry.example.com:5000/ns/app@${DIGEST_A}`);
  });

  test('key-based and keyless invocations name the trust root explicitly', () => {
    expect(buildCosignVerifyCommand('ghcr.io/o/a@' + DIGEST_A, { keyPath: '/k.pub' }))
      .toBe(`cosign verify --output json --key /k.pub ghcr.io/o/a@${DIGEST_A}`);
    expect(buildCosignVerifyCommand('ghcr.io/o/a@' + DIGEST_A, {
      identity: 'https://github.com/try-hola/apps/.github/workflows/r.yml@refs/heads/main',
      issuer: 'https://token.actions.githubusercontent.com',
    })).toBe(
      'cosign verify --output json ' +
      '--certificate-identity https://github.com/try-hola/apps/.github/workflows/r.yml@refs/heads/main ' +
      `--certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/o/a@${DIGEST_A}`,
    );
  });

  test('a private artifact authenticates via DOCKER_CONFIG, never on argv', async () => {
    const base = await makeCache();
    const log: string[] = [];
    let authContents: string | undefined;
    const runner: CommandRunner = async (cmd) => {
      log.push(cmd);
      const m = cmd.match(/DOCKER_CONFIG=(\S+)/);
      if (m) authContents = readFileSync(join(m[1], 'config.json'), 'utf8');
      if (cmd.includes('oras resolve')) return { stdout: DIGEST_A + '\n', stderr: '' };
      return { stdout: '[]', stderr: '' };
    };
    const svc = new RealBundleService(base, runner, settings('required', KEY_TRUST));

    await svc.verifySignature({
      ociRef: 'ghcr.io/acme/app:1.0',
      digest: DIGEST_A,
      credentials: { registry: 'ghcr.io', username: 'bot', password: 'ghp_secret' },
    });

    const verify = log.find((c) => c.includes('cosign verify'))!;
    expect(verify).toContain('DOCKER_CONFIG=');
    expect(verify).not.toContain('ghp_secret');
    expect(authContents).toContain(Buffer.from('bot:ghp_secret').toString('base64'));
  });

  test('failures are classified as `unsigned` only when that is actually known', () => {
    expect(classifyCosignFailure('Error: no matching signatures').status).toBe('unsigned');
    expect(classifyCosignFailure('MANIFEST_UNKNOWN: manifest unknown').status).toBe('unsigned');
    expect(classifyCosignFailure('sh: 1: cosign: command not found').status).toBe('unverifiable');
    expect(classifyCosignFailure('GET https://ghcr.io/token: 401 Unauthorized').status).toBe('unverifiable');
    expect(classifyCosignFailure('dial tcp: lookup ghcr.io: no such host').status).toBe('unverifiable');
    // Unrecognised output is never guessed into a determinate answer.
    expect(classifyCosignFailure('panic: something new').status).toBe('unverifiable');
    expect(classifyCosignFailure('').status).toBe('unverifiable');
    // Every non-verified verdict carries a reason an operator can act on.
    expect(classifyCosignFailure('sh: 1: cosign: command not found').reason).toContain('cosign is not installed');
  });

  test('a rotated key file changes the trust fingerprint (content, not path)', async () => {
    const base = await makeCache();
    const keyPath = join(base, 'cosign.pub');
    writeFileSync(keyPath, 'KEY-ONE');
    const before = trustFingerprint({ keyPath });
    writeFileSync(keyPath, 'KEY-TWO');
    const after = trustFingerprint({ keyPath });
    expect(after).not.toBe(before);
    // An unreadable key fingerprints distinctly too, so provenance is dropped
    // rather than silently reused.
    expect(trustFingerprint({ keyPath: join(base, 'gone.pub') })).not.toBe(after);
  });
});
