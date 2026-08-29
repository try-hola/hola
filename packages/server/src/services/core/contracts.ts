/**
 * Manifest coercion for capability contract roles (ADR 0004).
 *
 * The vocabulary itself — the contract table, ref parsing, provider grants —
 * lives in `@hola/shared/contracts`, because the web wizard (consent step) and
 * the CLI (`--grant`) need the same answers this server does. What stays here is
 * the part that needs a Logger: narrowing an untrusted bundle manifest's
 * `provides`/`accepts` into canonical refs, dropping anything this build can't
 * honor, in the same style as `coerceManifestAuth` / `coerceConsumes`.
 */

import { CONTRACTS, formatContractRef, parseContractRef } from '@hola/shared/contracts';

import type { Logger } from '../../lib/logger';

type CoerceCtx = { appId?: string; version?: string };

/** Normalize a manifest field that accepts a bare string or an array of them. */
function asRefList(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function coerceRefs(
  raw: unknown,
  role: 'provides' | 'accepts',
  logger: Logger,
  ctx: CoerceCtx,
): string[] | undefined {
  const out: string[] = [];

  for (const ref of asRefList(raw)) {
    const def = parseContractRef(ref);
    if (!def) {
      // Forward-compat (ADR 0003): a newer manifest naming a contract this build
      // has never heard of degrades to "doesn't participate", never to a failed
      // catalog load or a blocked install.
      logger.warn('Dropping unknown capability contract from manifest', { ...ctx, role, ref });
      continue;
    }
    // A platform-provided contract has no app-side provider to claim. Dropping
    // it (rather than honoring it) keeps `provides` meaning exactly one thing:
    // this app performs the capability for others — which is what the grant and
    // the consent step key off.
    if (role === 'provides' && def.providerKind === 'platform') {
      logger.warn('Dropping `provides` for a platform-provided contract', { ...ctx, ref });
      continue;
    }
    const canonical = formatContractRef(def);
    if (!out.includes(canonical)) out.push(canonical);
  }

  return out.length ? out : undefined;
}

/** Coerce a manifest `provides` field (string or string[]) to canonical refs. */
export function coerceProvides(raw: unknown, logger: Logger, ctx: CoerceCtx = {}): string[] | undefined {
  return coerceRefs(raw, 'provides', logger, ctx);
}

/** Coerce a manifest `accepts` field (string or string[]) to canonical refs. */
export function coerceAccepts(raw: unknown, logger: Logger, ctx: CoerceCtx = {}): string[] | undefined {
  return coerceRefs(raw, 'accepts', logger, ctx);
}

/**
 * Contract refs whose acceptor block is present in the manifest while the
 * contract itself isn't accepted — a manifest that predates ADR 0004 or an author
 * who filled in the block and forgot the declaration.
 *
 * Reported, never repaired: inferring acceptance from the block is exactly the
 * derivation ADR 0004 §2 rejected, and quietly opting an app into a contract on
 * its author's behalf is the opposite of what the declaration is for. The
 * server's job here is to make the discrepancy visible; the catalog's manifest CI
 * is what fails the build.
 */
export function findUndeclaredAcceptorBlocks(
  manifest: Record<string, unknown>,
  accepts: string[] | undefined,
): string[] {
  const declared = new Set(accepts ?? []);
  return CONTRACTS.filter(
    (c) => c.acceptorBlock !== undefined && manifest[c.acceptorBlock] !== undefined && !declared.has(formatContractRef(c)),
  ).map(formatContractRef);
}
