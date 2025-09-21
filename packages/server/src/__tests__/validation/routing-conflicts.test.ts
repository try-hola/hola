/**
 * Validation Service Routing Conflicts Tests
 * 
 * Tests the new Traefik host-based routing conflict detection functionality.
 * Covers overlap cases, success scenarios, and error handling.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type {
  TraefikRoutingRule,
  RoutingConflict,
  TraefikRoutingMap,
  DeploymentListItem,
  GetDeploymentsResponse,
} from '@hola/shared';
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';
import { RealValidationService } from '../../services/core/validation';
import { MockStorageService } from '../../services/core/storage';
import { MockDockerService } from '../../services/core/docker';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';

describe('Validation Service - Routing Conflicts', () => {
  let validationService: RealValidationService;
  let storageService: MockStorageService;

  beforeAll(async () => {
    await setupTestEnvironment({
      env: {
        HOLA_USE_REAL_DOCKER: 'false',
        HOLA_USE_REAL_DATABASE: 'false',
      }
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  beforeEach(async () => {
    // Create fresh service instances for each test
    const dockerService = new MockDockerService();
    const systemMonitoring = new MockSystemMonitoringService();
    storageService = new MockStorageService();
    
    // Create real validation service with mock dependencies
    validationService = new RealValidationService(
      dockerService,
      systemMonitoring,
      storageService
    );
  });

  test('should generate valid routing rule', () => {
    const rule = validationService.generateRoutingRule(
      'deploy-123',
      'nextcloud',
      'local.hola'
    );

    expect(rule).toEqual({
      deploymentId: 'deploy-123',
      appName: 'nextcloud',
      host: 'nextcloud.local.hola',
      domain: 'local.hola',
      serviceName: 'nextcloud-deploy-1',
      networkName: 'hola-deploy-1',
      createdAt: expect.any(String),
    });
  });

  test('should return no conflicts for unique host', async () => {
    // Mock deployment service to return no existing deployments
    const mockDeploymentService = {
      listDeployments: async () => ({
        items: [],
        page: 1,
        limit: 1000,
        total: 0,
      } as GetDeploymentsResponse),
    };

    // Override the deployment service temporarily
    (validationService as any).deploymentService = mockDeploymentService;

    const conflicts = await validationService.validateRoutingRules('nextcloud', 'local.hola');
    expect(conflicts).toEqual([]);
  });

  test('should detect conflict with existing running deployment', async () => {
    // Mock deployment service to return existing deployment with same app
    const existingDeployments: DeploymentListItem[] = [
      {
        id: 'existing-deploy-1',
        name: 'Existing Nextcloud',
        app: 'nextcloud',
        icon: '☁️',
        status: 'running',
        resources: { cpu: '10%', memory: '128MB' },
        ports: [],
        lastUpdated: new Date().toISOString(),
      },
    ];

    const mockDeploymentService = {
      listDeployments: async (request: any) => ({
        items: request.status === 'running' ? existingDeployments : [],
        page: 1,
        limit: 1000,
        total: existingDeployments.length,
      } as GetDeploymentsResponse),
    };

    (validationService as any).deploymentService = mockDeploymentService;

    const conflicts = await validationService.validateRoutingRules('nextcloud', 'local.hola');
    
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      conflictingDeploymentId: 'existing-deploy-1',
      conflictingAppName: 'nextcloud',
      conflictingHost: 'nextcloud.local.hola',
      message: "Host 'nextcloud.local.hola' is already in use by deployment 'Existing Nextcloud' (existing-deploy-1)",
    });
  });

  test('should detect conflict with pending deployment', async () => {
    const pendingDeployments: DeploymentListItem[] = [
      {
        id: 'pending-deploy-1',
        name: 'Pending Nextcloud',
        app: 'nextcloud',
        icon: '☁️',
        status: 'installing',
        resources: { cpu: '0%', memory: '0MB' },
        ports: [],
        lastUpdated: new Date().toISOString(),
      },
    ];

    const mockDeploymentService = {
      listDeployments: async (request: any) => ({
        items: request.status === 'installing' ? pendingDeployments : [],
        page: 1,
        limit: 1000,
        total: request.status === 'installing' ? pendingDeployments.length : 0,
      } as GetDeploymentsResponse),
    };

    (validationService as any).deploymentService = mockDeploymentService;

    const conflicts = await validationService.validateRoutingRules('nextcloud', 'local.hola');
    
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      conflictingDeploymentId: 'pending-deploy-1',
      conflictingAppName: 'nextcloud',
      conflictingHost: 'nextcloud.local.hola',
      message: "Host 'nextcloud.local.hola' conflicts with pending deployment 'Pending Nextcloud' (pending-deploy-1)",
    });
  });

  test('should allow different apps on same domain', async () => {
    const existingDeployments: DeploymentListItem[] = [
      {
        id: 'existing-deploy-1',
        name: 'Existing Nextcloud',
        app: 'nextcloud',
        icon: '☁️',
        status: 'running',
        resources: { cpu: '10%', memory: '128MB' },
        ports: [],
        lastUpdated: new Date().toISOString(),
      },
    ];

    const mockDeploymentService = {
      listDeployments: async (request: any) => ({
        items: request.status === 'running' ? existingDeployments : [],
        page: 1,
        limit: 1000,
        total: existingDeployments.length,
      } as GetDeploymentsResponse),
    };

    (validationService as any).deploymentService = mockDeploymentService;

    // Check for a different app - should have no conflicts
    const conflicts = await validationService.validateRoutingRules('homeassistant', 'local.hola');
    expect(conflicts).toEqual([]);
  });

  test('should handle deployment service errors gracefully', async () => {
    const mockDeploymentService = {
      listDeployments: async () => {
        throw new Error('Service unavailable');
      },
    };

    (validationService as any).deploymentService = mockDeploymentService;

    // Should not throw, but return empty conflicts
    const conflicts = await validationService.validateRoutingRules('nextcloud', 'local.hola');
    expect(conflicts).toEqual([]);
  });

  test('should handle missing deployment service', async () => {
    // Simulate missing deployment service
    (validationService as any).deploymentService = undefined;

    const conflicts = await validationService.validateRoutingRules('nextcloud', 'local.hola');
    expect(conflicts).toEqual([]);
  });

  test('should persist and retrieve routing map', async () => {
    const rules: TraefikRoutingRule[] = [
      {
        deploymentId: 'deploy-1',
        appName: 'nextcloud',
        host: 'nextcloud.local.hola',
        domain: 'local.hola',
        serviceName: 'nextcloud-deploy-1',
        networkName: 'hola-deploy-1',
        createdAt: new Date().toISOString(),
      },
      {
        deploymentId: 'deploy-2',
        appName: 'homeassistant',
        host: 'homeassistant.local.hola',
        domain: 'local.hola',
        serviceName: 'homeassistant-deploy-2',
        networkName: 'hola-deploy-2',
        createdAt: new Date().toISOString(),
      },
    ];

    // Persist routing map
    await validationService.persistRoutingMap(rules);

    // Retrieve routing map
    const retrievedMap = await validationService.getRoutingMap();

    expect(retrievedMap).toEqual({
      'nextcloud.local.hola': rules[0],
      'homeassistant.local.hola': rules[1],
    });
  });

  test('should return empty map when no routing file exists', async () => {
    // Get routing map without persisting anything first
    const map = await validationService.getRoutingMap();
    expect(map).toEqual({});
  });
});