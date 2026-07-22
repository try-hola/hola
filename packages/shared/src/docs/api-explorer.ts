/**
 * Interactive API documentation and exploration system
 * 
 * This module provides tools for generating interactive API documentation,
 * including OpenAPI schema generation, Swagger UI integration, and ReDoc setup.
 */

// Note: This module generates documentation metadata and string-based schemas.
// It does not require importing runtime or type symbols from the shared index.

/**
 * HTTP methods supported by the API
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * OpenAPI parameter definition
 */
export interface OpenAPIParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  description?: string;
  required: boolean;
  schema: {
    type: string;
    format?: string;
    enum?: string[];
    minimum?: number;
    maximum?: number;
    pattern?: string;
    default?: unknown;
  };
  example?: unknown;
}

/**
 * OpenAPI request body definition
 */
export interface OpenAPIRequestBody {
  description?: string;
  required: boolean;
  content: {
    [mediaType: string]: {
      schema: object;
      example?: unknown;
    };
  };
}

/**
 * OpenAPI response definition
 */
export interface OpenAPIResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: object;
      example?: unknown;
    };
  };
  headers?: {
    [headerName: string]: {
      description?: string;
      schema: object;
    };
  };
}

/**
 * OpenAPI operation definition
 */
export interface OpenAPIOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: {
    [statusCode: string]: OpenAPIResponse;
  };
  security?: Array<{ [securityScheme: string]: string[] }>;
  deprecated?: boolean;
}

/**
 * OpenAPI path item definition
 */
export interface OpenAPIPathItem {
  [method: string]: OpenAPIOperation;
}

/**
 * Complete OpenAPI specification
 */
export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description: string;
    version: string;
    contact?: {
      name: string;
      email: string;
      url: string;
    };
    license?: {
      name: string;
      url: string;
    };
  };
  servers: Array<{
    url: string;
    description: string;
  }>;
  paths: {
    [path: string]: OpenAPIPathItem;
  };
  components: {
    schemas: {
      [schemaName: string]: object;
    };
    securitySchemes: {
      [schemeName: string]: object;
    };
  };
  tags: Array<{
    name: string;
    description: string;
  }>;
}

/**
 * API endpoint metadata for documentation generation
 */
export interface EndpointMetadata {
  path: string;
  method: HttpMethod;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  parameters?: OpenAPIParameter[];
  requestBodyType?: string;
  responseType: string;
  examples?: {
    request?: unknown;
    response?: unknown;
  };
  deprecated?: boolean;
}

/**
 * Complete API documentation metadata
 */
export const API_ENDPOINTS: EndpointMetadata[] = [
  // Health & System
  {
    path: '/api/health',
    method: 'GET',
    operationId: 'getHealth',
    summary: 'Health Check',
    description: 'Check if the API server is running and healthy',
    tags: ['system'],
    responseType: 'HealthResponse',
    examples: {
      response: { ok: true, ts: '2025-08-12T10:00:00Z' }
    }
  },
  {
    path: '/api/hello',
    method: 'GET',
    operationId: 'getHello',
    summary: 'Hello World',
    description: 'Simple hello world endpoint for testing connectivity',
    tags: ['system'],
    responseType: 'HelloResponse',
    examples: {
      response: { message: 'Hello from Bun server' }
    }
  },
  {
    path: '/api/me',
    method: 'GET',
    operationId: 'getMe',
    summary: 'Get Current User',
    description: 'Get information about the currently authenticated user',
    tags: ['identity'],
    responseType: 'GetMeResponse',
    examples: {
      response: { id: 'demo-user', email: 'demo@example.com', name: 'Demo User', roles: ['user'] }
    }
  },
  {
    path: '/api/summary',
    method: 'GET',
    operationId: 'getSummary',
    summary: 'Get Dashboard Summary',
    description: 'Get summary data for the main dashboard including deployment counts, active jobs, and system status',
    tags: ['dashboard'],
    responseType: 'GetSummaryResponse'
  },
  {
    path: '/api/system/status',
    method: 'GET',
    operationId: 'getSystemStatus',
    summary: 'Get System Status',
    description: 'Get detailed system status including Docker, disk usage, and service health',
    tags: ['system'],
    responseType: 'GetSystemStatusResponse'
  },
  
  // Catalog
  {
    path: '/api/catalog/apps',
    method: 'GET',
    operationId: 'getCatalogApps',
    summary: 'List Catalog Apps',
    description: 'Get a paginated list of available applications from the catalog with optional search and filtering',
    tags: ['catalog'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 12 }
      },
      {
        name: 'query',
        in: 'query',
        description: 'Search query to filter applications',
        required: false,
        schema: { type: 'string' }
      },
      {
        name: 'category',
        in: 'query',
        description: 'Filter by application category',
        required: false,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetCatalogAppsResponse'
  },
  {
    path: '/api/catalog/apps/{appId}',
    method: 'GET',
    operationId: 'getCatalogApp',
    summary: 'Get Catalog App Details',
    description: 'Get detailed information about a specific catalog application',
    tags: ['catalog'],
    parameters: [
      {
        name: 'appId',
        in: 'path',
        description: 'Application identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetCatalogAppResponse'
  },
  {
    path: '/api/catalog/apps/{appId}/versions',
    method: 'GET',
    operationId: 'getCatalogAppVersions',
    summary: 'Get App Versions',
    description: 'Get available versions for a catalog application',
    tags: ['catalog'],
    parameters: [
      {
        name: 'appId',
        in: 'path',
        description: 'Application identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetCatalogAppVersionsResponse'
  },
  {
    path: '/api/catalog/apps/{appId}/versions/{version}',
    method: 'GET',
    operationId: 'getCatalogAppVersionDetail',
    summary: 'Get App Version Details',
    description: 'Get detailed configuration for a specific version of a catalog application',
    tags: ['catalog'],
    parameters: [
      {
        name: 'appId',
        in: 'path',
        description: 'Application identifier',
        required: true,
        schema: { type: 'string' }
      },
      {
        name: 'version',
        in: 'path',
        description: 'Application version',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetCatalogAppVersionDetailResponse'
  },
  
  // Drafts (Install Wizard)
  {
    path: '/api/drafts',
    method: 'POST',
    operationId: 'createDraft',
    summary: 'Create Installation Draft',
    description: 'Create a new installation draft for configuring an application before deployment',
    tags: ['install'],
    requestBodyType: 'CreateDraftRequest',
    responseType: 'CreateDraftResponse',
    examples: {
      request: { appId: 'nextcloud', version: '1.0.0' },
      response: {
        draftId: 'uuid-here',
        app: { id: 'nextcloud', name: 'Nextcloud', icon: '☁️' },
        systemEnv: [],
        appEnv: [],
        defaults: { ports: [], volumes: [] }
      }
    }
  },
  {
    path: '/api/drafts/{draftId}',
    method: 'GET',
    operationId: 'getDraft',
    summary: 'Get Installation Draft',
    description: 'Get the current state of an installation draft',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetDraftResponse'
  },
  {
    path: '/api/drafts/{draftId}',
    method: 'PATCH',
    operationId: 'updateDraft',
    summary: 'Update Installation Draft',
    description: 'Update configuration of an installation draft',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBodyType: 'PatchDraftRequest',
    responseType: 'PatchDraftResponse'
  },
  {
    path: '/api/drafts/{draftId}/uploads',
    method: 'POST',
    operationId: 'uploadDraftFile',
    summary: 'Upload Draft File',
    description: 'Upload a file to an installation draft (compose override or additional files)',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'UploadDraftFileResponse'
  },
  {
    path: '/api/drafts/{draftId}/uploads/{uploadId}',
    method: 'DELETE',
    operationId: 'deleteDraftFile',
    summary: 'Delete Draft File',
    description: 'Remove an uploaded file from an installation draft',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      },
      {
        name: 'uploadId',
        in: 'path',
        description: 'Upload identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'DeleteDraftFileResponse'
  },
  {
    path: '/api/drafts/{draftId}/validate',
    method: 'POST',
    operationId: 'validateDraft',
    summary: 'Validate Installation Draft',
    description: 'Validate an installation draft configuration and return any errors or warnings',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'ValidateDraftResponse'
  },
  {
    path: '/api/drafts/{draftId}/preflight',
    method: 'POST',
    operationId: 'preflightDraft',
    summary: 'Run Preflight Checks',
    description: 'Run system compatibility checks for an installation draft',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'PreflightResponse'
  },
  {
    path: '/api/drafts/{draftId}/finalize',
    method: 'POST',
    operationId: 'finalizeDraft',
    summary: 'Finalize Installation Draft',
    description: 'Generate final deployment specification from installation draft',
    tags: ['install'],
    parameters: [
      {
        name: 'draftId',
        in: 'path',
        description: 'Draft identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'FinalizeDraftResponse'
  },
  
  // Deployments
  {
    path: '/api/deployments',
    method: 'GET',
    operationId: 'getDeployments',
    summary: 'List Deployments',
    description: 'Get a paginated list of deployments with optional filtering',
    tags: ['deployments'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 12 }
      },
      {
        name: 'q',
        in: 'query',
        description: 'Search query to filter deployments',
        required: false,
        schema: { type: 'string' }
      },
      {
        name: 'status',
        in: 'query',
        description: 'Filter by deployment status',
        required: false,
        schema: { 
          type: 'string',
          enum: ['all', 'running', 'stopped', 'installing', 'updating', 'error'],
          default: 'all'
        }
      }
    ],
    responseType: 'GetDeploymentsResponse'
  },
  {
    path: '/api/deployments',
    method: 'POST',
    operationId: 'createDeployment',
    summary: 'Create Deployment from Draft',
    description: 'Create a new deployment from a finalized installation draft',
    tags: ['deployments'],
    requestBodyType: 'CreateDeploymentRequest',
    responseType: 'PostDeploymentActionResponse'
  },
  {
    path: '/api/deployments/{deploymentId}',
    method: 'GET',
    operationId: 'getDeployment',
    summary: 'Get Deployment Details',
    description: 'Get detailed information about a specific deployment',
    tags: ['deployments'],
    parameters: [
      {
        name: 'deploymentId',
        in: 'path',
        description: 'Deployment identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetDeploymentResponse'
  },
  {
    path: '/api/deployments/{deploymentId}',
    method: 'PATCH',
    operationId: 'updateDeployment',
    summary: 'Update Deployment Configuration',
    description: 'Update configuration of an existing deployment. Env changes merge by key: vars in `env` are upserted, vars omitted are left untouched, and keys in `removeEnvKeys` are deleted.',
    tags: ['deployments'],
    parameters: [
      {
        name: 'deploymentId',
        in: 'path',
        description: 'Deployment identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBodyType: 'PatchDeploymentRequest',
    responseType: 'PatchDeploymentResponse'
  },
  {
    path: '/api/deployments/{deploymentId}/actions',
    method: 'POST',
    operationId: 'executeDeploymentAction',
    summary: 'Execute Deployment Action',
    description: 'Execute an action on a deployment (start, stop, restart, delete)',
    tags: ['deployments'],
    parameters: [
      {
        name: 'deploymentId',
        in: 'path',
        description: 'Deployment identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBodyType: 'PostDeploymentActionRequest',
    responseType: 'PostDeploymentActionResponse',
    examples: {
      request: { action: 'restart' },
      response: { ok: true, jobId: 'job-uuid' }
    }
  },
  {
    path: '/api/deployments/{deploymentId}/history',
    method: 'GET',
    operationId: 'getDeploymentHistory',
    summary: 'Get Deployment History',
    description: 'Get paginated history of actions performed on a deployment',
    tags: ['deployments'],
    parameters: [
      {
        name: 'deploymentId',
        in: 'path',
        description: 'Deployment identifier',
        required: true,
        schema: { type: 'string' }
      },
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 }
      }
    ],
    responseType: 'GetDeploymentHistoryResponse'
  },
  {
    path: '/api/deployments/{deploymentId}/logs/stream',
    method: 'GET',
    operationId: 'streamDeploymentLogs',
    summary: 'Stream Deployment Logs (SSE)',
    description: 'Stream real-time logs from a deployment via Server-Sent Events',
    tags: ['deployments', 'logs'],
    parameters: [
      {
        name: 'deploymentId',
        in: 'path',
        description: 'Deployment identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'text/event-stream'
  },
  
  // Jobs
  {
    path: '/api/jobs',
    method: 'GET',
    operationId: 'getJobs',
    summary: 'List Jobs',
    description: 'Get a paginated list of jobs with optional filtering by deployment or status',
    tags: ['jobs'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
      },
      {
        name: 'deploymentId',
        in: 'query',
        description: 'Filter jobs by deployment',
        required: false,
        schema: { type: 'string' }
      },
      {
        name: 'status',
        in: 'query',
        description: 'Filter jobs by status',
        required: false,
        schema: { 
          type: 'string',
          enum: ['all', 'queued', 'running', 'completed', 'failed'],
          default: 'all'
        }
      }
    ],
    responseType: 'GetJobsResponse'
  },
  {
    path: '/api/jobs/{jobId}',
    method: 'GET',
    operationId: 'getJob',
    summary: 'Get Job Details',
    description: 'Get detailed information about a specific job',
    tags: ['jobs'],
    parameters: [
      {
        name: 'jobId',
        in: 'path',
        description: 'Job identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetJobResponse'
  },
  {
    path: '/api/jobs/{jobId}/logs/stream',
    method: 'GET',
    operationId: 'streamJobLogs',
    summary: 'Stream Job Logs (SSE)',
    description: 'Stream real-time logs and progress updates from a job via Server-Sent Events',
    tags: ['jobs', 'logs'],
    parameters: [
      {
        name: 'jobId',
        in: 'path',
        description: 'Job identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'text/event-stream'
  },
  
  // Backups
  {
    path: '/api/backups',
    method: 'GET',
    operationId: 'getBackups',
    summary: 'List Backups',
    description: 'Get a paginated list of backups with optional filtering',
    tags: ['backups'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
      },
      {
        name: 'appId',
        in: 'query',
        description: 'Filter backups by application',
        required: false,
        schema: { type: 'string' }
      },
      {
        name: 'status',
        in: 'query',
        description: 'Filter backups by status',
        required: false,
        schema: { 
          type: 'string',
          enum: ['completed', 'failed', 'running']
        }
      }
    ],
    responseType: 'GetBackupsResponse'
  },
  {
    path: '/api/backups',
    method: 'POST',
    operationId: 'createBackup',
    summary: 'Create Backup',
    description: 'Create a new backup for an application',
    tags: ['backups'],
    requestBodyType: 'CreateBackupRequest',
    responseType: 'CreateBackupResponse',
    examples: {
      request: { appId: 'nextcloud' },
      response: { jobId: 'job-uuid', backupId: 'backup-uuid' }
    }
  },
  {
    path: '/api/backups/{backupId}',
    method: 'GET',
    operationId: 'getBackup',
    summary: 'Get Backup Details',
    description: 'Get detailed information about a specific backup',
    tags: ['backups'],
    parameters: [
      {
        name: 'backupId',
        in: 'path',
        description: 'Backup identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'GetBackupResponse'
  },
  {
    path: '/api/backups/{backupId}/restore',
    method: 'POST',
    operationId: 'restoreBackup',
    summary: 'Restore Backup',
    description: 'Restore a backup to a deployment',
    tags: ['backups'],
    parameters: [
      {
        name: 'backupId',
        in: 'path',
        description: 'Backup identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBodyType: 'RestoreBackupRequest',
    responseType: 'RestoreBackupResponse'
  },
  {
    path: '/api/backups/{backupId}',
    method: 'DELETE',
    operationId: 'deleteBackup',
    summary: 'Delete Backup',
    description: 'Delete a backup permanently',
    tags: ['backups'],
    parameters: [
      {
        name: 'backupId',
        in: 'path',
        description: 'Backup identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    responseType: 'DeleteBackupResponse'
  },
  
  // Notifications
  {
    path: '/api/notifications',
    method: 'GET',
    operationId: 'getNotifications',
    summary: 'List Notifications',
    description: 'Get a paginated list of notifications with optional filtering',
    tags: ['notifications'],
    parameters: [
      {
        name: 'page',
        in: 'query',
        description: 'Page number for pagination',
        required: false,
        schema: { type: 'integer', minimum: 1, default: 1 }
      },
      {
        name: 'limit',
        in: 'query',
        description: 'Number of items per page',
        required: false,
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
      },
      {
        name: 'filter',
        in: 'query',
        description: 'Filter notifications by read status or type',
        required: false,
        schema: { 
          type: 'string',
          enum: ['all', 'unread', 'type:error', 'type:success', 'type:warning', 'type:info', 'type:update']
        }
      }
    ],
    responseType: 'GetNotificationsResponse'
  },
  {
    path: '/api/notifications/{notificationId}',
    method: 'PATCH',
    operationId: 'updateNotification',
    summary: 'Update Notification',
    description: 'Update notification read status or dismiss it',
    tags: ['notifications'],
    parameters: [
      {
        name: 'notificationId',
        in: 'path',
        description: 'Notification identifier',
        required: true,
        schema: { type: 'string' }
      }
    ],
    requestBodyType: 'PatchNotificationRequest',
    responseType: 'PatchNotificationResponse'
  },
  {
    path: '/api/notifications/actions',
    method: 'POST',
    operationId: 'executeNotificationAction',
    summary: 'Execute Notification Bulk Action',
    description: 'Execute bulk actions on notifications (mark all as read, dismiss all)',
    tags: ['notifications'],
    requestBodyType: 'PostNotificationsActionRequest',
    responseType: 'PostNotificationsActionResponse',
    examples: {
      request: { action: 'markAllRead' },
      response: { ok: true }
    }
  },
  
  // Settings
  {
    path: '/api/settings',
    method: 'GET',
    operationId: 'getSettings',
    summary: 'Get System Settings',
    description: 'Get current system settings including environment variables and service configuration',
    tags: ['settings'],
    responseType: 'GetSettingsResponse'
  },
  {
    path: '/api/settings',
    method: 'PATCH',
    operationId: 'updateSettings',
    summary: 'Update System Settings',
    description: 'Update system settings and configuration',
    tags: ['settings'],
    requestBodyType: 'PatchSettingsRequest',
    responseType: 'PatchSettingsResponse'
  },
  {
    path: '/api/settings/backup',
    method: 'GET',
    operationId: 'getBackupSettings',
    summary: 'Get Backup Settings',
    description: 'Get backup schedule and retention settings',
    tags: ['settings'],
    responseType: 'GetBackupSettingsResponse'
  },
  {
    path: '/api/settings/backup',
    method: 'PATCH',
    operationId: 'updateBackupSettings',
    summary: 'Update Backup Settings',
    description: 'Update backup schedule and retention configuration',
    tags: ['settings'],
    requestBodyType: 'PatchBackupSettingsRequest',
    responseType: 'PatchBackupSettingsResponse'
  },
];

/**
 * Generate TypeScript interface definitions for documentation
 */
export function generateTypeScriptSchemas(): Record<string, string> {
  return {
    // Common types
    ErrorResponse: `{
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}`,
    
    PageRequest: `{
  page?: number;
  limit?: number;
  q?: string;
}`,
    
    PageResponse: `<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
}`,
    
    // Health & Identity
    HealthResponse: `{
  ok: boolean;
  ts: string; // ISO timestamp
}`,
    
    HelloResponse: `{
  message: string;
}`,
    
    GetMeResponse: `{
  id: string;
  name: string;
  email: string;
  roles: string[];
}`,
    
    // Dashboard
    GetSummaryResponse: `{
  deploymentsCount: number;
  activeJobsCount: number;
  alertsCount: number;
  recentJobs: SummaryJob[];
  system: SystemStatus;
}`,
    
    SystemStatus: `{
  docker: { ok: boolean; version?: string };
  disk: { freeBytes: number; totalBytes: number };
  version: { hola: string; compose: string };
  oras?: { ok: boolean; version?: string };
  authentik?: { ok: boolean };
}`,

    // Catalog schemas
    GetCatalogAppsRequest: `{
  page?: number;
  limit?: number;
  q?: string;
  query?: string;
  category?: string;
}`,

    GetCatalogAppsResponse: `{
  items: CatalogApp[];
  page: number;
  limit: number;
  total: number;
}`,

    GetCatalogAppResponse: `{
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rating: number;
  downloads: string | number;
  tags: string[];
  featured: boolean;
  versions: string[];
}`,

    GetCatalogAppVersionsResponse: `{
  items: CatalogAppVersion[];
  total: number;
}`,

    GetCatalogAppVersionDetailResponse: `{
  defaultEnv: AppEnvVar[];
  defaults: DraftDefaults;
}`,

    // Draft schemas
    CreateDraftRequest: `{
  appId: string;
  version?: string;
}`,

    CreateDraftResponse: `{
  draftId: string;
  app: { id: string; name: string; icon: string };
  systemEnv: AppEnvVar[];
  appEnv: AppEnvVar[];
  defaults: DraftDefaults;
}`,

    GetDraftResponse: `{
  draftId: string;
  appId: string;
  version?: string;
  systemOverrides: Record<string, string>;
  appEnv: AppEnvVar[];
  ports: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  composeOverride?: string;
  files: Array<{ uploadId: string; name: string; size: number; kind: 'composeOverride' | 'additionalFile' }>;
}`,

    PatchDraftRequest: `{
  systemOverrides?: Record<string, string>;
  appEnv?: AppEnvVar[];
  ports?: Array<{ host?: number; container: number; protocol: 'tcp' | 'udp' }>;
  composeOverride?: string;
}`,

    PatchDraftResponse: `{
  ok: true;
  draft: Draft;
}`,

    UploadDraftFileResponse: `{
  uploadId: string;
  name: string;
  size: number;
  kind: 'composeOverride' | 'additionalFile';
}`,

    DeleteDraftFileResponse: `{
  ok: true;
}`,

    ValidateDraftResponse: `{
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field?: string; message: string }>;
}`,

    PreflightResponse: `{
  ok: boolean;
  checks: PreflightCheck[];
}`,

    FinalizeDraftResponse: `{
  spec: unknown;
  checksum: string;
}`,

    // Deployment schemas
    GetDeploymentsRequest: `{
  page?: number;
  limit?: number;
  q?: string;
  status?: 'running' | 'stopped' | 'installing' | 'updating' | 'error' | 'all';
}`,

    GetDeploymentsResponse: `{
  items: DeploymentListItem[];
  page: number;
  limit: number;
  total: number;
}`,

    GetDeploymentResponse: `{
  id: string;
  name: string;
  app: string;
  icon: string;
  status: 'running' | 'stopped' | 'installing' | 'updating' | 'error';
  uptime?: string;
  version?: string;
  url?: string;
  resources: { cpu: string; memory: string; disk?: string };
  ports: string[];
  lastUpdated: string;
}`,

    CreateDeploymentRequest: `{
  draftId: string;
}`,

    PatchDeploymentRequest: `{
  // Merge-by-key: vars listed are upserted; stored vars omitted here are left
  // untouched. Use removeEnvKeys to delete. (issue #332)
  env?: AppEnvVar[];
  removeEnvKeys?: string[];
  systemOverrides?: Record<string, string>;
}`,

    PatchDeploymentResponse: `{
  ok: true;
}`,

    PostDeploymentActionRequest: `{
  action: 'start' | 'stop' | 'restart' | 'delete';
}`,

    PostDeploymentActionResponse: `{
  ok?: boolean;
  jobId?: string;
}`,

    GetDeploymentHistoryResponse: `{
  items: DeploymentHistoryItem[];
  page: number;
  limit: number;
  total: number;
}`,

    // Job schemas
    GetJobsRequest: `{
  page?: number;
  limit?: number;
  q?: string;
  deploymentId?: string;
  status?: 'queued' | 'running' | 'completed' | 'failed';
}`,

    GetJobsResponse: `{
  items: Job[];
  page: number;
  limit: number;
  total: number;
}`,

    GetJobResponse: `{
  id: string;
  type: 'install' | 'update' | 'backup' | 'restore' | 'start' | 'stop' | 'restart';
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  progress?: number;
  deploymentId?: string;
}`,

    // Backup schemas
    GetBackupsRequest: `{
  page?: number;
  limit?: number;
  q?: string;
  appId?: string;
  status?: 'completed' | 'failed' | 'running';
}`,

    GetBackupsResponse: `{
  items: BackupItem[];
  page: number;
  limit: number;
  total: number;
}`,

    CreateBackupRequest: `{
  appId?: string;
}`,

    CreateBackupResponse: `{
  jobId: string;
  backupId?: string;
}`,

    GetBackupResponse: `{
  id: string;
  app: string;
  appId?: string;
  icon?: string;
  timestamp: string;
  sizeBytes: number;
  status: 'completed' | 'failed' | 'running';
  type: 'automatic' | 'manual';
  files?: Array<{ path: string; sizeBytes: number }>;
}`,

    RestoreBackupRequest: `{
  targetDeploymentId?: string;
}`,

    RestoreBackupResponse: `{
  jobId: string;
}`,

    DeleteBackupResponse: `{
  ok: true;
}`,

    // Notification schemas
    GetNotificationsRequest: `{
  page?: number;
  limit?: number;
  q?: string;
  filter?: 'all' | 'unread' | 'type:error' | 'type:success' | 'type:warning' | 'type:info' | 'type:update';
}`,

    GetNotificationsResponse: `{
  items: NotificationItem[];
  page: number;
  limit: number;
  total: number;
  unreadCount: number;
}`,

    PatchNotificationRequest: `{
  read?: boolean;
  dismiss?: true;
}`,

    PatchNotificationResponse: `{
  id: string;
  read: boolean;
}`,

    PostNotificationsActionRequest: `{
  action: 'markAllRead' | 'dismissAll';
}`,

    PostNotificationsActionResponse: `{
  ok: true;
}`,

    // Settings schemas
    GetSettingsResponse: `{
  systemEnv: SystemEnvVar[];
  docker?: { host?: string };
  tls?: { email?: string };
  notifications?: { smtpHost?: string; smtpUser?: string; smtpPassword?: string };
}`,

    PatchSettingsRequest: `{
  systemEnv?: SystemEnvVar[];
  docker?: { host?: string };
  tls?: { email?: string };
  notifications?: { smtpHost?: string; smtpUser?: string; smtpPassword?: string };
}`,

    PatchSettingsResponse: `{
  systemEnv: SystemEnvVar[];
  docker?: { host?: string };
  tls?: { email?: string };
  notifications?: { smtpHost?: string; smtpUser?: string; smtpPassword?: string };
}`,

    GetBackupSettingsResponse: `{
  scheduleEnabled: boolean;
  scheduleTime: string; // "HH:mm"
  retentionDays: number;
}`,

    PatchBackupSettingsRequest: `{
  scheduleEnabled?: boolean;
  scheduleTime?: string; // "HH:mm"
  retentionDays?: number;
}`,

    PatchBackupSettingsResponse: `{
  scheduleEnabled: boolean;
  scheduleTime: string; // "HH:mm"
  retentionDays: number;
}`,

    // System schemas
    GetSystemStatusResponse: `{
  docker: { ok: boolean; version?: string };
  disk: { freeBytes: number; totalBytes: number };
  version: { hola: string; compose: string };
  oras?: { ok: boolean; version?: string };
  authentik?: { ok: boolean };
}`,
  };
}

/**
 * Generate OpenAPI 3.0 specification
 */
export function generateOpenAPISpec(): OpenAPISpec {
  const spec: OpenAPISpec = {
    openapi: '3.0.3',
    info: {
      title: 'Hola Application Platform API',
      description: `
# Hola API Documentation

The Hola Application Platform provides a comprehensive REST API for managing containerized applications, deployments, and system infrastructure.

## Features

- **Application Catalog**: Browse and install applications from a curated catalog
- **Deployment Management**: Deploy, configure, and manage containerized applications  
- **Job Tracking**: Monitor installation, backup, and maintenance jobs
- **Real-time Updates**: Server-Sent Events for live logs and status updates
- **Backup Management**: Create, restore, and manage application backups
- **System Monitoring**: Track system health, resources, and service status
- **Notifications**: Centralized notification system for alerts and updates

## Authentication

All API endpoints require authentication via API key. Include your API key in the request headers:

\`\`\`
X-API-Key: your-api-key-here
\`\`\`

## Error Handling

All API responses follow a consistent format. Successful responses return data in a wrapper:

\`\`\`json
{
  "success": true,
  "data": { ... }
}
\`\`\`

Error responses include detailed error information:

\`\`\`json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": { ... }
  }
}
\`\`\`

## Real-time Features

Several endpoints support real-time updates via Server-Sent Events (SSE):

- **Deployment Logs**: \`/api/deployments/{id}/logs/stream\`
- **Job Logs**: \`/api/jobs/{id}/logs/stream\`  
- **System Status**: \`/api/system/status/stream\`

SSE connections provide continuous updates without polling.

## Rate Limiting

API requests are rate limited to ensure system stability. See response headers for current limits:

- \`X-RateLimit-Limit\`: Maximum requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: When the current window resets
      `,
      version: '1.0.0',
      contact: {
        name: 'Hola Support',
        email: 'support@try-hola.com',
        url: 'https://try-hola.com/support'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      },
      {
        url: 'https://api.try-hola.com',
        description: 'Production server'
      }
    ],
    paths: {},
    components: {
      schemas: {},
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for authentication'
        }
      }
    },
    tags: [
      { name: 'system', description: 'System health and status endpoints' },
      { name: 'identity', description: 'User identity and authentication' },
      { name: 'dashboard', description: 'Dashboard summary and overview data' },
      { name: 'catalog', description: 'Application catalog browsing and search' },
      { name: 'install', description: 'Application installation and draft management' },
      { name: 'deployments', description: 'Deployment management and lifecycle operations' },
      { name: 'jobs', description: 'Job tracking and monitoring' },
      { name: 'logs', description: 'Real-time log streaming' },
      { name: 'backups', description: 'Backup creation, restoration, and management' },
      { name: 'notifications', description: 'Notification management and alerts' },
      { name: 'settings', description: 'System configuration and settings' }
    ]
  };

  // Convert endpoint metadata to OpenAPI paths
  for (const endpoint of API_ENDPOINTS) {
    if (!spec.paths[endpoint.path]) {
      spec.paths[endpoint.path] = {};
    }

    const operation: OpenAPIOperation = {
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      description: endpoint.description,
      tags: endpoint.tags,
      parameters: endpoint.parameters || [],
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${endpoint.responseType}` },
              example: endpoint.examples?.response
            }
          }
        },
        '400': {
          description: 'Bad Request - Invalid input',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        '401': {
          description: 'Unauthorized - Invalid or missing API key',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        '404': {
          description: 'Not Found - Resource does not exist',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        '500': {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        }
      },
      security: [{ ApiKeyAuth: [] }]
    };

    // Add request body if specified
    if (endpoint.requestBodyType) {
      operation.requestBody = {
        description: `${endpoint.requestBodyType} data`,
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${endpoint.requestBodyType}` },
            example: endpoint.examples?.request
          }
        }
      };
    }

    // Handle special response types (SSE)
    if (endpoint.responseType === 'text/event-stream') {
      operation.responses = {
        '200': {
          description: 'Server-Sent Events stream',
          content: {
            'text/event-stream': {
              schema: {
                type: 'string',
                format: 'binary'
              }
            }
          }
        }
      };
    }

    // Mark deprecated endpoints
    if (endpoint.deprecated) {
      operation.deprecated = true;
    }

    spec.paths[endpoint.path][endpoint.method.toLowerCase()] = operation;
  }

  // Add schema definitions
  const schemas = generateTypeScriptSchemas();
  for (const [name, definition] of Object.entries(schemas)) {
    spec.components.schemas[name] = {
      type: 'object',
      description: `TypeScript definition: ${definition}`
    };
  }

  return spec;
}

/**
 * Generate Swagger UI HTML page
 */
export function generateSwaggerUI(apiSpecUrl: string = '/api/openapi.json'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Hola API Documentation</title>
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.9.0/favicon-32x32.png" sizes="32x32" />
  <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.9.0/favicon-16x16.png" sizes="16x16" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin:0;
      background: #fafafa;
    }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: '${apiSpecUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        tryItOutEnabled: true,
        requestInterceptor: function(request) {
          // Add API key header to all requests
          if (!request.headers['X-API-Key']) {
            request.headers['X-API-Key'] = 'demo-api-key';
          }
          return request;
        }
      });
    };
  </script>
</body>
</html>`;
}

/**
 * Generate ReDoc HTML page
 */
export function generateReDocUI(apiSpecUrl: string = '/api/openapi.json'): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Hola API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: Arial, sans-serif;
    }
    .loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      font-size: 18px;
      color: #666;
    }
    .error {
      padding: 20px;
      background-color: #fee;
      border: 1px solid #fcc;
      color: #c00;
      margin: 20px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="redoc-container">
    <div class="loading">Loading API Documentation...</div>
  </div>
  
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  <script>
    try {
      Redoc.init('${apiSpecUrl}', {
        scrollYOffset: 0,
        hideHostname: false,
        theme: {
          colors: {
            primary: {
              main: '#1976d2'
            }
          },
          typography: {
            fontSize: '14px',
            lineHeight: '1.5em',
            code: {
              fontSize: '13px'
            }
          },
          sidebar: {
            width: '260px'
          }
        }
      }, document.getElementById('redoc-container'));
    } catch (error) {
      console.error('ReDoc initialization failed:', error);
      document.getElementById('redoc-container').innerHTML = \`
        <div class="error">
          <h2>Documentation Loading Error</h2>
          <p>Failed to load API documentation. Please try refreshing the page.</p>
          <p><strong>Error:</strong> \${error.message}</p>
          <p><a href="${apiSpecUrl}" target="_blank">View Raw OpenAPI Specification</a></p>
        </div>
      \`;
    }
  </script>
</body>
</html>`;
}

/**
 * API change detection for breaking changes
 */
export interface APIChange {
  type: 'breaking' | 'addition' | 'deprecation' | 'modification';
  severity: 'high' | 'medium' | 'low';
  path: string;
  method?: string;
  description: string;
  migration?: string;
}

/**
 * Compare two OpenAPI specifications and detect changes
 */
export function detectAPIChanges(
  oldSpec: OpenAPISpec, 
  newSpec: OpenAPISpec
): APIChange[] {
  const changes: APIChange[] = [];

  // Compare paths
  for (const [path, pathItem] of Object.entries(oldSpec.paths)) {
    if (!newSpec.paths[path]) {
      changes.push({
        type: 'breaking',
        severity: 'high',
        path,
        description: `Endpoint removed: ${path}`,
        migration: 'Update client code to remove calls to this endpoint'
      });
      continue;
    }

    // Compare methods within path
    for (const [method] of Object.entries(pathItem)) {
      const newOperation = newSpec.paths[path][method];
      if (!newOperation) {
        changes.push({
          type: 'breaking',
          severity: 'high',
          path,
          method: method.toUpperCase(),
          description: `HTTP method removed: ${method.toUpperCase()} ${path}`,
          migration: `Remove ${method.toUpperCase()} requests to ${path}`
        });
      }
    }
  }

  // Check for new endpoints
  for (const [path, pathItem] of Object.entries(newSpec.paths)) {
    if (!oldSpec.paths[path]) {
      changes.push({
        type: 'addition',
        severity: 'low',
        path,
        description: `New endpoint added: ${path}`,
        migration: 'No migration required - new functionality available'
      });
      continue;
    }

    // Check for new methods
    for (const [method] of Object.entries(pathItem)) {
      if (!oldSpec.paths[path][method]) {
        changes.push({
          type: 'addition',
          severity: 'low',
          path,
          method: method.toUpperCase(),
          description: `New HTTP method added: ${method.toUpperCase()} ${path}`,
          migration: 'No migration required - new functionality available'
        });
      }
    }
  }

  return changes;
}
