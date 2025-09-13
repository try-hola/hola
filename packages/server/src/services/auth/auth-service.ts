/**
 * Authentication service for pluggable auth providers
 * 
 * Provides a unified interface for different authentication mechanisms
 * including API keys, JWT tokens, and other identity providers.
 */

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from '../factory';

// Principal represents the authenticated user/entity
export interface Principal {
  id: string;
  type: 'user' | 'service' | 'system';
  name: string;
  email?: string;
  roles: string[];
  capabilities: string[];
  metadata?: Record<string, unknown>;
}

// Authentication result
export interface AuthResult {
  success: boolean;
  principal?: Principal;
  error?: string;
  requiresCapability?: string;
}

// Auth provider interface for pluggable authentication
export interface AuthProvider {
  readonly name: string;
  
  /**
   * Authenticate a request and return principal if valid
   */
  authenticate(token: string, metadata?: Record<string, unknown>): Promise<AuthResult>;
  
  /**
   * Check if principal has required capability
   */
  hasCapability(principal: Principal, capability: string): boolean;
  
  /**
   * Optional health check for the provider
   */
  healthCheck?(): Promise<boolean>;
}

// Base AuthService interface
export interface AuthService extends HealthCheckable {
  /**
   * Authenticate a token using configured providers
   */
  authenticate(token: string, metadata?: Record<string, unknown>): Promise<AuthResult>;
  
  /**
   * Check if principal has required capability
   */
  hasCapability(principal: Principal, capability: string): boolean;
  
  /**
   * Check if auth is enabled/required
   */
  isEnabled(): boolean;
  
  /**
   * Get list of configured providers
   */
  getProviders(): string[];
}

/**
 * Mock AuthService - always allows access when auth is disabled
 */
export class MockAuthService implements AuthService {
  private logger = getLogger().child({ service: 'MockAuthService' });

  async authenticate(_token: string): Promise<AuthResult> {
    void _token;
    this.logger.debug('Mock auth: allowing all requests');
    
    // Create a default principal for mock mode
    const mockPrincipal: Principal = {
      id: 'mock-user',
      type: 'user',
      name: 'Mock User',
      email: 'mock@example.com',
      roles: ['user', 'admin'],
      capabilities: ['*'], // All capabilities in mock mode
    };

    return {
      success: true,
      principal: mockPrincipal,
    };
  }

  hasCapability(_principal: Principal, _capability: string): boolean {
    void _principal;
    void _capability;
    // Mock mode: always grant capabilities
    return true;
  }

  isEnabled(): boolean {
    return false; // Mock service means auth is disabled
  }

  getProviders(): string[] {
    return ['mock'];
  }

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }
}

/**
 * Real AuthService with pluggable providers
 */
export class RealAuthService implements AuthService {
  private logger = getLogger().child({ service: 'RealAuthService' });
  private providers: Map<string, AuthProvider> = new Map();
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.logger.info('Real auth service initialized', { enabled });
  }

  /**
   * Register an auth provider
   */
  registerProvider(provider: AuthProvider): void {
    this.providers.set(provider.name, provider);
    this.logger.info('Auth provider registered', { 
      provider: provider.name,
      totalProviders: this.providers.size 
    });
  }

  async authenticate(token: string, metadata?: Record<string, unknown>): Promise<AuthResult> {
    if (!this.enabled) {
      this.logger.debug('Auth disabled, creating mock principal');
      return this.createMockPrincipal();
    }

    if (!token) {
      this.logger.debug('No token provided');
      return {
        success: false,
        error: 'No authentication token provided',
      };
    }

    // Try each provider until one succeeds
    for (const [name, provider] of this.providers) {
      try {
        this.logger.debug('Trying auth provider', { provider: name });
        const result = await provider.authenticate(token, metadata);
        
        if (result.success) {
          this.logger.info('Authentication successful', { 
            provider: name,
            principalId: result.principal?.id,
            principalType: result.principal?.type 
          });
          return result;
        }
        
        this.logger.debug('Auth provider failed', { 
          provider: name, 
          error: result.error 
        });
      } catch (error) {
        this.logger.warn('Auth provider error', { 
          provider: name, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.logger.warn('All auth providers failed');
    return {
      success: false,
      error: 'Authentication failed',
    };
  }

  hasCapability(principal: Principal, capability: string): boolean {
    if (!this.enabled) {
      return true; // When auth disabled, allow all capabilities
    }

    // Check if principal has wildcard capability
    if (principal.capabilities.includes('*')) {
      return true;
    }

    // Check exact capability match
    if (principal.capabilities.includes(capability)) {
      return true;
    }

    // Check role-based capabilities through providers
    for (const provider of this.providers.values()) {
      if (provider.hasCapability(principal, capability)) {
        return true;
      }
    }

    return false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a mock principal for when auth is disabled
   */
  private createMockPrincipal(): AuthResult {
    const mockPrincipal: Principal = {
      id: 'system',
      type: 'system',
      name: 'System User',
      roles: ['admin'],
      capabilities: ['*'],
    };

    return {
      success: true,
      principal: mockPrincipal,
    };
  }

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Check health of all providers
      const providerHealths = await Promise.all(
        Array.from(this.providers.values()).map(async (provider) => {
          if (provider.healthCheck) {
            return await provider.healthCheck();
          }
          return true; // No health check means healthy
        })
      );

      const allHealthy = providerHealths.every(health => health === true);
      
      return {
        healthy: allHealthy,
        lastCheck: new Date(),
        error: allHealthy ? undefined : 'One or more auth providers unhealthy',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Auth service health check failed', error instanceof Error ? error : undefined);
      
      return {
        healthy: false,
        lastCheck: new Date(),
        error: errorMessage,
      };
    }
  }
}

/**
 * API Key Auth Provider
 * Simple provider that validates against configured API keys
 */
export class ApiKeyAuthProvider implements AuthProvider {
  readonly name = 'api-key';
  private logger = getLogger().child({ service: 'ApiKeyAuthProvider' });
  private validKeys: Map<string, Principal> = new Map();

  constructor(keys: Record<string, Partial<Principal>> = {}) {
    // Setup default keys and principals
    for (const [key, principalData] of Object.entries(keys)) {
      const principal: Principal = {
        id: principalData.id || `api-key-${key.slice(0, 8)}`,
        type: principalData.type || 'service',
        name: principalData.name || `API Key ${key.slice(0, 8)}`,
        email: principalData.email,
        roles: principalData.roles || ['user'],
        capabilities: principalData.capabilities || ['read', 'write'],
        metadata: principalData.metadata,
      };
      
      this.validKeys.set(key, principal);
    }
    
    this.logger.info('API key provider initialized', { 
      keyCount: this.validKeys.size 
    });
  }

  async authenticate(token: string): Promise<AuthResult> {
    const principal = this.validKeys.get(token);
    
    if (principal) {
      this.logger.debug('API key authentication successful', { 
        principalId: principal.id 
      });
      return {
        success: true,
        principal,
      };
    }

    this.logger.debug('Invalid API key provided');
    return {
      success: false,
      error: 'Invalid API key',
    };
  }

  hasCapability(principal: Principal, capability: string): boolean {
    // API key provider uses simple capability checking
    return principal.capabilities.includes('*') || 
           principal.capabilities.includes(capability);
  }

  async healthCheck(): Promise<boolean> {
    // API key provider is always healthy if it has keys configured
    return this.validKeys.size > 0;
  }
}

/**
 * Standard capabilities for the application
 */
export const CAPABILITIES = {
  // Read operations
  READ_SYSTEM: 'read:system',
  READ_DEPLOYMENTS: 'read:deployments',
  READ_LOGS: 'read:logs',
  READ_BACKUPS: 'read:backups',
  READ_CATALOG: 'read:catalog',
  
  // Write operations  
  WRITE_DEPLOYMENTS: 'write:deployments',
  WRITE_SETTINGS: 'write:settings',
  WRITE_BACKUPS: 'write:backups',
  
  // Management operations
  MANAGE_SYSTEM: 'manage:system',
  MANAGE_USERS: 'manage:users',
  
  // Special capabilities
  ADMIN: 'admin',
  ALL: '*',
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];
