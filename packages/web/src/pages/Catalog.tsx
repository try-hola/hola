import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { 
  Search, 
  Grid, 
  List, 
  Star, 
  Download, 
  Package, 
  Eye, 
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  AlertCircle 
} from 'lucide-react';
import type { 
  CatalogApp, 
  CatalogAppVersion,
  // These types will be used when implementing real API calls:
  // GetCatalogAppsResponse,
  // GetCatalogAppsRequest,
  // GetCatalogAppResponse,
  // GetCatalogAppVersionsResponse,
  // GetCatalogAppVersionDetailResponse,
  // PageResponse,
  // ErrorResponse
} from '@hola/shared';
// API constants will be used for real API calls:
// import { API } from '@hola/shared';

// Enhanced mock data with version information
const apps: CatalogApp[] = [
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    description: 'Self-hosted productivity platform with file sync, calendar, and collaboration tools',
    icon: '☁️',
    category: 'Productivity',
    rating: 4.8,
    downloads: '12.5k',
    tags: ['File Storage', 'Collaboration', 'Calendar'],
    featured: true,
  },
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    description: 'Open source home automation platform with focus on privacy and local control',
    icon: '🏠',
    category: 'Home Automation',
    rating: 4.9,
    downloads: '45.2k',
    tags: ['IoT', 'Automation', 'Smart Home'],
    featured: true,
  },
  {
    id: 'plex',
    name: 'Plex Media Server',
    description: 'Stream movies, TV shows, music, and photos to any device, anywhere',
    icon: '🎬',
    category: 'Media',
    rating: 4.6,
    downloads: '89.1k',
    tags: ['Streaming', 'Media', 'Entertainment'],
    featured: false,
  },
  {
    id: 'grafana',
    name: 'Grafana',
    description: 'Analytics and interactive visualization web application for monitoring',
    icon: '📊',
    category: 'Monitoring',
    rating: 4.7,
    downloads: '32.8k',
    tags: ['Analytics', 'Monitoring', 'Dashboards'],
    featured: false,
  },
  {
    id: 'bitwarden',
    name: 'Bitwarden',
    description: 'Self-hosted password manager with end-to-end encryption',
    icon: '🔐',
    category: 'Security',
    rating: 4.9,
    downloads: '67.3k',
    tags: ['Password Manager', 'Security', 'Encryption'],
    featured: true,
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    description: 'Free software media system that puts you in control of your media',
    icon: '🎭',
    category: 'Media',
    rating: 4.5,
    downloads: '28.9k',
    tags: ['Streaming', 'Media', 'Open Source'],
    featured: false,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Advanced open source relational database',
    icon: '🐘',
    category: 'Database',
    rating: 4.8,
    downloads: '156.3k',
    tags: ['Database', 'SQL', 'Relational'],
    featured: false,
  },
  {
    id: 'redis',
    name: 'Redis',
    description: 'In-memory data structure store, used as database, cache, and message broker',
    icon: '📦',
    category: 'Database',
    rating: 4.7,
    downloads: '98.7k',
    tags: ['Cache', 'Database', 'Memory'],
    featured: false,
  },
];

// Mock app versions data
const appVersionsData: Record<string, CatalogAppVersion[]> = {
  nextcloud: [
    { version: '28.0.2', createdAt: '2024-01-15T10:30:00Z' },
    { version: '28.0.1', createdAt: '2024-01-10T08:15:00Z' },
    { version: '27.1.5', createdAt: '2023-12-20T14:45:00Z' },
  ],
  homeassistant: [
    { version: '2024.1.5', createdAt: '2024-01-18T16:20:00Z' },
    { version: '2024.1.4', createdAt: '2024-01-12T11:30:00Z' },
    { version: '2023.12.4', createdAt: '2023-12-28T09:10:00Z' },
  ],
  plex: [
    { version: '1.40.0.7998', createdAt: '2024-01-20T12:00:00Z' },
    { version: '1.39.0.7920', createdAt: '2024-01-05T14:30:00Z' },
  ],
  grafana: [
    { version: '10.3.1', createdAt: '2024-01-22T13:45:00Z' },
    { version: '10.3.0', createdAt: '2024-01-15T10:20:00Z' },
    { version: '10.2.3', createdAt: '2023-12-18T16:15:00Z' },
  ],
  bitwarden: [
    { version: '2024.1.2', createdAt: '2024-01-25T09:30:00Z' },
    { version: '2024.1.1', createdAt: '2024-01-18T11:15:00Z' },
  ],
  jellyfin: [
    { version: '10.8.13', createdAt: '2024-01-19T15:45:00Z' },
    { version: '10.8.12', createdAt: '2024-01-10T12:30:00Z' },
  ],
  postgres: [
    { version: '16.1', createdAt: '2024-01-20T10:00:00Z' },
    { version: '15.5', createdAt: '2024-01-15T14:30:00Z' },
    { version: '14.10', createdAt: '2024-01-10T16:45:00Z' },
  ],
  redis: [
    { version: '7.2.4', createdAt: '2024-01-18T11:20:00Z' },
    { version: '7.2.3', createdAt: '2024-01-08T13:15:00Z' },
  ],
};

const categories = ['All', 'Productivity', 'Home Automation', 'Media', 'Monitoring', 'Security', 'Database'];

type AppDetailModalProps = {
  app: CatalogApp;
  isOpen: boolean;
  onClose: () => void;
};

const AppDetailModal: React.FC<AppDetailModalProps> = ({ app, isOpen, onClose }) => {
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [versions, setVersions] = useState<CatalogAppVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load app versions when modal opens
  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call - in production, this would be:
      // const response = await fetch(API.catalog.versions(app.id));
      // const data: GetCatalogAppVersionsResponse = await response.json();
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate API delay
      const mockVersions = appVersionsData[app.id] || [];
      setVersions(mockVersions);
      setSelectedVersion(mockVersions[0]?.version || '');
    } catch (error) {
      setError('Failed to load app versions');
      console.error('Error loading versions:', error);
    } finally {
      setLoading(false);
    }
  }, [app.id]);

  useEffect(() => {
    if (isOpen && app) {
      loadVersions();
    }
  }, [isOpen, app, loadVersions]);

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
              to={`/catalog/${app.id}/install${selectedVersion ? `?version=${selectedVersion}` : ''}`}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('query') || '');
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || 'All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [appsPerPage] = useState(12);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set('query', searchTerm);
    if (selectedCategory !== 'All') params.set('category', selectedCategory);
    if (currentPage > 1) params.set('page', currentPage.toString());
    
    setSearchParams(params, { replace: true });
  }, [searchTerm, selectedCategory, currentPage, setSearchParams]);

  // Simulated API call for catalog apps
  const loadApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Simulate API call - in production, this would be:
      // const params: GetCatalogAppsRequest = {
      //   page: currentPage,
      //   limit: appsPerPage,
      //   query: searchTerm || undefined,
      //   category: selectedCategory !== 'All' ? selectedCategory : undefined,
      // };
      // const response = await fetch(`${API.catalog.apps}?${new URLSearchParams(params)}`);
      // const data: GetCatalogAppsResponse = await response.json();
      
      await new Promise(resolve => setTimeout(resolve, 300)); // Simulate API delay
      
      // For now, return mock data (this will be replaced with real API calls)
      console.log('Mock API call:', { searchTerm, selectedCategory, currentPage });
    } catch (error) {
      setError('Failed to load applications');
      console.error('Error loading apps:', error);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, selectedCategory, currentPage]);

  // Load apps when filters change
  useEffect(() => {
    loadApps();
  }, [loadApps]);

  // Filter and paginate apps (this simulates what the API would do)
  const filteredApps = useMemo(() => {
    return apps.filter(app => {
      const matchesSearch = !searchTerm || 
        app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        app.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === 'All' || app.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchTerm, selectedCategory]);

  const paginatedApps = useMemo(() => {
    const startIndex = (currentPage - 1) * appsPerPage;
    return filteredApps.slice(startIndex, startIndex + appsPerPage);
  }, [filteredApps, currentPage, appsPerPage]);

  const totalPages = Math.ceil(filteredApps.length / appsPerPage);
  const featuredApps = filteredApps.filter(app => app.featured);

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

  const selectedApp = selectedAppId ? apps.find(app => app.id === selectedAppId) : null;

  return (
    <div className="space-y-6">
      {/* App Detail Modal */}
      {selectedApp && (
        <AppDetailModal
          app={selectedApp}
          isOpen={!!selectedAppId}
          onClose={() => setSelectedAppId(null)}
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">App Catalog</h1>
        <p className="text-text-muted mt-1">Discover and install applications for your home lab</p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search applications..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-1 border border-border rounded-lg text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>

        <div className="flex space-x-2">
          <select
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="px-3 py-2 bg-surface-1 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          >
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>

          <div className="flex border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-primary text-primary-contrast' : 'bg-surface-1 text-text-muted hover:text-text-strong'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary text-primary-contrast' : 'bg-surface-1 text-text-muted hover:text-text-strong'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-text-muted mr-2" />
          <span className="text-text-muted">Loading applications...</span>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-error/10 border border-error/20 rounded-lg p-4">
          <div className="flex items-center space-x-2 text-error">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Featured Apps */}
      {!loading && !error && selectedCategory === 'All' && searchTerm === '' && featuredApps.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-4">Featured Applications</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {featuredApps.slice(0, 3).map(app => (
              <div key={app.id} className="bg-surface-1 rounded-lg border border-border p-6 hover:border-primary/50 transition-colors group">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="text-2xl">{app.icon}</div>
                    <div>
                      <h3 className="font-medium group-hover:text-primary transition-colors">{app.name}</h3>
                      <span className="text-xs text-text-muted bg-surface-2 px-2 py-1 rounded">{app.category}</span>
                    </div>
                  </div>
                  <Star className="w-4 h-4 text-warning fill-current" />
                </div>
                
                <p className="text-sm text-text-muted mb-4 line-clamp-2">{app.description}</p>
                
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4 text-xs text-text-muted">
                    <span className="flex items-center space-x-1">
                      <Star className="w-3 h-3" />
                      <span>{app.rating}</span>
                    </span>
                    <span className="flex items-center space-x-1">
                      <Download className="w-3 h-3" />
                      <span>{app.downloads}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedAppId(app.id)}
                    className="text-text-muted hover:text-primary transition-colors"
                    title="View details"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex space-x-2">
                  <Link 
                    to={`/catalog/${app.id}/install`}
                    className="flex-1 bg-primary text-primary-contrast py-2 px-4 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors text-center"
                  >
                    Install
                  </Link>
                  <button
                    onClick={() => setSelectedAppId(app.id)}
                    className="bg-surface-2 text-text-strong py-2 px-3 rounded-lg text-sm font-medium hover:bg-surface-3 transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Apps */}
      {!loading && !error && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">
              {selectedCategory === 'All' ? 'All Applications' : selectedCategory} 
              <span className="text-text-muted font-normal ml-2">({filteredApps.length})</span>
            </h2>
          </div>

          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {paginatedApps.map(app => (
                <div key={app.id} className="bg-surface-1 rounded-lg border border-border p-4 hover:border-primary/50 transition-colors group">
                  <div className="flex items-center space-x-3 mb-3">
                    <div className="text-xl">{app.icon}</div>
                    <div className="flex-grow min-w-0">
                      <h3 className="font-medium group-hover:text-primary transition-colors truncate">{app.name}</h3>
                      <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded">{app.category}</span>
                    </div>
                    <button
                      onClick={() => setSelectedAppId(app.id)}
                      className="text-text-muted hover:text-primary transition-colors"
                      title="View details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <p className="text-sm text-text-muted mb-3 line-clamp-2">{app.description}</p>
                  
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3 text-xs text-text-muted">
                      <span className="flex items-center space-x-1">
                        <Star className="w-3 h-3" />
                        <span>{app.rating}</span>
                      </span>
                      <span>{app.downloads}</span>
                    </div>
                  </div>

                  <Link 
                    to={`/catalog/${app.id}/install`}
                    className="w-full bg-surface-2 text-text-strong py-1.5 px-3 rounded text-sm font-medium hover:bg-primary hover:text-primary-contrast transition-colors flex items-center justify-center"
                  >
                    Install
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {paginatedApps.map(app => (
                <div key={app.id} className="bg-surface-1 rounded-lg border border-border p-4 hover:border-primary/50 transition-colors group">
                  <div className="flex items-center space-x-4">
                    <div className="text-xl">{app.icon}</div>
                    
                    <div className="flex-grow min-w-0">
                      <div className="flex items-center space-x-3 mb-1">
                        <h3 className="font-medium group-hover:text-primary transition-colors">{app.name}</h3>
                        <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded">{app.category}</span>
                        {app.featured && <Star className="w-4 h-4 text-warning fill-current" />}
                      </div>
                      <p className="text-sm text-text-muted mb-2">{app.description}</p>
                      <div className="flex items-center space-x-4 text-xs text-text-muted">
                        <span className="flex items-center space-x-1">
                          <Star className="w-3 h-3" />
                          <span>{app.rating}</span>
                        </span>
                        <span className="flex items-center space-x-1">
                          <Download className="w-3 h-3" />
                          <span>{app.downloads}</span>
                        </span>
                        <div className="flex space-x-1">
                          {app.tags.slice(0, 3).map(tag => (
                            <span key={tag} className="bg-surface-2 px-2 py-0.5 rounded text-xs">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex-shrink-0 flex space-x-2">
                      <button
                        onClick={() => setSelectedAppId(app.id)}
                        className="bg-surface-2 text-text-strong py-2 px-3 rounded-lg text-sm font-medium hover:bg-surface-3 transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <Link 
                        to={`/catalog/${app.id}/install`}
                        className="bg-primary text-primary-contrast py-2 px-4 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                      >
                        Install
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-border">
              <div className="text-sm text-text-muted">
                Showing {(currentPage - 1) * appsPerPage + 1}-{Math.min(currentPage * appsPerPage, filteredApps.length)} of {filteredApps.length} applications
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg border border-border text-text-muted hover:text-text-strong hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
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
                      className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                        currentPage === pageNum
                          ? 'bg-primary text-primary-contrast'
                          : 'text-text-muted hover:text-text-strong hover:bg-surface-2'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
                
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg border border-border text-text-muted hover:text-text-strong hover:border-primary/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No Results */}
      {!loading && !error && filteredApps.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No applications found</h3>
          <p className="text-text-muted">Try adjusting your search or filter criteria</p>
        </div>
      )}
    </div>
  );
};