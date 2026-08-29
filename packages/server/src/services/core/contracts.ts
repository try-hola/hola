/**
 * Capability contracts (ADR 0004) — the two-sided cross-app integration model.
 *
 * ADR 0002 gave the platform a one-sided primitive: an app declares
 * `consumes: <capability>` and the server grants it something (a read-only mount,
 * a published feed). That models *app-consumes-platform*. It does not model the
 * relationship where one app performs a capability **on** another — backup being
 * the case that forced the issue (#121/#298).
 *
 * A **contract** has an id and a version (`backup@1`) and two roles:
 *
 * - **provider** — the side that performs the capability (backrest performs backups),
 *   declared as `provides: ["backup@1"]`;
 * - **acceptor** — the side that opts in to being a subject of it, declared as
 *   `accepts: ["backup@1"]`, with an optional typed manifest block carrying the
 *   details (`backup` → pre/post hooks).
 *
 * The contract, not the app, is the coupling point: an acceptor never names
 * backrest, so replacing the provider is a catalog change rather than a
 * fleet-wide manifest edit.
 *
 * **Acceptance is declared, not derived from the block.** The block says *how* an
 * app participates; `accepts` says *whether* it does, and they are different
 * facts — an app that needs no hooks at all (SQLite, flat-file) has to be
 * distinguishable from an app nobody ever considered, or the "which apps are
 * covered?" rollup is worthless. See ADR 0004 §2.
 *
 * **Contract ids are a closed set defined here, not in the catalog.** A contract
 * is a promise about *server* behavior; matching two strings does nothing unless
 * the server implements the middle, so an open vocabulary would let a bundle
 * claim a capability nothing honors. Unrecognized refs are dropped with a warning
 * rather than rejected (ADR 0003's forward-compat rule): the catalog and the
 * server release on separate cadences, and a stale server must not brick an
 * install.
 *
 * This module is Phase 1 (#418) — the vocabulary and its coercion only. Provider
 * grants + install-time consent (Phase 2), the broker endpoints (Phase 3) and the
 * API/UI rollup (Phase 4) land on top of this table.
 */

import type { Logger } from '../../lib/logger';

/**
 * How a contract's two sides actually exchange (ADR 0004 §5).
 *
 * - `brokered` — the provider asks the server and the server acts on acceptors.
 *   Right for a low-volume operation with a request/response shape (run every
 *   app's `pg_dump` before a backup). The provider holds no reach into any other
 *   app, and ordering/retry/failure stay inside the orchestrator.
 * - `provisioned` — the server wires up a scoped connection and steps out of the
 *   path. Right for continuous or latency-sensitive traffic, where proxying
 *   through the orchestrator would make it a data-plane bottleneck. Auth/OIDC
 *   already works this way (provision an Authentik client, inject env, join
 *   networks; the app then talks to the IdP directly forever), as does Traefik
 *   routing.
 *
 * The rule: broker if the interaction is an *operation*, provision if it is a
 * *connection*. Nothing in this phase reads the field — it is recorded now so the
 * choice is made per contract at design time rather than per call site later.
 */
export type ContractShape = 'brokered' | 'provisioned';

/**
 * Who can fill the provider role.
 *
 * - `app` — a catalog app declares `provides` (backrest → `backup@1`).
 * - `platform` — Hola itself is the provider and no app may claim it. Auth's
 *   provider is the Authentik stack the platform deploys, not a catalog app;
 *   `push@1`'s provider is the CLI driving `hola app data push`. An app declaring
 *   `provides` for one of these is a manifest error, not a capability.
 */
export type ContractProviderKind = 'app' | 'platform';

export interface ContractDefinition {
  /** Contract id — the stable half of a ref (`backup` in `backup@1`). */
  id: string;
  /** Contract version — bumped when the acceptor's obligations change. */
  version: number;
  shape: ContractShape;
  providerKind: ContractProviderKind;
  /**
   * The manifest block carrying an acceptor's details, when the contract has
   * one. Absent means acceptance needs no further declaration. Used to warn
   * about a block declared without the matching `accepts` (see
   * {@link findUndeclaredAcceptorBlocks}).
   */
  acceptorBlock?: string;
  /** One line, for logs and the future API rollup. */
  summary: string;
}

/**
 * The contract table. Every id the server honors, and nothing else.
 *
 * `auth@1` and `push@1` are pre-existing integrations re-labelled by ADR 0004 §8
 * — their blocks, coercers and runtime behavior are unchanged; naming them as
 * contracts is what lets one rollup answer "what does this app participate in?"
 */
export const CONTRACTS: readonly ContractDefinition[] = [
  {
    id: 'auth',
    version: 1,
    shape: 'provisioned',
    providerKind: 'platform',
    acceptorBlock: 'auth',
    summary: 'Per-app SSO provisioned at deploy time (native-oidc, forward-auth, native-ldap).',
  },
  {
    id: 'backup',
    version: 1,
    shape: 'brokered',
    providerKind: 'app',
    acceptorBlock: 'backup',
    summary: 'Consistent capture of an app\'s data, with optional pre/post hooks around the file capture.',
  },
  {
    id: 'push',
    version: 1,
    shape: 'brokered',
    providerKind: 'platform',
    acceptorBlock: 'push',
    summary: 'Bulk data loaded into declared directories under the app\'s data root.',
  },
] as const;

/** Canonical ref for a definition (`backup@1`). */
export function formatContractRef(def: ContractDefinition): string {
  return `${def.id}@${def.version}`;
}

/**
 * Resolve a raw `id@version` ref against the table.
 *
 * The version is **required**: `backup` alone is ambiguous the moment `backup@2`
 * exists, and silently reading it as `@1` would let an old manifest drift into a
 * contract whose obligations changed underneath it. Manifest CI in the catalog
 * repo catches the missing `@1` before publish; here it simply doesn't resolve.
 */
export function parseContractRef(raw: string): ContractDefinition | undefined {
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return undefined;
  const id = raw.slice(0, at);
  const version = Number(raw.slice(at + 1));
  if (!Number.isInteger(version)) return undefined;
  return CONTRACTS.find((c) => c.id === id && c.version === version);
}

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
    // this app performs the capability for others.
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
