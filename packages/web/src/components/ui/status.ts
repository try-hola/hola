/**
 * Single source of truth for status → colour/label across the dashboard
 * (deployment, job and backup statuses). Pages call `statusMeta()` directly, or
 * render `<StatusBadge>` / `<StatusDot>` (which build on it), rather than
 * re-deriving these maps.
 */
export interface StatusMeta {
  label: string;
  /** A CSS-variable colour token (theme-aware). */
  color: string;
  /** A CSS-variable background token (theme-aware). */
  bg: string;
  /** Whether to render an animated "live" dot. */
  live?: boolean;
}

const STATUS: Record<string, StatusMeta> = {
  // deployment
  running: { label: 'Running', color: 'var(--success)', bg: 'var(--success-weak)', live: true },
  installing: { label: 'Installing', color: 'var(--info)', bg: 'var(--info-weak)', live: true },
  updating: { label: 'Updating', color: 'var(--info)', bg: 'var(--info-weak)', live: true },
  stopped: { label: 'Stopped', color: 'var(--muted)', bg: 'var(--s2)' },
  error: { label: 'Error', color: 'var(--danger)', bg: 'var(--danger-weak)' },
  // job
  completed: { label: 'Completed', color: 'var(--success)', bg: 'var(--success-weak)' },
  failed: { label: 'Failed', color: 'var(--danger)', bg: 'var(--danger-weak)' },
  queued: { label: 'Queued', color: 'var(--warn)', bg: 'var(--warn-weak)' },
  pending: { label: 'Pending', color: 'var(--warn)', bg: 'var(--warn-weak)' },
  success: { label: 'Success', color: 'var(--success)', bg: 'var(--success-weak)' },
};

/** Resolve any status string to its display metadata (with a safe fallback). */
export function statusMeta(status: string): StatusMeta {
  return (
    STATUS[status] || {
      label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown',
      color: 'var(--muted)',
      bg: 'var(--s2)',
    }
  );
}
