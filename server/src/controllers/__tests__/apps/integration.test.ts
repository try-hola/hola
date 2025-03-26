// server/src/controllers/__tests__/apps/integration.test.ts
import request from 'supertest';
import { TestServer } from '../../../test/test-server.js';

// Mock the DockerRunner to use our test adapter
jest.mock('../../../utils/docker', () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require('../../../test/docker-test-adapter').DockerTestAdapter)();
    })
  };
});

describe('Apps API Integration Tests', () => {
  let testServer: TestServer;

  beforeAll(async () => {
    // Set up the test server
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();
    
    // Create test apps
    await testServer.environment.createMockApp('test-app1');
    await testServer.environment.createMockApp('test-app2');
  });

  afterAll(async () => {
    await testServer.stop();
  });

  test('GET /api/apps should return list of apps', async () => {
    const response = await request(testServer.getApp())
      .get('/api/apps')
      .expect(200);
    
    expect(response.body).toHaveProperty('apps');
    expect(Array.isArray(response.body.apps)).toBeTruthy();
    expect(response.body.apps).toContain('test-app1');
    expect(response.body.apps).toContain('test-app2');
  });

  test('GET /api/apps/:appName/details should return app details', async () => {
    const response = await request(testServer.getApp())
      .get('/api/apps/test-app1/details')
      .expect(200);
    
    expect(response.body).toHaveProperty('appName', 'test-app1');
    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('config');
    expect(response.body.config).toHaveProperty('name', 'test-app1');
  });

  test('POST /api/apps/:appName/start should start the app', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/test-app1/start')
      .expect(200);
    
    // Test for SSE headers
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  test('POST /api/apps/:appName/stop should stop the app', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/test-app1/stop')
      .expect(200);
    
    expect(response.headers['content-type']).toContain('text/event-stream');
  });

  test('GET /api/apps/non-existent-app/details should return 404', async () => {
    await request(testServer.getApp())
      .get('/api/apps/non-existent-app/details')
      .expect(404);
  });

  test('POST /api/apps/deploy should deploy an app and return SSE headers', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/deploy')
      .send({ appName: 'test-app1', version: 'latest' })
      .expect(200);
    
    // Validate SSE headers (the deploy operation is expected to use SSE)
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  test('POST /api/apps/test-app1/upgrade should upgrade an app and return SSE headers', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/test-app1/upgrade')
      .send({ version: 'new-version' })
      .expect(200);
    
    // Validate SSE headers for the upgrade endpoint
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });

  test('DELETE /api/apps/test-app1 should remove the app', async () => {
    const response = await request(testServer.getApp())
      .delete('/api/apps/test-app1')
      .expect(200);
    
    // Check for SSE headers instead of JSON body
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.headers['cache-control']).toContain('no-cache');
  });
});