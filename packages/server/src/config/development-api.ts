// Development tools API endpoints for mock data management and debugging
import { 
  getCurrentDevelopmentConfig, 
  getAvailableScenarios, 
  applyScenario, 
  updateCustomization,
  developmentUtils,
  type MockDataCustomization 
} from '../config/development';
import { stateManager, type MockJob, type MockDeployment, type MockNotification } from '../mock-data/state-manager';

// API monitoring data structure
interface ApiCall {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  duration: number;
  status: number;
  requestSize: number;
  responseSize: number;
  userAgent?: string;
  error?: string;
  timing?: {
    dns?: number;
    connect?: number;
    request?: number;
    response?: number;
    total: number;
  };
  stackTrace?: string;
  uiContext?: string;
}

interface PerformanceMetrics {
  memoryUsage: {
    rss: string;
    heapTotal: string;
    heapUsed: string;
    external: string;
  } | null;
  uptime: number;
  apiCalls: {
    total: number;
    last24h: number;
    errors: number;
    averageResponseTime: number;
  };
  cacheStats: {
    size: number;
    hitRate: string;
    evictions: number;
  };
}

// In-memory storage for development tools
class DevelopmentToolsManager {
  private apiCalls: ApiCall[] = [];
  private maxApiCallHistory = 1000; // Keep last 1000 API calls
  private startTime = Date.now();

  // Record API call with enhanced debugging info
  recordApiCall(call: Omit<ApiCall, 'id' | 'timestamp'>): void {
    const apiCall: ApiCall = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...call,
      // Add timing breakdown for debugging
      timing: {
        total: call.duration,
        dns: Math.floor(Math.random() * 20), // Mock DNS lookup time
        connect: Math.floor(Math.random() * 50), // Mock connection time
        request: Math.floor(call.duration * 0.3), // Mock request time
        response: Math.floor(call.duration * 0.7), // Mock response time
      },
      // Add UI context for tracing
      uiContext: call.path.includes('/api/') ? `API: ${call.path.split('/').pop()}` : undefined,
      // Add stack trace for errors
      stackTrace: call.status >= 400 ? `Error in ${call.path} at ${new Date().toISOString()}` : undefined,
    };

    this.apiCalls.push(apiCall);

    // Keep only recent calls
    if (this.apiCalls.length > this.maxApiCallHistory) {
      this.apiCalls = this.apiCalls.slice(-this.maxApiCallHistory);
    }
  }

  // Get API call history with enhanced details
  getApiCallHistory(limit = 100, enhanced = false): ApiCall[] {
    const calls = this.apiCalls.slice(-limit).reverse();
    
    if (enhanced) {
      // Add additional debugging information for enhanced mode
      return calls.map(call => ({
        ...call,
        timing: call.timing || {
          total: call.duration,
          dns: Math.floor(Math.random() * 20),
          connect: Math.floor(Math.random() * 50),
          request: Math.floor(call.duration * 0.3),
          response: Math.floor(call.duration * 0.7),
        },
        uiContext: call.uiContext || `Component: ${call.path.split('/').pop()?.toUpperCase()}`,
        stackTrace: call.status >= 400 ? `Error in ${call.path} at ${new Date(call.timestamp).toISOString()}` : call.stackTrace,
      }));
    }
    
    return calls;
  }

  // Get performance metrics
  getPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const recentCalls = this.apiCalls.filter(call => call.timestamp > last24h);
    
    const totalCalls = this.apiCalls.length;
    const errorCalls = this.apiCalls.filter(call => call.status >= 400).length;
    const averageResponseTime = totalCalls > 0 
      ? this.apiCalls.reduce((sum, call) => sum + call.duration, 0) / totalCalls 
      : 0;

    return {
      memoryUsage: developmentUtils.getMemoryUsage(),
      uptime: (now - this.startTime) / 1000, // seconds
      apiCalls: {
        total: totalCalls,
        last24h: recentCalls.length,
        errors: errorCalls,
        averageResponseTime: Math.round(averageResponseTime),
      },
      cacheStats: {
        size: 0, // TODO: Implement cache stats
        hitRate: '0%',
        evictions: 0,
      },
    };
  }

  // Clear API call history
  clearApiCallHistory(): void {
    this.apiCalls = [];
  }

  // Get state debugging information
  getStateDebugInfo(): {
    jobs: unknown[];
    deployments: unknown[];
    notifications: unknown[];
    timers: number;
  } {
    return {
      jobs: stateManager.getAllJobs(),
      deployments: stateManager.getAllDeployments(),
      notifications: stateManager.getNotifications(),
      timers: 0, // TODO: Get timer count from state manager
    };
  }
}

// Global development tools manager
const devToolsManager = new DevelopmentToolsManager();

// Middleware to record API calls
export function createApiMonitoringMiddleware() {
  return async (req: Request, handler: () => Promise<Response>): Promise<Response> => {
    const startTime = performance.now();
    const url = new URL(req.url);
    
    // Skip monitoring for development endpoints
    if (url.pathname.startsWith('/api/dev/')) {
      return handler();
    }

    try {
      const response = await handler();
      const duration = performance.now() - startTime;
      
      // Record the API call
      devToolsManager.recordApiCall({
        method: req.method,
        path: url.pathname,
        duration: Math.round(duration),
        status: response.status,
        requestSize: await estimateRequestSize(req),
        responseSize: await estimateResponseSize(response),
        userAgent: req.headers.get('user-agent') || undefined,
      });

      return response;
    } catch (error) {
      const duration = performance.now() - startTime;
      
      // Record failed API call
      devToolsManager.recordApiCall({
        method: req.method,
        path: url.pathname,
        duration: Math.round(duration),
        status: 500,
        requestSize: await estimateRequestSize(req),
        responseSize: 0,
        userAgent: req.headers.get('user-agent') || undefined,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  };
}

// Helper functions
async function estimateRequestSize(req: Request): Promise<number> {
  try {
    if (req.body) {
      const text = await req.text();
      return new TextEncoder().encode(text).length;
    }
  } catch {
    // Ignore errors in size estimation
  }
  return 0;
}

async function estimateResponseSize(response: Response): Promise<number> {
  try {
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      return parseInt(contentLength, 10);
    }
  } catch {
    // Ignore errors in size estimation
  }
  return 0;
}

// Development tools API endpoints
export const developmentToolsEndpoints = {
  // Get current development configuration
  getConfig: (): Response => {
    return new Response(JSON.stringify(getCurrentDevelopmentConfig()), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Get available scenarios
  getScenarios: (): Response => {
    return new Response(JSON.stringify(getAvailableScenarios()), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Apply a scenario
  applyScenario: async (req: Request): Promise<Response> => {
    try {
      const { scenario } = await req.json();
      applyScenario(scenario);
      return new Response(JSON.stringify({ success: true, scenario }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },

  // Update customization settings
  updateCustomization: async (req: Request): Promise<Response> => {
    try {
      const customization: Partial<MockDataCustomization> = await req.json();
      updateCustomization(customization);
      return new Response(JSON.stringify({ success: true, customization }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },

  // Reset mock data
  resetMockData: (): Response => {
    developmentUtils.resetMockData();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Get API call history
  getApiCallHistory: (req: Request): Response => {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const enhanced = url.searchParams.get('enhanced') === 'true';
    const history = devToolsManager.getApiCallHistory(limit, enhanced);
    
    return new Response(JSON.stringify(history), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Get performance metrics
  getPerformanceMetrics: (): Response => {
    const metrics = devToolsManager.getPerformanceMetrics();
    return new Response(JSON.stringify(metrics), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Clear API call history
  clearApiCallHistory: (): Response => {
    devToolsManager.clearApiCallHistory();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Get state debugging information
  getStateDebugInfo: (): Response => {
    const stateInfo = devToolsManager.getStateDebugInfo();
    return new Response(JSON.stringify(stateInfo), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Benchmark endpoint for testing performance
  benchmark: async (req: Request): Promise<Response> => {
    const { operation, iterations = 1 } = await req.json();
    
    const results = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      // Simulate different operations
      switch (operation) {
        case 'mock-data-generation':
          stateManager.getAllJobs();
          stateManager.getAllDeployments();
          break;
        case 'memory-allocation': {
          // Create and discard some objects
          const data = new Array(10000).fill(0).map((_, i) => ({ id: i, data: 'test' }));
          void data.length; // Use the data
          break;
        }
        default:
          await new Promise(resolve => setTimeout(resolve, 10));
      }
      
      const duration = performance.now() - start;
      results.push({ iteration: i + 1, duration });
    }
    
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const averageDuration = totalDuration / iterations;
    
    return new Response(JSON.stringify({
      operation,
      iterations,
      results,
      summary: {
        totalDuration: Math.round(totalDuration * 100) / 100,
        averageDuration: Math.round(averageDuration * 100) / 100,
        minDuration: Math.min(...results.map(r => r.duration)),
        maxDuration: Math.max(...results.map(r => r.duration)),
      },
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Network simulation endpoints
  simulateNetworkCondition: async (req: Request): Promise<Response> => {
    const { condition, duration = 30000 } = await req.json(); // duration in ms
    
    // This would need to be implemented in the network simulation middleware
    console.log(`[Development] Simulating network condition: ${condition} for ${duration}ms`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      condition, 
      duration,
      message: 'Network simulation applied (implementation pending)'
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

// Export the development tools manager for external use
export { devToolsManager };
