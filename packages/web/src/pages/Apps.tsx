import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Package, Plus } from 'lucide-react';

import { useDeploymentsApi } from '../hooks/useDeploymentsApi';
import { useCatalogAppsApi } from '../hooks/useCatalogApi';
import { AppIcon } from '../components/ui/AppIcon';
import { StatusBadge } from '../components/ui/StatusBadge';
import type { GetDeploymentsRequest } from '@hola/shared';

/**
 * Apps — the default landing: a launcher for installed apps.
 *
 * Everything here is data the server already owns (deployments + the catalog for
 * icons), joined client-side — no separate dashboard app to keep in sync. Every
 * installed app is shown: running apps with a URL open in a new tab; the rest
 * link to their deployment detail so a tile is never a dead end.
 */

const DEPLOYMENTS_PARAMS: GetDeploymentsRequest = { page: 1, limit: 100 };
const CATALOG_PARAMS = { page: 1, limit: 100 };

export const Apps: React.FC = () => {
  const { data: deploymentsData, loading, error } = useDeploymentsApi(DEPLOYMENTS_PARAMS);
  const { data: catalogData } = useCatalogAppsApi(CATALOG_PARAMS);

  // Join app id -> catalog icon so tiles show the real app glyph, not a fallback.
  const iconByApp = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const app of catalogData?.items ?? []) map.set(app.id, app.icon);
    return map;
  }, [catalogData]);

  const apps = React.useMemo(() => deploymentsData?.items ?? [], [deploymentsData]);
  const runningCount = React.useMemo(
    () => apps.filter((a) => a.status === 'running').length,
    [apps],
  );

  return (
    <div className="animate-fadein">
      <div className="flex items-end gap-3.5 mb-[22px]">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Your apps</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            {apps.length === 0
              ? 'Nothing installed yet.'
              : `${runningCount} running · ${apps.length} installed`}
          </p>
        </div>
        <div className="flex-1" />
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

      {!loading && !error && apps.length > 0 && (
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(212px,1fr))]">
          {apps.map((app) => {
            const icon = iconByApp.get(app.app) || app.icon || '';
            const openable = app.status === 'running' && !!app.url;

            const tile = (
              <div className="group relative h-full bg-surface-1 border border-border rounded-[14px] p-[22px] transition hover:-translate-y-[3px] hover:border-primary hover:shadow-elevation-4">
                <div className="flex items-start justify-between">
                  <AppIcon name={app.name} emoji={icon} size={54} />
                  {openable && (
                    <ExternalLink className="w-4 h-4 text-text-faint group-hover:text-primary transition-colors" />
                  )}
                </div>
                <div className="mt-4 font-semibold text-base truncate">{app.name}</div>
                <div className="mt-2">
                  <StatusBadge status={app.status} />
                </div>
                {app.url && (
                  <div className="mt-2 font-mono text-[11.5px] text-text-faint truncate">{app.url}</div>
                )}
              </div>
            );

            return openable ? (
              <a
                key={app.id}
                href={app.url!}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${app.name}`}
                className="block"
              >
                {tile}
              </a>
            ) : (
              <Link key={app.id} to={`/deployments/${app.id}`} title={app.name} className="block">
                {tile}
              </Link>
            );
          })}
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
