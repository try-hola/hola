// server/src/controllers/__tests__/apps/management.test.ts
import request from 'supertest';
import { TestServer } from '../../../test/test-server.js';
import fs from 'fs-extra';
import path from 'path';

// Mock the DockerRunner to use our test adapter
jest.mock('../../../utils/docker', () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require('../../../test/docker-test-adapter').DockerTestAdapter)();
    })
  };
});

describe('App Management API Tests', () => {
  let testServer: TestServer;
  const testAppName = 'management-test-app';

  beforeAll(async () => {
    // Set up the test server
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();
    
    // Create a test app for management operations
    await testServer.environment.createMockApp(testAppName);
  });

  afterAll(async () => {
    await testServer.stop();
  });

  test('GET /api/apps/:appName/details should return complete app details', async () => {
    // Create a file in the app's files directory to test the files listing
    const filesDir = testServer.environment.getPaths().deployments.files(testAppName);
    await fs.ensureDir(filesDir);
    await fs.writeFile(path.join(filesDir, 'test-config.json'), '{"test": true}');
    
    const response = await request(testServer.getApp())
      .get(`/api/apps/${testAppName}/details`)
      .expect(200);
    
    // Verify app details
    expect(response.body).toHaveProperty('appName', testAppName);
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('config');
    expect(response.body.config).toHaveProperty('name', testAppName);
    expect(response.body.config).toHaveProperty('test', true);
    
    // Verify files array
    expect(response.body).toHaveProperty('files');
    expect(Array.isArray(response.body.files)).toBe(true);
    expect(response.body.files.length).toBeGreaterThan(0);
  });

  test('POST /api/apps/:appName/start should start the app and return SSE headers', async () => {
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/start`)
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });
  
  test('POST /api/apps/:appName/stop should stop the app and return SSE headers', async () => {
    const response = await request(testServer.getApp())
      .post(`/api/apps/${testAppName}/stop`)
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });
  
  test('DELETE /api/apps/:appName should remove the app and return SSE headers', async () => {
    const response = await request(testServer.getApp())
      .delete(`/api/apps/${testAppName}`)
      .expect(200);
    
    // Validate SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
    
    // Verify that a backup was created during removal
    const backupsDir = path.dirname(testServer.environment.getPaths().backups(testAppName, ''));
    const backupExists = await fs.pathExists(backupsDir);
    expect(backupExists).toBe(true);
    
    // Verify that the app directory was removed
    const appDir = testServer.environment.getPaths().deployments.root(testAppName);
    const appDirExists = await fs.pathExists(appDir);
    expect(appDirExists).toBe(false);
  });
  
  test('POST /api/apps/:appName/start should return an error for non-existent app', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/non-existent-app/start')
      .expect(200); // Still returns 200 for SSE
    
    // We would need to parse the SSE events to verify the error message
    // but we can check the headers are correct
    expect(response.headers['content-type']).toContain('text/event-stream');
  });
  
  test('GET /api/apps should return a list of all deployed apps', async () => {
    // Create a couple more test apps
    await testServer.environment.createMockApp('list-test-app1');
    await testServer.environment.createMockApp('list-test-app2');
    
    const response = await request(testServer.getApp())
      .get('/api/apps')
      .expect(200);
    
    expect(response.body).toHaveProperty('apps');
    expect(Array.isArray(response.body.apps)).toBe(true);
    expect(response.body.apps).toContain('list-test-app1');
    expect(response.body.apps).toContain('list-test-app2');
  });
});