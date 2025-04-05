const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const net = require("net");
const config = require("../config");
const { registerRoutes } = require("../routes");
import { Application, Request, Response, NextFunction } from "express";
import * as HTTP from "http";
import { AddressInfo } from "net";
import { TestEnvironment } from "./test-environment";
import { promisify } from "util";

// Add a small delay utility for shutdown sequence
const sleep = promisify(setTimeout);

/**
 * Test server for running integration tests with Express
 * Provides an isolated environment with configurable test paths
 */
export class TestServer {
  private server: HTTP.Server | null = null;
  private app: Application;
  public port: number = 0;
  public baseUrl: string = "";
  public environment: TestEnvironment;
  private originalPaths: any = null;

  constructor() {
    this.environment = new TestEnvironment();
    this.app = express();
  }

  /**
   * Initialize the test server with isolated environment
   * Sets up middleware, routes, and overrides configuration paths for testing
   */
  async init(): Promise<void> {
    // Store original config to restore later
    this.originalPaths = { ...config.PATHS };

    // Initialize test environment first
    await this.environment.init();

    // Override config paths to use test environment
    const testPaths = this.environment.getPaths();

    // Override config values for testing
    Object.defineProperty(config, "STORAGE_ROOT", {
      value: this.environment.storageRoot,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(config, "PATHS", {
      value: testPaths,
      writable: true,
      configurable: true,
    });

    // Set up middleware and routes on the test app
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Register routes explicitly
    registerRoutes(this.app);

    // Add a catch-all error handler for tests
    this.app.use(
      (err: any, req: Request, res: Response, next: NextFunction) => {
        console.error("Test server error:", err);
        res
          .status(500)
          .json({ error: "Internal Server Error", message: err.message });
      }
    );
  }

  /**
   * Start the server on a random available port to avoid conflicts
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
   * Ensures proper shutdown sequence to prevent resource leaks
   */
  async stop(): Promise<void> {
    // Always attempt to clean up environment
    try {
      if (this.server) {
        // First close any open connections
        await new Promise<void>((resolve) => {
          this.server!.close((err) => {
            if (err) {
              console.warn("Error closing test server:", err);
            }
            // Always resolve, even on errors
            resolve();
          });
        });

        // Small delay to allow connections to fully close
        await sleep(100);
        this.server = null;
      }
    } catch (err) {
      console.warn("Error during test server shutdown:", err);
    } finally {
      // Always try to clean up the environment
      try {
        await this.environment.cleanup();

        // Restore original config values
        if (this.originalPaths) {
          Object.defineProperty(config, "PATHS", {
            value: this.originalPaths,
            writable: true,
            configurable: true,
          });
        }
      } catch (err) {
        console.warn("Error during test environment cleanup:", err);
      }
    }
  }

  /**
   * Get the Express app instance for use with supertest
   */
  getApp(): Application {
    return this.app;
  }
}

module.exports = { TestServer };
