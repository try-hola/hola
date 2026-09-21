/**
 * What the `restore@1` provider half remembers about a published snapshot
 * index (spec 008, data-model.md §3c).
 *
 * A restore provider periodically publishes what it holds — metadata only, no
 * captured bytes (FR-022). The index is a CACHE, never a promise: it is not
 * re-validated on read, so a capture named here but pruned from the
 * provider's own repository since publication fails at claim/delivery time,
 * not at listing time (research R13). Keyed by the PUBLISHING provider's
 * deployment id (not a single record — unlike `backup-broker-state.ts`, more
 * than one entry set could theoretically exist across a provider's lifetime,
 * and uninstall/revoke cleanup needs to target exactly one publisher's rows).
 */

import { getLogger } from '../../lib/logger';
import type { StorageService } from './storage';
import type { RestoreIndexEntry } from '@hola/shared';

const STORE_PATH = 'config/restore-index.json';

export interface RestoreIndexPublication {
  publishedAt: string;
  entries: RestoreIndexEntry[];
}

export type RestoreIndexFile = Record<string, RestoreIndexPublication>;

export class RestoreIndexStore {
  private logger = getLogger().child({ service: 'RestoreIndexStore' });

  constructor(private storage: StorageService) {}

  private async read(): Promise<RestoreIndexFile> {
    try {
      if (!(await this.storage.fileExists(STORE_PATH))) return {};
      return JSON.parse(await this.storage.readFileAsString(STORE_PATH)) as RestoreIndexFile;
    } catch (err) {
      this.logger.warn('Unreadable restore index; treating it as empty', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  private async write(file: RestoreIndexFile): Promise<void> {
    try {
      await this.storage.writeFile(STORE_PATH, JSON.stringify(file, null, 2));
    } catch (err) {
      this.logger.warn('Could not persist restore index', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Replace `providerDeploymentId`'s index WHOLESALE — never merged (FR-024). */
  async publish(providerDeploymentId: string, entries: RestoreIndexEntry[]): Promise<void> {
    const file = await this.read();
    file[providerDeploymentId] = { publishedAt: new Date().toISOString(), entries };
    await this.write(file);
  }

  /** Every entry the given provider has published, or `[]` if none. */
  async entriesFor(providerDeploymentId: string): Promise<RestoreIndexEntry[]> {
    const file = await this.read();
    return file[providerDeploymentId]?.entries ?? [];
  }

  /** Whether ANY index has ever been published for this provider (FR-034's `reindex` signal). */
  async hasPublished(providerDeploymentId: string): Promise<boolean> {
    const file = await this.read();
    return providerDeploymentId in file;
  }

  /** One entry by capture id, or `undefined` if the index no longer names it. */
  async entryFor(providerDeploymentId: string, captureId: string): Promise<RestoreIndexEntry | undefined> {
    const entries = await this.entriesFor(providerDeploymentId);
    return entries.find((e) => e.captureId === captureId);
  }

  /** Discard a provider's index entirely (uninstall, or `restore@1` consent revoked — FR-025a). */
  async discard(providerDeploymentId: string): Promise<void> {
    const file = await this.read();
    if (!(providerDeploymentId in file)) return;
    delete file[providerDeploymentId];
    await this.write(file);
  }
}

// ---------------------------------------------------------------------------
// Publish-time validation (spec 008, FR-022/SC-002)
// ---------------------------------------------------------------------------

/** Upper bound on one publish, so a metadata-only route stays metadata-only. */
export const MAX_RESTORE_INDEX_ENTRIES = 5000;

/** Upper bound on any single provider-supplied string this route persists. */
export const MAX_RESTORE_INDEX_STRING = 1024;

/**
 * A capture id is interpolated into a candidate id
 * (`<providerDeploymentId>:<captureId>`) that every downstream surface parses,
 * and a candidate id has historically been a bare deployment id — a value the
 * server itself minted. Constraining it to an opaque, separator-free token
 * HERE, at the one point it enters the system, is what keeps it from being
 * trusted as a path component further down. A provider that wants structure
 * puts it in `location`, which is never used as a path component on this host.
 */
const RESTORE_CAPTURE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Whether a published index entry carries every field data-model.md §3b
 * declares, in the right shape — no field of any type could carry a byte
 * stream (FR-022, SC-002). Malformed entries refuse the WHOLE publish; the
 * previously published index is left untouched (FR-024's own guard, never a
 * partial merge).
 */
export function isWellFormedRestoreIndexEntry(entry: unknown): entry is RestoreIndexEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.captureId !== 'string' || !RESTORE_CAPTURE_ID_RE.test(e.captureId) || e.captureId.includes('..')) return false;
  if (typeof e.takenAt !== 'string' || Number.isNaN(Date.parse(e.takenAt))) return false;
  if (typeof e.sizeBytes !== 'number' || !Number.isFinite(e.sizeBytes) || e.sizeBytes < 0) return false;
  if (typeof e.location !== 'string' || e.location.trim().length === 0 || e.location.length > MAX_RESTORE_INDEX_STRING) return false;
  // `typeof [] === 'object'`, so an array would otherwise pass and be stored;
  // every downstream `identity?.app` read then yields undefined and the
  // capture is quietly offered as inference-identified instead of refused.
  if (e.identity !== null && (typeof e.identity !== 'object' || Array.isArray(e.identity))) return false;
  return true;
}
