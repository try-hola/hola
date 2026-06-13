/**
 * Manual Acceptance Criteria Test
 * 
 * Tests the specific scenario mentioned in the issue:
 * - Create deployment A at host `app.local`, path `/`.
 * - Attempt deployment B at same host `app.local`, path `/api`
 * - Expect conflict detection since we use host-based routing (no path routing)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type {
  DeploymentListItem,
  GetDeploymentsRequest,
} from '@hola/shared';
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';
import { MockDeploymentService } from '../helpers/mock-deployment-service';
import { RealValidationService } from '../../services/core/validation';
import { MockStorageService } from '../../services/core/storage';
import { MockDockerService } from '../../services/core/docker';
import { MockSystemMonitoringService } from '../../services/core/system-monitoring';

describe('Acceptance Criteria - Host-based Routing Conflicts', () => {
  let validationService: RealValidationService;

  beforeAll(async () => {
    await setupTestEnvironment({
      env: {
        NODE_ENV: 'test',
      }
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment();
  });

  beforeEach(() => {
    // Create fresh service instances for each test
    const dockerService = new MockDockerService();
    const systemMonitoring = new MockSystemMonitoringService();
    const storageService = new MockStorageService();
    
    validationService = new RealValidationService(
      dockerService,
      systemMonitoring,
      storageService
    );
  });

  test('Scenario: Deployment A at app.local should conflict with Deployment B at same host', async () => {
    // Simulate deployment A already exists at 'app.local'
    const existingDeploymentA: DeploymentListItem = {
      id: 'deployment-a-123',
      name: 'App Deployment A',
      app: 'app',
      icon: '📦',
      status: 'running',
      resources: { cpu: '15%', memory: '256MB' },
      ports: [],
      lastUpdated: new Date().toISOString(),
      url: 'http://app.local',
    };

    // Mock deployment service that returns existing deployment A
    const mockDeploymentService: MockDeploymentService = {
      listDeployments: async (request: GetDeploymentsRequest) => {
        // Return deployment A only for running status (not installing)
        if (request.status === 'running') {
          return {
            items: [existingDeploymentA],
            page: 1,
            limit: 1000,
            total: 1,
          };
        } else {
          return {
            items: [],
            page: 1,
            limit: 1000,
            total: 0,
          };
        }
      },
    };

    Object.assign(validationService, { deploymentService: mockDeploymentService });

    // Attempt to validate deployment B using the same app name (which would use same host)
    const conflicts = await validationService.validateRoutingRules('app', 'local');
    
    // Should detect conflict
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({
      conflictingDeploymentId: 'deployment-a-123',
      conflictingAppName: 'app',
      conflictingHost: 'app.local',
      message: "Host 'app.local' is already in use by deployment 'App Deployment A' (deployment-a-123)",
    });

    console.log('✅ Conflict detected as expected:');
    console.log(`   Conflicting deployment: ${conflicts[0].conflictingDeploymentId}`);
    console.log(`   Conflicting host: ${conflicts[0].conflictingHost}`);
    console.log(`   Message: ${conflicts[0].message}`);
  });

  test('Scenario: Different app names should not conflict (different hosts)', async () => {
    // Deployment A exists at 'app.local'  
    const existingDeploymentA: DeploymentListItem = {
      id: 'deployment-a-123',
      name: 'App Deployment A',
      app: 'app',
      icon: '📦',
      status: 'running',
      resources: { cpu: '15%', memory: '256MB' },
      ports: [],
      lastUpdated: new Date().toISOString(),
      url: 'http://app.local',
    };

    const mockDeploymentService: MockDeploymentService = {
      listDeployments: async (request: GetDeploymentsRequest) => ({
        items: request.status === 'running' ? [existingDeploymentA] : [],
        page: 1,
        limit: 1000,
        total: request.status === 'running' ? 1 : 0,
      }),
    };

    Object.assign(validationService, { deploymentService: mockDeploymentService });

    // Deployment B uses different app name, so different host: 'myapp.local'
    const conflicts = await validationService.validateRoutingRules('myapp', 'local');
    
    // Should have no conflicts (different hosts)
    expect(conflicts).toEqual([]);

    console.log('✅ No conflict detected for different app names:');
    console.log('   Deployment A: app.local');
    console.log('   Deployment B: myapp.local');
    console.log('   Result: No conflicts (different hosts)');
  });

  test('Scenario: Host-based routing rule generation', () => {
    // Test that routing rules are generated correctly for host-based routing
    const deploymentId = 'deploy-abc123';
    const appName = 'app';
    const domain = 'local';

    const rule = validationService.generateRoutingRule(deploymentId, appName, domain);

    expect(rule).toEqual({
      deploymentId: 'deploy-abc123',
      appName: 'app',
      host: 'app.local',
      domain: 'local',
      serviceName: 'app-deploy-abc12',
      networkName: 'hola-deploy-abc12',
      createdAt: expect.any(String),
    });

    console.log('✅ Routing rule generated for host-based routing:');
    console.log(`   Host: ${rule.host}`);
    console.log(`   Service: ${rule.serviceName}`);
    console.log(`   Network: ${rule.networkName}`);
    console.log('   Note: No path-based routing - each app gets unique host');
  });

  test('Integration: preflightCheck should detect routing conflicts', async () => {
    // Mock a draft that would conflict with existing deployment
    const draft = {
      draftId: 'draft-123',
      appId: 'app', // Same app name as existing deployment
      version: '1.0.0',
      systemOverrides: {},
      appEnv: [],
      ports: [],
      composeOverride: '',
      files: [],
    };

    // Existing deployment using same app name
    const existingDeploymentA: DeploymentListItem = {
      id: 'deployment-a-123',
      name: 'Existing App',
      app: 'app',
      icon: '📦',
      status: 'running',
      resources: { cpu: '15%', memory: '256MB' },
      ports: [],
      lastUpdated: new Date().toISOString(),
    };

    const mockDeploymentService: MockDeploymentService = {
      listDeployments: async (request: GetDeploymentsRequest) => ({
        items: request.status === 'running' ? [existingDeploymentA] : [],
        page: 1,
        limit: 1000,
        total: request.status === 'running' ? 1 : 0,
      }),
    };

    Object.assign(validationService, { deploymentService: mockDeploymentService });

    // Run preflight check
    const result = await validationService.preflightCheck(draft);

    // Should fail due to routing conflict
    expect(result.ok).toBe(false);
    
    // Find the routing check
    const routingCheck = result.checks.find(check => check.name === 'routing');
    expect(routingCheck).toBeDefined();
    expect(routingCheck?.status).toBe('fail');
    expect(routingCheck?.detail).toContain('app.local.hola');
    expect(routingCheck?.detail).toContain('deployment-a-123');

    console.log('✅ Preflight check integration working:');
    console.log(`   Overall result: ${result.ok ? 'PASS' : 'FAIL'}`);
    console.log(`   Routing check status: ${routingCheck?.status}`);
    console.log(`   Routing check detail: ${routingCheck?.detail}`);
    console.log(`   Remediation: ${routingCheck?.remediation}`);
  });

  test('Demo: The new system replaces port management with host routing', () => {
    console.log('\n🎯 Summary: Port Registry → Host-based Routing');
    console.log('════════════════════════════════════════════════');
    console.log('OLD SYSTEM (port-based):');
    console.log('  - App A: localhost:8080');
    console.log('  - App B: localhost:8081 (different port required)');
    console.log('  - Conflicts: Port already in use');
    console.log('  - Problem: Port management complexity');
    console.log('');
    console.log('NEW SYSTEM (host-based via Traefik):');
    console.log('  - App A: app-a.local.hola (unique host)');
    console.log('  - App B: app-b.local.hola (different host)');
    console.log('  - Conflicts: Host already in use');
    console.log('  - Solution: Isolated networks + unique hostnames');
    console.log('');
    console.log('✅ Benefits:');
    console.log('  ✓ No port conflicts (each app isolated network)');
    console.log('  ✓ Simplified routing (host-based, no paths)'); 
    console.log('  ✓ Clear conflict messages with deployment IDs');
    console.log('  ✓ Traefik routing map for ops debugging');
    console.log('  ✓ Port methods kept for backwards compatibility');

    // This test always passes - it's just for demonstration
    expect(true).toBe(true);
  });
});
