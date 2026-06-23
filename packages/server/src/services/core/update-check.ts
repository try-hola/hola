/**
 * Update-availability check.
 *
 * The newest published Hola version is the latest `cli-v*` release of
 * `try-hola/hola`. To keep many clients (web dashboard + every CLI talking to the
 * host) from each hitting GitHub — and to make a single outbound call from the
 * host — the server performs the check and caches the result with a TTL. The web
 * banner and `hola update --check` both read this one cached answer.
 *
 * The check is fail-safe: any network/parse/rate-limit error resolves to
 * `{ latest: null, updateAvailable: false }` so the dashboard never shows a false
 * "update available" and never errors on an offline host.
 */

import { isNewerVersion, type UpdateCheckResult } from '@hola/shared';
import { getLogger } from '../../lib/logger';
import { getHolaVersion } from './system-monitoring';

export interface UpdateCheckService {
  /** Current version, newest release, and whether an upgrade is available. */
  check(): Promise<UpdateCheckResult>;
}

/** GitHub releases for the repo Hola ships from. */
const RELEASES_API = 'https://api.github.com/repos/try-hola/hola/releases?per_page=30';
/** Cache TTL — releases are infrequent and we never want to hammer the API. */
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Bound the outbound call so a slow/hung GitHub never blocks the endpoint. */
const FETCH_TIMEOUT_MS = 5000;

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

/**
 * Real implementation: cached GitHub lookup. `fetchImpl` and `now` are injectable
 * so tests can drive the cache and the network without real I/O.
 */
export class RealUpdateCheckService implements UpdateCheckService {
  private logger = getLogger().child({ service: 'UpdateCheckService' });
  private cache: { value: UpdateCheckResult; expires: number } | null = null;

  constructor(
    private readonly current: string = getHolaVersion(),
    private readonly opts: {
      ttlMs?: number;
      fetchImpl?: typeof fetch;
      now?: () => number;
    } = {},
  ) {}

  async check(): Promise<UpdateCheckResult> {
    const now = (this.opts.now ?? Date.now)();
    if (this.cache && this.cache.expires > now) {
      return this.cache.value;
    }

    const result = await this.fetchLatest();
    const ttl = this.opts.ttlMs ?? DEFAULT_TTL_MS;
    this.cache = { value: result, expires: now + ttl };
    return result;
  }

  private async fetchLatest(): Promise<UpdateCheckResult> {
    const fail = (reason: string, err?: unknown): UpdateCheckResult => {
      this.logger.debug('Update check unavailable', { reason, error: err instanceof Error ? err.message : err });
      return { current: this.current, latest: null, updateAvailable: false, releaseUrl: null };
    };

    try {
      const doFetch = this.opts.fetchImpl ?? fetch;
      const res = await doFetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'hola-server' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return fail(`HTTP ${res.status}`);

      const releases = (await res.json()) as GitHubRelease[];
      if (!Array.isArray(releases)) return fail('unexpected payload');

      // Only stable `cli-v*` releases count (skip drafts and prereleases). Pick the
      // newest by version, not by list order, so the answer is order-independent.
      let best: { version: string; url: string } | null = null;
      for (const r of releases) {
        if (r.draft || r.prerelease) continue;
        if (typeof r.tag_name !== 'string' || !r.tag_name.startsWith('cli-v')) continue;
        const version = r.tag_name.slice('cli-v'.length);
        if (!best || isNewerVersion(version, best.version)) {
          best = { version, url: r.html_url };
        }
      }
      if (!best) return fail('no stable cli-v release found');

      return {
        current: this.current,
        latest: best.version,
        updateAvailable: isNewerVersion(best.version, this.current),
        releaseUrl: best.url,
      };
    } catch (err) {
      return fail('fetch failed', err);
    }
  }
}

/** Mock for test/dev: no network. Defaults to "up to date"; override via constructor. */
export class MockUpdateCheckService implements UpdateCheckService {
  constructor(private readonly result?: Partial<UpdateCheckResult>) {}

  async check(): Promise<UpdateCheckResult> {
    return {
      current: '1.0.0',
      latest: '1.0.0',
      updateAvailable: false,
      releaseUrl: null,
      ...this.result,
    };
  }
}
