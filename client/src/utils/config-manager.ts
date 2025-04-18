const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');

const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

/**
 * ConfigManager handles configuration storage and retrieval
 * Including server contexts for different server types
 */
class ConfigManager {
  constructor() {
    this.configDir = path.join(os.homedir(), '.hola');
    this.configFile = path.join(this.configDir, 'config.json');
    this.serversFile = path.join(this.configDir, 'servers.json');
    // In-memory cache for synchronous access
    this._cachedConfig = null;
    try {
      if (fs.existsSync(this.configFile)) {
        this._cachedConfig = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      }
    } catch (error) {
      // Default values if config can't be read
      this._cachedConfig = {
        server_url: 'http://localhost:3000',
        timeout: 60000,
        output_format: 'table',
        color: 'auto',
        log_level: 'info',
        auto_update_check: true
      };
    }
  }

  /**
   * Initialize configuration directory and files
   */
  async init() {
    try {
      // Create config directory if it doesn't exist
      if (!fs.existsSync(this.configDir)) {
        await mkdir(this.configDir, { recursive: true });
      }

      // Create config file if it doesn't exist
      if (!fs.existsSync(this.configFile)) {
        await writeFile(this.configFile, JSON.stringify({
          server_url: 'http://localhost:3000',
          timeout: 60000,
          output_format: 'table',
          color: 'auto',
          log_level: 'info',
          auto_update_check: true
        }, null, 2));
      }

      // Create servers file if it doesn't exist
      if (!fs.existsSync(this.serversFile)) {
        await writeFile(this.serversFile, JSON.stringify({
          servers: {},
          current: null
        }, null, 2));
      }
    } catch (error) {
      throw new Error(`Failed to initialize configuration: ${error.message}`);
    }
  }

  /**
   * Get client settings
   */
  async getSettings() {
    try {
      await this.init();
      const data = await readFile(this.configFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      throw new Error(`Failed to read settings: ${error.message}`);
    }
  }

  /**
   * Set client settings
   */
  async setSettings(settings) {
    try {
      await this.init();
      const currentSettings = await this.getSettings();
      const newSettings = { ...currentSettings, ...settings };
      await writeFile(this.configFile, JSON.stringify(newSettings, null, 2));
      return newSettings;
    } catch (error) {
      throw new Error(`Failed to save settings: ${error.message}`);
    }
  }
  
  /**
   * Get all server contexts
   */
  async getServerContexts() {
    try {
      await this.init();
      const data = await readFile(this.serversFile, 'utf8');
      return JSON.parse(data).servers || {};
    } catch (error) {
      throw new Error(`Failed to read server contexts: ${error.message}`);
    }
  }
  
  /**
   * Get a specific server context
   */
  async getServerContext(name) {
    const contexts = await this.getServerContexts();
    return contexts[name];
  }
  
  /**
   * Save a server context
   */
  async saveServerContext(context) {
    try {
      await this.init();
      const data = await readFile(this.serversFile, 'utf8');
      const serversData = JSON.parse(data);
      
      serversData.servers = {
        ...serversData.servers,
        [context.name]: context
      };
      
      await writeFile(this.serversFile, JSON.stringify(serversData, null, 2));
      return context;
    } catch (error) {
      throw new Error(`Failed to save server context: ${error.message}`);
    }
  }
  
  /**
   * Remove a server context
   */
  async removeServerContext(name) {
    try {
      await this.init();
      const data = await readFile(this.serversFile, 'utf8');
      const serversData = JSON.parse(data);
      
      if (!serversData.servers[name]) {
        throw new Error(`Server context "${name}" not found`);
      }
      
      delete serversData.servers[name];
      
      // If we're removing the current context, set current to null
      if (serversData.current === name) {
        serversData.current = null;
      }
      
      await writeFile(this.serversFile, JSON.stringify(serversData, null, 2));
      return true;
    } catch (error) {
      throw new Error(`Failed to remove server context: ${error.message}`);
    }
  }
  
  /**
   * Get the current server context name
   */
  async getCurrentServerContextName() {
    try {
      await this.init();
      const data = await readFile(this.serversFile, 'utf8');
      return JSON.parse(data).current;
    } catch (error) {
      throw new Error(`Failed to get current server context: ${error.message}`);
    }
  }
  
  /**
   * Get the current server context
   */
  async getCurrentServerContext() {
    const currentName = await this.getCurrentServerContextName();
    
    if (!currentName) {
      return null;
    }
    
    return this.getServerContext(currentName);
  }
  
  /**
   * Set the current server context
   */
  async setCurrentServerContext(name) {
    try {
      await this.init();
      const data = await readFile(this.serversFile, 'utf8');
      const serversData = JSON.parse(data);
      
      if (name && !serversData.servers[name]) {
        throw new Error(`Server context "${name}" not found`);
      }
      
      serversData.current = name;
      await writeFile(this.serversFile, JSON.stringify(serversData, null, 2));
      return name;
    } catch (error) {
      throw new Error(`Failed to set current server context: ${error.message}`);
    }
  }
  
  /**
   * Resolve the server context to use for a command
   * 
   * Resolution order:
   * 1. Explicit server specified with --server option
   * 2. Environment variable HOLA_SERVER_CONTEXT
   * 3. Currently active server context
   * 4. Default server context if none is active
   */
  async resolveServerContext(serverOption) {
    // 1. Check explicit --server option
    if (serverOption) {
      const context = await this.getServerContext(serverOption);
      if (!context) {
        throw new Error(`Server context "${serverOption}" not found`);
      }
      return context;
    }
    
    // 2. Check environment variable
    if (process.env.HOLA_SERVER_CONTEXT) {
      const context = await this.getServerContext(process.env.HOLA_SERVER_CONTEXT);
      if (!context) {
        throw new Error(`Server context "${process.env.HOLA_SERVER_CONTEXT}" from environment variable not found`);
      }
      return context;
    }
    
    // 3. Check current server context
    const current = await this.getCurrentServerContext();
    if (current) {
      return current;
    }
    
    // 4. Check if there's only one context
    const contexts = await this.getServerContexts();
    const contextNames = Object.keys(contexts);
    
    if (contextNames.length === 1) {
      return contexts[contextNames[0]];
    }
    
    throw new Error('No server context selected. Use --server option or set a current context with "hola server switch"');
  }

  /**
   * Get a configuration value synchronously
   * @param {string} key - The configuration key to get
   * @param {any} defaultValue - Default value if the key is not found
   * @returns {any} The configuration value or default
   */
  get(key, defaultValue) {
    if (!this._cachedConfig) {
      return defaultValue;
    }
    return this._cachedConfig[key] !== undefined ? this._cachedConfig[key] : defaultValue;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

module.exports = configManager;
