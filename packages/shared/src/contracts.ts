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
 *
 * **Spec 004** adds: acceptor participation as a *list* (`backup@1`'s block may
 * be one or many participations — `backupParticipations()` is the only reader
 * of either shape); a per-contract *participation mode* (`declared` — the app
 * opts in via `accepts` — vs `implicit` — every install is a subject with
 * nothing to declare, `container-logs@1`); a database-image recogniser and
 * coverage judgement (`isDatabaseImage`, `judgeBackupCoverage`) so the dashboard
 * can tell "quiesced" from "partially covered" from "as-is"; and the platform
 * label keys applied to every app container.
 */

import type { AppBackupConfig, AppBackupDeclaration, AppBackupHook, AppBackupParticipation, BackupCoverageState, ContractCoverage } from './index';

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
 *
 * `container-logs` (spec 004, ADR 0004 §12) is the second kind: a read-only,
 * least-privilege log source (a redacting Docker API proxy, never a raw socket
 * or log-directory mount) for a trusted log collector.
 */
export type ProviderGrantKind = 'apps-data' | 'container-logs';

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
   * Whether an app opts in to being a subject via `accepts` (`declared`), or is
   * a subject by virtue of running, with nothing to declare (`implicit`; spec
   * 004, ADR 0004 §11). `container-logs@1` is the first `implicit` contract:
   * a manifest `accepts` naming it is meaningless and is dropped with a
   * warning, the way `provides` on a platform-provided contract already is.
   */
  participation: 'declared' | 'implicit';
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
    participation: 'declared',
    acceptorBlock: 'auth',
    summary: 'Per-app SSO provisioned at deploy time (native-oidc, forward-auth, native-ldap).',
  },
  {
    id: 'backup',
    version: 1,
    shape: 'brokered',
    providerKind: 'app',
    participation: 'declared',
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
    participation: 'declared',
    acceptorBlock: 'push',
    summary: 'Bulk data loaded into declared directories under the app\'s data root.',
  },
  {
    id: 'container-logs',
    version: 1,
    shape: 'provisioned',
    providerKind: 'app',
    participation: 'implicit',
    providerGrant: {
      kind: 'container-logs',
      label: 'Read the logs of every container on this host',
      risk:
        'This app can read whatever every installed app writes to its logs — which routinely includes ' +
        'tokens, request paths and personal data — and can see which containers exist and how they are ' +
        'labelled. It cannot start, stop or reach into them. Grant it only to a log collector you trust ' +
        'with everything on this host.',
    },
    summary: 'Continuous read access to every container\'s logs for a trusted collector; every install is a subject.',
  },
] as const;

/**
 * The backup contract's canonical ref. Named rather than inlined because the
 * server matches on it in three places (broker, acceptor lookup, grant) and a
 * typo would silently mean "no app participates".
 */
export const BACKUP_CONTRACT_REF = 'backup@1';

/**
 * The container-logs contract's canonical ref (spec 004), for callers that need
 * to name it — the CLI's `--grant`, a client rendering the rollup, a test.
 * Unlike `BACKUP_CONTRACT_REF`, the server never matches on this string: the
 * provider guard keys on `providerKind`, the implicit-`accepts` drop on
 * `participation`, and materialisation on the grant `kind`, so the ref stays a
 * label rather than a branch.
 */
export const CONTAINER_LOGS_CONTRACT_REF = 'container-logs@1';

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

// ---------------------------------------------------------------------------
// Plural participation (spec 004, FR-001–004)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/** A command must be a non-empty array of non-empty strings (exec form, no shell-string). */
function asCommand(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  if (!v.every((x) => typeof x === 'string' && x.length > 0)) return undefined;
  return v as string[];
}

function readHook(value: unknown): AppBackupHook | undefined {
  if (!isRecord(value)) return undefined;
  const service = asNonEmptyString(value.service);
  const command = asCommand(value.command);
  if (!service || !command) return undefined;
  return { service, command };
}

/**
 * The one reader of the `backup` block, in either shape (spec 004 / ADR 0003
 * back-compat): the legacy singular object (`{ preHook?, postHook? }`) becomes
 * a one-element list whose participation id is `default`; the plural array is
 * filtered to well-formed entries in declaration order (a missing/blank `id`,
 * a duplicate `id` — first wins — or an entry with neither hook is dropped).
 * Pure and warning-less by design: this runs on every read (including
 * on-disk release manifests written before this feature), while the
 * publish-time coercer (`coerceManifestBackup`, server-side, with a logger) is
 * where a bundle author's manifest gets one warning per drop.
 */
export function backupParticipations(value: unknown): AppBackupParticipation[] {
  if (Array.isArray(value)) {
    const out: AppBackupParticipation[] = [];
    const seen = new Set<string>();
    for (const entry of value) {
      if (!isRecord(entry)) continue;
      const id = asNonEmptyString(entry.id);
      if (!id || seen.has(id)) continue;
      const preHook = readHook(entry.preHook);
      const postHook = readHook(entry.postHook);
      if (!preHook && !postHook) continue;
      seen.add(id);
      const participation: AppBackupParticipation = { id };
      if (preHook) participation.preHook = preHook;
      if (postHook) participation.postHook = postHook;
      out.push(participation);
    }
    return out;
  }

  if (isRecord(value)) {
    const preHook = readHook(value.preHook);
    const postHook = readHook(value.postHook);
    if (!preHook && !postHook) return [];
    const participation: AppBackupParticipation = { id: 'default' };
    if (preHook) participation.preHook = preHook;
    if (postHook) participation.postHook = postHook;
    return [participation];
  }

  return [];
}

/** Re-exported so a caller can accept either the config or declaration type without importing both. */
export type { AppBackupConfig, AppBackupDeclaration, AppBackupParticipation };

// ---------------------------------------------------------------------------
// Database-service recognition and backup coverage (spec 004, FR-015–019)
// ---------------------------------------------------------------------------

/**
 * Closed, documented list of database image families whose live file copy is
 * unsafe (relational and document databases). A platform constant, never app
 * data — recognition keys on the image reference only, never an app id, and
 * matches the check the catalog's own CI applies. Caches (Redis) are
 * deliberately absent: a crash-consistent copy of a cache is acceptable.
 * Extend by pull request as the catalog adds database images.
 */
export const DATABASE_IMAGE_FAMILIES = [
  'postgres',
  'postgresql',
  'pgvector',
  'postgis',
  'timescaledb',
  'mysql',
  'mariadb',
  'percona',
  'mongo',
  'mongodb',
  'mssql',
  'cockroachdb',
  'couchdb',
] as const;

/**
 * Whether an image reference names a recognised database family. Strips the
 * registry/path and the tag/digest, then matches the lower-cased last path
 * segment against the family list: exact, `family-*` (`mysql-server`,
 * `timescaledb-ha`) or `*-family` (unlikely today, kept for symmetry). A
 * prefix/suffix match whose remaining words name a companion role
 * (`mongo-express`, `postgres-exporter`, `mariadb-backup`) is NOT a database —
 * see `COMPANION_ROLE_WORDS`.
 */
export function isDatabaseImage(imageRef: string): boolean {
  if (typeof imageRef !== 'string' || imageRef.trim().length === 0) return false;
  const withoutDigest = imageRef.split('@')[0] ?? '';
  const lastSlash = withoutDigest.lastIndexOf('/');
  const afterSlash = lastSlash >= 0 ? withoutDigest.slice(lastSlash + 1) : withoutDigest;
  const withoutTag = afterSlash.split(':')[0] ?? '';
  const segment = withoutTag.toLowerCase().trim();
  if (!segment) return false;

  return DATABASE_IMAGE_FAMILIES.some((family) => {
    if (segment === family) return true;
    if (segment.startsWith(`${family}-`)) return !namesACompanionRole(segment.slice(family.length + 1));
    if (segment.endsWith(`-${family}`)) return !namesACompanionRole(segment.slice(0, -(family.length + 1)));
    return false;
  });
}

/**
 * Words that turn a database family name into something that *talks to* a
 * database rather than *being* one: `mongo-express` (a web UI),
 * `postgres-exporter` (metrics), `mariadb-backup` (a dump tool). None of these
 * hold the data, so counting them as recognised databases would report a
 * perfectly quiesced app as `partial` — teaching operators to ignore the one
 * warning FR-019 exists to raise. Kept deliberately short and literal; extend by
 * pull request alongside `DATABASE_IMAGE_FAMILIES`.
 */
const COMPANION_ROLE_WORDS: ReadonlySet<string> = new Set([
  'adminer', 'admin', 'agent', 'backup', 'backups', 'cli', 'client', 'dump',
  'exporter', 'express', 'init', 'operator', 'proxy', 'restore', 'ui', 'web',
]);

/** Whether any hyphen-separated word of the remainder names a companion role. */
function namesACompanionRole(remainder: string): boolean {
  return remainder.split('-').some((word) => COMPANION_ROLE_WORDS.has(word));
}

/**
 * The coverage judgement for one deployment's `backup@1` acceptance (spec 004
 * FR-016; data-model.md "Coverage judgement" state table). `targeted` counts
 * distinct entries of `databaseServices` named by some participation's
 * **pre-hook** — the pre-hook is the quiesce; a post-hook-only participation
 * targets nothing, and two pre-hooks naming the same service count it once.
 */
export function judgeBackupCoverage(input: {
  accepts: boolean;
  participations: AppBackupParticipation[];
  databaseServices: string[];
}): ContractCoverage {
  const { accepts, participations, databaseServices } = input;
  const recognisedSet = new Set(databaseServices);
  const targetedSet = new Set<string>();
  const parts = participations.map((p) => {
    const service = p.preHook?.service;
    if (service && recognisedSet.has(service)) targetedSet.add(service);
    return { id: p.id, service };
  });

  const recognised = databaseServices.length;
  const targeted = targetedSet.size;

  let state: BackupCoverageState;
  if (!accepts) state = 'uncovered';
  else if (recognised === 0) state = participations.length > 0 ? 'quiesced' : 'as-is';
  else state = targeted === recognised ? 'quiesced' : 'partial';

  return { state, targeted, recognised, participations: parts, databases: databaseServices };
}

// ---------------------------------------------------------------------------
// Platform container labels (spec 004, FR-030/031)
// ---------------------------------------------------------------------------

/** Reserved-namespace label naming the Hola app id, on every app container. */
export const PLATFORM_LABEL_APP = 'sh.hola.app';
/** Reserved-namespace label naming the deployment id, on every app container. */
export const PLATFORM_LABEL_DEPLOYMENT = 'sh.hola.deployment';
/** Reserved-namespace label naming the deployment's display name, on every app container. */
export const PLATFORM_LABEL_NAME = 'sh.hola.name';
/** The reserved namespace itself — a user-authored label under this prefix is overwritten. */
export const PLATFORM_LABEL_PREFIX = 'sh.hola.';
