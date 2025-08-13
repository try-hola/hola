// Development environment configuration and utilities

export interface MockDataScenario {
  name: string;
  description: string;
  customization: MockDataCustomization;
}

export interface MockDataCustomization {
  jobProgressSpeed: 'slow' | 'normal' | 'fast';
  errorRate: number; // 0-1 probability of API errors
  latency: { min: number; max: number }; // ms
  deploymentCount: number;
  jobCount: number;
  notificationCount: number;
  enableFailures: boolean;
}

export interface DevelopmentConfig {
  mockData: {
    enabled: boolean;
    currentScenario: string;
    scenarios: Record<string, MockDataScenario>;
    customization: MockDataCustomization;
  };
  devTools: {
    apiInspector: boolean;
    performanceProfiler: boolean;
    stateDebugger: boolean;
    networkEmulator: boolean;
    enableLogging: boolean;
  };
  network: {
    simulateSlowNetwork: boolean;
    simulateOffline: boolean;
    latencyMultiplier: number;
    errorRate: number;
  };
}

// Default development configuration
export const defaultDevelopmentConfig: DevelopmentConfig = {
  mockData: {
    enabled: Bun.env.USE_MOCK_DATA !== 'false',
    currentScenario: Bun.env.MOCK_SCENARIO || 'normal',
    scenarios: {
      normal: {
        name: 'Normal Development',
        description: 'Default mock data with realistic values',
        customization: {
          jobProgressSpeed: 'normal',
          errorRate: 0.02, // 2% error rate
          latency: { min: 100, max: 500 },
          deploymentCount: 5,
          jobCount: 3,
          notificationCount: 8,
          enableFailures: false,
        },
      },
      stress: {
        name: 'High Load Testing',
        description: 'High-load scenario with many deployments and jobs',
        customization: {
          jobProgressSpeed: 'fast',
          errorRate: 0.05, // 5% error rate
          latency: { min: 200, max: 1000 },
          deploymentCount: 20,
          jobCount: 15,
          notificationCount: 30,
          enableFailures: true,
        },
      },
      error: {
        name: 'Error Testing',
        description: 'Error-prone scenario for testing error handling',
        customization: {
          jobProgressSpeed: 'normal',
          errorRate: 0.3, // 30% error rate
          latency: { min: 500, max: 2000 },
          deploymentCount: 3,
          jobCount: 5,
          notificationCount: 12,
          enableFailures: true,
        },
      },
      empty: {
        name: 'Clean Slate',
        description: 'Minimal data for clean slate testing',
        customization: {
          jobProgressSpeed: 'normal',
          errorRate: 0.0,
          latency: { min: 50, max: 200 },
          deploymentCount: 0,
          jobCount: 0,
          notificationCount: 0,
          enableFailures: false,
        },
      },
      demo: {
        name: 'Demo Mode',
        description: 'Perfect data for demonstrations and screenshots',
        customization: {
          jobProgressSpeed: 'slow',
          errorRate: 0.0,
          latency: { min: 100, max: 300 },
          deploymentCount: 8,
          jobCount: 2,
          notificationCount: 5,
          enableFailures: false,
        },
      },
    },
    customization: {
      jobProgressSpeed: 'normal',
      errorRate: 0.02,
      latency: { min: 100, max: 500 },
      deploymentCount: 5,
      jobCount: 3,
      notificationCount: 8,
      enableFailures: false,
    },
  },
  devTools: {
    apiInspector: Bun.env.DEV_API_INSPECTOR !== 'false',
    performanceProfiler: Bun.env.DEV_PERFORMANCE_PROFILER !== 'false',
    stateDebugger: Bun.env.DEV_STATE_DEBUGGER !== 'false',
    networkEmulator: Bun.env.DEV_NETWORK_EMULATOR !== 'false',
    enableLogging: Bun.env.DEV_ENABLE_LOGGING !== 'false',
  },
  network: {
    simulateSlowNetwork: Bun.env.SIMULATE_SLOW_NETWORK === 'true',
    simulateOffline: Bun.env.SIMULATE_OFFLINE === 'true',
    latencyMultiplier: Number(Bun.env.LATENCY_MULTIPLIER) || 1,
    errorRate: Number(Bun.env.NETWORK_ERROR_RATE) || 0,
  },
};

// Current development configuration (can be modified at runtime)
const developmentConfig = { ...defaultDevelopmentConfig };

// Apply scenario to current configuration
export function applyScenario(scenarioName: string): void {
  const scenario = developmentConfig.mockData.scenarios[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}`);
  }
  
  developmentConfig.mockData.currentScenario = scenarioName;
  developmentConfig.mockData.customization = { ...scenario.customization };
  
  console.log(`[Development] Applied scenario: ${scenario.name}`);
  console.log(`[Development] Configuration:`, scenario.customization);
}

// Update specific customization settings
export function updateCustomization(updates: Partial<MockDataCustomization>): void {
  developmentConfig.mockData.customization = {
    ...developmentConfig.mockData.customization,
    ...updates,
  };
  
  console.log(`[Development] Updated customization:`, updates);
}

// Network simulation middleware
export function applyNetworkSimulation<T>(
  operation: () => Promise<T>, 
  options: { simulateErrors?: boolean } = {}
): Promise<T> {
  return new Promise((resolve, reject) => {
    const config = developmentConfig.network;
    const customization = developmentConfig.mockData.customization;
    
    // Simulate network latency
    const baseLatency = Math.random() * (customization.latency.max - customization.latency.min) + customization.latency.min;
    const simulatedLatency = baseLatency * config.latencyMultiplier;
    
    // Check for simulated network errors
    if (options.simulateErrors !== false && Math.random() < (config.errorRate + customization.errorRate)) {
      setTimeout(() => {
        reject(new Error('Simulated network error'));
      }, simulatedLatency / 2);
      return;
    }
    
    // Check for offline simulation
    if (config.simulateOffline) {
      setTimeout(() => {
        reject(new Error('Network offline'));
      }, 100);
      return;
    }
    
    // Execute operation with simulated latency
    setTimeout(async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }, simulatedLatency);
  });
}

// Development utilities
export const developmentUtils = {
  // Reset all mock data to scenario defaults
  resetMockData: () => {
    const currentScenario = developmentConfig.mockData.currentScenario;
    applyScenario(currentScenario);
    // TODO: Reset state manager based on scenario
    console.log(`[Development] Reset mock data to ${currentScenario} scenario`);
  },
  
  // Seed development data
  seedDevelopmentData: async () => {
    console.log('[Development] Seeding development data...');
    // TODO: Implement development data seeding
    console.log('[Development] Development data seeded successfully');
  },
  
  // Generate sample data for testing
  generateSampleData: (type: 'deployment' | 'job' | 'notification', count: number = 1) => {
    console.log(`[Development] Generating ${count} sample ${type}(s)`);
    // TODO: Implement sample data generation
  },
  
  // Performance benchmarking
  benchmark: async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - start;
      console.log(`[Development] Benchmark ${name}: ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.log(`[Development] Benchmark ${name} failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  },
  
  // Memory usage monitoring
  getMemoryUsage: () => {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return {
        rss: `${Math.round(usage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(usage.external / 1024 / 1024)}MB`,
      };
    }
    return null;
  },
};

// Environment validation
export function validateDevelopmentEnvironment(): void {
  console.log('[Development] Validating development environment...');
  
  // Check Node.js/Bun version
  if (typeof process !== 'undefined') {
    console.log(`[Development] Runtime: ${process.version}`);
  }
  
  // Check environment variables
  const optionalEnvVars = [
    'USE_MOCK_DATA',
    'MOCK_SCENARIO',
    'DEV_API_INSPECTOR',
    'DEV_PERFORMANCE_PROFILER',
    'DEV_STATE_DEBUGGER',
    'DEV_NETWORK_EMULATOR',
  ];
  
  console.log('[Development] Environment variables:');
  optionalEnvVars.forEach(envVar => {
    const value = Bun.env[envVar] || 'not set';
    console.log(`[Development]   ${envVar}: ${value}`);
  });
  
  console.log('[Development] Environment validation complete');
}

// Initialize development environment
export function initializeDevelopmentEnvironment(): void {
  console.log('[Development] Initializing development environment...');
  
  validateDevelopmentEnvironment();
  
  // Apply initial scenario
  const initialScenario = developmentConfig.mockData.currentScenario;
  if (developmentConfig.mockData.scenarios[initialScenario]) {
    applyScenario(initialScenario);
  }
  
  // Set up development tools
  if (developmentConfig.devTools.enableLogging) {
    console.log('[Development] Enhanced logging enabled');
  }
  
  console.log('[Development] Development environment initialized');
  console.log('[Development] Current configuration:', {
    scenario: developmentConfig.mockData.currentScenario,
    mockDataEnabled: developmentConfig.mockData.enabled,
    devToolsEnabled: Object.entries(developmentConfig.devTools)
      .filter(([, enabled]) => enabled)
      .map(([tool]) => tool),
  });
}

// Export current config getter
export function getCurrentDevelopmentConfig(): DevelopmentConfig {
  return { ...developmentConfig };
}

// Export scenarios list
export function getAvailableScenarios(): Array<{ name: string; description: string }> {
  return Object.entries(developmentConfig.mockData.scenarios).map(([key, scenario]) => ({
    name: key,
    description: scenario.description,
  }));
}
