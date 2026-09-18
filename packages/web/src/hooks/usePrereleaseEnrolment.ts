import { useSettingsApi } from './useSettingsApi';

/**
 * Whether this operator has enrolled in seeing pre-release (beta/rc) channels.
 *
 * Backed by the shared, cached `useSettingsApi()` read. Fails closed: returns
 * `false` while the settings read is loading and `false` when `data` is
 * `null`/absent (including after a fetch error) — never throws, and never
 * returns `true` unless `channels.showPrerelease` is explicitly `true`.
 */
export function usePrereleaseEnrolment(): boolean {
  const { data, loading } = useSettingsApi();

  if (loading || !data) {
    return false;
  }

  return data.channels?.showPrerelease === true;
}
