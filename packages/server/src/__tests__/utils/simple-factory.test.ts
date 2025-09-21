/**
 * Simple Factory Tests
 * 
 * Tests for the simplified environment-based service factory
 */

import { describe, it, expect } from 'vitest';
import { createServices, detectEnvironment, getServices, resetServices } from '../../services/simple-factory';

describe('Simple Service Factory', () => {
  describe('createServices', () => {
    it('should create mock services for test environment', () => {
      const services = createServices('test');
      
      expect(services.storage).toBeDefined();
      expect(services.config).toBeDefined();
      expect(services.database).toBeDefined();
      expect(services.auth).toBeDefined();
      expect(services.docker).toBeDefined();
      expect(services.systemMonitoring).toBeDefined();
      expect(services.logging).toBeDefined();
      expect(services.jobs).toBeDefined();
      expect(services.catalog).toBeDefined();
      expect(services.bundles).toBeDefined();
      expect(services.drafts).toBeDefined();
      expect(services.validation).toBeDefined();
      expect(services.deployments).toBeDefined();
      
      // Verify these are mock implementations by checking constructor names
      expect(services.storage.constructor.name).toBe('MockStorageService');
      expect(services.docker.constructor.name).toBe('MockDockerService');
    });

    it('should create real services for production environment', () => {
      const services = createServices('production');
      
      expect(services.storage).toBeDefined();
      expect(services.config).toBeDefined();
      expect(services.database).toBeDefined();
      expect(services.auth).toBeDefined();
      expect(services.docker).toBeDefined();
      expect(services.systemMonitoring).toBeDefined();
      expect(services.logging).toBeDefined();
      expect(services.jobs).toBeDefined();
      expect(services.catalog).toBeDefined();
      expect(services.bundles).toBeDefined();
      expect(services.drafts).toBeDefined();
      expect(services.validation).toBeDefined();
      expect(services.deployments).toBeDefined();
      
      // Verify these are real implementations by checking constructor names
      expect(services.storage.constructor.name).toBe('RealStorageService');
      expect(services.docker.constructor.name).toBe('RealDockerService');
    });

    it('should create mixed services for development environment', () => {
      const services = createServices('development');
      
      expect(services.storage).toBeDefined();
      expect(services.config).toBeDefined();
      expect(services.database).toBeDefined();
      expect(services.auth).toBeDefined();
      expect(services.docker).toBeDefined();
      expect(services.systemMonitoring).toBeDefined();
      expect(services.logging).toBeDefined();
      expect(services.jobs).toBeDefined();
      expect(services.catalog).toBeDefined();
      expect(services.bundles).toBeDefined();
      expect(services.drafts).toBeDefined();
      expect(services.validation).toBeDefined();
      expect(services.deployments).toBeDefined();
      
      // Verify mixed implementations: real services where safe, mock Docker for safety
      expect(services.storage.constructor.name).toBe('RealStorageService');
      expect(services.docker.constructor.name).toBe('MockDockerService'); // Mock for safety
      expect(services.systemMonitoring.constructor.name).toBe('RealSystemMonitoringService');
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
  });

  describe('getServices and resetServices', () => {
    it('should return the same instance on multiple calls', () => {
      resetServices(); // Ensure clean state
      
      const services1 = getServices();
      const services2 = getServices();
      
      expect(services1).toBe(services2);
    });

    it('should create new instance after reset', () => {
      resetServices(); // Ensure clean state
      
      const services1 = getServices();
      resetServices();
      const services2 = getServices();
      
      expect(services1).not.toBe(services2);
    });
  });
});