const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const net = require('net');
const config = require('../config');
const { registerRoutes } = require('../routes');
import { Application, Request, Response, NextFunction } from 'express';
import * as HTTP from 'http'; // Import for TypeScript type definitions
import { AddressInfo } from 'net'; // Import AddressInfo type from net
import { TestEnvironment } from './test-environment';

/**
 * Test server for running integration tests with Express
 */
export class TestServer {
  private server: HTTP.Server | null = null;
  private app: Application;
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
    
    // Set up middleware and routes on the test app
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    
    // Register routes explicitly
    registerRoutes(this.app);
    
    // Add a catch-all error handler for tests
    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error('Test server error:', err);
      res.status(500).json({ error: 'Internal Server Error', message: err.message });
    });
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
        console.log(`Test server started on ${this.baseUrl}`);
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
  getApp(): Application {
    return this.app;
  }
}

module.exports = { TestServer };