/**
 * What the `restore@1` request queue remembers between calls (spec 008,
 * data-model.md §4).
 *
 * Modelled on `backup-broker-state.ts`'s persistence pattern — one small JSON
 * record under the server's own config directory, read-modify-write through
 * `StorageService`, a missing or unparseable file reading as empty, and the
 * same fail-closed "an unparseable timestamp counts as expired" rule
 * `isPrepareExpired` established. What does NOT transfer is that store's
 * defining property: `backup@1` has exactly one open prepare per host, so one
 * record suffices. Restore requests are concurrent — two installs of the same
 * app may each have one open at once (FR-035) — so this store is keyed by
 * REQUEST id, not a single record.
 */

import { getLogger } from '../../lib/logger';
import type { StorageService } from './storage';
import type { RestoreRequestStatus } from '@hola/shared';

const STORE_PATH = 'config/restore-broker.json';

/**
 * How long a claimed-but-uncompleted (or never-claimed) request may stay open
 * before it is treated as expired. Mirrors `DEFAULT_PREPARE_TIMEOUT_MS`'s
 * exact reasoning: a repository restore of a large app data root is slow, and
 * cutting it off early turns a slow recovery into a failed one — strictly
 * worse than waiting. Default 30 minutes (research R12), operator-overridable.
 */
export const DEFAULT_RESTORE_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export function restoreRequestTimeoutMs(): number {
  const raw = process.env.HOLA_RESTORE_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_RESTORE_REQUEST_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RESTORE_REQUEST_TIMEOUT_MS;
}

/**
 * How long a TERMINAL record is kept before pruning drops it (#502).
 *
 * Chosen the way `DEFAULT_PREPARE_TIMEOUT_MS` is — against the thing it must
 * not cut short. That constant's constraint is a machine's (a restic run still
 * reading a dump); this one's is a person's. Once a request is terminal the
 * only remaining reader is an operator asking what happened: which provider
 * was asked, for which capture, and why it failed. A restore that fails at
 * 02:00 is read over coffee, so the window has to survive a night and a
 * working day — twenty-four hours does, with room, while still bounding a file
 * the provider poll re-parses every couple of seconds.
 *
 * It is deliberately far longer than `DEFAULT_RESTORE_REQUEST_TIMEOUT_MS`
 * (30 minutes), which bounds how long a record stays ACTIONABLE. Retention
 * begins where that ends: nothing may be pruned while it can still be claimed,
 * completed, or waited on.
 */
export const TERMINAL_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface RestoreRequestRecord {
  id: string;
  /** The consented `restore@1` provider deployment that must serve this request. */
  providerDeploymentId: string;
  /** The install waiting on it. */
  targetDeploymentId: string;
  targetAppId: string;
  /** The chosen `RestoreIndexEntry.captureId`. */
  captureId: string;
  /** Absolute path under the staging root, server-minted — never the provider's. */
  destination: string;
  status: RestoreRequestStatus;
  createdAt: string;
  deadlineAt: string;
  claimedAt?: string;
  completedAt?: string;
  /** Set on 'failed' (provider-reported) or 'expired' (server-set, names the provider). */
  failureReason?: string;
}

export type RestoreRequestStore = Record<string, RestoreRequestRecord>;

/** Whether `record` is past its deadline and still open (`pending`/`claimed`). */
export function isRestoreRequestExpired(record: RestoreRequestRecord, now = Date.now()): boolean {
  if (record.status !== 'pending' && record.status !== 'claimed') return false;
  const deadline = Date.parse(record.deadlineAt);
  // An unparseable deadline means a corrupt record; the safe reading is "we
  // don't know when this expires", so treat it as already expired rather than
  // leaving an install waiting on a request that can never resolve.
  if (Number.isNaN(deadline)) return true;
  return now >= deadline;
}

/** A request no further transition can move — `pendingFor`/`get` never touch it again. */
export function isTerminalRestoreRequest(record: RestoreRequestRecord): boolean {
  return record.status === 'completed' || record.status === 'failed' || record.status === 'expired';
}

/**
 * When a terminal record actually became terminal. `completedAt` is written by
 * the provider's complete/fail call; an expiry is recorded by flipping the
 * status alone, so the moment it became terminal is the deadline it blew.
 * `createdAt` is the last resort for a record from neither path.
 */
function terminalAtMs(record: RestoreRequestRecord): number {
  const raw = record.completedAt ?? (record.status === 'expired' ? record.deadlineAt : undefined) ?? record.createdAt;
  return Date.parse(raw);
}

/**
 * Drop terminal records nothing can still need (#502). Pure — the store's own
 * methods apply it under their lock; this is the whole rule in one testable
 * place.
 *
 * Three things are never pruned, each because something can still read it:
 *
 *  - **A non-terminal record, at any age.** `pending`/`claimed` is a live
 *    request: the provider may still claim it, and the expiry path
 *    (`isRestoreRequestExpired`) still has to be the one that closes it.
 *    Deleting one would strand an install with no record to fail against.
 *  - **A record in `retain`.** The deploy job polls `get(requestId)` and reads
 *    `undefined` as "the provider never answered" (`RESTORE_PROVIDER_UNRESPONSIVE`).
 *    A `completed` record pruned in the couple of seconds between the provider
 *    reporting success and the job's next tick would fail a restore that
 *    worked, so a job that is still waiting pins its own record.
 *  - **The newest terminal record, at any age.** It is the only thing
 *    `brokerActivity` can derive "when a restore last finished, and whether it
 *    finished by expiring" from — `backup@1` keeps those facts in a
 *    single always-overwritten record, and here they live in the rows. Pruning
 *    the last one would make the dashboard report a host that restored last
 *    week as one that has never restored at all. Keeping one row is the whole
 *    cost of not lying about that.
 */
export function pruneTerminalRequests(
  store: RestoreRequestStore,
  options: { now?: number; retain?: ReadonlySet<string> } = {},
): { store: RestoreRequestStore; pruned: string[] } {
  const now = options.now ?? Date.now();

  let anchorId: string | undefined;
  let anchorAt = -Infinity;
  for (const [id, record] of Object.entries(store)) {
    if (!isTerminalRestoreRequest(record)) continue;
    const at = terminalAtMs(record);
    if (!Number.isNaN(at) && at > anchorAt) {
      anchorAt = at;
      anchorId = id;
    }
  }

  const pruned: string[] = [];
  const next: RestoreRequestStore = {};
  for (const [id, record] of Object.entries(store)) {
    const at = terminalAtMs(record);
    const keep =
      !isTerminalRestoreRequest(record) ||
      options.retain?.has(id) === true ||
      id === anchorId ||
      // An unparseable timestamp on an already-terminal record means a corrupt
      // row nothing can act on — the same fail-toward-cleanup reading
      // `isRestoreRequestExpired` takes of one it cannot date.
      (!Number.isNaN(at) && now - at < TERMINAL_RECORD_RETENTION_MS);
    if (keep) next[id] = record;
    else pruned.push(id);
  }

  return pruned.length > 0 ? { store: next, pruned } : { store, pruned };
}

/**
 * Reads and writes the request store. A missing or unparseable file reads as
 * empty rather than throwing — the broker must keep working through a corrupt
 * record, and losing one costs at worst one stuck-looking install, not a
 * crash.
 */
export class RestoreBrokerStateStore {
  private logger = getLogger().child({ service: 'RestoreBrokerState' });

  constructor(private storage: StorageService) {}

  /**
   * Serialises every read-modify-write against the store (spec 008, FR-028).
   *
   * Unlike `backup@1`'s single-record broker, several requests are open at
   * once here and two of them are reached by concurrent HTTP calls. A plain
   * `patch(await read())` then `await write(next)` yields at BOTH awaits, so
   * two interleaved claims each read `pending`, each write `claimed`, and
   * each conclude they won — the second write silently clobbering the first.
   * The claim is specified as exactly-once, so the window has to close.
   *
   * One promise chain is enough: every mutator runs in this process, and the
   * store is a single file this process owns.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Request ids a live deploy job is currently polling (#502). Pruning skips
   * them: see {@link pruneTerminalRequests}'s second rule — a job reads a
   * missing record as an unresponsive provider, so a record must outlive the
   * loop waiting on it even once it is terminal.
   *
   * In-memory, not persisted, and that is correct: it names jobs running in
   * THIS process, and a restart has no wait loop left to protect.
   */
  private readonly waitedOn = new Set<string>();

  /**
   * Pin `requestId` against pruning for as long as a deploy job is waiting on
   * it, and return the release the job calls when it stops waiting — whether
   * it saw a terminal record, gave up on the provider, or threw.
   */
  retainWhileWaiting(requestId: string): () => void {
    this.waitedOn.add(requestId);
    return () => {
      this.waitedOn.delete(requestId);
    };
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    // Never let a rejection poison the chain for the next caller.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async read(): Promise<RestoreRequestStore> {
    try {
      if (!(await this.storage.fileExists(STORE_PATH))) return {};
      return JSON.parse(await this.storage.readFileAsString(STORE_PATH)) as RestoreRequestStore;
    } catch (err) {
      this.logger.warn('Unreadable restore broker state; treating it as empty', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  async write(state: RestoreRequestStore): Promise<void> {
    try {
      await this.storage.writeFile(STORE_PATH, JSON.stringify(state, null, 2));
    } catch (err) {
      this.logger.warn('Could not persist restore broker state', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Read-modify-write, with pruning folded in (#502). Creating a request is
   * the only thing that ever GROWS this store, so applying retention on the
   * same call that grows it is what keeps the file bounded without a timer or
   * a sweep task of its own.
   */
  async update(patch: (current: RestoreRequestStore) => RestoreRequestStore): Promise<RestoreRequestStore> {
    return this.enqueue(async () => {
      const patched = patch(await this.read());
      const { store: next } = pruneTerminalRequests(patched, { retain: this.waitedOn });
      await this.write(next);
      return next;
    });
  }

  /**
   * Atomic compare-and-set on ONE record: re-read under the store's lock,
   * apply `next` only if `guard` still holds, and report whether it did.
   *
   * This is what makes a claim exactly-once (FR-028) — `applied: false` is
   * the losing caller's answer, and it is decided by the same read that
   * performed the write, not by a re-read afterwards (which cannot tell "I
   * claimed it" from "someone else just did").
   */
  async transition(
    requestId: string,
    guard: (record: RestoreRequestRecord) => boolean,
    next: (record: RestoreRequestRecord) => RestoreRequestRecord,
  ): Promise<{ applied: boolean; record?: RestoreRequestRecord }> {
    return this.enqueue(async () => {
      const store = await this.read();
      const current = store[requestId];
      if (!current) return { applied: false };
      if (!guard(current)) return { applied: false, record: current };
      const updated = next(current);
      await this.write({ ...store, [requestId]: updated });
      return { applied: true, record: updated };
    });
  }

  /** One record, re-evaluating expiry on read (research R11's dual guard: no timer required). */
  async get(requestId: string): Promise<RestoreRequestRecord | undefined> {
    return this.enqueue(async () => {
      const store = await this.read();
      const record = store[requestId];
      if (!record) return undefined;
      if (isRestoreRequestExpired(record)) {
        const expired: RestoreRequestRecord = { ...record, status: 'expired', failureReason: `Provider '${record.providerDeploymentId}' did not respond before the deadline.` };
        await this.write({ ...store, [requestId]: expired });
        return expired;
      }
      return record;
    });
  }

  /** Every `pending` record addressed to `providerDeploymentId`, expiry-checked. */
  async pendingFor(providerDeploymentId: string): Promise<RestoreRequestRecord[]> {
    return this.enqueue(() => this.pendingForLocked(providerDeploymentId));
  }

  private async pendingForLocked(providerDeploymentId: string): Promise<RestoreRequestRecord[]> {
    const store = await this.read();
    const out: RestoreRequestRecord[] = [];
    let dirty = false;
    const expired: RestoreRequestStore = { ...store };
    for (const [id, record] of Object.entries(store)) {
      if (record.providerDeploymentId !== providerDeploymentId) continue;
      if (isRestoreRequestExpired(record)) {
        expired[id] = { ...record, status: 'expired', failureReason: `Provider '${record.providerDeploymentId}' did not respond before the deadline.` };
        dirty = true;
        continue;
      }
      if (record.status === 'pending') out.push(record);
    }
    // The poll tick is the one call that happens on a host doing nothing else,
    // and it is the call that pays for the file's size (a full parse roughly
    // every two seconds), so it also collects (#502). Expiry runs first: a
    // request that just aged out becomes terminal here, and its retention is
    // measured from the deadline it blew, not from this tick.
    const { store: next, pruned } = pruneTerminalRequests(expired, { retain: this.waitedOn });
    if (dirty || pruned.length > 0) await this.write(next);
    return out;
  }
}
