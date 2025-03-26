// server/src/controllers/__tests__/files/integration.test.ts
import request from 'supertest';
import { TestServer } from '../../../test/test-server.js';
import fs from 'fs-extra';
import path from 'path';

// Mock the DockerRunner to avoid actual Docker operations
jest.mock('../../../utils/docker', () => {
  return {
    DockerRunner: jest.fn().mockImplementation(() => {
      return new (require('../../../test/docker-test-adapter').DockerTestAdapter)();
    })
  };
});

describe('Files API Integration Tests', () => {
  let testServer: TestServer;
  const testContent = 'This is test file content.';

  beforeAll(async () => {
    // Set up the test server
    testServer = new TestServer();
    await testServer.init();
    await testServer.start();
    
    // Create test app directory for file uploads
    await testServer.environment.createMockApp('file-test-app');
  });

  afterAll(async () => {
    await testServer.stop();
  });

  test('POST /api/apps/:appName/files should upload a file', async () => {
    const response = await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', 'test-file.txt')
      .attach('file', Buffer.from(testContent), {
        filename: 'test-file.txt',
        contentType: 'text/plain'
      })
      .expect(201);

    expect(response.body).toHaveProperty('message', 'File uploaded successfully');
    expect(response.body).toHaveProperty('path');
    
    // Verify file was actually created with correct content
    const filePath = testServer.environment.getPaths().deployments.files('file-test-app');
    const uploadedFilePath = path.join(filePath, 'test-file.txt');
    
    const exists = await fs.pathExists(uploadedFilePath);
    expect(exists).toBe(true);
    
    const content = await fs.readFile(uploadedFilePath, 'utf-8');
    expect(content).toBe(testContent);
  });
  
  test('POST /api/apps/:appName/files should create nested directories', async () => {
    const nestedPath = 'nested/directory/structure/test.txt';
    const nestedContent = 'Nested directory test file';
    
    const response = await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', nestedPath)
      .attach('file', Buffer.from(nestedContent), {
        filename: 'test.txt',
        contentType: 'text/plain'
      })
      .expect(201);

    expect(response.body).toHaveProperty('message', 'File uploaded successfully');
    
    // Verify nested directories and file were created
    const basePath = testServer.environment.getPaths().deployments.files('file-test-app');
    const fullPath = path.join(basePath, nestedPath);
    
    const exists = await fs.pathExists(fullPath);
    expect(exists).toBe(true);
    
    const content = await fs.readFile(fullPath, 'utf-8');
    expect(content).toBe(nestedContent);
  });
  
  test('POST /api/apps/:appName/files should reject paths with traversal attempts', async () => {
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', '../../../etc/passwd')
      .attach('file', Buffer.from('malicious content'), {
        filename: 'passwd',
        contentType: 'text/plain'
      })
      .expect(400);
      
    // Verify no file was saved outside the app directory
    const parentDir = path.dirname(testServer.environment.getPaths().deployments.files('file-test-app'));
    const parentFiles = await fs.readdir(parentDir);
    
    // Only the file-test-app directory should exist in the parent
    expect(parentFiles.includes('etc')).toBe(false);
  });
  
  test('POST /api/apps/:appName/files should reject invalid app names', async () => {
    await request(testServer.getApp())
      .post('/api/apps/invalid..app/files')  // Use an app name with invalid characters
      .field('filePath', 'test.txt')
      .attach('file', Buffer.from('test content'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      })
      .expect(400);
  });
  
  test('POST /api/apps/:appName/files should return 400 when file is missing', async () => {
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', 'test-no-file.txt')
      // Deliberately not attaching a file
      .expect(400);
  });

  test('POST /api/apps/:appName/files should return 400 when filePath is missing', async () => {
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      // No filePath field
      .attach('file', Buffer.from('test content'), {
        filename: 'test.txt',
        contentType: 'text/plain'
      })
      .expect(400);
  });
});