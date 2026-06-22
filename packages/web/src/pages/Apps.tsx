import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Package, Plus, Search, SlidersHorizontal } from 'lucide-react';

import { useDeploymentsApi } from '../hooks/useDeploymentsApi';
import { AppIcon } from '../components/ui/AppIcon';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { GetDeploymentsRequest } from '@hola/shared';

/**
 * Apps — the default landing: an Okta/Entra-style launcher for installed apps.
 *
 * The job here is *launch*, not manage. Running apps are full-colour tiles that
 * open the app in a new tab; everything technical (logs, lifecycle, config) lives
 * on the Deployments page. Non-running apps are dimmed and route to their
 * deployment detail so a tile is never a dead end, and every running tile keeps a
 * subtle "manage" shortcut to its detail for troubleshooting.
 *
 * The name and icon are persisted on the deployment at install (seeded from the
 * catalog), so this renders from the deployments list alone — no live catalog
 * join, and it keeps working if the catalog is unreachable.
 */

const DEPLOYMENTS_PARAMS: GetDeploymentsRequest = { page: 1, limit: 100 };

export const Apps: React.FC = () => {
  const { data: deploymentsData, loading, error } = useDeploymentsApi(DEPLOYMENTS_PARAMS);
  const [query, setQuery] = React.useState('');

  const apps = React.useMemo(() => deploymentsData?.items ?? [], [deploymentsData]);
  const runningCount = React.useMemo(
    () => apps.filter((a) => a.status === 'running').length,
    [apps],
  );

  // Client-side filter over the app name and id.
  const visibleApps = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) => a.name.toLowerCase().includes(q) || a.app.toLowerCase().includes(q));
  }, [apps, query]);

  return (
    <div className="animate-fadein">
      <div className="flex items-end gap-3.5 mb-[22px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Your apps</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            {apps.length === 0
              ? 'Nothing installed yet.'
              : `${runningCount} running · ${apps.length} installed`}
          </p>
        </div>
        <div className="flex-1" />
        {apps.length > 0 && (
          <div className="relative flex items-center">
            <span className="absolute left-[11px] flex text-text-faint">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="Search apps…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-56 bg-surface-1 border border-border rounded-[10px] text-text-strong pl-[34px] pr-3 text-[13.5px] outline-none focus:border-primary"
            />
          </div>
        )}
        <Link
          to="/catalog"
          className="flex items-center gap-2 h-10 px-4 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 transition"
        >
          <Plus className="w-[18px] h-[18px]" />
          <span>Install app</span>
        </Link>
      </div>

      {loading && apps.length === 0 && <div className="text-text-muted text-sm">Loading apps…</div>}

      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm">
          Could not load apps: {error}
        </div>
      )}

      {!loading && !error && visibleApps.length > 0 && (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {visibleApps.map((app) => {
            // Name + icon are persisted on the deployment at install (seeded from
            // the catalog), falling back to the app id for older records.
            const icon = app.icon || '';
            const displayName = app.name || app.app;
            const openable = app.status === 'running' && !!app.url;

            return (
              <div
                key={app.id}
                className={`group relative flex flex-col items-center text-center bg-surface-1 border border-border rounded-[14px] px-4 pt-[26px] pb-5 transition hover:-translate-y-[3px] hover:border-primary hover:shadow-elevation-4 ${
                  openable ? '' : 'opacity-70 hover:opacity-100'
                }`}
              >
                {/* Stretched primary action: launch when running, else go to detail.
                    A sibling (not nested) of the manage link below, so the HTML
                    stays valid while the whole tile is clickable. */}
                {openable ? (
                  <a
                    href={app.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open ${displayName}`}
                    title={`Open ${displayName}`}
                    className="absolute inset-0 z-[1] rounded-[14px]"
                  />
                ) : (
                  <Link
                    to={`/deployments/${app.id}`}
                    aria-label={`${displayName} — view deployment`}
                    title={`${displayName} — view deployment`}
                    className="absolute inset-0 z-[1] rounded-[14px]"
                  />
                )}

                {/* Manage shortcut (running tiles only — non-running tiles already
                    route to the detail). Sits above the stretched link. */}
                {openable && (
                  <Link
                    to={`/deployments/${app.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Manage & logs"
                    aria-label={`Manage ${displayName}`}
                    className="absolute top-2.5 right-2.5 z-[2] w-7 h-7 flex items-center justify-center rounded-[8px] text-text-faint opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary-weak transition"
                  >
                    <SlidersHorizontal className="w-[15px] h-[15px]" />
                  </Link>
                )}
                {openable && (
                  <ExternalLink className="absolute top-2.5 left-2.5 w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 group-hover:text-primary transition" />
                )}

                <AppIcon name={displayName} emoji={icon} size={60} />
                <div className="mt-3.5 font-semibold text-[14.5px] leading-tight truncate max-w-full">
                  {displayName}
                </div>
                <div className="mt-2 min-h-[24px] flex items-center">
                  {openable ? (
                    <span className="text-[12.5px] text-text-faint">Open</span>
                  ) : (
                    <StatusBadge status={app.status} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* No results for the current search (but apps do exist). */}
      {!loading && !error && apps.length > 0 && visibleApps.length === 0 && (
        <div className="px-5 py-16 text-center text-text-muted text-sm bg-surface-1 border border-dashed border-border rounded-[14px]">
          No apps match “{query}”.
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center px-5 py-20 bg-surface-1 border border-dashed border-border rounded-[14px]">
          <div className="w-16 h-16 rounded-2xl bg-primary-weak text-primary flex items-center justify-center mb-[18px]">
            <Package className="w-8 h-8" />
          </div>
          <h2 className="m-0 text-[19px] font-semibold">No apps installed yet</h2>
          <p className="mt-2 mb-5 text-text-muted text-sm max-w-[380px]">
            Browse the catalog to install your first app. Pick something, configure it, and Hola
            brings it up at its own subdomain.
          </p>
          <Link
            to="/catalog"
            className="flex items-center gap-2 h-[42px] px-[18px] bg-primary text-white rounded-[10px] text-sm font-semibold"
          >
            <Plus className="w-[18px] h-[18px]" /> Browse the catalog
          </Link>
        </div>
      )}
    </div>
  );
};

export default Apps;
