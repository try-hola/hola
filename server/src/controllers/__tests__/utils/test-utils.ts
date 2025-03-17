import { EventEmitter } from 'events';
import { jest } from '@jest/globals';
import path from 'path';

// Use a consistent storage root for tests
export const TEST_STORAGE_ROOT = '/var/lib/hola';

// Mock functions for fs-extra
export const mockFs = {
  ensureDir: jest.fn(() => Promise.resolve()),
  emptyDir: jest.fn(() => Promise.resolve()),
  pathExists: jest.fn((path: string) => {
    // Automatically handle common deployment paths for tests
    if (path.includes('/var/lib/hola/deployments') || 
        path.includes('/var/lib/hola/config')) {
      return Promise.resolve(true);
    }
    return Promise.resolve(true);
  }),
  copy: jest.fn(() => Promise.resolve()),
  remove: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve('{"test":"value"}')),
  readdir: jest.fn((dir: string) => {
    // Match different directory contents based on path
    if (dir.includes('/var/lib/hola/deployments')) {
      return Promise.resolve(['app1', 'app2']);
    }
    return Promise.resolve(['file1', 'file2']);
  }),
  stat: jest.fn((path: string) => {
    // For deployment directories, return directory stats
    if (path.includes('/var/lib/hola/deployments/app1') || 
        path.includes('/var/lib/hola/deployments/app2')) {
      return Promise.resolve({
        isDirectory: jest.fn(() => true),
        isFile: jest.fn(() => false),
        size: 0,
        mtime: new Date(),
        ctime: new Date()
      });
    }
    // For anything with 'notadir' in path, return file stats
    else if (path.includes('notadir')) {
      return Promise.resolve({
        isDirectory: jest.fn(() => false),
        isFile: jest.fn(() => true),
        size: 1024,
        mtime: new Date(),
        ctime: new Date()
      });
    }
    // Default response
    return Promise.resolve({
      isDirectory: jest.fn(() => true),
      isFile: jest.fn(() => false),
      size: 0,
      mtime: new Date(),
      ctime: new Date()
    });
  }),
  createReadStream: jest.fn(() => ({
    pipe: jest.fn(() => ({}))
  })),
  writeFile: jest.fn(() => Promise.resolve()),
  existsSync: jest.fn((path) => {
    // Automatically handle common file paths
    return true;
  }),
  readFileSync: jest.fn(() => Buffer.from("test"))
};

// Docker runner mock
export class MockDocker extends EventEmitter {
  runCommand = jest.fn().mockImplementation(() => Promise.resolve({ code: 0, output: 'running' }));
}

// Oras runner mock
export class MockOras extends EventEmitter {
  runCommand = jest.fn().mockImplementation(() => Promise.resolve());
}

export const mockDocker = new MockDocker();
export const mockOras = new MockOras();

// Setup reusable mocks for response object
export const setupMocks = () => {
  // Response with SSE methods
  const res: {
    setHeader: jest.Mock<any>,
    write: jest.Mock<any>,
    end: jest.Mock<any>,
    status: jest.Mock<any>,
    json: jest.Mock<any>,
    sendFile: jest.Mock<any>
  } = {
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    status: jest.fn(() => res),
    json: jest.fn(() => res),
    sendFile: jest.fn(() => res)
  };

  // Default next function
  const next = jest.fn();

  return { res, next };
};

// Mock paths
export const mockPaths = {
  packages: jest.fn((appName: string, version: string) => 
    `/var/lib/hola/packages/${appName}/${version}`),
  config: jest.fn((appName: string) => 
    `/var/lib/hola/config/${appName}`),
  deployments: {
    root: jest.fn((appName: string) => 
      `/var/lib/hola/deployments/${appName}`),
    files: jest.fn((appName: string) => 
      `/var/lib/hola/deployments/${appName}/files`),
    compose: jest.fn((appName: string) => 
      `/var/lib/hola/deployments/${appName}/compose`),
    current: jest.fn((appName: string) => 
      `/var/lib/hola/deployments/${appName}/current`)
  },
  backups: jest.fn((appName: string, tag: string) => 
    `/var/lib/hola/backups/${appName}/${tag}`)
};

// Create a function to set up all the Jest mocks
export const setupJestMocks = () => {
  // Mock modules
  jest.mock('../../../utils/updates', () => ({
    sendUpdate: jest.fn()
  }));

  jest.mock("uuid", () => ({
    v4: () => "mock-task-id"
  }));

  jest.mock("../../../utils/docker", () => ({
    DockerRunner: jest.fn(() => mockDocker)
  }));

  jest.mock("../../../utils/oras", () => ({
    OrasRunner: jest.fn(() => mockOras)
  }));

  jest.mock("fs-extra", () => mockFs);

  jest.mock("tar", () => ({
    extract: jest.fn(() => ({}))
  }));

  jest.mock("../../../config", () => {
    return {
      STORAGE_ROOT: TEST_STORAGE_ROOT,
      ORAS_REGISTRY: "localhost:5000",
      PORT: 3000,
      PATHS: mockPaths,
      isValidAppName: jest.fn(() => true)
    };
  });
};

// Function to configure all mocks required for files tests
export const setupFilesTestMocks = () => {
  // Configure mocks for all modules
  jest.mock("fs-extra", () => mockFs);

  jest.mock("../../../utils/logger", () => ({
    logEvent: jest.fn()
  }));

  jest.mock("../../../config", () => ({
    PATHS: mockPaths,
    STORAGE_ROOT: "/var/lib/hola",
    ORAS_REGISTRY: "localhost:5000",
    isValidAppName: jest.fn(() => true)
  }));
};