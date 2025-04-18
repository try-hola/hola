/**
 * OrbStack implementation of the ServerProvider interface
 * This is the first server provider we'll support, taking advantage of
 * OrbStack's built-in HTTPS and wildcard hostname capabilities.
 */
const path = require('path');
const types = require('../types/server-provider');
const { outputFormatter } = require('../utils/output-formatter');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import types correctly for TypeScript
type ServerProvider = typeof types.ServerProvider;
type ServerBootstrapOptions = typeof types.ServerBootstrapOptions;
type ServerContext = typeof types.ServerContext;
type ServerProviderConfigOptions = typeof types.ServerProviderConfigOptions;

class OrbStackProvider implements ServerProvider {
  readonly type = 'orbstack';
  readonly displayName = 'OrbStack';
  
  /**
   * Check if OrbStack is available on the current system
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('orb version');
      return stdout.includes('OrbStack');
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Bootstrap a new Hola server on OrbStack
   */
  async bootstrap(options: ServerBootstrapOptions): Promise<ServerContext> {
    // Generate a secure random string for Authentik secret key
    const crypto = require('crypto');
    const authManager = require('../../utils/auth-manager');
    
    // Generate initial admin password for Authentik
    const initialAdminPassword = crypto.randomBytes(16).toString('hex');
    
    // Get the subdomain and construct the domain
    const subdomain = options.providerOptions.subdomain || 'hola';
    const domain = `${subdomain}.local`;
    
    // Get other bootstrap options from the provider
    const bootstrapOptions = {
      ...options,
      authProvider: {
        initialAdminPassword,
        domain: `auth.${domain}`
      }
    };
    
    outputFormatter.formatOutput('info', 'Setting up OIDC authentication with Authentik...');
    
    // Bootstrap the server with Traefik, Authentik, and Hola
    const serverContext = await this.bootstrapServer(bootstrapOptions);
    
    // Configure Authentik for the CLI OIDC client
    outputFormatter.formatOutput('spinner', 'Configuring authentication provider...');
    const clientId = await this.configureAuthentik(
      bootstrapOptions.authProvider.domain,
      initialAdminPassword
    );
    
    // Store the client ID in the server context
    serverContext.clientId = clientId;
    
    // Prompt user to authenticate
    outputFormatter.formatOutput('info', 'Server bootstrapped successfully. Please authenticate now.');
    await authManager.authenticate(serverContext);
    
    return serverContext;
  }
  
  /**
   * Validate a server context for OrbStack
   */
  async validateContext(context: ServerContext): Promise<boolean> {
    // Check if the server is reachable and responding
    try {
      // We would make an API call to the server to validate connectivity
      // This is a placeholder for the actual implementation
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Get OrbStack-specific configuration options
   */
  getConfigOptions(): ServerProviderConfigOptions {
    return {
      subdomain: {
        type: 'string',
        label: 'Subdomain',
        description: 'The subdomain to use for the server (defaults to "hola" resulting in hola.local)',
        required: false,
        default: 'hola'
      }
    };
  }
  
  /**
   * Generate a secure API key
   */
  private generateApiKey(): string {
    // This is a simplified version - the actual implementation would be more secure
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }
  
  /**
   * Deploy the Docker Compose configuration to OrbStack
   */
  private async deployComposeFile(
    options: ServerBootstrapOptions, 
    apiKey: string, 
    orbOptions: any
  ): Promise<void> {
    const path = require('path');
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    
    // Generate secure tokens for Authentik
    const authSecretKey = this.generateSecureString(32);
    const bootstrapToken = this.generateSecureString(16);
    
    // Path to the docker-compose.yml in the static directory
    const staticDir = path.join(__dirname, '../../static');
    const composeFilePath = path.join(staticDir, 'docker-compose.yml');
    
    // Set up environment variables for docker-compose
    const env = {
      ...process.env,
      AUTHENTIK_SECRET_KEY: authSecretKey,
      AUTHENTIK_BOOTSTRAP_PASSWORD: options.authProvider.initialAdminPassword,
      AUTHENTIK_BOOTSTRAP_TOKEN: bootstrapToken,
      DATA_DIR: options.dataDir || './data',
      HOLA_API_KEY: apiKey,
      ORB_DOMAIN: orbOptions.orbDomain,
      POSTGRES_USER: options.dbUser || 'authentik',
      POSTGRES_DB: options.dbName || 'authentik',
      POSTGRES_PASSWORD: options.dbPassword || 'authentik'
    };
    
    // Deploy the stack
    outputFormatter.formatOutput('spinner', 'Deploying server components...');
    try {
      await execAsync(
        `docker-compose -f ${composeFilePath} up -d`,
        { 
          cwd: staticDir,
          env: env
        }
      );
      outputFormatter.formatOutput('info', 'Server components deployed successfully');
    } catch (error: any) {
      outputFormatter.formatOutput('error', `Failed to deploy: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Generate a secure random string
   */
  private generateSecureString(length: number): string {
    const crypto = require('crypto');
    return crypto.randomBytes(length).toString('hex');
  }
  
  /**
   * Wait for the server to be ready
   */
  private async waitForServerReady(domain: string): Promise<void> {
    // This is a placeholder for the actual implementation
    // We would wait for the server to be ready by pinging it
  }

  /**
   * Configure Authentik for CLI OIDC authentication
   */
  private async configureAuthentik(domain: string, adminPassword: string): Promise<string> {
    // Wait for Authentik to be ready
    await this.waitForService(`https://${domain}`);

    // Use the container name (or 'authentik-authentik-1' for docker compose v2 naming convention)
    const containerName = 'authentik-authentik-1';
    
    outputFormatter.formatOutput('info', 'Configuring Authentik OIDC client...');
    
    // Execute the existing create_oidc_client.py script inside the Authentik container
    try {
      const { stdout } = await execAsync(
        `docker exec ${containerName} python /init/create_oidc_client.py`
      );
      
      // Extract client ID from output
      const match = stdout.match(/Client ID: ([a-zA-Z0-9]+)/);
      const clientId = match ? match[1] : '';
      
      if (!clientId) {
        throw new Error('Failed to extract client ID from Authentik output');
      }
      
      outputFormatter.formatOutput('info', `Created OIDC client with ID: ${clientId}`);
      return clientId;
    } catch (error: any) {
      outputFormatter.formatOutput('error', `Failed to configure Authentik: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Wait for a service to be available
   */
  private async waitForService(url: string, maxAttempts = 30, interval = 2000): Promise<void> {
    const axios = require('axios');
    outputFormatter.formatOutput('info', `Waiting for service at ${url} to be ready...`);
    
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        await axios.get(url, { 
          timeout: 5000,
          validateStatus: () => true // Accept any status code
        });
        outputFormatter.formatOutput('info', `Service at ${url} is ready`);
        return;
      } catch (error) {
        attempts++;
        
        if (attempts >= maxAttempts) {
          throw new Error(`Service at ${url} not ready after ${maxAttempts} attempts`);
        }
        
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
  }
  
  /**
   * Bootstrap the server with Authentik and Traefik
   */
  private async bootstrapServer(options: ServerBootstrapOptions): Promise<ServerContext> {
    outputFormatter.formatOutput('spinner', 'Preparing server deployment...');
    
    // Generate a secure API key for the server
    const apiKey = this.generateApiKey();
    
    // Get the subdomain from options or use default
    const subdomain = options.providerOptions.subdomain || 'hola';
    
    // Construct the OrbStack domain (always .local for OrbStack)
    const orbOptions = {
      subdomain: subdomain,
      orbDomain: `${subdomain}.local`
    };
    
    // Deploy the server components (Traefik, Authentik, and Hola server)
    await this.deployComposeFile(options, apiKey, orbOptions);
    
    // Wait for the server to be ready
    await this.waitForServerReady(orbOptions.orbDomain);
    
    // Create server context
    return {
      name: options.name,
      type: this.type,
      url: `https://${orbOptions.orbDomain}`,
      apiKey: apiKey,
      providerOptions: orbOptions
    };
  }
}

module.exports = OrbStackProvider;