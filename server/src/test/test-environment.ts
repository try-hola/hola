// server/src/test/test-environment.ts
import path from "path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";

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

  constructor(options: { cleanOnExit?: boolean } = {}) {
    this.storageRoot = path.join(process.cwd(), "data");
    this.appDirectories = {
      deployments: path.join(this.storageRoot, "deployments"),
      packages: path.join(this.storageRoot, "packages"),
      backups: path.join(this.storageRoot, "backups"),
      config: path.join(this.storageRoot, "config"),
      apps: path.join(this.storageRoot, "apps"),
    };

    if (options.cleanOnExit) {
      process.on("exit", () => {
        this.cleanup();
      });
    }
  }

  /**
   * Initialize the test environment by creating required directories
   */
  async init(): Promise<void> {
    await fs.emptyDir(this.storageRoot);
    await Promise.all(
      Object.values(this.appDirectories).map((dir) => fs.ensureDir(dir))
    );
  }

  /**
   * Creates a complete mock application structure for testing
   * Sets up all required directories and config files for an application
   */
  async createMockApp(appName: string): Promise<void> {
    // Create deployment directories
    const appDeploymentPath = path.join(
      this.appDirectories.deployments,
      appName
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
      })
    );

    // Verify backup directory creation
    if (!(await fs.pathExists(timestampedBackupDir))) {
      console.error(
        `Backup directory creation failed: ${timestampedBackupDir}`
      );
    }
  }

  /**
   * Clean up all test data directories
   * Uses a more thorough recursive removal approach with retries
   */
  async cleanup(): Promise<void> {
    try {
      // First try to clean up specific directories recursively
      const directories = Object.values(this.appDirectories);
      for (const dir of directories) {
        if (await fs.pathExists(dir)) {
          try {
            // Recursively delete all files in directory first
            const files = await fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
              const fullPath = path.join(dir, file.name);
              await fs.remove(fullPath);
            }
            // Then remove the directory itself
            await fs.remove(dir);
          } catch (error) {
            console.error(`Failed to remove directory: ${dir}`, error);
          }
        }
      }

      // Then clean up the entire storage root
      if (await fs.pathExists(this.storageRoot)) {
        try {
          await fs.remove(this.storageRoot);
        } catch (error) {
          console.warn(
            `Failed to completely remove storage root: ${this.storageRoot}`,
            error
          );
          // Try to at least remove all the files
          try {
            const files = await fs.readdir(this.storageRoot, {
              withFileTypes: true,
            });
            for (const file of files) {
              await fs.remove(path.join(this.storageRoot, file.name));
            }
          } catch (err) {
            // Ignore any errors in this final cleanup attempt
          }
        }
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
                `version-${version}`
              ),
        bundle: (appName: string, version: string): string =>
          path.join(
            this.storageRoot,
            "packages",
            appName,
            version === "latest" ? version : `version-${version}`,
            "bundle.tgz"
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
              encrypted: boolean
            ): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                encrypted ? "encrypted" : "regular",
                key
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
                "regular"
              ),
            encrypted: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                "services",
                serviceName,
                "encrypted"
              ),
            variable: (
              appName: string,
              serviceName: string,
              key: string,
              encrypted: boolean
            ): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "env",
                "services",
                serviceName,
                encrypted ? "encrypted" : "regular",
                key
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
                serviceName
              ),
            config: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "files",
                "services",
                serviceName,
                "config"
              ),
            dockerfile: (appName: string, serviceName: string): string =>
              path.join(
                this.storageRoot,
                "apps",
                appName,
                "files",
                "services",
                serviceName,
                "Dockerfile"
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
            serviceName
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
