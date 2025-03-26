// server/src/test/test-environment.ts
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';

/**
 * Test environment configuration that provides isolated storage paths
 * and manages cleanup between tests
 */
export class TestEnvironment {
  public readonly storageRoot: string;
  public readonly appDirectories: {
    deployments: string;
    packages: string;
    backups: string;
    config: string;
  };

  constructor(options: { cleanOnExit?: boolean } = {}) {
    // Create unique test directory in system temp folder
    this.storageRoot = path.join(
      process.env.TEST_STORAGE_ROOT || 
      path.join(process.env.TEMP || '/tmp', 'hola-test-' + uuidv4())
    );
    
    // Define sub-directories
    this.appDirectories = {
      deployments: path.join(this.storageRoot, 'deployments'),
      packages: path.join(this.storageRoot, 'packages'),
      backups: path.join(this.storageRoot, 'backups'),
      config: path.join(this.storageRoot, 'config')
    };
    
    // Clean test directory on process exit if requested
    if (options.cleanOnExit) {
      process.on('exit', () => {
        this.cleanup();
      });
    }
  }

  /**
   * Initialize the test environment by creating necessary directories
   */
  async init(): Promise<void> {
    // Ensure the storage root exists and is empty
    await fs.emptyDir(this.storageRoot);
    
    // Create required sub-directories
    await Promise.all(
      Object.values(this.appDirectories).map(dir => fs.ensureDir(dir))
    );
  }

  /**
   * Create mock app directory structure for testing
   */
  async createMockApp(appName: string): Promise<void> {
    const appDeploymentPath = path.join(this.appDirectories.deployments, appName);
    const appComposePath = path.join(appDeploymentPath, 'compose');
    const appFilesPath = path.join(appDeploymentPath, 'files');
    const appCurrentPath = path.join(appDeploymentPath, 'current');
    
    await fs.ensureDir(appDeploymentPath);
    await fs.ensureDir(appComposePath);
    await fs.ensureDir(appFilesPath);
    await fs.ensureDir(appCurrentPath);
    
    // Create sample docker-compose.yml file
    await fs.writeFile(
      path.join(appComposePath, 'docker-compose.yml'),
      'version: "3"\nservices:\n  app:\n    image: nginx:alpine'
    );
    
    // Create sample config file
    await fs.ensureDir(path.join(this.appDirectories.config, appName));
    await fs.writeFile(
      path.join(this.appDirectories.config, appName, 'config.json'),
      JSON.stringify({ name: appName, test: true })
    );
  }

  /**
   * Clean up the test environment and remove all test data
   */
  async cleanup(): Promise<void> {
    try {
      await fs.remove(this.storageRoot);
    } catch (error) {
      console.warn('Failed to clean up test environment:', error);
    }
  }
  
  /**
   * Returns path functions that mimic the project's PATHS configuration but using test directories
   */
  getPaths() {
    return {
      packages: (appName: string, version: string) => 
        path.join(this.appDirectories.packages, appName, version),
      config: (appName: string) => 
        path.join(this.appDirectories.config, appName),
      deployments: {
        root: (appName: string) => 
          path.join(this.appDirectories.deployments, appName),
        files: (appName: string) => 
          path.join(this.appDirectories.deployments, appName, 'files'),
        compose: (appName: string) => 
          path.join(this.appDirectories.deployments, appName, 'compose'),
        current: (appName: string) => 
          path.join(this.appDirectories.deployments, appName, 'current')
      },
      backups: (appName: string, tag: string) => 
        path.join(this.appDirectories.backups, appName, tag)
    };
  }
}