// server/src/test/test-environment.ts
import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import { promisify } from "util";

// Add a small delay utility for retry mechanisms
const sleep = promisify(setTimeout);

/**
 * Test environment configuration for integration testing
 *
 * Creates an isolated filesystem structure with standardized paths
 * for app deployments, packages, backups, and configuration.
 * Handles initialization and cleanup of test data between test runs.
 */
export class TestEnvironment {
  public readonly storageRoot: string;
  public readonly appDirectories: {
    deployments: string;
    packages: string;
    backups: string;
    config: string;
    apps: string;
  };
  private readonly uniqueId: string;

  constructor(options: { cleanOnExit?: boolean } = {}) {
    // Add a unique ID to prevent test collisions
    this.uniqueId = uuidv4().substring(0, 8);
    // Use /tmp directory instead of project directory
    this.storageRoot = path.join("/tmp", `data_test_${this.uniqueId}`);
    this.appDirectories = {
      deployments: path.join(this.storageRoot, "deployments"),
      packages: path.join(this.storageRoot, "packages"),
      backups: path.join(this.storageRoot, "backups"),
      config: path.join(this.storageRoot, "config"),
      apps: path.join(this.storageRoot, "apps"),
    };

    if (options.cleanOnExit !== false) {
      // Default to true
      // Register cleanup handlers for various exit scenarios
      process.on("exit", () => {
        try {
          fs.removeSync(this.storageRoot);
        } catch (e) {
          console.warn("Failed to clean test dir on exit:", e);
        }
      });

      // Also clean up on process termination signals
      process.on("SIGINT", () => {
        this.cleanup().finally(() => process.exit(130));
      });

      process.on("SIGTERM", () => {
        this.cleanup().finally(() => process.exit(143));
      });
    }
  }

  /**
   * Initialize the test environment by creating required directories
   */
  async init(): Promise<void> {
    // Ensure the storage root doesn't exist before starting
    await this.safeRemove(this.storageRoot);

    // Create storage root and all subdirectories
    await fs.ensureDir(this.storageRoot);
    await Promise.all(
      Object.values(this.appDirectories).map((dir) => fs.ensureDir(dir)),
    );
  }

  /**
   * Safe removal of directory with retries and recursive deletion
   * @param dirPath Directory path to remove
   * @param maxRetries Maximum number of retry attempts
   * @param retryDelay Delay between retries in milliseconds
   */
  private async safeRemove(
    dirPath: string,
    maxRetries = 5,
    retryDelay = 200,
  ): Promise<boolean> {
    if (!(await fs.pathExists(dirPath))) {
      return true;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fs.remove(dirPath);
        return true;
      } catch (error) {
        if (attempt === maxRetries - 1) {
          // On final attempt, don't throw but return false to indicate failure
          console.warn(
            `Failed to remove directory ${dirPath} after ${maxRetries} attempts`,
          );
          return false;
        }

        // Wait before retrying
        await sleep(retryDelay);

        // Try to remove files first on retry
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              await this.safeRemove(fullPath, 1, 0);
            } else {
              try {
                // Ensure write permission before removal
                fs.chmodSync(fullPath, 0o666);
                await fs.unlink(fullPath).catch(() => {});
              } catch {
                // Ignore chmod errors
              }
            }
          }
        } catch {
          // Ignore errors in the intermediate cleanup
        }
      }
    }

    return false;
  }

  /**
   * Creates a complete mock application structure for testing
   * Sets up all required directories and config files for an application
   */
  async createMockApp(appName: string): Promise<void> {
    // Create deployment directories
    const appDeploymentPath = path.join(
      this.appDirectories.deployments,
      appName,
    );
    const appComposePath = path.join(appDeploymentPath, "compose");
    const appFilesPath = path.join(appDeploymentPath, "files");
    const appCurrentPath = path.join(appDeploymentPath, "current");
    const appServicesPath = path.join(appDeploymentPath, "services");

    await fs.ensureDir(appDeploymentPath);
    await fs.ensureDir(appComposePath);
    await fs.ensureDir(appFilesPath);
    await fs.ensureDir(appCurrentPath);
    await fs.ensureDir(appServicesPath);

    // Create app files structure (app-level and services)
    await fs.ensureDir(path.join(appFilesPath, "app"));
    await fs.ensureDir(path.join(appFilesPath, "services"));

    // Create app configuration structure
    const appPath = path.join(this.appDirectories.apps, appName);
    await fs.ensureDir(appPath);

    // Create app files directories
    await fs.ensureDir(path.join(appPath, "files", "app"));
    await fs.ensureDir(path.join(appPath, "files", "services"));

    // Create environment variable directories
    await fs.ensureDir(path.join(appPath, "env", "regular"));
    await fs.ensureDir(path.join(appPath, "env", "encrypted"));
    await fs.ensureDir(path.join(appPath, "env", "services"));

    // Create config directory
    const configPath = path.join(this.appDirectories.config, "apps", appName);
    await fs.ensureDir(configPath);

    // Create a sample config.json file
    await fs.writeJSON(path.join(configPath, "config.json"), {
      name: appName,
      test: true,
      createdAt: new Date().toISOString(),
    });

    // Create backup structure
    const backupsRoot = path.join(this.appDirectories.backups, appName);
    const timestamp = new Date().toISOString();
    const timestampedBackupDir = path.join(backupsRoot, timestamp);

    await fs.ensureDir(backupsRoot);
    await fs.ensureDir(timestampedBackupDir);
    await fs.ensureDir(path.join(timestampedBackupDir, "files"));
    await fs.ensureDir(path.join(timestampedBackupDir, "config"));

    // Create backup metadata
    await fs.writeFile(
      path.join(timestampedBackupDir, "metadata.json"),
      JSON.stringify({
        appName,
        timestamp,
        success: true,
        backupType: "test",
      }),
    );

    // Verify backup directory creation
    if (!(await fs.pathExists(timestampedBackupDir))) {
      console.error(
        `Backup directory creation failed: ${timestampedBackupDir}`,
      );
    }
  }

  /**
   * Clean up all test data directories
   * Uses a more thorough recursive removal approach with retries
   */
  async cleanup(): Promise<void> {
    try {
      // Safety check to only remove directories in /tmp
      if (!this.storageRoot || !this.storageRoot.startsWith("/tmp/")) {
        console.warn("Refusing to clean up storage root not in /tmp");
        return;
      }

      // Remove the entire storage root with our safer removal function
      const success = await this.safeRemove(this.storageRoot);

      if (!success) {
        console.warn(
          `Could not completely remove test data directory: ${this.storageRoot}`,
        );
      }
    } catch (error) {
      console.warn("Failed to clean up test environment:", error);
    }
  }

  /**
   * Returns path helper functions for accessing standardized file locations
   * Used to override the default paths in the application configuration
   */
  getPaths() {
    return {
      packages: {
        root: (appName: string): string =>
          path.join(this.storageRoot, "packages", appName),
        version: (appName: string, version: string): string =>
          version === "latest"
            ? path.join(this.storageRoot, "packages", appName, version)
            : path.join(
                this.storageRoot,
                "packages",
                appName,
                `version-${version}`,
              ),
        bundle: (appName: string, version: string): string =>
          path.join(
            this.storageRoot,
            "packages",
            appName,
            version === "latest" ? version : `version-${version}`,
            "bundle.tgz",
          ),
      },
      apps: {
        root: (appName: string): string =>
          path.join(this.storageRoot, "apps", appName),
        packageRef: (appName: string): string =>
          path.join(this.storageRoot, "apps", appName, "package-ref"),
        env: {
          app: {
            regular: (appName: string): string =>
              path.join(this.storageRoot, "apps", appName, "env", "regular"),
            encrypted: (appName: string): string =>
              path.join(this.storageRoot, "apps", appName, "env", "encrypted"),
            variable: (
              appName: string,
              key: string,
              encrypted: boolean,
            ): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                encrypted ? "encrypted" : "regular",
                key,
              ),
          },
          service: {
            regular: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                "services",
                serviceName,
                "regular",
              ),
            encrypted: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                "services",
                serviceName,
                "encrypted",
              ),
            variable: (
              appName: string,
              serviceName: string,
              key: string,
              encrypted: boolean,
            ): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                "services",
                serviceName,
                encrypted ? "encrypted" : "regular",
                key,
              ),
          },
        },
        files: {
          app: (appName: string): string =>
            path.join(this.storageRoot, "apps", appName, "files", "app"),
          service: {
            root: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "files",
                "services",
                serviceName,
              ),
            config: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "files",
                "services",
                serviceName,
                "config",
              ),
            dockerfile: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "files",
                "services",
                serviceName,
                "Dockerfile",
              ),
          },
        },
      },
      config: {
        system: (): string => path.join(this.storageRoot, "config", "system"),
        app: (appName: string): string =>
          path.join(this.storageRoot, "config", "apps", appName),
      },
      deployments: {
        root: (appName: string): string =>
          path.join(this.storageRoot, "deployments", appName),
        files: (appName: string): string =>
          path.join(this.storageRoot, "deployments", appName, "files"),
        compose: (appName: string): string =>
          path.join(this.storageRoot, "deployments", appName, "compose"),
        current: (appName: string): string =>
          path.join(this.storageRoot, "deployments", appName, "current"),
        services: (appName: string): string =>
          path.join(this.storageRoot, "deployments", appName, "services"),
        service: (appName: string, serviceName: string): string =>
          path.join(
            this.storageRoot,
            "deployments",
            appName,
            "services",
            serviceName,
          ),
      },
      backups: {
        root: (appName: string): string =>
          path.join(this.storageRoot, "backups", appName),
        timestamp: (appName: string, tag: string): string =>
          path.join(this.storageRoot, "backups", appName, tag),
        files: (appName: string, tag: string): string =>
          path.join(this.storageRoot, "backups", appName, tag, "files"),
        config: (appName: string, tag: string): string =>
          path.join(this.storageRoot, "backups", appName, tag, "config"),
        metadata: (appName: string, tag: string): string =>
          path.join(this.storageRoot, "backups", appName, tag, "metadata.json"),
      },
    };
  }
}
