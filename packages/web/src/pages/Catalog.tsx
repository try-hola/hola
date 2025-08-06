import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, Grid, List, Star, Download, ExternalLink } from 'lucide-react';
import type { 
  CatalogApp, 
  GetCatalogAppsResponse,
  GetCatalogAppsRequest 
} from '@hola/shared';

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
];

const categories = ['All', 'Productivity', 'Home Automation', 'Media', 'Monitoring', 'Security'];

export const Catalog: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedApp, setSelectedApp] = useState<string | null>(null);

  const filteredApps = apps.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         app.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         app.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesCategory = selectedCategory === 'All' || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const featuredApps = filteredApps.filter(app => app.featured);

  return (
    <div className="space-y-6">
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
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface-1 border border-border rounded-lg text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>

        <div className="flex space-x-2">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
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

      {/* Featured Apps */}
      {selectedCategory === 'All' && searchTerm === '' && (
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
                </div>

                <Link 
                  to={`/catalog/${app.id}/install`}
                  className="w-full bg-primary text-primary-contrast py-2 px-4 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center"
                >
                  Install
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Apps */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">
            {selectedCategory === 'All' ? 'All Applications' : selectedCategory} 
            <span className="text-text-muted font-normal ml-2">({filteredApps.length})</span>
          </h2>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredApps.map(app => (
              <div key={app.id} className="bg-surface-1 rounded-lg border border-border p-4 hover:border-primary/50 transition-colors group">
                <div className="flex items-center space-x-3 mb-3">
                  <div className="text-xl">{app.icon}</div>
                  <div className="flex-grow min-w-0">
                    <h3 className="font-medium group-hover:text-primary transition-colors truncate">{app.name}</h3>
                    <span className="text-xs text-text-muted bg-surface-2 px-2 py-0.5 rounded">{app.category}</span>
                  </div>
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
            {filteredApps.map(app => (
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

                  <div className="flex-shrink-0">
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
      </div>

      {filteredApps.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No applications found</h3>
          <p className="text-text-muted">Try adjusting your search or filter criteria</p>
        </div>
      )}
    </div>
  );
};