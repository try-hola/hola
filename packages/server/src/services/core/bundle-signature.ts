/**
 * Bundle signature verification: the decision logic, kept pure (F05).
 *
 * ## What was wrong
 *
 * `RealBundleService.verifySignature` used to run `cosign version` and return
 * `{ verified: true }`. It never verified a signature, a trusted identity, a
 * key, or an artifact digest — and the one log line admitting that was at
 * `debug`, so in normal operation the platform simply reported every bundle as
 * verified.
 *
 * The inversion that made it dangerous: cosign **absent** produced
 * `verified: false`, so a `required` policy failed closed; cosign **present**
 * produced `verified: true`, so the same policy passed having checked nothing.
 * Installing cosign — exactly the remediation an operator performs when
 * `required` starts failing — is what converted a safe error into a false pass.
 * The security posture degraded the more diligent the operator was.
 *
 * ## The shape of the fix
 *
 * A boolean cannot express "nothing was checked", and that conflation *was* the
 * bug. The outcome is therefore a three-state verdict:
 *
 * - `verified`     — a signature over THIS manifest digest matched the
 *                    configured trust root. The only status that satisfies
 *                    `required`.
 * - `unsigned`     — a determinate negative: the registry holds no signature
 *                    over this digest that the configured trust root accepts.
 *                    Covers both "no signature at all" and "a signature that
 *                    does not match our trust"; the `reason` distinguishes
 *                    them, the gate does not (neither is trustworthy).
 * - `unverifiable` — we do not know: no trust root configured, no resolvable
 *                    digest to verify, cosign missing, registry unreachable, or
 *                    an output we cannot classify. Never treated as success.
 *
 * Verification is always pinned to `<repo>@sha256:...`, never to the tag: a tag
 * is mutable and therefore not a verifiable identity.
 *
 * ## No invented trust root
 *
 * There is deliberately no default key, identity or issuer. A hardcoded trust
 * root is worse than none — it would look like verification while proving
 * nothing about who signed. With nothing configured the verdict is
 * `unverifiable`, which `required` refuses and `optional` reports.
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import type { SignaturePolicy, SignatureTrust } from '../../config/catalog';

/** See the module header: `verified` is the only status that means anything was proved. */
export type SignatureStatus = 'verified' | 'unsigned' | 'unverifiable';

export interface SignatureVerdict {
  status: SignatureStatus;
  /** Operator-actionable explanation. Always set unless the status is `verified`. */
  reason?: string;
  /** The OCI manifest digest this verdict is about (absent only when none could be resolved). */
  digest?: string;
  /**
   * Fingerprint of the trust configuration that produced a `verified`. Persisted
   * with the verdict so a trust change invalidates the previous decision.
   */
  trust?: string;
}

/** Quote a value for the shell the CommandRunner hands the command to. */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9@%_+=:,./-]*$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Is there anything to verify *against*? Key-based needs the key; keyless needs
 * BOTH an identity and an issuer — an identity with no issuer would accept a
 * certificate for that identity from any issuer, which is not a trust root.
 */
export function isTrustConfigured(trust: SignatureTrust): boolean {
  if (trust.keyPath) return true;
  return Boolean(trust.identity && trust.issuer);
}

/** Human-readable trust summary for logs/messages. Carries no secret material. */
export function describeTrust(trust: SignatureTrust): string {
  if (trust.keyPath) return `key ${trust.keyPath}`;
  if (trust.identity && trust.issuer) return `identity ${trust.identity} issued by ${trust.issuer}`;
  return 'none';
}

/**
 * A stable fingerprint of the *effective* trust material — for a key that means
 * the key's CONTENT, not its path, so rotating a key in place invalidates every
 * persisted verdict that key produced. An unreadable key fingerprints
 * distinctly, which invalidates too (and then fails closed on re-verification).
 */
export function trustFingerprint(trust: SignatureTrust): string {
  const parts: string[] = [];
  if (trust.keyPath) parts.push(`key=${keyMaterialHash(trust.keyPath)}`);
  if (trust.identity) parts.push(`identity=${trust.identity}`);
  if (trust.issuer) parts.push(`issuer=${trust.issuer}`);
  return 'sha256:' + createHash('sha256').update(parts.sort().join('\n')).digest('hex');
}

function keyMaterialHash(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return `unreadable:${path}`;
  }
}

/**
 * Report a signature configuration that cannot do what it claims. Returned as a
 * string rather than thrown: the server still has to manage already-installed
 * apps, so a bad *catalog-pull* setting must not take the host down (see
 * OPERATIONS.md). It is logged at `error` on construction and every affected
 * install fails with it.
 */
export function evaluateSignatureConfig(policy: SignaturePolicy, trust: SignatureTrust): string | undefined {
  // Under `none` nothing is attempted, so a confused trust root is inert — and
  // an inert setting must not make the service report itself unhealthy.
  if (policy === 'none') return undefined;
  if (trust.keyPath && (trust.identity || trust.issuer)) {
    return 'HOLA_SIGNATURE_TRUST_KEY is set together with keyless trust (HOLA_SIGNATURE_TRUST_IDENTITY/ISSUER); ' +
      'cosign accepts one or the other. Unset whichever you do not mean to use.';
  }
  if (trust.identity && !trust.issuer) {
    return 'HOLA_SIGNATURE_TRUST_IDENTITY is set without HOLA_SIGNATURE_TRUST_ISSUER; an identity with no issuer is ' +
      'not a trust root (any issuer could mint a certificate for it). Set HOLA_SIGNATURE_TRUST_ISSUER too.';
  }
  if (trust.issuer && !trust.identity) {
    return 'HOLA_SIGNATURE_TRUST_ISSUER is set without HOLA_SIGNATURE_TRUST_IDENTITY; an issuer alone would accept ' +
      'any identity it has ever signed for. Set HOLA_SIGNATURE_TRUST_IDENTITY too.';
  }
  if (policy === 'required' && !isTrustConfigured(trust)) {
    return 'HOLA_SIGNATURE_POLICY=required but no signing trust root is configured, so no bundle can ever be ' +
      'verified and every install will be refused. Set HOLA_SIGNATURE_TRUST_KEY (a cosign public key), or both ' +
      'HOLA_SIGNATURE_TRUST_IDENTITY and HOLA_SIGNATURE_TRUST_ISSUER — or lower HOLA_SIGNATURE_POLICY.';
  }
  return undefined;
}

/**
 * Rewrite a ref so it names the manifest digest we actually pulled. Verifying
 * the tag would verify whatever the tag points at *now*, which is not
 * necessarily what is in the cache — the same-tag-republish case the digest
 * marker already exists to catch.
 */
export function pinRefToDigest(ociRef: string, digest: string): string {
  const at = ociRef.lastIndexOf('@');
  let repo = at >= 0 ? ociRef.slice(0, at) : ociRef;
  // Strip a tag, but not a registry port: only a ':' after the last '/' is a tag.
  const slash = repo.lastIndexOf('/');
  const colon = repo.lastIndexOf(':');
  if (colon > slash) repo = repo.slice(0, colon);
  return `${repo}@${digest}`;
}

/**
 * The cosign invocation. `--registry-config`-style auth does not exist for
 * cosign, so a private pull passes its scoped docker-config directory through
 * `DOCKER_CONFIG` — same reason as the `oras` path: the token must not appear on
 * argv, where `ps` would show it.
 */
export function buildCosignVerifyCommand(
  pinnedRef: string,
  trust: SignatureTrust,
  opts: { dockerConfigDir?: string } = {},
): string {
  const args = ['cosign', 'verify', '--output', 'json'];
  if (trust.keyPath) {
    args.push('--key', shellEscape(trust.keyPath));
  } else {
    args.push('--certificate-identity', shellEscape(trust.identity!));
    args.push('--certificate-oidc-issuer', shellEscape(trust.issuer!));
  }
  args.push(shellEscape(pinnedRef));
  const prefix = opts.dockerConfigDir ? `DOCKER_CONFIG=${shellEscape(opts.dockerConfigDir)} ` : '';
  return prefix + args.join(' ');
}

const COSIGN_MISSING = /command not found|: not found|executable file not found|ENOENT/i;
const NO_TRUSTED_SIGNATURE = /no matching signatures|no signatures found|MANIFEST_UNKNOWN|signature not found/i;
const REGISTRY_TROUBLE = /401|403|unauthorized|denied|dial tcp|no such host|i\/o timeout|timed? ?out|x509|tls/i;

/**
 * Turn a cosign failure into a verdict. The distinction that matters is
 * "we know there is no trusted signature" (`unsigned` — a determinate negative)
 * versus "we could not find out" (`unverifiable`). Anything unrecognised is
 * `unverifiable`: guessing `unsigned` would be a claim we cannot support, and
 * guessing `verified` is the bug this replaces.
 */
export function classifyCosignFailure(message: string): { status: Exclude<SignatureStatus, 'verified'>; reason: string } {
  const text = (message || '').trim();
  const excerpt = text.slice(0, 300) || 'no output';
  if (COSIGN_MISSING.test(text)) {
    return {
      status: 'unverifiable',
      reason: 'cosign is not installed in the server image, so no signature can be checked',
    };
  }
  if (NO_TRUSTED_SIGNATURE.test(text)) {
    return {
      status: 'unsigned',
      reason: `the registry holds no signature over this digest that the configured trust root accepts: ${excerpt}`,
    };
  }
  if (REGISTRY_TROUBLE.test(text)) {
    return { status: 'unverifiable', reason: `could not reach the registry to check the signature: ${excerpt}` };
  }
  return { status: 'unverifiable', reason: `cosign verify failed in a way we cannot classify: ${excerpt}` };
}
