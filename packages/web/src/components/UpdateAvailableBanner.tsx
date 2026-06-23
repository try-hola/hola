import React, { useState } from 'react';
import { ArrowUpCircle, ExternalLink, X } from 'lucide-react';
import { useUpdateCheck } from '../hooks/useUpdateCheck';

/**
 * Dismissible banner shown when the server reports an available Hola update.
 * Points operators at the CLI (`hola update`) — there is no in-app update action.
 * Dismissal is session-only (local state, not persisted).
 */
export const UpdateAvailableBanner: React.FC = () => {
  const { data } = useUpdateCheck();
  const [dismissed, setDismissed] = useState(false);

  if (!data?.updateAvailable || dismissed) return null;

  return (
    <div className="flex-none flex items-center gap-3 px-[22px] py-[10px] border-b border-warning/30 bg-warning/10 text-[13px]">
      <ArrowUpCircle className="w-[18px] h-[18px] flex-none text-warning" />
      <div className="min-w-0 flex-1 text-text-strong">
        <span className="font-semibold">Hola {data.latest}</span> is available — you&rsquo;re on{' '}
        <span className="font-mono text-text-muted">{data.current}</span>. Update with{' '}
        <code className="font-mono text-[12px] px-[5px] py-px bg-surface-2 border border-border rounded-[5px]">
          hola update --host …
        </code>
      </div>

      {data.releaseUrl && (
        <a
          href={data.releaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:inline-flex items-center gap-[6px] flex-none text-warning hover:underline font-medium"
        >
          View release
          <ExternalLink className="w-[14px] h-[14px]" />
        </a>
      )}

      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update notification"
        className="w-7 h-7 flex-none flex items-center justify-center rounded-[7px] text-text-muted cursor-pointer hover:text-text-strong hover:bg-surface-2 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
