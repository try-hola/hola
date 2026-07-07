import React, { useEffect, useRef } from 'react';
import { CheckCircle, X } from 'lucide-react';

interface TransientNoticeProps {
  message: string;
  /** Auto-dismiss delay in ms. */
  duration?: number;
  onDismiss?: () => void;
}

/**
 * A minimal transient banner for one-shot notices (e.g. "App X was removed"
 * after a deployment is deleted elsewhere — spec.md User Story 2 / research.md
 * R9). Mirrors `UpdateAvailableBanner`'s surface/border/icon conventions.
 * Auto-dismisses after `duration` (default 5s); also manually dismissible.
 */
export const TransientNotice: React.FC<TransientNoticeProps> = ({ message, duration = 5000, onDismiss }) => {
  // Keep the latest onDismiss in a ref so the auto-dismiss timer is armed exactly
  // once per mount. Callers typically pass an inline `() => setNotice(null)` whose
  // identity changes every parent render; depending on it directly would re-arm a
  // fresh timeout on each re-render (e.g. while the deployments list polls a
  // transitional app faster than `duration`), so the banner would never auto-dismiss.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current?.(), duration);
    return () => clearTimeout(timer);
  }, [duration]);

  return (
    <div className="animate-fadein flex items-center gap-3 px-4 py-3 mb-4 bg-surface-1 border border-border rounded-card text-[13px]">
      <CheckCircle className="w-[18px] h-[18px] flex-none text-success" />
      <div className="min-w-0 flex-1 text-text-strong">{message}</div>
      <button
        onClick={() => onDismiss?.()}
        aria-label="Dismiss notice"
        className="w-7 h-7 flex-none flex items-center justify-center rounded-[7px] text-text-muted cursor-pointer hover:text-text-strong hover:bg-surface-2 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
