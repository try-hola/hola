/**
 * Type browser and relationship explorer for API documentation
 * 
 * This module provides tools for exploring TypeScript types, their relationships,
 * inheritance patterns, and usage examples throughout the API.
 */

import type {
  // Import all shared types for analysis
  Identity,
  SystemStatus,
  SummaryJob,
  GetSummaryResponse,
  CatalogApp,
  GetCatalogAppsResponse,
  Draft,
  CreateDraftRequest,
  DeploymentListItem,
  DeploymentDetail,
  Job,
  BackupItem,
  NotificationItem,
  SystemEnvVar,
  AppEnvVar,
  DraftDefaults,
  PageRequest,
  PageResponse,
  ErrorResponse,
  SSEEvent,
  SSELogEvent,
  SSEJobUpdateEvent,
  SSESystemUpdateEvent,
  SSEDeploymentUpdateEvent,
  JobType,
  JobStatus,
  DeploymentStatus,
  BackupStatus,
  BackupType,
  NotificationType,
  NotificationPriority,
  LogLevel,
  SSEConnectionState,
} from '../index';

/**
 * TypeScript type definition with metadata
 */
export interface TypeDefinition {
  name: string;
  category: 'primitive' | 'interface' | 'type' | 'enum' | 'union' | 'generic';
  description: string;
  properties?: PropertyDefinition[];
  extends?: string[];
  usedBy?: string[];
  examples?: unknown[];
  deprecated?: boolean;
  since?: string;
}

/**
 * Property definition within a type
 */
export interface PropertyDefinition {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
  example?: unknown;
  deprecated?: boolean;
}

/**
 * Type relationship information
 */
export interface TypeRelationship {
  from: string;
  to: string;
  relationship: 'extends' | 'uses' | 'contains' | 'references';
  description: string;
}

/**
 * Complete type registry for the API
 */
export const TYPE_REGISTRY: Record<string, TypeDefinition> = {
  // ===== COMMON TYPES =====
  
  ErrorResponse: {
    name: 'ErrorResponse',
    category: 'interface',
    description: 'Standard error response format used across all API endpoints',
    properties: [
      {
        name: 'error',
        type: 'ErrorDetails',
        optional: false,
        description: 'Error details object',
        example: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input provided',
          details: { field: 'name', reason: 'required' }
        }
      }
    ],
    usedBy: ['All API endpoints'],
    examples: [
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          details: null
        }
      },
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: {
            field: 'email',
            reason: 'invalid format'
          }
        }
      }
    ]
  },

  PageRequest: {
    name: 'PageRequest',
    category: 'interface',
    description: 'Standard pagination parameters for list endpoints',
    properties: [
      {
        name: 'page',
        type: 'number',
        optional: true,
        description: 'Page number (1-based)',
        example: 1
      },
      {
        name: 'limit',
        type: 'number',
        optional: true,
        description: 'Number of items per page',
        example: 20
      },
      {
        name: 'q',
        type: 'string',
        optional: true,
        description: 'Search query string',
        example: 'nextcloud'
      }
    ],
    usedBy: ['GetCatalogAppsRequest', 'GetDeploymentsRequest', 'GetJobsRequest', 'GetBackupsRequest'],
    examples: [
      { page: 1, limit: 20 },
      { page: 2, limit: 10, q: 'docker' }
    ]
  },

  PageResponse: {
    name: 'PageResponse<T>',
    category: 'generic',
    description: 'Standard paginated response wrapper for list endpoints',
    properties: [
      {
        name: 'items',
        type: 'T[]',
        optional: false,
        description: 'Array of items for current page',
        example: '[...items]'
      },
      {
        name: 'page',
        type: 'number',
        optional: false,
        description: 'Current page number',
        example: 1
      },
      {
        name: 'limit',
        type: 'number',
        optional: false,
        description: 'Items per page',
        example: 20
      },
      {
        name: 'total',
        type: 'number',
        optional: false,
        description: 'Total number of items across all pages',
        example: 150
      }
    ],
    usedBy: ['GetCatalogAppsResponse', 'GetDeploymentsResponse', 'GetJobsResponse'],
    examples: [
      {
        items: ['...'],
        page: 1,
        limit: 20,
        total: 50
      }
    ]
  },

  // ===== IDENTITY & SYSTEM =====

  Identity: {
    name: 'Identity',
    category: 'interface',
    description: 'User identity information returned by authentication',
    properties: [
      {
        name: 'id',
        type: 'string',
        optional: false,
        description: 'Unique user identifier',
        example: 'user-123'
      },
      {
        name: 'name',
        type: 'string',
        optional: false,
        description: 'Display name',
        example: 'John Doe'
      },
      {
        name: 'email',
        type: 'string',
        optional: false,
        description: 'Email address',
        example: 'john@example.com'
      },
      {
        name: 'roles',
        type: 'string[]',
        optional: false,
        description: 'User roles and permissions',
        example: ['user', 'admin']
      }
    ],
    usedBy: ['GetMeResponse'],
    examples: [
      {
        id: 'demo-user',
        name: 'Demo User',
        email: 'demo@example.com',
        roles: ['user']
      }
    ]
  },

  SystemStatus: {
    name: 'SystemStatus',
    category: 'interface',
    description: 'System health and status information',
    properties: [
      {
        name: 'docker',
        type: '{ ok: boolean; version?: string }',
        optional: false,
        description: 'Docker daemon status and version',
        example: { ok: true, version: '24.0.5' }
      },
      {
        name: 'disk',
        type: '{ freeBytes: number; totalBytes: number }',
        optional: false,
        description: 'Disk usage information',
        example: { freeBytes: 50000000000, totalBytes: 100000000000 }
      },
      {
        name: 'version',
        type: '{ hola: string; compose: string }',
        optional: false,
        description: 'Software version information',
        example: { hola: '1.0.0', compose: '2.20.0' }
      },
      {
        name: 'oras',
        type: '{ ok: boolean; version?: string }',
        optional: true,
        description: 'ORAS registry client status',
        example: { ok: true, version: '1.1.0' }
      },
      {
        name: 'authentik',
        type: '{ ok: boolean }',
        optional: true,
        description: 'Authentik SSO integration status',
        example: { ok: true }
      }
    ],
    usedBy: ['GetSummaryResponse', 'GetSystemStatusResponse'],
    examples: [
      {
        docker: { ok: true, version: '24.0.5' },
        disk: { freeBytes: 50000000000, totalBytes: 100000000000 },
        version: { hola: '1.0.0', compose: '2.20.0' },
        oras: { ok: true, version: '1.1.0' },
        authentik: { ok: true }
      }
    ]
  },

  // ===== JOBS & TASKS =====

  JobType: {
    name: 'JobType',
    category: 'union',
    description: 'Types of jobs that can be executed in the system',
    properties: [
      {
        name: 'Values',
        type: "'install' | 'update' | 'backup' | 'restore' | 'start' | 'stop' | 'restart'",
        optional: false,
        description: 'Possible job type values'
      }
    ],
    usedBy: ['Job', 'SummaryJob'],
    examples: ['install', 'backup', 'restart']
  },

  JobStatus: {
    name: 'JobStatus',
    category: 'union',
    description: 'Current status of a job execution',
    properties: [
      {
        name: 'Values',
        type: "'queued' | 'running' | 'completed' | 'failed'",
        optional: false,
        description: 'Possible job status values'
      }
    ],
    usedBy: ['Job', 'SummaryJob'],
    examples: ['running', 'completed', 'failed']
  },

  Job: {
    name: 'Job',
    category: 'interface',
    description: 'Job execution details and progress tracking',
    properties: [
      {
        name: 'id',
        type: 'string',
        optional: false,
        description: 'Unique job identifier',
        example: 'job-abc123'
      },
      {
        name: 'type',
        type: 'JobType',
        optional: false,
        description: 'Type of job being executed',
        example: 'install'
      },
      {
        name: 'status',
        type: 'JobStatus',
        optional: false,
        description: 'Current execution status',
        example: 'running'
      },
      {
        name: 'startedAt',
        type: 'string',
        optional: false,
        description: 'ISO timestamp when job started',
        example: '2025-08-12T10:00:00Z'
      },
      {
        name: 'finishedAt',
        type: 'string',
        optional: true,
        description: 'ISO timestamp when job completed',
        example: '2025-08-12T10:05:30Z'
      },
      {
        name: 'progress',
        type: 'number',
        optional: true,
        description: 'Completion percentage (0-100)',
        example: 75
      },
      {
        name: 'deploymentId',
        type: 'string',
        optional: true,
        description: 'Associated deployment ID',
        example: 'deploy-123'
      }
    ],
    usedBy: ['GetJobResponse', 'GetJobsResponse'],
    examples: [
      {
        id: 'job-install-nextcloud',
        type: 'install',
        status: 'running',
        startedAt: '2025-08-12T10:00:00Z',
        progress: 45,
        deploymentId: 'nextcloud-deploy'
      }
    ]
  },

  // ===== DEPLOYMENTS =====

  DeploymentStatus: {
    name: 'DeploymentStatus',
    category: 'union',
    description: 'Current status of a deployment',
    properties: [
      {
        name: 'Values',
        type: "'running' | 'stopped' | 'installing' | 'updating' | 'error'",
        optional: false,
        description: 'Possible deployment status values'
      }
    ],
    usedBy: ['DeploymentListItem', 'DeploymentDetail'],
    examples: ['running', 'stopped', 'error']
  },

  DeploymentListItem: {
    name: 'DeploymentListItem',
    category: 'interface',
    description: 'Summary information for deployment in list views',
    properties: [
      {
        name: 'id',
        type: 'string',
        optional: false,
        description: 'Unique deployment identifier',
        example: 'nextcloud-deploy'
      },
      {
        name: 'name',
        type: 'string',
        optional: false,
        description: 'Human-readable deployment name',
        example: 'My Nextcloud'
      },
      {
        name: 'app',
        type: 'string',
        optional: false,
        description: 'Application type',
        example: 'Nextcloud'
      },
      {
        name: 'icon',
        type: 'string',
        optional: false,
        description: 'App icon (emoji or URL)',
        example: '☁️'
      },
      {
        name: 'status',
        type: 'DeploymentStatus',
        optional: false,
        description: 'Current deployment status',
        example: 'running'
      },
      {
        name: 'uptime',
        type: 'string',
        optional: true,
        description: 'Human-readable uptime',
        example: '2d 5h 30m'
      },
      {
        name: 'version',
        type: 'string',
        optional: true,
        description: 'Application version',
        example: '28.0.3'
      },
      {
        name: 'resources',
        type: '{ cpu: string; memory: string }',
        optional: true,
        description: 'Resource usage summary',
        example: { cpu: '2%', memory: '256MB' }
      },
      {
        name: 'ports',
        type: 'string[]',
        optional: false,
        description: 'Exposed ports',
        example: ['8080:80']
      },
      {
        name: 'lastUpdated',
        type: 'string',
        optional: false,
        description: 'Last update timestamp',
        example: '2025-08-12T10:00:00Z'
      },
      {
        name: 'url',
        type: 'string',
        optional: true,
        description: 'Public access URL',
        example: 'https://nextcloud.example.com'
      }
    ],
    usedBy: ['GetDeploymentsResponse'],
    examples: [
      {
        id: 'nextcloud-1',
        name: 'My Nextcloud',
        app: 'Nextcloud',
        icon: '☁️',
        status: 'running',
        uptime: '2d 5h',
        version: '28.0.3',
        resources: { cpu: '2%', memory: '256MB' },
        ports: ['8080:80'],
        lastUpdated: '2025-08-12T10:00:00Z',
        url: 'https://nextcloud.example.com'
      }
    ]
  },

  // ===== CATALOG =====

  CatalogApp: {
    name: 'CatalogApp',
    category: 'interface',
    description: 'Application listing in the catalog',
    properties: [
      {
        name: 'id',
        type: 'string',
        optional: false,
        description: 'Unique application identifier',
        example: 'nextcloud'
      },
      {
        name: 'name',
        type: 'string',
        optional: false,
        description: 'Application display name',
        example: 'Nextcloud'
      },
      {
        name: 'description',
        type: 'string',
        optional: false,
        description: 'Application description',
        example: 'Self-hosted cloud storage and collaboration platform'
      },
      {
        name: 'icon',
        type: 'string',
        optional: false,
        description: 'App icon (emoji or URL)',
        example: '☁️'
      },
      {
        name: 'category',
        type: 'string',
        optional: false,
        description: 'Application category',
        example: 'Productivity'
      },
      {
        name: 'rating',
        type: 'number',
        optional: false,
        description: 'User rating (0-5)',
        example: 4.5
      },
      {
        name: 'downloads',
        type: 'string | number',
        optional: false,
        description: 'Download count',
        example: '10k+'
      },
      {
        name: 'tags',
        type: 'string[]',
        optional: false,
        description: 'Application tags',
        example: ['cloud', 'storage', 'collaboration']
      },
      {
        name: 'featured',
        type: 'boolean',
        optional: false,
        description: 'Whether app is featured',
        example: true
      }
    ],
    usedBy: ['GetCatalogAppsResponse', 'GetCatalogAppResponse'],
    examples: [
      {
        id: 'nextcloud',
        name: 'Nextcloud',
        description: 'Self-hosted cloud storage platform',
        icon: '☁️',
        category: 'Productivity',
        rating: 4.5,
        downloads: '10k+',
        tags: ['cloud', 'storage'],
        featured: true
      }
    ]
  },

  // ===== SSE EVENTS =====

  SSEEvent: {
    name: 'SSEEvent',
    category: 'union',
    description: 'Server-Sent Event types for real-time updates',
    properties: [
      {
        name: 'Types',
        type: 'SSELogEvent | SSEJobUpdateEvent | SSESystemUpdateEvent | SSEDeploymentUpdateEvent',
        optional: false,
        description: 'Union of all possible SSE event types'
      }
    ],
    usedBy: ['Real-time streaming endpoints'],
    examples: [
      {
        type: 'log',
        data: {
          timestamp: '2025-08-12T10:00:00Z',
          service: 'nextcloud',
          level: 'info',
          message: 'Service started successfully'
        }
      }
    ]
  },

  SSELogEvent: {
    name: 'SSELogEvent',
    category: 'interface',
    description: 'Real-time log entry event',
    properties: [
      {
        name: 'type',
        type: "'log'",
        optional: false,
        description: 'Event type identifier',
        example: 'log'
      },
      {
        name: 'data',
        type: 'LogEntry',
        optional: false,
        description: 'Log entry data',
        example: {
          timestamp: '2025-08-12T10:00:00Z',
          service: 'nextcloud',
          level: 'info',
          message: 'User login successful'
        }
      }
    ],
    usedBy: ['Log streaming endpoints'],
    examples: [
      {
        type: 'log',
        data: {
          timestamp: '2025-08-12T10:00:00Z',
          service: 'postgres',
          level: 'info',
          message: 'Database connection established'
        }
      }
    ]
  }
};

/**
 * Generate type relationships graph
 */
export function generateTypeRelationships(): TypeRelationship[] {
  const relationships: TypeRelationship[] = [];

  // Extract relationships from type registry
  for (const [typeName, typeDef] of Object.entries(TYPE_REGISTRY)) {
    // Extends relationships
    if (typeDef.extends) {
      for (const extendedType of typeDef.extends) {
        relationships.push({
          from: typeName,
          to: extendedType,
          relationship: 'extends',
          description: `${typeName} extends ${extendedType}`
        });
      }
    }

    // Usage relationships
    if (typeDef.usedBy) {
      for (const usingType of typeDef.usedBy) {
        relationships.push({
          from: usingType,
          to: typeName,
          relationship: 'uses',
          description: `${usingType} uses ${typeName}`
        });
      }
    }

    // Property type relationships
    if (typeDef.properties) {
      for (const prop of typeDef.properties) {
        const propType = extractTypeFromString(prop.type);
        if (propType && TYPE_REGISTRY[propType]) {
          relationships.push({
            from: typeName,
            to: propType,
            relationship: 'contains',
            description: `${typeName}.${prop.name} is of type ${propType}`
          });
        }
      }
    }
  }

  return relationships;
}

/**
 * Extract type name from type string (e.g., "User[]" -> "User")
 */
function extractTypeFromString(typeStr: string): string | null {
  // Remove array brackets, optional markers, union types, etc.
  const cleaned = typeStr
    .replace(/\[\]/g, '')  // Remove array brackets
    .replace(/\?/g, '')    // Remove optional markers
    .split('|')[0]         // Take first type from union
    .split('<')[0]         // Remove generics
    .trim();
  
  // Return null for primitive types
  if (['string', 'number', 'boolean', 'unknown', 'any', 'void'].includes(cleaned)) {
    return null;
  }
  
  return cleaned;
}

/**
 * Get all types that depend on a given type
 */
export function getTypeDependents(typeName: string): string[] {
  const dependents: string[] = [];
  const relationships = generateTypeRelationships();
  
  for (const rel of relationships) {
    if (rel.to === typeName && ['uses', 'contains', 'extends'].includes(rel.relationship)) {
      dependents.push(rel.from);
    }
  }
  
  return [...new Set(dependents)]; // Remove duplicates
}

/**
 * Get all types that a given type depends on
 */
export function getTypeDependencies(typeName: string): string[] {
  const dependencies: string[] = [];
  const relationships = generateTypeRelationships();
  
  for (const rel of relationships) {
    if (rel.from === typeName && ['uses', 'contains', 'extends'].includes(rel.relationship)) {
      dependencies.push(rel.to);
    }
  }
  
  return [...new Set(dependencies)]; // Remove duplicates
}

/**
 * Search types by name or description
 */
export function searchTypes(query: string): TypeDefinition[] {
  const lowercaseQuery = query.toLowerCase();
  return Object.values(TYPE_REGISTRY).filter(type => 
    type.name.toLowerCase().includes(lowercaseQuery) ||
    type.description.toLowerCase().includes(lowercaseQuery) ||
    type.category.toLowerCase().includes(lowercaseQuery)
  );
}

/**
 * Get types by category
 */
export function getTypesByCategory(category: TypeDefinition['category']): TypeDefinition[] {
  return Object.values(TYPE_REGISTRY).filter(type => type.category === category);
}

/**
 * Generate usage examples for a type
 */
export function generateTypeUsageExamples(typeName: string): string[] {
  const typeDef = TYPE_REGISTRY[typeName];
  if (!typeDef) return [];

  const examples: string[] = [];

  // Add basic usage examples
  if (typeDef.examples) {
    examples.push(
      `// Example ${typeName} usage:\nconst example: ${typeName} = ${JSON.stringify(typeDef.examples[0], null, 2)};`
    );
  }

  // Add property access examples
  if (typeDef.properties && typeDef.examples?.[0]) {
    const exampleValue = typeDef.examples[0] as Record<string, unknown>;
    for (const prop of typeDef.properties.slice(0, 3)) { // Show first 3 properties
      if (prop.name in exampleValue) {
        examples.push(
          `// Accessing ${prop.name} property:\nconst ${prop.name} = ${typeName.toLowerCase()}.${prop.name}; // ${JSON.stringify(exampleValue[prop.name])}`
        );
      }
    }
  }

  // Add API usage examples
  const dependents = getTypeDependents(typeName);
  if (dependents.length > 0) {
    examples.push(
      `// Used in API responses:\n// ${dependents.slice(0, 3).join(', ')}${dependents.length > 3 ? ` and ${dependents.length - 3} more` : ''}`
    );
  }

  return examples;
}

/**
 * Generate HTML page for type browser
 */
export function generateTypeBrowserHTML(): string {
  const types = Object.values(TYPE_REGISTRY);
  const categories = [...new Set(types.map(t => t.category))];
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hola API Type Browser</title>
  <style>
    * { box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background: #f8fafc;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: white;
      min-height: 100vh;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
      display: grid;
      grid-template-columns: 300px 1fr;
      grid-template-rows: auto 1fr;
      grid-template-areas: 
        "header header"
        "sidebar content";
    }
    
    .header {
      grid-area: header;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: white;
      padding: 2rem;
      text-align: center;
    }
    
    .header h1 {
      margin: 0;
      font-size: 2.2rem;
      font-weight: 700;
    }
    
    .header p {
      margin: 1rem 0 0 0;
      opacity: 0.9;
    }
    
    .sidebar {
      grid-area: sidebar;
      background: #f8fafc;
      border-right: 1px solid #e2e8f0;
      padding: 1.5rem;
      overflow-y: auto;
      max-height: calc(100vh - 160px);
    }
    
    .search-box {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    
    .category-filter {
      margin-bottom: 1.5rem;
    }
    
    .category-filter label {
      display: block;
      font-weight: 600;
      color: #374151;
      margin-bottom: 0.5rem;
    }
    
    .category-filter select {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.9rem;
    }
    
    .type-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    
    .type-item {
      margin-bottom: 0.5rem;
    }
    
    .type-link {
      display: block;
      padding: 0.75rem;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      text-decoration: none;
      color: #374151;
      transition: all 0.2s;
      cursor: pointer;
    }
    
    .type-link:hover {
      background: #f1f5f9;
      border-color: #6366f1;
      transform: translateX(2px);
    }
    
    .type-link.active {
      background: #6366f1;
      color: white;
      border-color: #6366f1;
    }
    
    .type-name {
      font-weight: 600;
      font-size: 0.9rem;
    }
    
    .type-category {
      font-size: 0.75rem;
      opacity: 0.7;
      margin-top: 0.25rem;
    }
    
    .content {
      grid-area: content;
      padding: 2rem;
      overflow-y: auto;
      max-height: calc(100vh - 160px);
    }
    
    .type-detail {
      display: none;
    }
    
    .type-detail.active {
      display: block;
    }
    
    .type-header {
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 1rem;
      margin-bottom: 2rem;
    }
    
    .type-title {
      font-size: 2rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .type-badge {
      background: #6366f1;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
    }
    
    .type-description {
      color: #64748b;
      font-size: 1.1rem;
      margin: 1rem 0 0 0;
      line-height: 1.5;
    }
    
    .properties-section {
      margin-bottom: 2rem;
    }
    
    .section-title {
      font-size: 1.3rem;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 1rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .properties-table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .properties-table th {
      background: #f8fafc;
      padding: 0.75rem 1rem;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .properties-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    
    .properties-table tr:last-child td {
      border-bottom: none;
    }
    
    .property-name {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-weight: 600;
      color: #6366f1;
    }
    
    .property-type {
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      color: #059669;
      background: #f0fdf4;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-size: 0.85rem;
    }
    
    .optional-indicator {
      color: #f59e0b;
      font-weight: 600;
    }
    
    .examples-section {
      margin-bottom: 2rem;
    }
    
    .example-item {
      background: #1e293b;
      color: #e2e8f0;
      border: 1px solid #334155;
      padding: 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
      font-size: 0.85rem;
      overflow-x: auto;
      white-space: pre;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      text-shadow: none !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .relationships-section {
      margin-bottom: 2rem;
    }
    
    .relationship-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1rem;
    }
    
    .relationship-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 1rem;
    }
    
    .relationship-title {
      font-weight: 600;
      color: #374151;
      margin: 0 0 0.5rem 0;
    }
    
    .relationship-links {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    
    .relationship-link {
      background: #6366f1;
      color: white;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.8rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .relationship-link:hover {
      background: #4f46e5;
    }
    
    .stats {
      background: #f1f5f9;
      padding: 1rem 2rem;
      text-align: center;
      color: #64748b;
      font-size: 0.9rem;
      border-top: 1px solid #e2e8f0;
    }
    
    .hidden {
      display: none !important;
    }
    
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: #64748b;
    }
    
    @media (max-width: 1024px) {
      .container {
        grid-template-columns: 1fr;
        grid-template-areas: 
          "header"
          "sidebar"
          "content";
      }
      
      .sidebar {
        max-height: none;
        border-right: none;
        border-bottom: 1px solid #e2e8f0;
      }
      
      .content {
        max-height: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔍 Hola API Type Browser</h1>
      <p>Explore TypeScript types, their relationships, and usage patterns</p>
    </div>
    
    <div class="sidebar">
      <input type="text" id="searchBox" class="search-box" placeholder="Search types..." onkeyup="searchTypes()">
      
      <div class="category-filter">
        <label for="categoryFilter">Filter by Category:</label>
        <select id="categoryFilter" onchange="filterByCategory()">
          <option value="all">All Categories</option>
          ${categories.map(cat => `<option value="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`).join('')}
        </select>
      </div>
      
      <ul class="type-list" id="typeList">
        ${types.map(type => `
          <li class="type-item" data-category="${type.category}" data-name="${type.name.toLowerCase()}">
            <div class="type-link" onclick="showTypeDetail('${type.name}')">
              <div class="type-name">${type.name}</div>
              <div class="type-category">${type.category}</div>
            </div>
          </li>
        `).join('')}
      </ul>
    </div>
    
    <div class="content">
      <div id="emptyState" class="empty-state">
        <h3>Select a type to explore</h3>
        <p>Choose a type from the sidebar to view its properties, relationships, and usage examples.</p>
      </div>
      
      ${types.map(type => `
        <div id="type-${type.name}" class="type-detail">
          <div class="type-header">
            <h1 class="type-title">
              ${type.name}
              <span class="type-badge">${type.category}</span>
            </h1>
            <p class="type-description">${type.description}</p>
          </div>
          
          ${type.properties ? `
            <div class="properties-section">
              <h2 class="section-title">📋 Properties</h2>
              <table class="properties-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Type</th>
                    <th>Required</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  ${type.properties.map(prop => `
                    <tr>
                      <td class="property-name">${prop.name}</td>
                      <td class="property-type">${escapeHtml(prop.type)}</td>
                      <td>${prop.optional ? '<span class="optional-indicator">Optional</span>' : 'Required'}</td>
                      <td>${prop.description || 'No description'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : ''}
          
          ${type.examples && type.examples.length > 0 ? `
            <div class="examples-section">
              <h2 class="section-title">💡 Examples</h2>
              ${type.examples.map(example => `
                <div class="example-item">${JSON.stringify(example, null, 2)}</div>
              `).join('')}
            </div>
          ` : ''}
          
          <div class="relationships-section">
            <h2 class="section-title">🔗 Relationships</h2>
            <div class="relationship-list">
              ${type.usedBy && type.usedBy.length > 0 ? `
                <div class="relationship-card">
                  <h3 class="relationship-title">Used By</h3>
                  <div class="relationship-links">
                    ${type.usedBy.map(ref => `<span class="relationship-link" onclick="showTypeDetail('${ref}')">${ref}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
              
              ${type.extends && type.extends.length > 0 ? `
                <div class="relationship-card">
                  <h3 class="relationship-title">Extends</h3>
                  <div class="relationship-links">
                    ${type.extends.map(ref => `<span class="relationship-link" onclick="showTypeDetail('${ref}')">${ref}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  </div>
  
  <div class="stats">
    Total: ${types.length} types across ${categories.length} categories
  </div>
  
  <script>
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function showTypeDetail(typeName) {
      // Hide all type details
      const details = document.querySelectorAll('.type-detail');
      details.forEach(detail => detail.classList.remove('active'));
      
      // Hide empty state
      document.getElementById('emptyState').classList.add('hidden');
      
      // Show selected type detail
      const targetDetail = document.getElementById('type-' + typeName);
      if (targetDetail) {
        targetDetail.classList.add('active');
      }
      
      // Update active state in sidebar
      const typeLinks = document.querySelectorAll('.type-link');
      typeLinks.forEach(link => link.classList.remove('active'));
      
      const activeLink = document.querySelector('[onclick="showTypeDetail(\\'' + typeName + '\\')"]');
      if (activeLink) {
        activeLink.classList.add('active');
      }
    }
    
    function searchTypes() {
      const searchTerm = document.getElementById('searchBox').value.toLowerCase();
      const typeItems = document.querySelectorAll('.type-item');
      
      typeItems.forEach(item => {
        const typeName = item.dataset.name;
        if (searchTerm === '' || typeName.includes(searchTerm)) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    }
    
    function filterByCategory() {
      const selectedCategory = document.getElementById('categoryFilter').value;
      const typeItems = document.querySelectorAll('.type-item');
      
      typeItems.forEach(item => {
        const itemCategory = item.dataset.category;
        if (selectedCategory === 'all' || itemCategory === selectedCategory) {
          item.style.display = 'block';
        } else {
          item.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
}
