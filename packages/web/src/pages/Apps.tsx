import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Package } from 'lucide-react';

import { useDeploymentsApi } from '../hooks/useDeploymentsApi';
import { useCatalogAppsApi } from '../hooks/useCatalogApi';
import type { DeploymentStatus, GetDeploymentsRequest } from '@hola/shared';

/**
 * Apps — the default landing: a read-only launcher for installed apps.
 *
 * Everything here is data the server already owns (deployments + the catalog for
 * icons), joined client-side — no separate dashboard app to keep in sync.
 */

const STATUS_STYLES: Record<DeploymentStatus, string> = {
  running: 'bg-success/10 text-success border-success/20',
  installing: 'bg-info/10 text-info border-info/20',
  updating: 'bg-info/10 text-info border-info/20',
  stopped: 'bg-surface-2 text-text-muted border-border',
  error: 'bg-danger/10 text-danger border-danger/20',
};

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

  const apps = deploymentsData?.items ?? [];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-strong">Apps</h1>
        <p className="text-text-muted mt-1">Your installed apps. Click a tile to open it.</p>
      </div>

      {loading && apps.length === 0 && (
        <div className="text-text-muted">Loading apps…</div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/20 text-danger rounded-lg p-4">
          Could not load apps: {error}
        </div>
      )}

      {!loading && !error && apps.length === 0 && (
        <div className="bg-surface-1 border border-border rounded-lg p-8 text-center">
          <Package className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-text-strong font-medium">No apps installed yet</p>
          <p className="text-text-muted mt-1">
            Browse the <Link to="/catalog" className="text-primary hover:underline">catalog</Link> to install your first app.
          </p>
        </div>
      )}

      {apps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {apps.map((app) => {
            const icon = iconByApp.get(app.app) || app.icon || '📦';
            const tile = (
              <div className="bg-surface-1 rounded-lg border border-border p-4 h-full hover:border-primary/50 transition-colors flex items-center space-x-3">
                <div className="text-3xl leading-none">{icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-text-strong truncate">{app.name}</h3>
                    {app.url && <ExternalLink className="w-4 h-4 text-text-muted shrink-0" />}
                  </div>
                  <div className="mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${STATUS_STYLES[app.status]}`}>
                      {app.status}
                    </span>
                  </div>
                </div>
              </div>
            );

            // Link out to the running app when we have a URL; otherwise the tile
            // links to its deployment detail so it's never a dead end.
            return app.url ? (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block"
                title={`Open ${app.name}`}
              >
                {tile}
              </a>
            ) : (
              <Link key={app.id} to={`/deployments/${app.id}`} className="block" title={app.name}>
                {tile}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Apps;
