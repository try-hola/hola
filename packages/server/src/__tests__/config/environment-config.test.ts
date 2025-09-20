/**
 * Environment Configuration Tests
 * 
 * Tests for the new environment-based configuration system that replaces
 * complex feature flag matrices with simple environment modes.
 */

import { describe, it, expect } from 'vitest';
import { 
  getEnvironmentConfig, 
  detectEnvironment, 
  loadEnvironmentConfig,
  type Environment,
  type EnvironmentConfig 
} from '../../config/features';

describe('Environment Configuration', () => {
  describe('getEnvironmentConfig', () => {
    it('should return test configuration for test environment', () => {
      const config = getEnvironmentConfig('test');
      
      expect(config).toEqual({
        environment: 'test',
        useAuth: false,
        useObservability: false,
        enableDevApi: true,
        useRealServices: false,
      });
    });

    it('should return development configuration for development environment', () => {
      const config = getEnvironmentConfig('development');
      
      expect(config).toEqual({
        environment: 'development',
        useAuth: false,
        useObservability: false,
        enableDevApi: true,
        useRealServices: true,
      });
    });

    it('should return production configuration for production environment', () => {
      const config = getEnvironmentConfig('production');
      
      expect(config).toEqual({
        environment: 'production',
        useAuth: true,
        useObservability: true,
        enableDevApi: false,
        useRealServices: true,
      });
    });
  });

  describe('detectEnvironment', () => {
    it('should detect test environment when NODE_ENV is test', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      
      expect(detectEnvironment()).toBe('test');
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should detect test environment when VITEST is true', () => {
      const originalVitest = process.env.VITEST;
      const originalNodeEnv = process.env.NODE_ENV;
      
      process.env.VITEST = 'true';
      process.env.NODE_ENV = 'production'; // Should still detect test
      
      expect(detectEnvironment()).toBe('test');
      
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should detect test environment when HOLA_DISABLE_AUTOSTART is true', () => {
      const originalAutostart = process.env.HOLA_DISABLE_AUTOSTART;
      const originalNodeEnv = process.env.NODE_ENV;
      
      process.env.HOLA_DISABLE_AUTOSTART = 'true';
      process.env.NODE_ENV = 'production'; // Should still detect test
      
      expect(detectEnvironment()).toBe('test');
      
      process.env.HOLA_DISABLE_AUTOSTART = originalAutostart;
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should detect development environment when NODE_ENV is development', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalVitest = process.env.VITEST;
      const originalAutostart = process.env.HOLA_DISABLE_AUTOSTART;
      
      process.env.NODE_ENV = 'development';
      delete process.env.VITEST;
      delete process.env.HOLA_DISABLE_AUTOSTART;
      
      expect(detectEnvironment()).toBe('development');
      
      process.env.NODE_ENV = originalNodeEnv;
      process.env.VITEST = originalVitest;
      process.env.HOLA_DISABLE_AUTOSTART = originalAutostart;
    });

    it('should detect production environment by default', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalVitest = process.env.VITEST;
      const originalAutostart = process.env.HOLA_DISABLE_AUTOSTART;
      
      process.env.NODE_ENV = 'production';
      delete process.env.VITEST;
      delete process.env.HOLA_DISABLE_AUTOSTART;
      
      expect(detectEnvironment()).toBe('production');
      
      process.env.NODE_ENV = originalNodeEnv;
      process.env.VITEST = originalVitest;
      process.env.HOLA_DISABLE_AUTOSTART = originalAutostart;
    });
  });

  describe('loadEnvironmentConfig', () => {
    it('should load test configuration in test environment', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      
      const config = loadEnvironmentConfig();
      
      expect(config.environment).toBe('test');
      expect(config.useAuth).toBe(false);
      expect(config.useObservability).toBe(false);
      expect(config.enableDevApi).toBe(true);
      expect(config.useRealServices).toBe(false);
      
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should allow auth override in development environment', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalUseAuth = process.env.HOLA_USE_AUTH;
      
      process.env.NODE_ENV = 'development';
      process.env.HOLA_USE_AUTH = 'true';
      
      const config = loadEnvironmentConfig();
      
      expect(config.environment).toBe('development');
      expect(config.useAuth).toBe(true); // Overridden
      
      process.env.NODE_ENV = originalNodeEnv;
      process.env.HOLA_USE_AUTH = originalUseAuth;
    });

    it('should allow observability override in production environment', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalUseObservability = process.env.HOLA_USE_OBSERVABILITY;
      
      process.env.NODE_ENV = 'production';
      process.env.HOLA_USE_OBSERVABILITY = 'false';
      
      const config = loadEnvironmentConfig();
      
      expect(config.environment).toBe('production');
      expect(config.useObservability).toBe(false); // Overridden
      
      process.env.NODE_ENV = originalNodeEnv;
      process.env.HOLA_USE_OBSERVABILITY = originalUseObservability;
    });

    it('should ignore overrides in test environment', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalUseAuth = process.env.HOLA_USE_AUTH;
      
      process.env.NODE_ENV = 'test';
      process.env.HOLA_USE_AUTH = 'true'; // This should be ignored
      
      const config = loadEnvironmentConfig();
      
      expect(config.environment).toBe('test');
      expect(config.useAuth).toBe(false); // Not overridden in test
      
      process.env.NODE_ENV = originalNodeEnv;
      process.env.HOLA_USE_AUTH = originalUseAuth;
    });
  });
});