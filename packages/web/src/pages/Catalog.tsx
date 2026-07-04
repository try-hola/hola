import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Plus,
  Star,
  Download,
  RefreshCw,
  AlertCircle,
  Terminal,
  X,
} from 'lucide-react';
import type {
  CatalogApp,
  GetCatalogAppsRequest,
  RegistryCredentialRecord,
} from '@hola/shared';
import { useCatalogAppsApi, useCatalogAppVersionsApi } from '../hooks/useCatalogApi';
import { AppIcon } from '../components/ui/AppIcon';
import { api } from '../utils/api-hybrid';
import { globalCache } from '../utils/cache';

const categories = ['All', 'Productivity', 'Home Automation', 'Media', 'Monitoring', 'Security', 'Database', 'Infrastructure', 'Networking'];

/**
 * Modal to install a package straight from an OCI reference (the escape hatch for
 * one-off private/first-party packages). Picks an optional stored credential for a
 * private registry, then routes into the same install wizard as a catalog install.
 */
const InstallFromRefModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [ref, setRef] = useState('');
  const [credentialRef, setCredentialRef] = useState('');
  const [creds, setCreds] = useState<RegistryCredentialRecord[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setRef(''); setCredentialRef('');
    api.registryCredentials.list().then(r => setCreds(r.items)).catch(() => setCreds([]));
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = () => {
    const trimmed = ref.trim();
    if (!trimmed) return;
    const params = new URLSearchParams({ ref: trimmed });
    if (credentialRef) params.set('cred', credentialRef);
    onClose();
    navigate(`/install/ref?${params.toString()}`);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-0 rounded-xl border border-border w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-lg font-semibold">Install from OCI reference</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-strong transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Package reference</label>
            <input
              autoFocus
              type="text"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="ghcr.io/acme/hola-cms:0.1.0"
              className="w-full h-[38px] bg-surface-1 border border-border rounded-lg px-3 text-[13.5px] text-text-strong outline-none focus:border-primary"
            />
            <p className="mt-1.5 text-xs text-text-muted">The loose-OCI package ref (compose.yaml + manifest.json). Validated against the same strict rules as catalog apps.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Registry credential (for private registries)</label>
            <select
              value={credentialRef}
              onChange={(e) => setCredentialRef(e.target.value)}
              className="w-full h-[38px] bg-surface-1 border border-border rounded-lg px-3 text-[13.5px] text-text-strong outline-none focus:border-primary"
            >
              <option value="">None (public)</option>
              {creds.map(c => <option key={c.id} value={c.id}>{c.id} — {c.registry}</option>)}
            </select>
            <p className="mt-1.5 text-xs text-text-muted">Manage credentials in Settings → Registry Credentials.</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 p-6 border-t border-border bg-surface-1">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-text-muted hover:text-text-strong transition-colors">Cancel</button>
          <button
            onClick={submit}
            disabled={!ref.trim()}
            className="bg-primary text-primary-contrast px-5 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

type AppDetailModalProps = {
  app: CatalogApp;
  isOpen: boolean;
  onClose: () => void;
};

const AppDetailModal: React.FC<AppDetailModalProps> = ({ app, isOpen, onClose }) => {
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  
  // Use API hook for loading versions
  const { data: versionsData, loading, error } = useCatalogAppVersionsApi(app?.id || '');
  
  // Memoize versions to prevent unnecessary re-renders
  const versions = useMemo(() => versionsData?.items || [], [versionsData?.items]);

  // Set selected version when versions load
  useEffect(() => {
    if (versions.length > 0 && !selectedVersion) {
      setSelectedVersion(versions[0].version);
    }
  }, [versions, selectedVersion]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-surface-0 rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-4">
            <div className="text-3xl">{app.icon}</div>
            <div>
              <h2 className="text-xl font-semibold">{app.name}</h2>
              <span className="text-sm text-text-muted bg-surface-2 px-2 py-1 rounded">{app.category}</span>
              {app.version && (
                <span className="ml-2 text-sm font-mono text-text-muted bg-surface-2 px-2 py-1 rounded">v{app.version}</span>
              )}
              {app.source && app.source !== 'hola' && (
                <span className="ml-2 text-xs text-warning bg-warning/10 px-2 py-1 rounded">{app.source} · {app.trust}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-strong transition-colors"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* App Info */}
          <div className="mb-6">
            <p className="text-text-muted mb-4">{app.description}</p>
            
            <div className="flex items-center space-x-6 text-sm text-text-muted mb-4">
              <div className="flex items-center space-x-1">
                <Star className="w-4 h-4 text-warning fill-current" />
                <span>{app.rating}</span>
              </div>
              <div className="flex items-center space-x-1">
                <Download className="w-4 h-4" />
                <span>{app.downloads} downloads</span>
              </div>
              {app.featured && (
                <span className="text-warning text-xs font-medium">Featured</span>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {app.tags.map(tag => (
                <span key={tag} className="bg-surface-2 text-text-muted px-2 py-1 rounded text-sm">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Version Selection */}
          <div className="mb-6">
            <h3 className="text-lg font-medium mb-3">Available Versions</h3>
            
            {loading ? (
              <div className="flex items-center space-x-2 text-text-muted">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading versions...</span>
              </div>
            ) : error ? (
              <div className="flex items-center space-x-2 text-error">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            ) : versions.length > 0 ? (
              <div className="space-y-2">
                {versions.map((version) => (
                  <div
                    key={version.version}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedVersion === version.version
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedVersion(version.version)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium">{version.version}</span>
                        {versions.indexOf(version) === 0 && (
                          <span className="ml-2 text-xs bg-primary text-primary-contrast px-2 py-0.5 rounded">
                            Latest
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-text-muted">
                        {formatDate(version.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-muted">No versions available</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-border bg-surface-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-muted hover:text-text-strong transition-colors"
          >
            Close
          </button>
          <div className="flex space-x-3">
            <Link
              to={`/catalog/${app.id}/install?${new URLSearchParams({
                ...(selectedVersion ? { version: selectedVersion } : {}),
                ...(app.source && app.source !== 'hola' ? { source: app.source } : {}),
              }).toString()}`}
              className="bg-primary text-primary-contrast px-6 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
              onClick={onClose}
            >
              Install {selectedVersion && `v${selectedVersion}`}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Catalog: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('query') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'All');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page') || '1', 10));
  const [appsPerPage] = useState(12);
  const [showRefModal, setShowRefModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<{ text: string; failed: boolean } | null>(null);

  // Build API request parameters
  const apiParams = useMemo(() => {
    const params: GetCatalogAppsRequest = {
      page: currentPage,
      limit: appsPerPage,
    };
    
    if (searchTerm) params.query = searchTerm;
    if (selectedCategory !== 'All') params.category = selectedCategory;
    
    return params;
  }, [searchTerm, selectedCategory, currentPage, appsPerPage]);

  // Use API hook for catalog apps
  const { data: appsData, loading, error, refetch } = useCatalogAppsApi(apiParams);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const result = await api.catalog.refresh(true);
      // The hook's own 30s cache is separate from the SDK-adapter cache the
      // server call already invalidated — clear it too, or refetch() below
      // would just re-serve the stale in-memory entry.
      globalCache.deleteByPattern(/^catalog-apps-/);
      await refetch();
      const failed = result.sources.filter((s) => !s.ok);
      setRefreshMessage(
        failed.length > 0
          ? { text: `${failed.length} of ${result.sources.length} catalog source(s) failed to refresh: ${failed.map((s) => s.name).join(', ')}`, failed: true }
          : { text: `Refreshed ${result.sources.length} catalog source(s).`, failed: false }
      );
    } catch (e) {
      setRefreshMessage({ text: e instanceof Error ? e.message : 'Catalog refresh failed', failed: true });
    } finally {
      setRefreshing(false);
    }
  };


  // Extract data from API response
  const apps = useMemo(() => appsData?.items || [], [appsData?.items]);
  const totalPages = useMemo(() => {
    if (!appsData?.total) return 1;
    return Math.ceil(appsData.total / appsPerPage);
  }, [appsData?.total, appsPerPage]);
  
  // Calculate featured apps
  const featuredApps = useMemo(() => apps.filter(app => app.featured), [apps]);
  
  // Find selected app for modal
  const selectedApp = useMemo(() => 
    selectedAppId ? apps.find(app => app.id === selectedAppId) || null : null, 
    [selectedAppId, apps]
  );

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set('query', searchTerm);
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    if (currentPage > 1) params.set('page', currentPage.toString());
    
    setSearchParams(params, { replace: true });
  }, [searchTerm, selectedCategory, currentPage, setSearchParams]);

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const featuredIds = useMemo(
    () => new Set(featuredApps.map((app) => app.id)),
    [featuredApps],
  );

  return (
    <div className="animate-fadein">
      {/* App Detail Modal */}
      {selectedApp && (
        <AppDetailModal
          app={selectedApp}
          isOpen={!!selectedAppId}
          onClose={() => setSelectedAppId(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-end gap-3.5 mb-[18px] flex-wrap">
        <div>
          <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Catalog</h1>
          <p className="mt-1.5 text-text-muted text-sm">
            {appsData?.total || 0} apps available — install with one click.
          </p>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Re-pull every configured catalog source"
          className="h-[38px] px-3.5 flex items-center gap-2 bg-surface-1 border border-border rounded-[9px] text-[13px] font-medium text-text-muted hover:text-text-strong transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <button
          onClick={() => setShowRefModal(true)}
          className="h-[38px] px-3.5 flex items-center gap-2 bg-surface-1 border border-border rounded-[9px] text-[13px] font-medium text-text-muted hover:text-text-strong transition-colors"
        >
          <Terminal className="w-4 h-4" />
          Install from reference
        </button>
        <div className="relative flex items-center">
          <Search className="absolute left-[11px] w-4 h-4 text-text-faint pointer-events-none" />
          <input
            type="text"
            placeholder="Search apps…"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="h-[38px] w-60 bg-surface-1 border border-border rounded-[9px] text-text-strong pl-[34px] pr-3 text-[13.5px] outline-none focus:border-primary"
          />
        </div>
      </div>

      <InstallFromRefModal isOpen={showRefModal} onClose={() => setShowRefModal(false)} />

      {/* Refresh result */}
      {refreshMessage && (
        <div
          className={`mb-4 rounded-card p-3 text-[13px] flex items-center gap-2 ${
            refreshMessage.failed
              ? 'bg-warning-weak border border-warning/20 text-warning'
              : 'bg-success-weak border border-success/20 text-success'
          }`}
        >
          <AlertCircle className="w-4 h-4 flex-none" />
          <span>{refreshMessage.text}</span>
        </div>
      )}

      {/* Category chips */}
      <div className="flex gap-2 flex-wrap mb-5">
        {categories.map((category) => {
          const active = selectedCategory === category;
          return (
            <button
              key={category}
              onClick={() => handleCategoryChange(category)}
              className={`h-8 px-[13px] flex items-center rounded-lg text-[13px] font-medium cursor-pointer border transition ${
                active
                  ? 'bg-primary-weak text-primary border-primary'
                  : 'bg-surface-1 text-text-muted border-border hover:text-text-strong'
              }`}
            >
              {category}
            </button>
          );
        })}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center gap-2 text-text-muted text-sm py-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Loading applications…</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && apps.length === 0 && (
        <div className="px-5 py-[60px] text-center bg-surface-1 border border-dashed border-border rounded-[14px] text-text-muted">
          <div className="font-semibold text-text-strong mb-1.5">No matching apps</div>
          <div className="text-[13.5px]">
            Try another search or category. You can also install by pasting a Compose file.
          </div>
        </div>
      )}

      {/* Card grid */}
      {!loading && !error && apps.length > 0 && (
        <>
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
            {apps.map((app: CatalogApp) => {
              const custom = app.source && app.source !== 'hola';
              const installTo = `/catalog/${app.id}/install${custom ? `?source=${app.source}` : ''}`;
              return (
                <div
                  key={`${app.source}/${app.id}`}
                  onClick={() => navigate(installTo)}
                  className="bg-surface-1 border border-border rounded-card p-[18px] flex flex-col cursor-pointer transition hover:border-primary hover:-translate-y-[2px]"
                >
                  <div className="flex items-start gap-[13px] mb-[13px]">
                    <AppIcon name={app.name} emoji={app.icon} size={44} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[15.5px] truncate">{app.name}</span>
                        {featuredIds.has(app.id) && (
                          <Star className="w-3.5 h-3.5 text-warning fill-current flex-none" />
                        )}
                      </div>
                      <div className="text-xs text-text-faint mt-px">
                        {app.category}
                        {app.version && <span className="font-mono ml-1.5">· v{app.version}</span>}
                        {custom && <span className="ml-1.5 text-warning">· {app.source} ({app.trust})</span>}
                      </div>
                    </div>
                    <span className="font-mono text-[11px] text-text-faint flex items-center gap-1 flex-none">
                      <Download className="w-3 h-3" />
                      {app.downloads}
                    </span>
                  </div>

                  <p className="m-0 text-[13px] text-text-muted leading-relaxed flex-1">
                    {app.description}
                  </p>

                  <div className="flex items-center gap-[10px] mt-4 pt-[14px] border-t border-border-soft">
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-warning font-medium">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      {app.rating}
                    </span>
                    <div className="flex-1" />
                    <Link
                      to={installTo}
                      onClick={(e) => e.stopPropagation()}
                      className="h-[34px] px-[14px] flex items-center gap-[6px] bg-primary-weak text-primary rounded-lg text-[13px] font-semibold hover:bg-primary hover:text-white transition"
                    >
                      <Plus className="w-4 h-4" />
                      Install
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <div className="text-sm text-text-muted">
                Showing {(currentPage - 1) * appsPerPage + 1}-
                {Math.min(currentPage * appsPerPage, appsData?.total || 0)} of {appsData?.total || 0}{' '}
                applications
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 px-3 flex items-center rounded-lg border border-border text-[13px] text-text-muted hover:text-text-strong hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Prev
                </button>

                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`h-8 px-[11px] flex items-center text-[13px] rounded-lg border transition ${
                        currentPage === pageNum
                          ? 'bg-primary-weak text-primary border-primary'
                          : 'bg-surface-1 text-text-muted border-border hover:text-text-strong'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-8 px-3 flex items-center rounded-lg border border-border text-[13px] text-text-muted hover:text-text-strong hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};