/**
 * API migration and change tracking utility
 * 
 * This module provides tools for tracking API changes, generating migration guides,
 * and managing API versioning across different releases.
 */

import type { OpenAPISpec, APIChange } from './api-explorer';
import { detectAPIChanges } from './api-explorer';

/**
 * API version information
 */
export interface APIVersion {
  version: string;
  releaseDate: string;
  description: string;
  breaking: boolean;
  changes: APIChange[];
  migrationGuide?: string;
  deprecated?: string[]; // List of deprecated endpoints
  removed?: string[]; // List of removed endpoints
}

/**
 * Migration step for upgrading between versions
 */
export interface MigrationStep {
  step: number;
  title: string;
  description: string;
  codeExample?: string;
  required: boolean;
  automation?: {
    script: string;
    description: string;
  };
}

/**
 * Complete migration guide between versions
 */
export interface MigrationGuide {
  fromVersion: string;
  toVersion: string;
  severity: 'patch' | 'minor' | 'major';
  estimatedTime: string;
  prerequisites: string[];
  steps: MigrationStep[];
  testingChecklist: string[];
  rollbackPlan: string[];
}

/**
 * API version history with comprehensive change tracking
 */
export const API_VERSION_HISTORY: APIVersion[] = [
  {
    version: '1.0.0',
    releaseDate: '2025-08-12',
    description: 'Initial stable release with complete API coverage',
    breaking: false,
    changes: [
      {
        type: 'addition',
        severity: 'low',
        path: '/api/health',
        description: 'Added health check endpoint',
        migration: 'No migration required - new endpoint'
      },
      {
        type: 'addition',
        severity: 'low',
        path: '/api/deployments',
        description: 'Added deployment management endpoints',
        migration: 'No migration required - new functionality'
      },
      {
        type: 'addition',
        severity: 'low',
        path: '/api/catalog',
        description: 'Added application catalog endpoints',
        migration: 'No migration required - new functionality'
      }
    ],
    migrationGuide: `# Migration to v1.0.0

This is the initial stable release. No migration required for new installations.

## New Features
- Complete deployment management
- Application catalog browsing
- Real-time log streaming
- Job tracking and monitoring
- Backup management
- System settings configuration

## Getting Started
1. Install the latest version
2. Configure your API key
3. Start using the endpoints documented in the API reference
`
  },
  {
    version: '1.1.0',
    releaseDate: '2025-09-15',
    description: 'Enhanced real-time features and improved error handling',
    breaking: false,
    changes: [
      {
        type: 'addition',
        severity: 'low',
        path: '/api/deployments/{id}/logs/stream',
        description: 'Added real-time log streaming via Server-Sent Events',
        migration: 'No migration required - new endpoint enhances existing functionality'
      },
      {
        type: 'addition',
        severity: 'low',
        path: '/api/jobs/{id}/logs/stream',
        description: 'Added real-time job progress tracking',
        migration: 'No migration required - new endpoint'
      },
      {
        type: 'modification',
        severity: 'low',
        path: '/api/deployments',
        description: 'Enhanced deployment status with real-time updates',
        migration: 'No breaking changes - enhanced response format is backward compatible'
      }
    ],
    migrationGuide: `# Migration to v1.1.0

This release adds real-time features without breaking existing functionality.

## New Features
- Real-time log streaming via SSE
- Live job progress updates
- Enhanced deployment status tracking

## Migration Steps
1. Update to v1.1.0
2. Optional: Implement SSE clients for real-time features
3. Test existing integrations (no changes required)

## Benefits
- Improved user experience with live updates
- Better monitoring capabilities
- Enhanced debugging with real-time logs
`
  },
  {
    version: '2.0.0',
    releaseDate: '2025-12-01',
    description: 'Major version with authentication changes and new features',
    breaking: true,
    changes: [
      {
        type: 'breaking',
        severity: 'high',
        path: '/api/*',
        description: 'Changed authentication from header-based to token-based',
        migration: 'Update API key header from X-API-Key to Authorization: Bearer <token>'
      },
      {
        type: 'breaking',
        severity: 'medium',
        path: '/api/deployments',
        description: 'Changed response format for deployment list',
        migration: 'Update client code to handle new paginated response format'
      },
      {
        type: 'addition',
        severity: 'low',
        path: '/api/workspaces',
        description: 'Added multi-workspace support',
        migration: 'No migration required - new optional feature'
      }
    ],
    deprecated: ['/api/legacy/deployments'],
    removed: ['/api/v1/health'],
    migrationGuide: `# Migration to v2.0.0

⚠️ **BREAKING CHANGES** - This is a major version with breaking changes.

## Breaking Changes

### 1. Authentication Method Change
**Before (v1.x):**
\`\`\`
X-API-Key: your-api-key
\`\`\`

**After (v2.0):**
\`\`\`
Authorization: Bearer your-jwt-token
\`\`\`

### 2. Deployment List Response Format
**Before (v1.x):**
\`\`\`json
{
  "deployments": [...],
  "total": 50
}
\`\`\`

**After (v2.0):**
\`\`\`json
{
  "success": true,
  "data": {
    "items": [...],
    "page": 1,
    "limit": 20,
    "total": 50
  }
}
\`\`\`

## Migration Steps
1. Update authentication headers in all API calls
2. Update deployment list response parsing
3. Remove references to deprecated endpoints
4. Test thoroughly before deploying

## New Features
- Multi-workspace support
- Enhanced security with JWT tokens
- Improved error handling
- Better pagination across all endpoints
`
  }
];

/**
 * Generate migration guide between two versions
 */
export function generateMigrationGuide(fromVersion: string, toVersion: string): MigrationGuide | null {
  const fromVersionIndex = API_VERSION_HISTORY.findIndex(v => v.version === fromVersion);
  const toVersionIndex = API_VERSION_HISTORY.findIndex(v => v.version === toVersion);
  
  if (fromVersionIndex === -1 || toVersionIndex === -1 || fromVersionIndex >= toVersionIndex) {
    return null;
  }

  // Get all versions between from and to
  const versionsToMigrate = API_VERSION_HISTORY.slice(fromVersionIndex + 1, toVersionIndex + 1);
  
  // Determine severity based on breaking changes
  const hasBreakingChanges = versionsToMigrate.some(v => v.breaking);
  const severity: 'patch' | 'minor' | 'major' = hasBreakingChanges ? 'major' : 'minor';
  
  // Collect all changes
  const allChanges = versionsToMigrate.flatMap(v => v.changes);
  const breakingChanges = allChanges.filter(c => c.type === 'breaking');
  
  // Generate migration steps
  const steps: MigrationStep[] = [];
  let stepNumber = 1;

  // Pre-migration steps
  steps.push({
    step: stepNumber++,
    title: 'Backup Current Implementation',
    description: 'Create a backup of your current API integration before making changes',
    required: true,
    codeExample: `# Create backup
git tag pre-migration-${fromVersion}
git push origin pre-migration-${fromVersion}`,
    automation: {
      script: 'git tag pre-migration-$(date +%Y%m%d-%H%M%S)',
      description: 'Automatically create backup tag'
    }
  });

  steps.push({
    step: stepNumber++,
    title: 'Review Breaking Changes',
    description: 'Understand all breaking changes that will affect your integration',
    required: true,
    codeExample: `// Breaking changes in this migration:
${breakingChanges.map(c => `// - ${c.description}`).join('\n')}`
  });

  // Add specific migration steps for each breaking change
  for (const change of breakingChanges) {
    steps.push({
      step: stepNumber++,
      title: `Migrate: ${change.description}`,
      description: change.migration || 'Update your code to handle this change',
      required: true,
      codeExample: generateMigrationCodeExample(change)
    });
  }

  // Testing step
  steps.push({
    step: stepNumber++,
    title: 'Test Migration',
    description: 'Thoroughly test your updated integration against the new API version',
    required: true,
    codeExample: `// Run your test suite
npm test

// Test against new API
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/api/health`
  });

  // Final verification
  steps.push({
    step: stepNumber,
    title: 'Verify Migration',
    description: 'Confirm all functionality works correctly with the new API version',
    required: true
  });

  return {
    fromVersion,
    toVersion,
    severity,
    estimatedTime: severity === 'major' ? '2-4 hours' : severity === 'minor' ? '30-60 minutes' : '15-30 minutes',
    prerequisites: [
      'Access to API documentation for new version',
      'Test environment for validation',
      'Backup of current implementation',
      ...(hasBreakingChanges ? ['Development time for code changes'] : [])
    ],
    steps,
    testingChecklist: [
      'Verify authentication works with new method',
      'Test all existing API endpoints',
      'Validate response format changes',
      'Check error handling behavior',
      'Test real-time features (if applicable)',
      'Verify pagination works correctly',
      'Test edge cases and error scenarios',
      'Performance testing with new version'
    ],
    rollbackPlan: [
      'Revert to previous API endpoint URLs',
      'Restore previous authentication method',
      'Deploy previous client code version',
      'Verify rollback functionality',
      'Monitor for any issues after rollback'
    ]
  };
}

/**
 * Generate code example for a specific migration
 */
function generateMigrationCodeExample(change: APIChange): string {
  switch (change.type) {
    case 'breaking':
      if (change.description.includes('authentication')) {
        return `// Before (v1.x)
const response = await fetch('/api/deployments', {
  headers: {
    'X-API-Key': 'your-api-key'
  }
});

// After (v2.0)
const response = await fetch('/api/deployments', {
  headers: {
    'Authorization': 'Bearer your-jwt-token'
  }
});`;
      }
      if (change.description.includes('response format')) {
        return `// Before (v1.x)
const data = await response.json();
const deployments = data.deployments;
const total = data.total;

// After (v2.0)
const apiResponse = await response.json();
const deployments = apiResponse.data.items;
const total = apiResponse.data.total;
const currentPage = apiResponse.data.page;`;
      }
      break;
    
    case 'deprecation':
      return `// Deprecated - will be removed in future version
// ${change.path}

// Use new endpoint instead:
// ${change.migration}`;
    
    default:
      return `// ${change.description}
// Migration: ${change.migration}`;
  }
  
  return `// ${change.description}\n// ${change.migration}`;
}

/**
 * Check if migration is required between versions
 */
export function isMigrationRequired(fromVersion: string, toVersion: string): boolean {
  const guide = generateMigrationGuide(fromVersion, toVersion);
  return guide !== null && guide.steps.some(step => step.required);
}

/**
 * Get latest API version
 */
export function getLatestVersion(): APIVersion {
  return API_VERSION_HISTORY[API_VERSION_HISTORY.length - 1];
}

/**
 * Get version by number
 */
export function getVersion(version: string): APIVersion | null {
  return API_VERSION_HISTORY.find(v => v.version === version) || null;
}

/**
 * Get all breaking changes since a version
 */
export function getBreakingChangesSince(version: string): APIChange[] {
  const versionIndex = API_VERSION_HISTORY.findIndex(v => v.version === version);
  if (versionIndex === -1) return [];
  
  return API_VERSION_HISTORY
    .slice(versionIndex + 1)
    .flatMap(v => v.changes)
    .filter(c => c.type === 'breaking');
}

/**
 * Generate changelog markdown
 */
export function generateChangelog(): string {
  let changelog = `# API Changelog

This document tracks all changes to the Hola API across different versions.

`;

  // Iterate newest-first on a COPY — Array.reverse() mutates in place, and
  // API_VERSION_HISTORY is shared module state that getLatestVersion/getVersion/
  // generateMigrationGuide rely on being in chronological order (this once left
  // it permanently reversed and made generateChangelog non-idempotent).
  for (const version of [...API_VERSION_HISTORY].reverse()) {
    changelog += `## [${version.version}] - ${version.releaseDate}

${version.description}

`;

    if (version.breaking) {
      changelog += `⚠️ **BREAKING CHANGES** - This release contains breaking changes that require migration.

`;
    }

    // Group changes by type
    const additions = version.changes.filter(c => c.type === 'addition');
    const modifications = version.changes.filter(c => c.type === 'modification');
    const deprecations = version.changes.filter(c => c.type === 'deprecation');
    const breaking = version.changes.filter(c => c.type === 'breaking');

    if (breaking.length > 0) {
      changelog += `### 💥 Breaking Changes
${breaking.map(c => `- **${c.path}**: ${c.description}`).join('\n')}

`;
    }

    if (additions.length > 0) {
      changelog += `### ✨ Added
${additions.map(c => `- **${c.path}**: ${c.description}`).join('\n')}

`;
    }

    if (modifications.length > 0) {
      changelog += `### 🔄 Changed
${modifications.map(c => `- **${c.path}**: ${c.description}`).join('\n')}

`;
    }

    if (deprecations.length > 0) {
      changelog += `### ⚠️ Deprecated
${deprecations.map(c => `- **${c.path}**: ${c.description}`).join('\n')}

`;
    }

    if (version.deprecated && version.deprecated.length > 0) {
      changelog += `### 📋 Deprecated Endpoints
${version.deprecated.map(endpoint => `- \`${endpoint}\``).join('\n')}

`;
    }

    if (version.removed && version.removed.length > 0) {
      changelog += `### 🗑️ Removed
${version.removed.map(endpoint => `- \`${endpoint}\``).join('\n')}

`;
    }

    if (version.migrationGuide) {
      changelog += `### 📖 Migration Guide

${version.migrationGuide}

`;
    }

    changelog += `---

`;
  }

  return changelog;
}

/**
 * Generate beautiful HTML changelog page
 */
export function generateChangelogHTML(): string {
  // Get the latest version (last in the chronological array)
  const currentVersion = API_VERSION_HISTORY[API_VERSION_HISTORY.length - 1]?.version || '1.0.0';
  
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API Changelog - Hola Documentation</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f8fafc;
            margin: 0;
            padding: 0;
            min-height: 100vh;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 1rem 0;
            position: sticky;
            top: 0;
            z-index: 100;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .header-content {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 2rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header h1 {
            color: white;
            font-size: 1.5rem;
            font-weight: 600;
        }
        
        .version-badge {
            background: rgba(255, 255, 255, 0.2);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 500;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: white;
            min-height: calc(100vh - 80px);
            box-shadow: 0 0 20px rgba(0,0,0,0.1);
        }
        
        .intro {
            background: #f0f4ff;
            border: 1px solid #c7d2fe;
            border-radius: 12px;
            padding: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .intro p {
            color: #475569;
            font-size: 1.1rem;
        }
        
        .timeline {
            position: relative;
            padding-left: 2rem;
        }
        
        .timeline::before {
            content: '';
            position: absolute;
            left: 1rem;
            top: 0;
            bottom: 0;
            width: 2px;
            background: linear-gradient(180deg, #667eea, #764ba2);
        }
        
        .version {
            position: relative;
            margin-bottom: 3rem;
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            padding: 2rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
        }
        
        .version::before {
            content: '';
            position: absolute;
            left: -2.5rem;
            top: 1.5rem;
            width: 12px;
            height: 12px;
            background: #667eea;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.3);
        }
        
        .version-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 1rem;
            flex-wrap: wrap;
            gap: 1rem;
        }
        
        .version-title {
            color: #667eea;
            font-size: 1.8rem;
            font-weight: 600;
            margin: 0;
        }
        
        .version-date {
            color: #64748b;
            font-size: 1rem;
            background: #f1f5f9;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            border: 1px solid #e2e8f0;
        }
        
        .version-description {
            color: #475569;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
            line-height: 1.7;
        }
        
        .breaking-notice {
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 12px;
            padding: 1rem;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .breaking-notice::before {
            content: '⚠️';
            font-size: 1.2rem;
        }
        
        .breaking-text {
            color: #dc2626;
            font-weight: 600;
        }
        
        .change-section {
            margin-bottom: 1.5rem;
        }
        
        .change-title {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: #334155;
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 0.75rem;
            padding-bottom: 0.5rem;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .change-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        
        .change-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 0.75rem 1rem;
            margin-bottom: 0.5rem;
            transition: all 0.2s ease;
        }
        
        .change-item:hover {
            background: #f1f5f9;
            border-color: #cbd5e1;
            transform: translateX(4px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .change-path {
            color: #3b82f6;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-weight: 600;
            font-size: 0.9rem;
        }
        
        .change-description {
            color: #475569;
            margin-top: 0.25rem;
        }
        
        .migration-guide {
            background: #faf5ff;
            border: 1px solid #e9d5ff;
            border-radius: 12px;
            padding: 1.5rem;
            margin-top: 1rem;
        }
        
        .migration-guide h4 {
            color: #7c3aed;
            margin-bottom: 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .migration-content {
            color: #475569;
            line-height: 1.7;
            white-space: pre-line;
        }
        
        .endpoint-list {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        
        .endpoint-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 0.5rem 0.75rem;
            margin-bottom: 0.25rem;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 0.9rem;
            color: #6366f1;
        }
        
        /* Responsive design */
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }
            
            .timeline {
                padding-left: 1rem;
            }
            
            .timeline::before {
                left: 0.5rem;
            }
            
            .version::before {
                left: -1.5rem;
            }
            
            .version {
                padding: 1.5rem;
            }
            
            .version-header {
                flex-direction: column;
                align-items: flex-start;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-content">
            <h1>📋 API Changelog</h1>
            <div class="version-badge">Current: v${currentVersion}</div>
        </div>
    </div>
    
    <div class="container">
        <div class="intro">
            <p>Track all changes, additions, and improvements to the Hola API. This changelog helps you stay up-to-date with the latest features and ensure smooth upgrades.</p>
        </div>
        
        <div class="timeline">`;

  // Generate version entries (latest first) - use slice().reverse() to avoid mutating original array
  for (const version of API_VERSION_HISTORY.slice().reverse()) {
    html += `
            <div class="version">
                <div class="version-header">
                    <h2 class="version-title">v${version.version}</h2>
                    <div class="version-date">${version.releaseDate}</div>
                </div>
                
                <div class="version-description">${version.description}</div>`;

    if (version.breaking) {
      html += `
                <div class="breaking-notice">
                    <span class="breaking-text">BREAKING CHANGES - Migration required</span>
                </div>`;
    }

    // Group changes by type
    const additions = version.changes.filter(c => c.type === 'addition');
    const modifications = version.changes.filter(c => c.type === 'modification');
    const deprecations = version.changes.filter(c => c.type === 'deprecation');
    const breaking = version.changes.filter(c => c.type === 'breaking');

    if (breaking.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">💥 Breaking Changes</h3>
                    <ul class="change-list">`;
      
      for (const change of breaking) {
        html += `
                        <li class="change-item">
                            <div class="change-path">${change.path}</div>
                            <div class="change-description">${change.description}</div>
                        </li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (additions.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">✨ Added</h3>
                    <ul class="change-list">`;
      
      for (const change of additions) {
        html += `
                        <li class="change-item">
                            <div class="change-path">${change.path}</div>
                            <div class="change-description">${change.description}</div>
                        </li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (modifications.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">🔄 Changed</h3>
                    <ul class="change-list">`;
      
      for (const change of modifications) {
        html += `
                        <li class="change-item">
                            <div class="change-path">${change.path}</div>
                            <div class="change-description">${change.description}</div>
                        </li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (deprecations.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">⚠️ Deprecated</h3>
                    <ul class="change-list">`;
      
      for (const change of deprecations) {
        html += `
                        <li class="change-item">
                            <div class="change-path">${change.path}</div>
                            <div class="change-description">${change.description}</div>
                        </li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (version.deprecated && version.deprecated.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">📋 Deprecated Endpoints</h3>
                    <ul class="endpoint-list">`;
      
      for (const endpoint of version.deprecated) {
        html += `
                        <li class="endpoint-item">${endpoint}</li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (version.removed && version.removed.length > 0) {
      html += `
                <div class="change-section">
                    <h3 class="change-title">🗑️ Removed</h3>
                    <ul class="endpoint-list">`;
      
      for (const endpoint of version.removed) {
        html += `
                        <li class="endpoint-item">${endpoint}</li>`;
      }
      
      html += `
                    </ul>
                </div>`;
    }

    if (version.migrationGuide) {
      html += `
                <div class="migration-guide">
                    <h4>📖 Migration Guide</h4>
                    <div class="migration-content">${version.migrationGuide}</div>
                </div>`;
    }

    html += `
            </div>`;
  }

  html += `
        </div>
    </div>
</body>
</html>`;

  return html;
}

/**
 * Track new API changes
 */
export function trackAPIChanges(oldSpec: OpenAPISpec, newSpec: OpenAPISpec): APIChange[] {
  return detectAPIChanges(oldSpec, newSpec);
}

/**
 * Generate version comparison report
 */
export function generateVersionComparison(version1: string, version2: string): string {
  const v1 = getVersion(version1);
  const v2 = getVersion(version2);
  
  if (!v1 || !v2) {
    return 'One or both versions not found';
  }

  const migrationGuide = generateMigrationGuide(version1, version2);
  
  return `# Version Comparison: ${version1} vs ${version2}

## Overview
- **From**: ${version1} (${v1.releaseDate}) - ${v1.description}
- **To**: ${version2} (${v2.releaseDate}) - ${v2.description}
- **Migration Required**: ${migrationGuide ? 'Yes' : 'No'}
- **Severity**: ${migrationGuide?.severity || 'None'}
- **Estimated Time**: ${migrationGuide?.estimatedTime || 'No migration needed'}

## Changes Summary
${migrationGuide ? `
### Breaking Changes
${migrationGuide.steps.filter(s => s.title.includes('Migrate:')).map(s => `- ${s.title.replace('Migrate: ', '')}`).join('\n')}

### Migration Steps
${migrationGuide.steps.length} steps required

### Prerequisites
${migrationGuide.prerequisites.map(p => `- ${p}`).join('\n')}
` : 'No breaking changes between these versions.'}

## Recommendations
${migrationGuide?.severity === 'major' 
  ? '- Plan for significant development time\n- Test thoroughly in staging environment\n- Consider gradual rollout'
  : migrationGuide?.severity === 'minor'
  ? '- Schedule development time for testing\n- Review affected endpoints'
  : '- Minor update, minimal impact expected'
}
`;
}
