/**
 * Main documentation system for the Hola API
 * 
 * This module provides the complete API documentation system including:
 * - OpenAPI schema generation
 * - Interactive API explorer
 * - Type browser and relationship mapping
 * - Code examples and usage patterns
 * - Migration guides and change tracking
 */

// Export all documentation utilities
export * from './api-explorer';
export * from './type-browser';
export * from './example-generator';
export * from './migration-tracker';

// Main documentation configuration
export const DOCUMENTATION_CONFIG = {
  title: 'Hola API Documentation',
  version: '1.0.0',
  baseUrl: process.env.NODE_ENV === 'production' 
    ? 'https://api.try-hola.com' 
    : 'http://localhost:3001',
  
  // Feature flags for documentation components
  features: {
    swagger: true,
    redoc: true,
    typeExplorer: true,
    codeExamples: true,
    migrationGuides: true,
    changeDetection: true
  },
  
  // UI customization
  theme: {
    primaryColor: '#3b82f6',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    codeTheme: 'github'
  }
};

import { 
  generateOpenAPISpec, 
  generateSwaggerUI, 
  generateReDocUI 
} from './api-explorer';

import { 
  generateAllExamples, 
  generateMarkdownExamples,
  generateExamplesHTML
} from './example-generator';

import { 
  generateChangelog,
  generateChangelogHTML
} from './migration-tracker';

import {
  generateTypeBrowserHTML
} from './type-browser';

/**
 * Generate complete documentation package
 */
export function generateCompleteDocs() {
  return {
    openapi: generateOpenAPISpec(),
    swagger: generateSwaggerUI(),
    redoc: generateReDocUI(),
    examples: generateAllExamples(),
    examplesMarkdown: generateMarkdownExamples(),
    examplesHTML: generateExamplesHTML(),
    typeBrowserHTML: generateTypeBrowserHTML(),
    changelog: generateChangelog(),
    changelogHTML: generateChangelogHTML()
  };
}

/**
 * Documentation routes configuration for server integration
 */
export const DOCUMENTATION_ROUTES = {
  openapi: '/api/openapi.json',
  swagger: '/docs',
  redoc: '/redoc',
  examples: '/docs/examples',
  changelog: '/docs/changelog',
  migration: '/docs/migration'
} as const;
