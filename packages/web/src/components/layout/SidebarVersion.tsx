import React from 'react';
import { Link } from 'react-router-dom';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

interface SidebarVersionProps {
  isCollapsed: boolean;
}

/**
 * The running Hola version, shown at the foot of the sidebar so an operator can
 * always tell what's deployed without digging into Settings (which is where the
 * link goes for the fuller system status).
 *
 * The version comes from the update-check endpoint — it reports the running
 * version alongside the newest release, is cached server-side for an hour, and is
 * fail-safe when the host is offline (so `current` is still populated). That's a
 * far cheaper read than /api/system/status, which shells out to docker/oras.
 */
export const SidebarVersion: React.FC<SidebarVersionProps> = ({ isCollapsed }) => {
  const { data } = useUpdateCheck();

  // Nothing to show until the version is known (or if the request failed).
  if (!data?.current) return null;

  const title = data.updateAvailable && data.latest
    ? `Hola v${data.current} — v${data.latest} is available`
    : `Hola v${data.current}`;

  return (
    <Link
      to="/settings"
      title={title}
      className={`flex items-center gap-2 ${
        isCollapsed ? 'justify-center px-1' : 'px-[11px]'
      } py-[7px] rounded-[9px] text-[12px] text-text-muted hover:bg-surface-2 hover:text-text-strong transition-colors`}
    >
      {isCollapsed ? (
        // Icon-rail width is tight: truncate long versions (e.g. "0.9.0-rc.1")
        // and lean on the tooltip. An available update just tints the text.
        <span
          className={`font-mono text-[10px] leading-none truncate ${
            data.updateAvailable ? 'text-warning' : ''
          }`}
        >
          {data.current}
        </span>
      ) : (
        <>
          <span className="font-mono truncate">v{data.current}</span>
          {data.updateAvailable && (
            <span className="flex-none ml-auto text-[11px] font-medium text-warning">Update</span>
          )}
        </>
      )}
    </Link>
  );
};
