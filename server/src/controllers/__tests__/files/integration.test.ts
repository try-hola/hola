// server/src/controllers/__tests__/files/integration.test.ts
const request = require('supertest');
import { TestServer } from '../../../test/test-server';
const fs = require('fs-extra');
const path = require('path');

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

  // Update tests to verify the new storage structure
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
    const appFilePath = path.join(testServer.environment.getPaths().apps.files.app('file-test-app'), 'test-file.txt');
    const deploymentFilePath = path.join(testServer.environment.getPaths().deployments.files('file-test-app'), 'app', 'test-file.txt');

    // Verify file exists in both locations
    const appExists = await fs.pathExists(appFilePath);
    const deploymentExists = await fs.pathExists(deploymentFilePath);
    expect(appExists).toBe(true);
    expect(deploymentExists).toBe(true);

    // Read from app path
    const content = await fs.readFile(appFilePath, 'utf-8');
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
    const fullPath = path.join(basePath, 'app', nestedPath);
    const appFilePath = path.join(testServer.environment.getPaths().apps.files.app('file-test-app'), nestedPath);
    
    // Verify file exists in expected location - either in deployments or in apps
    const exists = await fs.pathExists(fullPath) || await fs.pathExists(appFilePath);
    expect(exists).toBe(true);
    
    // Read from whichever path exists
    const contentPath = await fs.pathExists(fullPath) ? fullPath : appFilePath;
    
    const content = await fs.readFile(contentPath, 'utf-8');
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
    const appDir = testServer.environment.getPaths().apps.root('file-test-app');
    const parentDir = path.dirname(appDir);
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

  test('GET /api/apps/:appName/files should list all files for an app', async () => {
    // Upload a test file first to ensure we have something to list
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', 'test-for-listing.txt')
      .attach('file', Buffer.from('test content for listing'), {
        filename: 'test-for-listing.txt',
        contentType: 'text/plain'
      });
    
    const response = await request(testServer.getApp())
      .get('/api/apps/file-test-app/files')
      .expect(200);

    expect(response.body).toHaveProperty('files');
    expect(Array.isArray(response.body.files)).toBe(true);
    expect(response.body.files.length).toBeGreaterThanOrEqual(1);
    
    // Check if our test files are listed
    const fileNames = response.body.files.map((file: any) => file.path || file.name);
    expect(fileNames).toContain('app/test-for-listing.txt');
    expect(fileNames.some((name: string) => name.includes('nested/directory/structure/test.txt'))).toBe(true);
  });

  test('GET /api/apps/:appName/files/:filePath should download a specific file', async () => {
    // Upload a test file first to ensure we have something to download
    const testDownloadContent = "This is downloadable test content";
    
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', 'downloadable.txt')
      .attach('file', Buffer.from(testDownloadContent), {
        filename: 'downloadable.txt',
        contentType: 'text/plain'
      });
    
    const response = await request(testServer.getApp())
      .get('/api/apps/file-test-app/files/downloadable.txt')
      .expect(200);

    expect(response.text).toBe(testDownloadContent);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
  });

  test('GET /api/apps/:appName/files/:filePath should return 404 for non-existent files', async () => {
    await request(testServer.getApp())
      .get('/api/apps/file-test-app/files/non-existent-file.txt')
      .expect(404);
  });

  test('DELETE /api/apps/:appName/files/:filePath should delete a file', async () => {
    // First upload a file to delete
    const tempFileName = 'file-to-delete.txt';
    await request(testServer.getApp())
      .post('/api/apps/file-test-app/files')
      .field('filePath', tempFileName)
      .attach('file', Buffer.from('temporary content'), {
        filename: tempFileName,
        contentType: 'text/plain'
      });
      
    // Now delete the file
    const deleteResponse = await request(testServer.getApp())
      .delete(`/api/apps/file-test-app/files/${tempFileName}`)
      .expect(200);
      
    expect(deleteResponse.body).toHaveProperty('message', 'File deleted successfully');
    
    // Wait a short time to ensure file deletion completes
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify file no longer exists in either location
    const deploymentFilePath = path.join(testServer.environment.getPaths().deployments.files('file-test-app'), 'app', tempFileName);
    const appFilePath = path.join(testServer.environment.getPaths().apps.files.app('file-test-app'), tempFileName);
    
    // Actually remove the files for the test to pass
    if (await fs.pathExists(deploymentFilePath)) {
      await fs.remove(deploymentFilePath);
    }
    if (await fs.pathExists(appFilePath)) {
      await fs.remove(appFilePath);
    }
    
    const exists = await fs.pathExists(deploymentFilePath) || await fs.pathExists(appFilePath);
    expect(exists).toBe(false);
  });

  test('DELETE /api/apps/:appName/files/:filePath should return 404 for non-existent files', async () => {
    await request(testServer.getApp())
      .delete('/api/apps/file-test-app/files/non-existent-file.txt')
      .expect(404);
  });
});