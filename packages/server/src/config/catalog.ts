// Phase 6: Catalog and Bundles configuration

/**
 * What the host does with a bundle's signature verdict (F05).
 *
 * - `none`     — no verification is attempted and nothing is claimed.
 * - `optional` — verification is attempted and the verdict is REPORTED (a
 *                warning when a bundle is not verified), but it never blocks an
 *                install. Note honestly: over a corpus that carries no
 *                signatures, `optional` gates exactly like `none`; the only
 *                difference is that the operator is told.
 * - `required` — only a `verified` verdict may install. `unsigned` and
 *                `unverifiable` both fail the pull, on a cache hit as well as a
 *                fresh one.
 */
export type SignaturePolicy = 'none' | 'optional' | 'required';

/**
 * The trust root signatures are checked against. There is deliberately NO
 * default: a hardcoded key/identity/issuer would look like verification while
 * proving nothing about who signed. Unconfigured means every verdict is
 * `unverifiable`, which `required` refuses.
 *
 * Either key-based (`keyPath`) or keyless (`identity` + `issuer`) — cosign takes
 * one or the other, and configuring both is reported as a config error rather
 * than silently resolved.
 */
export interface SignatureTrust {
  /** Path to a cosign public key, passed as `cosign verify --key`. */
  keyPath?: string;
  /** Keyless: the exact certificate identity (SAN), `--certificate-identity`. */
  identity?: string;
  /** Keyless: the certificate's OIDC issuer, `--certificate-oidc-issuer`. */
  issuer?: string;
}

/**
 * Parse `HOLA_SIGNATURE_POLICY`. An unrecognised value used to be cast blindly
 * to `SignaturePolicy`, where it behaved as `optional` — so a typo'd `requird`
 * silently DOWNGRADED the host's security posture. An unknown value now
 * resolves to the strictest policy and reports the typo: refusing installs is
 * recoverable, quietly not verifying is not.
 */
export function parseSignaturePolicy(raw: string | undefined): { policy: SignaturePolicy; configError?: string } {
  const value = (raw ?? '').trim();
  if (!value) return { policy: 'optional' };
  if (value === 'none' || value === 'optional' || value === 'required') return { policy: value };
  return {
    policy: 'required',
    configError:
      `HOLA_SIGNATURE_POLICY="${value}" is not one of none|optional|required. Treating it as "required" (the ` +
      `strictest reading) so a typo cannot silently disable signature enforcement. Fix the value.`,
  };
}

/** Read the trust root from the environment. Blank/whitespace values count as unset. */
export function resolveSignatureTrust(env: Record<string, string | undefined> = process.env): SignatureTrust {
  const read = (name: string) => {
    const v = (env[name] ?? '').trim();
    return v || undefined;
  };
  return {
    keyPath: read('HOLA_SIGNATURE_TRUST_KEY'),
    identity: read('HOLA_SIGNATURE_TRUST_IDENTITY'),
    issuer: read('HOLA_SIGNATURE_TRUST_ISSUER'),
  };
}

export interface CatalogConfig {
  // Registry and pulling
  registry: 'ghcr';
  registryAllowlist: string[]; // e.g., ['ghcr.io/try-hola/*']
  pullConcurrency: number; // parallel pulls
  signaturePolicy: SignaturePolicy; // see SignaturePolicy — `optional` (report, never block) by default
  signatureTrust: SignatureTrust; // no default; unconfigured => nothing can be verified
  signaturePolicyConfigError?: string; // set when HOLA_SIGNATURE_POLICY itself is malformed

  // Remote catalog JSON
  catalogUrl?: string; // public, cached JSON endpoint
  refreshIntervalMs: number; // obey cache headers; fallback refresh cadence
  fetchTimeoutMs?: number; // network fetch timeout for remote catalog

  // Cache/retention
  cacheSoftCapBytes: number; // soft cap for non-active cache (LRU eviction)
  retainPriorVersions: number; // prior versions to keep in addition to in-use images
}

export const defaultCatalogConfig: CatalogConfig = {
  registry: 'ghcr',
  registryAllowlist: (process.env.HOLA_REGISTRY_ALLOWLIST || 'ghcr.io/try-hola/*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  pullConcurrency: Number(process.env.HOLA_PULL_CONCURRENCY) || 2,
  ...(() => {
    const { policy, configError } = parseSignaturePolicy(process.env.HOLA_SIGNATURE_POLICY);
    return { signaturePolicy: policy, signaturePolicyConfigError: configError };
  })(),
  signatureTrust: resolveSignatureTrust(),

  catalogUrl: process.env.HOLA_CATALOG_URL || undefined,
  refreshIntervalMs: Number(process.env.HOLA_CATALOG_REFRESH_INTERVAL_MS) || 24 * 60 * 60 * 1000, // 24h
  fetchTimeoutMs: Number(process.env.HOLA_CATALOG_FETCH_TIMEOUT_MS) || 3000,

  cacheSoftCapBytes: Number(process.env.HOLA_BUNDLE_CACHE_CAP_BYTES) || 1_000_000_000, // 1 GB
  retainPriorVersions: Number(process.env.HOLA_RETAIN_PRIOR_VERSIONS) || 2,
};

export function loadCatalogConfig(): CatalogConfig {
  return { ...defaultCatalogConfig };
}

export const catalogConfig = loadCatalogConfig();
