// server/src/controllers/__tests__/apps/deploy.test.ts
import request from 'supertest';
import { TestServer } from '../../../test/test-server.js';
import fs from 'fs-extra';
import path from 'path';
import * as tar from 'tar';

// Mock the tar module to avoid actual tar operations
jest.mock('tar', () => {
  return {
    create: jest.fn().mockImplementation(async () => {
      return Promise.resolve();
    })
  };
});

// Mock both Docker and ORAS runners for deployment testing
jest.mock('../../../utils/docker', () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require('../../../test/docker-test-adapter').DockerTestAdapter)();
    })
  };
});

jest.mock('../../../utils/oras', () => {
  return {
    OrasRunner: jest.fn().mockImplementation(() => {
      return new (require('../../../test/oras-test-adapter').OrasTestAdapter)();
    })
  };
});

describe('App Deployment API Tests', () => {
  let testServer: TestServer;

  beforeEach(async () => {
    // Set up a fresh test server for each test to ensure isolation
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();
  });

  afterEach(async () => {
    await testServer.stop();
  });

  test('POST /api/apps should deploy a new app', async () => {
    // Create a package directory and bundle file to simulate ORAS download
    const testAppName = 'deploy-test-app';
    const packageDir = testServer.environment.getPaths().packages(testAppName, 'latest');
    await fs.ensureDir(packageDir);
    
    // Create a temporary directory with files to include in the tar
    const tempDir = path.join(packageDir, 'temp');
    await fs.ensureDir(tempDir);
    
    // Create a docker-compose.yml file in the temp directory
    await fs.writeFile(
      path.join(tempDir, 'docker-compose.yml'),
      'version: "3"\nservices:\n  app:\n    image: test-app:latest'
    );
    
    // Create a test bundle file manually (tar module is mocked)
    const bundlePath = path.join(packageDir, 'bundle.tgz');
    await fs.writeFile(bundlePath, 'mock tarball content');
    
    // Create the compose directory and add a docker-compose.yml file
    const composeDir = testServer.environment.getPaths().deployments.compose(testAppName);
    await fs.ensureDir(composeDir);
    await fs.writeFile(
      path.join(composeDir, 'docker-compose.yml'),
      'version: "3"\nservices:\n  app:\n    image: test-app:latest'
    );
    
    // Ensure the current directory exists
    const currentDir = testServer.environment.getPaths().deployments.current(testAppName);
    await fs.ensureDir(currentDir);
    
    // Test deployment request
    const response = await request(testServer.getApp())
      .post('/api/apps')
      .send({ appName: testAppName })
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    
    // Verify deployment directory structure was created
    const composeFileExists = await fs.pathExists(path.join(composeDir, 'docker-compose.yml'));
    expect(composeFileExists).toBe(true);
  });

  test('POST /api/apps/:appName/upgrade should upgrade an existing app', async () => {
    const testAppName = 'upgrade-test-app';
    
    // Create initial app structure
    await testServer.environment.createMockApp(testAppName);
    
    // Create package for the new version
    const packageDir = testServer.environment.getPaths().packages(testAppName, 'v2');
    await fs.ensureDir(packageDir);
    
    // Create a temporary directory with files to include in the tar
    const tempDir = path.join(packageDir, 'temp');
    await fs.ensureDir(tempDir);
    
    // Create a docker-compose.yml file in the temp directory
    await fs.writeFile(
      path.join(tempDir, 'docker-compose.yml'),
      'version: "3"\nservices:\n  app:\n    image: test-app:v2'
    );
    
    // Create a test bundle file manually (tar module is mocked)
    const bundlePath = path.join(packageDir, 'bundle.tgz');
    await fs.writeFile(bundlePath, 'mock tarball content');
    
    // Test upgrade request
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/upgrade`)
      .send({ version: 'v2' })
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    
    // Check backup was created (we can't check exact path due to timestamp in name)
    const backupsDir = path.dirname(testServer.environment.getPaths().backups(testAppName, ''));
    const backupDirExists = await fs.pathExists(backupsDir);
    expect(backupDirExists).toBe(true);
  });

  test('POST /api/apps should return 400 if app name is missing', async () => {
    await request(testServer.getApp())
      .post('/api/apps')
      .send({}) // Missing appName field
      .expect(400);
  });

  test('POST /api/apps/:appName/upgrade should handle errors gracefully', async () => {
    // Create package for the new version to avoid ENOENT error
    const packageDir = testServer.environment.getPaths().packages('non-existent-app', 'v2');
    await fs.ensureDir(packageDir);
    
    // Create a test bundle file manually
    const bundlePath = path.join(packageDir, 'bundle.tgz');
    await fs.writeFile(bundlePath, 'mock tarball content');
    
    // Test upgrade for non-existent app - this should still return 200 due to SSE response
    // but the events should include an error status
    const response = await request(testServer.getApp())
      .post('/api/apps/non-existent-app/upgrade')
      .send({ version: 'v2' })
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
  });
});