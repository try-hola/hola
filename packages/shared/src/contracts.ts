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
 * by the server's coercion layer rather than rejected (ADR 0003's forward-compat
 * rule): the catalog and the server release on separate cadences, and a stale
 * server must not brick an install.
 *
 * This module is the *vocabulary* — the table and pure helpers over it. It lives
 * in `shared` rather than the server because three packages need the same answer:
 * the server (grant + broker), the web install wizard (render the consent step)
 * and the CLI (`--grant`). The manifest-coercion layer, which needs a Logger,
 * stays server-side in `services/core/contracts.ts`.
 */

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
 * *connection*.
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

/**
 * The privilege a contract's provider is granted so it can do the job.
 *
 * `apps-data` is a read-only, identity-mapped bind mount of the apps root — the
 * consumer can read every app's data. Under ADR 0002 an app asked for this
 * directly (`consumes: apps-data`), which meant the privilege was visible only in
 * a manifest line reviewed once at publish time, by whoever merged the bundle;
 * the operator installing it saw nothing. ADR 0004 §4 attaches it to the provider
 * role instead and discloses it at install, so the person who bears the risk is
 * the one asked.
 */
export type ProviderGrantKind = 'apps-data';

export type ProviderGrant = {
  kind: ProviderGrantKind;
  /** Short label for the consent row. */
  label: string;
  /** What the operator is actually agreeing to, in plain words. */
  risk: string;
};

export interface ContractDefinition {
  /** Contract id — the stable half of a ref (`backup` in `backup@1`). */
  id: string;
  /** Contract version — bumped when the acceptor's obligations change. */
  version: number;
  shape: ContractShape;
  providerKind: ContractProviderKind;
  /**
   * Privilege the server grants this contract's provider at deploy time, and
   * which the operator must consent to at install. Absent ⇒ filling the provider
   * role needs no elevated access.
   */
  providerGrant?: ProviderGrant;
  /**
   * The manifest block carrying an acceptor's details, when the contract has
   * one. Absent means acceptance needs no further declaration.
   */
  acceptorBlock?: string;
  /** One line, for logs and the API rollup. */
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
    providerGrant: {
      kind: 'apps-data',
      label: 'Read the data of every installed app',
      risk:
        'This app gets a read-only view of all app data — including database files and any secrets ' +
        'apps keep on disk. It needs this to back them up. Grant it only to an app you trust with ' +
        'everything on this host.',
    },
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

/**
 * The privileged grants implied by an app's declared provider roles — what the
 * install wizard renders for consent and what `createFromDraft` requires consent
 * for. Refs that don't resolve, or resolve to a contract with no grant, are
 * skipped: a provider role without privilege needs no consent step.
 */
export function providerGrantsFor(provides: string[] | undefined): Array<{ ref: string; grant: ProviderGrant }> {
  const out: Array<{ ref: string; grant: ProviderGrant }> = [];
  for (const ref of provides ?? []) {
    const def = parseContractRef(ref);
    if (!def?.providerGrant) continue;
    out.push({ ref: formatContractRef(def), grant: def.providerGrant });
  }
  return out;
}

/**
 * Declared provider grants the operator has NOT consented to. Non-empty ⇒ the
 * install must be refused: an app whose whole job is acting on other apps' data,
 * silently installed without the access to do it, is a backup tool that backs
 * nothing up — a failure the operator would discover at restore time. Better a
 * clear error at install.
 */
export function missingGrantConsents(provides: string[] | undefined, consented: string[] | undefined): string[] {
  const ok = new Set(consented ?? []);
  return providerGrantsFor(provides).filter((g) => !ok.has(g.ref)).map((g) => g.ref);
}

/** Whether a set of consented contract refs carries a particular grant kind. */
export function grantsInclude(refs: string[] | undefined, kind: ProviderGrantKind): boolean {
  return (refs ?? []).some((ref) => parseContractRef(ref)?.providerGrant?.kind === kind);
}
