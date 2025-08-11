// Catalog mock data and functionality
import type {
  CatalogApp,
  CatalogAppVersion,
  GetCatalogAppsResponse,
  GetCatalogAppResponse,
  GetCatalogAppVersionsResponse,
  GetCatalogAppVersionDetailResponse
} from '@hola/shared';

// Enhanced catalog data extracted from web component
export const catalogApps: CatalogApp[] = [
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
  {
    id: 'traefik',
    name: 'Traefik',
    description: 'Modern HTTP reverse proxy and load balancer for microservices',
    icon: '🔀',
    category: 'Infrastructure',
    rating: 4.6,
    downloads: '55.4k',
    tags: ['Reverse Proxy', 'Load Balancer', 'SSL'],
    featured: false,
  },
  {
    id: 'portainer',
    name: 'Portainer',
    description: 'Container management software for Docker and Kubernetes',
    icon: '🐳',
    category: 'Infrastructure',
    rating: 4.5,
    downloads: '78.9k',
    tags: ['Docker', 'Container Management', 'GUI'],
    featured: false,
  },
  {
    id: 'wireguard',
    name: 'WireGuard',
    description: 'Fast, modern, secure VPN tunnel',
    icon: '🔒',
    category: 'Security',
    rating: 4.8,
    downloads: '34.2k',
    tags: ['VPN', 'Security', 'Networking'],
    featured: false,
  },
  {
    id: 'pihole',
    name: 'Pi-hole',
    description: 'Network-wide ad blocker and local DNS server',
    icon: '🕳️',
    category: 'Networking',
    rating: 4.7,
    downloads: '91.5k',
    tags: ['DNS', 'Ad Blocker', 'Privacy'],
    featured: false,
  },
];

// App versions data
export const appVersionsData: Record<string, CatalogAppVersion[]> = {
  nextcloud: [
    { version: '28.0.2', createdAt: '2024-01-15T10:30:00Z' },
    { version: '28.0.1', createdAt: '2024-01-10T08:15:00Z' },
    { version: '27.1.5', createdAt: '2023-12-20T14:45:00Z' },
    { version: '27.1.4', createdAt: '2023-12-15T16:20:00Z' },
  ],
  homeassistant: [
    { version: '2024.1.5', createdAt: '2024-01-18T16:20:00Z' },
    { version: '2024.1.4', createdAt: '2024-01-12T11:30:00Z' },
    { version: '2023.12.4', createdAt: '2023-12-28T09:10:00Z' },
    { version: '2023.12.3', createdAt: '2023-12-22T14:45:00Z' },
  ],
  plex: [
    { version: '1.40.0.7998', createdAt: '2024-01-20T12:00:00Z' },
    { version: '1.39.0.7920', createdAt: '2024-01-05T14:30:00Z' },
    { version: '1.38.2.7865', createdAt: '2023-12-18T10:15:00Z' },
  ],
  grafana: [
    { version: '10.3.1', createdAt: '2024-01-22T13:45:00Z' },
    { version: '10.3.0', createdAt: '2024-01-15T10:20:00Z' },
    { version: '10.2.3', createdAt: '2023-12-18T16:15:00Z' },
    { version: '10.2.2', createdAt: '2023-12-10T11:30:00Z' },
  ],
  bitwarden: [
    { version: '2024.1.2', createdAt: '2024-01-25T09:30:00Z' },
    { version: '2024.1.1', createdAt: '2024-01-18T11:15:00Z' },
    { version: '2023.12.1', createdAt: '2023-12-20T15:45:00Z' },
  ],
  jellyfin: [
    { version: '10.8.13', createdAt: '2024-01-19T15:45:00Z' },
    { version: '10.8.12', createdAt: '2024-01-10T12:30:00Z' },
    { version: '10.8.11', createdAt: '2023-12-25T08:20:00Z' },
  ],
  postgres: [
    { version: '16.1', createdAt: '2024-01-20T10:00:00Z' },
    { version: '15.5', createdAt: '2024-01-15T14:30:00Z' },
    { version: '14.10', createdAt: '2024-01-10T16:45:00Z' },
    { version: '13.13', createdAt: '2023-12-20T09:15:00Z' },
  ],
  redis: [
    { version: '7.2.4', createdAt: '2024-01-18T11:20:00Z' },
    { version: '7.2.3', createdAt: '2024-01-08T13:15:00Z' },
    { version: '7.0.15', createdAt: '2023-12-15T10:30:00Z' },
  ],
  traefik: [
    { version: '3.0.0', createdAt: '2024-01-25T14:20:00Z' },
    { version: '2.11.0', createdAt: '2024-01-15T09:45:00Z' },
    { version: '2.10.7', createdAt: '2023-12-20T16:30:00Z' },
  ],
  portainer: [
    { version: '2.19.4', createdAt: '2024-01-22T12:15:00Z' },
    { version: '2.19.3', createdAt: '2024-01-10T14:45:00Z' },
    { version: '2.19.2', createdAt: '2023-12-18T11:20:00Z' },
  ],
  wireguard: [
    { version: '1.0.20210914', createdAt: '2024-01-20T08:30:00Z' },
    { version: '1.0.20210606', createdAt: '2023-12-15T13:45:00Z' },
  ],
  pihole: [
    { version: '2024.01.0', createdAt: '2024-01-25T10:15:00Z' },
    { version: '2023.11.0', createdAt: '2023-12-20T15:30:00Z' },
    { version: '2023.10.0', createdAt: '2023-11-18T09:45:00Z' },
  ],
};

// App version details with environment variables and defaults
export const appVersionDetails: Record<string, GetCatalogAppVersionDetailResponse> = {
  nextcloud: {
    defaultEnv: [
      { key: 'POSTGRES_DB', value: 'nextcloud', isSecret: false, description: 'Database name for Nextcloud' },
      { key: 'POSTGRES_USER', value: 'nextcloud', isSecret: false, description: 'Database user for Nextcloud' },
      { key: 'POSTGRES_PASSWORD', value: '', isSecret: true, description: 'Database password (required)' },
      { key: 'NEXTCLOUD_ADMIN_USER', value: 'admin', isSecret: false, description: 'Admin username' },
      { key: 'NEXTCLOUD_ADMIN_PASSWORD', value: '', isSecret: true, description: 'Admin password (required)' },
      { key: 'NEXTCLOUD_TRUSTED_DOMAINS', value: 'localhost', isSecret: false, description: 'Trusted domains for access' },
    ],
    defaults: {
      ports: [
        { host: 8080, container: 80, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './nextcloud', containerPath: '/var/www/html', readOnly: false },
        { hostPath: './nextcloud-data', containerPath: '/var/www/html/data', readOnly: false }
      ],
    },
  },
  homeassistant: {
    defaultEnv: [
      { key: 'TZ', value: 'UTC', isSecret: false, description: 'Timezone for Home Assistant' },
    ],
    defaults: {
      ports: [
        { host: 8123, container: 8123, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './homeassistant/config', containerPath: '/config', readOnly: false }
      ],
    },
  },
  plex: {
    defaultEnv: [
      { key: 'PLEX_CLAIM', value: '', isSecret: true, description: 'Plex claim token (optional)' },
      { key: 'TZ', value: 'UTC', isSecret: false, description: 'Timezone for Plex' },
    ],
    defaults: {
      ports: [
        { host: 32400, container: 32400, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './plex/config', containerPath: '/config', readOnly: false },
        { hostPath: './plex/media', containerPath: '/media', readOnly: true }
      ],
    },
  },
  grafana: {
    defaultEnv: [
      { key: 'GF_SECURITY_ADMIN_PASSWORD', value: '', isSecret: true, description: 'Grafana admin password (required)' },
      { key: 'GF_SECURITY_ADMIN_USER', value: 'admin', isSecret: false, description: 'Grafana admin username' },
    ],
    defaults: {
      ports: [
        { host: 3000, container: 3000, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './grafana', containerPath: '/var/lib/grafana', readOnly: false }
      ],
    },
  },
  bitwarden: {
    defaultEnv: [
      { key: 'ADMIN_TOKEN', value: '', isSecret: true, description: 'Admin panel access token (optional)' },
      { key: 'DATABASE_URL', value: '', isSecret: true, description: 'Database connection URL (optional)' },
    ],
    defaults: {
      ports: [
        { host: 8000, container: 80, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './bitwarden', containerPath: '/data', readOnly: false }
      ],
    },
  },
  postgres: {
    defaultEnv: [
      { key: 'POSTGRES_DB', value: 'postgres', isSecret: false, description: 'Database name' },
      { key: 'POSTGRES_USER', value: 'postgres', isSecret: false, description: 'Database user' },
      { key: 'POSTGRES_PASSWORD', value: '', isSecret: true, description: 'Database password (required)' },
    ],
    defaults: {
      ports: [
        { host: 5432, container: 5432, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './postgres', containerPath: '/var/lib/postgresql/data', readOnly: false }
      ],
    },
  },
  redis: {
    defaultEnv: [
      { key: 'REDIS_PASSWORD', value: '', isSecret: true, description: 'Redis password (optional)' },
    ],
    defaults: {
      ports: [
        { host: 6379, container: 6379, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: './redis', containerPath: '/data', readOnly: false }
      ],
    },
  },
};

// Helper functions for filtering and searching
function applyFilters(
  apps: CatalogApp[],
  filters: {
    query?: string;
    category?: string;
  }
): CatalogApp[] {
  return apps.filter(app => {
    // Search filter
    if (filters.query) {
      const query = filters.query.toLowerCase();
      const matchesName = app.name.toLowerCase().includes(query);
      const matchesDescription = app.description.toLowerCase().includes(query);
      const matchesTags = app.tags.some(tag => tag.toLowerCase().includes(query));
      if (!matchesName && !matchesDescription && !matchesTags) {
        return false;
      }
    }

    // Category filter
    if (filters.category && app.category !== filters.category) {
      return false;
    }

    return true;
  });
}

function paginateResults<T>(items: T[], page: number, limit: number): {
  items: T[];
  page: number;
  limit: number;
  total: number;
} {
  const total = items.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = items.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    page,
    limit,
    total,
  };
}

// Export functions for API handlers
export function getCatalogApps(params: {
  page?: number;
  limit?: number;
  query?: string;
  category?: string;
}): GetCatalogAppsResponse {
  const { page = 1, limit = 12, query, category } = params;
  
  const filteredApps = applyFilters(catalogApps, { query, category });
  
  return paginateResults(filteredApps, page, limit);
}

export function getCatalogAppById(appId: string): GetCatalogAppResponse | null {
  const app = catalogApps.find(a => a.id === appId);
  if (!app) {
    return null;
  }

  const versions = appVersionsData[appId]?.map(v => v.version) || [];

  return {
    ...app,
    versions,
  };
}

export function getCatalogAppVersions(appId: string): GetCatalogAppVersionsResponse | null {
  const app = catalogApps.find(a => a.id === appId);
  if (!app) {
    return null;
  }

  const versions = appVersionsData[appId] || [];

  return {
    items: versions,
    total: versions.length,
  };
}

export function getCatalogAppVersionDetail(
  appId: string, 
  version: string
): GetCatalogAppVersionDetailResponse | null {
  const app = catalogApps.find(a => a.id === appId);
  if (!app) {
    return null;
  }

  const appVersions = appVersionsData[appId] || [];
  const versionExists = appVersions.some(v => v.version === version);
  if (!versionExists) {
    return null;
  }

  // Return app-specific defaults or generic defaults
  return appVersionDetails[appId] || {
    defaultEnv: [
      { key: 'APP_ENV', value: 'production', isSecret: false, description: 'Application environment' },
    ],
    defaults: {
      ports: [
        { host: 8080, container: 80, protocol: 'tcp' }
      ],
      volumes: [
        { hostPath: `./data`, containerPath: '/data', readOnly: false }
      ],
    },
  };
}

export const categories = [
  'All',
  'Productivity',
  'Home Automation',
  'Media',
  'Monitoring',
  'Security',
  'Database',
  'Infrastructure',
  'Networking'
];
