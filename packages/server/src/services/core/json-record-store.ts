/**
 * The persistence mechanism both brokered-contract state stores use (#497):
 * a JSON record under the server's own data directory, read fail-open and
 * written warn-only.
 *
 * Deliberately NOT a shared base class for those stores. #497 set the trigger
 * for generalising the broker-state *model* at a third store, and there are
 * two — `BackupBrokerStateStore` holds one record per host because a capture
 * has one open operation at a time, while `RestoreBrokerStateStore` is keyed
 * by request id with a serialising lock and retention pruning. Those are
 * different models and two data points is not enough to know where the
 * boundary belongs.
 *
 * What IS identical between them, character for character apart from a log
 * string, is `read()` and `write()`. This is that, and only that. Each store
 * composes one and keeps its own `update()`, locking, expiry and query methods
 * entirely to itself, so extracting this prejudges nothing about the model.
 *
 * The two policies are the load-bearing part, and both are deliberate:
 *
 *  - **Read fails open to `{}`.** A missing file is the first-run case, and an
 *    unreadable one must not wedge the broker: the record is bookkeeping, and
 *    refusing to proceed without it would turn a corrupt file into an outage.
 *    Each caller's own expiry rule then decides what an empty record means —
 *    `isPrepareExpired` reads an unparseable timestamp as expired precisely so
 *    that failing open here cannot leave a dump on disk forever.
 *  - **Write warns rather than throws.** Losing the record costs bookkeeping,
 *    never the correctness of the operation the provider is mid-way through
 *    announcing. A failed write must not fail that operation.
 */

import { getLogger } from '../../lib/logger';
import type { StorageService } from './storage';

export class JsonRecordStore<T extends object> {
  private logger;

  constructor(
    private storage: StorageService,
    private opts: {
      /** Path under the server's data directory, e.g. `config/backup-broker.json`. */
      path: string;
      /** Names this store in its own log lines, e.g. `backup broker state`. */
      label: string;
      /** Service name for the child logger, e.g. `BackupBrokerState`. */
      service: string;
    },
  ) {
    this.logger = getLogger().child({ service: opts.service });
  }

  /** The stored record, or `{}` when absent or unreadable (see the header). */
  async read(): Promise<T> {
    try {
      if (!(await this.storage.fileExists(this.opts.path))) return {} as T;
      return JSON.parse(await this.storage.readFileAsString(this.opts.path)) as T;
    } catch (err) {
      this.logger.warn(`Unreadable ${this.opts.label}; treating it as empty`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return {} as T;
    }
  }

  /** Persist the record. A failure is reported, never thrown (see the header). */
  async write(state: T): Promise<void> {
    try {
      await this.storage.writeFile(this.opts.path, JSON.stringify(state, null, 2));
    } catch (err) {
      this.logger.warn(`Could not persist ${this.opts.label}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
