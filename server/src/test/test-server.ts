// server/src/test/test-server.ts
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import * as config from '../config.js';
import { TestEnvironment } from './test-environment.js';

/**
 * Class to manage a real test server instance for integration tests
 */
export class TestServer {
  private server: http.Server | null = null;
  private app: express.Application;
  public port: number = 0;
  public baseUrl: string = '';
  public environment: TestEnvironment;

  constructor() {
    this.environment = new TestEnvironment();
    this.app = express();
  }

  /**
   * Initialize the test server with real or mock modules as needed
   */
  async init(): Promise<void> {
    await this.environment.init();
    
    // Override config paths to use test environment
    const originalPaths = config.PATHS;
    const testPaths = this.environment.getPaths();
    
    // Override config values for testing
    Object.defineProperty(config, 'STORAGE_ROOT', {
      value: this.environment.storageRoot,
      writable: true,
      configurable: true
    });
    
    Object.defineProperty(config, 'PATHS', {
      value: testPaths,
      writable: true,
      configurable: true
    });
    
    // Import the real app routes (after config is modified)
    const { registerRoutes } = await import('../routes.js');
    
    // Set up middleware and routes on the test app
    this.app.use(express.json());
    registerRoutes(this.app);
  }

  /**
   * Start the server on a random available port
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(0, () => {
        const address = this.server?.address() as AddressInfo;
        this.port = address.port;
        this.baseUrl = `http://localhost:${this.port}`;
        resolve();
      });
    });
  }

  /**
   * Stop the server and clean up resources
   */
  async stop(): Promise<void> {
    if (this.server) {
      // First wait for the server to close
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      // Then clean up the environment
      await this.environment.cleanup();
    } else {
      // Just clean up the environment if server was never started
      await this.environment.cleanup();
    }
  }
  
  /**
   * Get the Express app instance for supertest
   */
  getApp(): express.Application {
    return this.app;
  }
}