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

  async update(patch: (current: RestoreRequestStore) => RestoreRequestStore): Promise<RestoreRequestStore> {
    return this.enqueue(async () => {
      const next = patch(await this.read());
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
    const next: RestoreRequestStore = { ...store };
    for (const [id, record] of Object.entries(store)) {
      if (record.providerDeploymentId !== providerDeploymentId) continue;
      if (isRestoreRequestExpired(record)) {
        next[id] = { ...record, status: 'expired', failureReason: `Provider '${record.providerDeploymentId}' did not respond before the deadline.` };
        dirty = true;
        continue;
      }
      if (record.status === 'pending') out.push(record);
    }
    if (dirty) await this.write(next);
    return out;
  }
}
