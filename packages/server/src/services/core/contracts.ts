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
import type { ContractParticipant, ContractRollup, DeploymentContracts } from '@hola/shared';

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
  return acceptorBlocksPresent(manifest).filter((ref) => !declared.has(ref));
}

/**
 * Contract refs whose typed acceptor block is present in the manifest, whether or
 * not the contract is declared in `accepts`.
 *
 * Presence of the block is *not* acceptance — that's the derivation ADR 0004 §2
 * rejects. It's the answer to a different question: among the apps that DO accept,
 * which ones need work done around the operation (a `pg_dump` before the copy) and
 * which are already safe to copy as they sit. The rollup shows that difference, so
 * "covered, no hooks needed" doesn't read as "hooks are missing".
 */
export function acceptorBlocksPresent(manifest: Record<string, unknown>): string[] {
  return CONTRACTS.filter(
    (c) => c.acceptorBlock !== undefined && manifest[c.acceptorBlock] !== undefined,
  ).map(formatContractRef);
}

/** One install as the rollup builder takes it: its identity plus the roles it fills. */
export type ContractRollupEntry = {
  deployment: Omit<ContractParticipant, 'hooks' | 'granted'>;
  contracts: DeploymentContracts;
};

/**
 * Sort every install into provider / acceptor / unaffiliated for each contract in
 * the table (ADR 0004 Phase 4).
 *
 * Pure, and it enumerates the *contract table* rather than the roles it happens to
 * find: a contract nobody fills still comes back, with three empty buckets. That
 * is what lets a client say "no backup provider installed" — an answer it cannot
 * give from a list that simply omits the contract.
 *
 * Every install lands in exactly one bucket per contract. An app doing both jobs
 * (backrest backs itself up) is a provider AND an acceptor; the buckets aren't
 * exclusive of each other, only `unaffiliated` is exclusive of both.
 */
export function buildContractRollup(entries: readonly ContractRollupEntry[]): ContractRollup[] {
  return CONTRACTS.map((def) => {
    const ref = formatContractRef(def);
    const providers: ContractParticipant[] = [];
    const acceptors: ContractParticipant[] = [];
    const unaffiliated: ContractParticipant[] = [];

    for (const { deployment, contracts } of entries) {
      const provides = contracts.provides?.includes(ref) ?? false;
      const accepts = contracts.accepts?.includes(ref) ?? false;

      if (provides) {
        // `granted` is deliberately separate from `provides`: an app can declare
        // the role and hold no grant (consent not given, or a role added by an
        // upgrade the operator hasn't consented to), and an operator debugging
        // "why did nothing back up?" needs to see that difference.
        providers.push({ ...deployment, granted: contracts.granted?.includes(ref) ?? false });
      }
      if (accepts) {
        acceptors.push({ ...deployment, hooks: contracts.hooks?.includes(ref) ?? false });
      }
      if (!provides && !accepts) {
        unaffiliated.push({ ...deployment });
      }
    }

    return {
      ref,
      id: def.id,
      version: def.version,
      shape: def.shape,
      providerKind: def.providerKind,
      summary: def.summary,
      providers,
      acceptors,
      unaffiliated,
    };
  });
}
