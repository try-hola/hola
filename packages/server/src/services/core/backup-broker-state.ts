/**
 * What the `backup@1` broker remembers between calls (ADR 0004 §6).
 *
 * The broker is a two-call protocol: the provider says `prepare` (every
 * acceptor's `preHook` runs — a `pg_dump` lands in each app's data root), the
 * provider captures, the provider says `finalize` (every `postHook` runs — the
 * dumps are removed). Between those two calls acceptors are holding state on
 * disk that only the second call releases.
 *
 * Nothing released it if the second call never came. A provider that crashed,
 * was killed mid-capture, or lost the network after `prepare` left a dump in
 * every accepting app's data root — and, because those roots are exactly what
 * the *next* backup captures, that stale dump was then copied into every
 * subsequent snapshot, silently, looking like a real one. ADR 0004 §6 has always
 * required "a per-contract timeout after which `finalize` runs regardless", and
 * backrest's own shipped hook script tells its reader the server applies one.
 * Until #472 the server did not.
 *
 * So the broker keeps one small record per host. It answers two questions:
 *
 * - **Is a prepare still open, and for how long?** Past the timeout the server
 *   finalizes on the provider's behalf. Cheaper and more honest than leaving
 *   dumps for a caller that may never return.
 * - **When did a provider last actually announce a backup?** An install that
 *   declares `provides: backup@1` makes the dashboard report every accepting app
 *   as covered — from the declaration alone. Whether the provider has ever *used*
 *   the contract is a different fact, and for a long time it was the one that
 *   mattered: try-hola/apps#159 shipped a provider whose hooks were never
 *   registered, so it never called the broker at all, while the dashboard said
 *   everything was quiesced. This record is what lets the rollup tell the
 *   operator "installed, and has never announced a backup".
 *
 * One record, not one per provider: a contract has one provider per host
 * (`assertProviderAllowed`), so "the open prepare" is unambiguous.
 */

import { getLogger } from '../../lib/logger';
import type { StorageService } from './storage';

const STORE_PATH = 'config/backup-broker.json';

/**
 * How long a prepare may stay open before the server finalizes it on the
 * provider's behalf.
 *
 * 30 minutes is chosen against the thing it must not interrupt: a restic run
 * over a large apps root. Finalizing early would delete a dump the provider is
 * still reading, which turns a slow backup into a corrupt one — strictly worse
 * than the leak this exists to stop. So the default is generous, and the
 * override exists for hosts where it isn't.
 */
export const DEFAULT_PREPARE_TIMEOUT_MS = 30 * 60 * 1000;

export function prepareTimeoutMs(): number {
  const raw = process.env.HOLA_BACKUP_PREPARE_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PREPARE_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PREPARE_TIMEOUT_MS;
}

export interface BackupBrokerState {
  /** ISO time the last prepare COMPLETED (its pre-hooks all ran), if ever. */
  lastPrepareAt?: string;
  /** ISO time the last finalize ran, whoever ran it. */
  lastFinalizeAt?: string;
  /**
   * ISO time the currently-open prepare completed. Set alongside
   * `lastPrepareAt` and cleared by finalize — present means acceptors are
   * holding dumps right now.
   */
  openSince?: string;
  /** Job id of the open prepare, for the log line when it expires. */
  openJobId?: string;
  /** True when the last finalize was the server expiring a stranded prepare. */
  lastFinalizeWasExpiry?: boolean;
}

/** Whether `state` has a prepare open past `timeoutMs`. */
export function isPrepareExpired(state: BackupBrokerState, timeoutMs: number, now = Date.now()): boolean {
  if (!state.openSince) return false;
  const openedAt = Date.parse(state.openSince);
  // An unparseable timestamp means a corrupt record, and the safe reading of
  // "we don't know when this opened" is "long enough" — leaving dumps forever
  // is the failure this file exists to prevent.
  if (Number.isNaN(openedAt)) return true;
  return now - openedAt >= timeoutMs;
}

/**
 * Reads and writes the one record. A missing or unparseable file reads as empty
 * rather than throwing: the broker must keep working through a corrupt record,
 * and the cost of forgetting one is at worst a dump cleaned up one backup later.
 */
export class BackupBrokerStateStore {
  private logger = getLogger().child({ service: 'BackupBrokerState' });

  constructor(private storage: StorageService) {}

  async read(): Promise<BackupBrokerState> {
    try {
      if (!(await this.storage.fileExists(STORE_PATH))) return {};
      return JSON.parse(await this.storage.readFileAsString(STORE_PATH)) as BackupBrokerState;
    } catch (err) {
      this.logger.warn('Unreadable backup broker state; treating it as empty', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  async write(state: BackupBrokerState): Promise<void> {
    try {
      await this.storage.writeFile(STORE_PATH, JSON.stringify(state, null, 2));
    } catch (err) {
      // Losing the record costs bookkeeping, never correctness of the hooks
      // themselves — so it must not fail the backup the provider is mid-way
      // through announcing.
      this.logger.warn('Could not persist backup broker state', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async update(patch: (current: BackupBrokerState) => BackupBrokerState): Promise<BackupBrokerState> {
    const next = patch(await this.read());
    await this.write(next);
    return next;
  }
}
