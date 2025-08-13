/**
 * Code example generator for API documentation
 * 
 * This module generates comprehensive code examples for API endpoints,
 * including React hooks, error handling patterns, and authentication examples.
 */

import { API_ENDPOINTS, type EndpointMetadata } from './api-explorer';

/**
 * Code example category
 */
export type ExampleCategory = 
  | 'react-hooks'
  | 'api-calls'
  | 'error-handling'
  | 'authentication'
  | 'real-time'
  | 'testing';

/**
 * Code example definition
 */
export interface CodeExample {
  title: string;
  description: string;
  category: ExampleCategory;
  language: 'typescript' | 'javascript' | 'bash' | 'json';
  code: string;
  tags: string[];
  related?: string[];
}

/**
 * Generate React hook example for an API endpoint
 */
export function generateReactHookExample(endpoint: EndpointMetadata): CodeExample {
  const hookName = `use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}`;
  const hasParams = endpoint.parameters && endpoint.parameters.length > 0;
  const hasBody = endpoint.requestBodyType;
  
  let code = `import React from 'react';
import { API } from '@hola/shared';
import type { ${endpoint.responseType}${hasBody ? `, ${endpoint.requestBodyType}` : ''} } from '@hola/shared';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';

interface ${hookName}State {
  data: ${endpoint.responseType.replace('Response', '').replace('Get', '')} | null;
  loading: boolean;
  error: string | null;
}

export function ${hookName}(${hasParams ? 'params: { ' + endpoint.parameters?.map(p => `${p.name}${p.required ? '' : '?'}: ${p.schema.type}`).join('; ') + ' }' : ''}) {
  const [state, setState] = React.useState<${hookName}State>({
    data: null,
    loading: false,
    error: null,
  });

  // StrictMode-compatible fetch function
  const fetchData = React.useCallback(async () => {
    const cacheKey = '${endpoint.path}'${hasParams ? ' + JSON.stringify(params)' : ''};
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first (TTL: 30s)
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {`;

  if (endpoint.method === 'GET') {
    code += `
      const result = await api.${endpoint.operationId}(${hasParams ? 'params' : ''});`;
  } else if (hasBody) {
    code += `
      const result = await api.${endpoint.operationId}(${hasParams ? 'params, ' : ''}body);`;
  } else {
    code += `
      const result = await api.${endpoint.operationId}(${hasParams ? 'params' : ''});`;
  }

  code += `
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [${hasParams ? 'params' : ''}]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}

// Usage example:
export const ${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}Component: React.FC = () => {
  const { data, loading, error, refetch } = ${hookName}(${hasParams ? '{ ' + endpoint.parameters?.slice(0, 2).map(p => `${p.name}: ${JSON.stringify(p.example || 'value')}`).join(', ') + ' }' : ''});

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!data) return <div>No data</div>;

  return (
    <div>
      <h2>${endpoint.summary}</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>Refresh</button>
    </div>
  );
};`;

  return {
    title: `${hookName} - React Hook`,
    description: `React hook for ${endpoint.summary.toLowerCase()} with StrictMode compatibility and caching`,
    category: 'react-hooks',
    language: 'typescript',
    code,
    tags: ['react', 'hooks', 'strictmode', 'cache'],
    related: [`${endpoint.operationId}ApiCall`, `${endpoint.operationId}ErrorHandling`]
  };
}

/**
 * Generate API call example
 */
export function generateApiCallExample(endpoint: EndpointMetadata): CodeExample {
  const hasParams = endpoint.parameters && endpoint.parameters.length > 0;
  const hasBody = endpoint.requestBodyType;
  
  let code = `import { api } from './utils/api';
import type { ${endpoint.responseType}${hasBody ? `, ${endpoint.requestBodyType}` : ''} } from '@hola/shared';

// ${endpoint.summary}
async function ${endpoint.operationId}Example() {
  try {`;

  // Add parameter setup if needed
  if (hasParams) {
    code += `
    const params = {
${endpoint.parameters?.map(p => `      ${p.name}: ${JSON.stringify(p.example || (p.schema.type === 'string' ? 'example-value' : p.schema.default || 'value'))}`).join(',\n')}
    };`;
  }

  // Add request body setup if needed
  if (hasBody) {
    code += `
    
    const requestData: ${endpoint.requestBodyType} = ${JSON.stringify(endpoint.examples?.request || {}, null, 6)};`;
  }

  // Add the API call
  if (endpoint.method === 'GET') {
    code += `
    
    const response = await api.${endpoint.operationId}(${hasParams ? 'params' : ''});`;
  } else if (hasBody) {
    code += `
    
    const response = await api.${endpoint.operationId}(${hasParams ? 'params, ' : ''}requestData);`;
  } else {
    code += `
    
    const response = await api.${endpoint.operationId}(${hasParams ? 'params' : ''});`;
  }

  code += `
    
    console.log('${endpoint.summary} successful:', response);
    return response;
    
  } catch (error) {
    console.error('${endpoint.summary} failed:', error);
    throw error;
  }
}

// Call the function
${endpoint.operationId}Example()
  .then(result => console.log('Result:', result))
  .catch(error => console.error('Error:', error));`;

  return {
    title: `${endpoint.operationId} - API Call`,
    description: `Direct API call example for ${endpoint.summary.toLowerCase()}`,
    category: 'api-calls',
    language: 'typescript',
    code,
    tags: ['api', 'async', 'fetch'],
    related: [`${endpoint.operationId}Hook`, `${endpoint.operationId}ErrorHandling`]
  };
}

/**
 * Generate error handling example
 */
export function generateErrorHandlingExample(endpoint: EndpointMetadata): CodeExample {
  const code = `import { api } from './utils/api';
import { 
  isNetworkError, 
  isServerError, 
  isValidationError,
  getErrorMessage,
  shouldRetry 
} from './utils/error-enhanced';

async function ${endpoint.operationId}WithErrorHandling() {
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount <= maxRetries) {
    try {
      const result = await api.${endpoint.operationId}();
      return result;
      
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      
      // Handle different error types
      if (isValidationError(error)) {
        console.error('Validation error:', errorMessage);
        // Don't retry validation errors
        throw new Error(\`Invalid request: \${errorMessage}\`);
        
      } else if (isNetworkError(error)) {
        console.warn('Network error:', errorMessage);
        
        if (retryCount < maxRetries && shouldRetry(error)) {
          retryCount++;
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          console.log(\`Retrying in \${delay}ms (attempt \${retryCount}/\${maxRetries})\`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw new Error(\`Network error after \${retryCount} retries: \${errorMessage}\`);
        
      } else if (isServerError(error)) {
        console.error('Server error:', errorMessage);
        throw new Error(\`Server error: \${errorMessage}\`);
        
      } else {
        console.error('Unexpected error:', error);
        throw new Error(\`Unexpected error: \${errorMessage}\`);
      }
    }
  }
}

// Usage with user-friendly error handling
${endpoint.operationId}WithErrorHandling()
  .then(result => {
    console.log('Success:', result);
    // Update UI with success state
  })
  .catch(error => {
    console.error('Final error:', error.message);
    // Show user-friendly error message
    showErrorToUser(error.message);
  });

function showErrorToUser(message: string) {
  // Show toast notification, modal, or inline error
  console.log('User message:', message);
}`;

  return {
    title: `${endpoint.operationId} - Error Handling`,
    description: `Comprehensive error handling for ${endpoint.summary.toLowerCase()} with retry logic`,
    category: 'error-handling',
    language: 'typescript',
    code,
    tags: ['error-handling', 'retry', 'user-experience'],
    related: [`${endpoint.operationId}Hook`, `${endpoint.operationId}ApiCall`]
  };
}

/**
 * Generate authentication example
 */
export function generateAuthenticationExample(): CodeExample {
  const code = `// API key authentication setup
const API_KEY = process.env.HOLA_API_KEY || 'your-api-key-here';

// 1. Basic API client with authentication
class AuthenticatedApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string, 
    options: RequestInit = {}
  ): Promise<T> {
    const url = \`\${this.baseUrl}\${endpoint}\`;
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid or missing API key');
      }
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}

// 2. Initialize client
const apiClient = new AuthenticatedApiClient(
  'https://api.example.com', 
  API_KEY
);

// 3. Usage examples
async function authenticatedRequests() {
  try {
    // Get user info
    const user = await apiClient.get('/api/me');
    console.log('Current user:', user);

    // Get deployments
    const deployments = await apiClient.get('/api/deployments');
    console.log('Deployments:', deployments);

    // Create deployment
    const newDeployment = await apiClient.post('/api/deployments', {
      draftId: 'draft-123',
      name: 'My App'
    });
    console.log('Created deployment:', newDeployment);

  } catch (error) {
    if (error.message.includes('Invalid or missing API key')) {
      console.error('Authentication failed - check your API key');
    } else {
      console.error('Request failed:', error.message);
    }
  }
}

// 4. Environment-based configuration
const getApiConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return {
        baseUrl: 'https://api.hola.com',
        apiKey: process.env.HOLA_API_KEY_PROD!
      };
    case 'staging':
      return {
        baseUrl: 'https://staging-api.hola.com',
        apiKey: process.env.HOLA_API_KEY_STAGING!
      };
    default:
      return {
        baseUrl: 'http://localhost:3001',
        apiKey: process.env.HOLA_API_KEY_DEV || 'demo-api-key'
      };
  }
};

const config = getApiConfig();
const api = new AuthenticatedApiClient(config.baseUrl, config.apiKey);`;

  return {
    title: 'API Authentication',
    description: 'Complete guide to API key authentication with environment configuration',
    category: 'authentication',
    language: 'typescript',
    code,
    tags: ['authentication', 'api-key', 'environment'],
    related: ['ApiClient', 'ErrorHandling']
  };
}

/**
 * Generate real-time (SSE) example
 */
export function generateRealTimeExample(): CodeExample {
  const code = `import React from 'react';
import { useSSE } from '../hooks/useSSE';
import type { SSEEvent, SSEConnectionState } from '@hola/shared';

// 1. Basic SSE hook usage
export function useDeploymentLogs(deploymentId: string) {
  const {
    data: events,
    connectionState,
    error,
    connect,
    disconnect
  } = useSSE<SSEEvent>(\`/api/deployments/\${deploymentId}/logs/stream\`);

  // Filter log events
  const logs = React.useMemo(() => 
    events
      .filter(event => event.type === 'log')
      .map(event => event.data),
    [events]
  );

  return { logs, connectionState, error, connect, disconnect };
}

// 2. Real-time logs component
export const DeploymentLogsViewer: React.FC<{ deploymentId: string }> = ({ 
  deploymentId 
}) => {
  const { logs, connectionState, error, connect, disconnect } = useDeploymentLogs(deploymentId);
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  React.useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getConnectionStatus = (state: SSEConnectionState) => {
    switch (state) {
      case 'connecting': return { text: 'Connecting...', color: 'yellow' };
      case 'connected': return { text: 'Live', color: 'green' };
      case 'disconnected': return { text: 'Disconnected', color: 'gray' };
      case 'error': return { text: 'Error', color: 'red' };
    }
  };

  const status = getConnectionStatus(connectionState);

  return (
    <div className="logs-viewer">
      <div className="logs-header">
        <h3>Live Logs</h3>
        <div className="connection-status">
          <span 
            className={\`status-indicator status-\${status.color}\`}
            title={status.text}
          />
          {status.text}
          {connectionState === 'disconnected' && (
            <button onClick={connect}>Reconnect</button>
          )}
          {connectionState === 'connected' && (
            <button onClick={disconnect}>Disconnect</button>
          )}
        </div>
      </div>

      <div className="logs-content">
        {error && (
          <div className="error-message">
            Connection error: {error}
          </div>
        )}
        
        <div className="logs-container">
          {logs.map((log, index) => (
            <div key={index} className={\`log-entry log-\${log.level}\`}>
              <span className="log-timestamp">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="log-service">[{log.service}]</span>
              <span className="log-level">{log.level.toUpperCase()}</span>
              <span className="log-message">{log.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

// 3. Advanced: Multiple SSE connections
export function useMultipleSSEConnections() {
  const [deploymentId] = React.useState('deployment-1');
  const [jobId] = React.useState('job-1');

  // Connect to multiple streams
  const deploymentLogs = useSSE<SSEEvent>(\`/api/deployments/\${deploymentId}/logs/stream\`);
  const jobLogs = useSSE<SSEEvent>(\`/api/jobs/\${jobId}/logs/stream\`);
  const systemStatus = useSSE<SSEEvent>('/api/system/status/stream');

  // Combine and process events
  const allEvents = React.useMemo(() => [
    ...deploymentLogs.data.map(e => ({ ...e, source: 'deployment' })),
    ...jobLogs.data.map(e => ({ ...e, source: 'job' })),
    ...systemStatus.data.map(e => ({ ...e, source: 'system' }))
  ].sort((a, b) => 
    new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
  ), [deploymentLogs.data, jobLogs.data, systemStatus.data]);

  return {
    events: allEvents,
    connections: {
      deployment: deploymentLogs.connectionState,
      job: jobLogs.connectionState,
      system: systemStatus.connectionState
    }
  };
}

// 4. SSE with fallback polling
export function useSSEWithFallback<T>(endpoint: string, pollInterval = 5000) {
  const { data: sseData, connectionState } = useSSE<T>(endpoint);
  const [pollData, setPollData] = React.useState<T[]>([]);

  // Fallback polling when SSE is not available
  React.useEffect(() => {
    if (connectionState === 'error' || connectionState === 'disconnected') {
      const interval = setInterval(async () => {
        try {
          const response = await fetch(endpoint.replace('/stream', ''));
          const data = await response.json();
          setPollData(prev => [...prev, data]);
        } catch (error) {
          console.warn('Polling fallback failed:', error);
        }
      }, pollInterval);

      return () => clearInterval(interval);
    }
  }, [connectionState, endpoint, pollInterval]);

  // Use SSE data when available, otherwise use polling data
  return {
    data: connectionState === 'connected' ? sseData : pollData,
    isLive: connectionState === 'connected',
    connectionState
  };
}`;

  return {
    title: 'Real-time Updates with Server-Sent Events',
    description: 'Complete guide to implementing real-time features using SSE with fallback polling',
    category: 'real-time',
    language: 'typescript',
    code,
    tags: ['sse', 'real-time', 'streaming', 'logs'],
    related: ['useSSE', 'LogsViewer', 'ErrorHandling']
  };
}

/**
 * Generate testing example
 */
export function generateTestingExample(endpoint: EndpointMetadata): CodeExample {
  const code = `import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)} } from '../hooks/use${endpoint.operationId}';
import { api } from '../utils/api';

// Mock the API
vi.mock('../utils/api', () => ({
  api: {
    ${endpoint.operationId}: vi.fn()
  }
}));

const mockApi = vi.mocked(api);

describe('${endpoint.operationId} Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear global cache
    global.globalCache?.clear();
  });

  it('should fetch data successfully', async () => {
    // Arrange
    const mockResponse = ${JSON.stringify(endpoint.examples?.response || {}, null, 4)};
    mockApi.${endpoint.operationId}.mockResolvedValue(mockResponse);

    // Act
    const { result } = renderHook(() => use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}(${endpoint.parameters?.length ? '{ id: "test-id" }' : ''}));

    // Assert initial state
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(null);

    // Wait for completion
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockResponse);
    expect(result.current.error).toBe(null);
    expect(mockApi.${endpoint.operationId}).toHaveBeenCalledTimes(1);
  });

  it('should handle errors gracefully', async () => {
    // Arrange
    const errorMessage = 'Network error';
    mockApi.${endpoint.operationId}.mockRejectedValue(new Error(errorMessage));

    // Act
    const { result } = renderHook(() => use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}(${endpoint.parameters?.length ? '{ id: "test-id" }' : ''}));

    // Wait for completion
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Assert
    expect(result.current.data).toBe(null);
    expect(result.current.error).toBe(errorMessage);
  });

  it('should use cached data when available', async () => {
    // Arrange
    const mockResponse = ${JSON.stringify(endpoint.examples?.response || {}, null, 4)};
    const cacheKey = '${endpoint.path}';
    
    // Pre-populate cache
    global.globalCache?.set(cacheKey, {
      data: mockResponse,
      timestamp: Date.now()
    });

    // Act
    const { result } = renderHook(() => use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}(${endpoint.parameters?.length ? '{ id: "test-id" }' : ''}));

    // Assert - should use cache immediately
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual(mockResponse);
    expect(mockApi.${endpoint.operationId}).not.toHaveBeenCalled();
  });

  it('should refetch data when refetch is called', async () => {
    // Arrange
    const mockResponse = ${JSON.stringify(endpoint.examples?.response || {}, null, 4)};
    mockApi.${endpoint.operationId}.mockResolvedValue(mockResponse);

    // Act
    const { result } = renderHook(() => use${endpoint.operationId.charAt(0).toUpperCase() + endpoint.operationId.slice(1)}(${endpoint.parameters?.length ? '{ id: "test-id" }' : ''}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Clear mock call history
    mockApi.${endpoint.operationId}.mockClear();

    // Trigger refetch
    result.current.refetch();

    // Assert
    await waitFor(() => {
      expect(mockApi.${endpoint.operationId}).toHaveBeenCalledTimes(1);
    });
  });
});

// Integration test with real API
describe('${endpoint.operationId} Integration', () => {
  it('should work with real API endpoint', async () => {
    // This test requires a running server
    const response = await fetch('http://localhost:3001${endpoint.path}', {
      method: '${endpoint.method}',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'demo-api-key'
      }${endpoint.requestBodyType ? `,
      body: JSON.stringify(${JSON.stringify(endpoint.examples?.request || {})})` : ''}
    });

    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('data');
  });
});`;

  return {
    title: `${endpoint.operationId} - Testing`,
    description: `Unit and integration tests for ${endpoint.summary.toLowerCase()}`,
    category: 'testing',
    language: 'typescript',
    code,
    tags: ['testing', 'vitest', 'mocking', 'integration'],
    related: [`${endpoint.operationId}Hook`, `${endpoint.operationId}ApiCall`]
  };
}

/**
 * Generate all examples for an endpoint
 */
export function generateEndpointExamples(endpoint: EndpointMetadata): CodeExample[] {
  return [
    generateReactHookExample(endpoint),
    generateApiCallExample(endpoint),
    generateErrorHandlingExample(endpoint),
    generateTestingExample(endpoint)
  ];
}

/**
 * Generate all examples for the API
 */
export function generateAllExamples(): CodeExample[] {
  const examples: CodeExample[] = [];

  // Generate examples for each endpoint
  for (const endpoint of API_ENDPOINTS) {
    examples.push(...generateEndpointExamples(endpoint));
  }

  // Add general examples
  examples.push(
    generateAuthenticationExample(),
    generateRealTimeExample()
  );

  return examples;
}

/**
 * Search examples by tags or content
 */
export function searchExamples(query: string, examples: CodeExample[] = generateAllExamples()): CodeExample[] {
  const lowercaseQuery = query.toLowerCase();
  return examples.filter(example => 
    example.title.toLowerCase().includes(lowercaseQuery) ||
    example.description.toLowerCase().includes(lowercaseQuery) ||
    example.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery)) ||
    example.code.toLowerCase().includes(lowercaseQuery)
  );
}

/**
 * Get examples by category
 */
export function getExamplesByCategory(category: ExampleCategory, examples: CodeExample[] = generateAllExamples()): CodeExample[] {
  return examples.filter(example => example.category === category);
}

/**
 * Generate markdown documentation with examples
 */
export function generateMarkdownExamples(examples: CodeExample[] = generateAllExamples()): string {
  const categories = [...new Set(examples.map(e => e.category))];
  
  let markdown = `# API Code Examples

This document contains comprehensive code examples for the Hola API, including React hooks, direct API calls, error handling patterns, and testing examples.

## Table of Contents

${categories.map(cat => `- [${cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' ')}](#${cat.replace('-', '-')})`).join('\n')}

`;

  for (const category of categories) {
    const categoryExamples = examples.filter(e => e.category === category);
    
    markdown += `## ${category.charAt(0).toUpperCase() + category.slice(1).replace('-', ' ')}

`;

    for (const example of categoryExamples) {
      markdown += `### ${example.title}

${example.description}

**Tags:** ${example.tags.map(tag => `\`${tag}\``).join(', ')}

\`\`\`${example.language}
${example.code}
\`\`\`

`;

      if (example.related && example.related.length > 0) {
        markdown += `**Related Examples:** ${example.related.join(', ')}

`;
      }
    }
  }

  return markdown;
}

/**
 * Generate HTML page for code examples
 */
export function generateExamplesHTML(examples: CodeExample[] = generateAllExamples()): string {
  const categories = [...new Set(examples.map(e => e.category))];
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hola API Code Examples</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-dark.min.css">
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
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      min-height: 100vh;
      box-shadow: 0 0 20px rgba(0,0,0,0.1);
    }
    
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      text-align: center;
    }
    
    .header h1 {
      margin: 0;
      font-size: 2.5rem;
      font-weight: 700;
    }
    
    .header p {
      margin: 1rem 0 0 0;
      font-size: 1.1rem;
      opacity: 0.9;
    }
    
    .nav {
      background: #f1f5f9;
      padding: 1rem 2rem;
      border-bottom: 1px solid #e2e8f0;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    .nav-links {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .nav-links a {
      color: #475569;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .nav-links a:hover {
      background: #e2e8f0;
      color: #1e293b;
    }
    
    .search-container {
      margin-left: auto;
      position: relative;
    }
    
    .search-input {
      padding: 0.5rem 1rem;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      width: 250px;
      font-size: 0.9rem;
    }
    
    .content {
      padding: 2rem;
    }
    
    .category-section {
      margin-bottom: 3rem;
    }
    
    .category-title {
      font-size: 1.8rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 1.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .category-icon {
      font-size: 1.5rem;
    }
    
    .examples-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 1.5rem;
    }
    
    .example-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .example-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .example-header {
      padding: 1rem 1.5rem;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .example-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 0.5rem 0;
    }
    
    .example-description {
      color: #64748b;
      font-size: 0.9rem;
      margin: 0;
      line-height: 1.4;
    }
    
    .example-tags {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      flex-wrap: wrap;
    }
    
    .tag {
      background: #e2e8f0;
      color: #475569;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .example-code {
      position: relative;
    }
    
    .code-header {
      background: #1e293b;
      color: white;
      padding: 0.5rem 1rem;
      font-size: 0.8rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .language-badge {
      background: #3b82f6;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.7rem;
    }
    
    .copy-button {
      background: #475569;
      border: none;
      color: white;
      padding: 0.3rem 0.6rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.7rem;
      transition: background 0.2s;
    }
    
    .copy-button:hover {
      background: #64748b;
    }
    
    .example-code pre {
      margin: 0;
      padding: 1.5rem;
      overflow-x: auto;
      background: #1e293b !important;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      text-shadow: none !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    
    .stats {
      background: #f1f5f9;
      padding: 1rem 2rem;
      text-align: center;
      color: #64748b;
      font-size: 0.9rem;
    }
    
    /* Clean syntax highlighting for dark background */
    .token.comment,
    .token.prolog,
    .token.doctype,
    .token.cdata {
      color: #94a3b8 !important;
      font-style: italic;
      text-shadow: none !important;
    }
    
    .token.keyword,
    .token.function {
      color: #60a5fa !important;
      font-weight: 500;
      text-shadow: none !important;
    }
    
    .token.string,
    .token.attr-value {
      color: #34d399 !important;
      text-shadow: none !important;
    }
    
    .token.number,
    .token.boolean {
      color: #fbbf24 !important;
      text-shadow: none !important;
    }
    
    .token.operator,
    .token.punctuation {
      color: #cbd5e1 !important;
      text-shadow: none !important;
    }
    
    .token.class-name,
    .token.builtin {
      color: #a78bfa !important;
      font-weight: 500;
      text-shadow: none !important;
    }
    
    .token.property,
    .token.variable {
      color: #e2e8f0 !important;
      text-shadow: none !important;
    }
    
    .hidden {
      display: none;
    }
    
    .no-results {
      text-align: center;
      padding: 3rem;
      color: #64748b;
    }
    
    .no-results h3 {
      margin: 0 0 0.5rem 0;
      color: #1e293b;
    }
    
    @media (max-width: 768px) {
      .container { margin: 0; box-shadow: none; }
      .header { padding: 1.5rem 1rem; }
      .header h1 { font-size: 2rem; }
      .nav { padding: 1rem; }
      .nav-links { flex-direction: column; align-items: stretch; }
      .search-container { margin-left: 0; margin-top: 1rem; }
      .search-input { width: 100%; }
      .content { padding: 1rem; }
      .examples-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Hola API Code Examples</h1>
      <p>Comprehensive code examples for React hooks, API calls, error handling, and testing</p>
    </div>
    
    <nav class="nav">
      <div class="nav-links">
        <a href="#" onclick="showAllCategories()">All Examples</a>
        ${categories.map(cat => `<a href="#${cat}" onclick="showCategory('${cat}')">${cat.charAt(0).toUpperCase() + cat.slice(1).replace('-', ' ')}</a>`).join('')}
        <div class="search-container">
          <input type="text" id="searchInput" class="search-input" placeholder="Search examples..." onkeyup="searchExamples()">
        </div>
      </div>
    </nav>
    
    <div class="content" id="content">
      <div id="no-results" class="no-results hidden">
        <h3>No examples found</h3>
        <p>Try adjusting your search terms or browse by category.</p>
      </div>
      
      ${categories.map(category => {
        const categoryExamples = examples.filter(e => e.category === category);
        const categoryIcon = getCategoryIcon(category);
        
        return `
        <section class="category-section" id="category-${category}" data-category="${category}">
          <h2 class="category-title">
            <span class="category-icon">${categoryIcon}</span>
            ${category.charAt(0).toUpperCase() + category.slice(1).replace('-', ' ')}
            <span style="font-size: 0.8rem; font-weight: normal; color: #64748b; margin-left: 0.5rem;">(${categoryExamples.length} examples)</span>
          </h2>
          
          <div class="examples-grid">
            ${categoryExamples.map((example, index) => `
              <div class="example-card" data-tags="${example.tags.join(' ')}" data-title="${example.title.toLowerCase()}" data-description="${example.description.toLowerCase()}">
                <div class="example-header">
                  <h3 class="example-title">${example.title}</h3>
                  <p class="example-description">${example.description}</p>
                  <div class="example-tags">
                    ${example.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                  </div>
                </div>
                <div class="example-code">
                  <div class="code-header">
                    <span class="language-badge">${example.language}</span>
                    <button class="copy-button" onclick="copyCode('code-${category}-${index}')">📋 Copy</button>
                  </div>
                  <pre><code id="code-${category}-${index}" class="language-${example.language}">${escapeHtml(example.code)}</code></pre>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
        `;
      }).join('')}
    </div>
    
    <div class="stats">
      Total: ${examples.length} examples across ${categories.length} categories
    </div>
  </div>
  
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-core.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
  <script>
    function getCategoryIcon(category) {
      const icons = {
        'react-hooks': '⚛️',
        'api-calls': '🌐',
        'error-handling': '🛡️',
        'authentication': '🔐',
        'real-time': '⚡',
        'testing': '🧪'
      };
      return icons[category] || '📝';
    }
    
    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    
    function showAllCategories() {
      const sections = document.querySelectorAll('.category-section');
      sections.forEach(section => section.style.display = 'block');
      document.getElementById('no-results').classList.add('hidden');
    }
    
    function showCategory(category) {
      const sections = document.querySelectorAll('.category-section');
      sections.forEach(section => {
        if (section.dataset.category === category) {
          section.style.display = 'block';
        } else {
          section.style.display = 'none';
        }
      });
      document.getElementById('no-results').classList.add('hidden');
    }
    
    function searchExamples() {
      const searchTerm = document.getElementById('searchInput').value.toLowerCase();
      const cards = document.querySelectorAll('.example-card');
      let visibleCount = 0;
      
      cards.forEach(card => {
        const tags = card.dataset.tags;
        const title = card.dataset.title;
        const description = card.dataset.description;
        
        if (searchTerm === '' || 
            tags.includes(searchTerm) || 
            title.includes(searchTerm) || 
            description.includes(searchTerm)) {
          card.style.display = 'block';
          visibleCount++;
        } else {
          card.style.display = 'none';
        }
      });
      
      // Show/hide category sections based on visible cards
      const sections = document.querySelectorAll('.category-section');
      sections.forEach(section => {
        const visibleCards = section.querySelectorAll('.example-card[style*="block"], .example-card:not([style*="none"])');
        section.style.display = visibleCards.length > 0 ? 'block' : 'none';
      });
      
      // Show no results message
      if (visibleCount === 0 && searchTerm !== '') {
        document.getElementById('no-results').classList.remove('hidden');
      } else {
        document.getElementById('no-results').classList.add('hidden');
      }
    }
    
    function copyCode(elementId) {
      const code = document.getElementById(elementId).textContent;
      navigator.clipboard.writeText(code).then(() => {
        // Show feedback
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy: ', err);
      });
    }
    
    // Initialize syntax highlighting
    Prism.highlightAll();
  </script>
</body>
</html>`;
}

function getCategoryIcon(category: ExampleCategory): string {
  const icons = {
    'react-hooks': '⚛️',
    'api-calls': '🌐',
    'error-handling': '🛡️',
    'authentication': '🔐',
    'real-time': '⚡',
    'testing': '🧪'
  };
  return icons[category] || '📝';
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
