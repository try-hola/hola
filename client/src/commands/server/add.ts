/**
 * Server add command for adding new server contexts
 * This allows users to connect to existing servers by providing connection details
 */
const inquirer = require('inquirer');
const configManager = require('../../utils/config-manager');
const { outputFormatter } = require('../../utils/output-formatter');
const serverProviderRegistry = require('../../utils/server-provider-registry');

/**
 * Command options for server add
 */
interface ServerAddOptions {
  url?: string;
  type?: string;
  clientId?: string;
  name?: string;
}

/**
 * Handler for the server add command
 * @param {ServerAddOptions} options Command options
 * @returns {Promise<any>} Command result
 */
async function handler(options: ServerAddOptions) {
  try {
    // Get available providers
    const availableProviders = await serverProviderRegistry.getAvailableProviders();
    
    if (availableProviders.length === 0) {
      outputFormatter.formatOutput('error', 'No server providers available');
      return {
        success: false,
        error: {
          code: 'NO_PROVIDERS',
          message: 'No server providers available'
        }
      };
    }
    
    // Ask for server name if not provided
    let name;
    if (!options.name) {
      const { serverName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'serverName',
          message: 'Enter a name for this server:',
          validate: (input) => {
            if (!input.trim()) return 'Name is required';
            return true;
          }
        }
      ]);
      name = serverName;
    } else {
      name = options.name;
    }
    
    // Check if server name already exists
    const contexts = await configManager.getServerContexts();
    if (contexts[name]) {
      outputFormatter.formatOutput('error', `Server context "${name}" already exists`);
      return {
        success: false,
        error: {
          code: 'DUPLICATE_NAME',
          message: `Server context "${name}" already exists`
        }
      };
    }
    
    // Ask for server URL if not provided
    let url;
    if (!options.url) {
      const { serverUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'serverUrl',
          message: 'Enter the server URL (e.g., https://hola.example.com):',
          validate: (input) => {
            if (!input.trim()) return 'URL is required';
            try {
              new URL(input);
              return true;
            } catch (e) {
              return 'Please enter a valid URL';
            }
          }
        }
      ]);
      url = serverUrl;
    } else {
      url = options.url;
      // Validate URL
      try {
        new URL(url);
      } catch (e) {
        outputFormatter.formatOutput('error', 'Invalid URL format');
        return {
          success: false,
          error: {
            code: 'INVALID_URL',
            message: 'Invalid URL format'
          }
        };
      }
    }
    
    // Ask for provider type if not provided
    let type;
    if (!options.type) {
      if (availableProviders.length === 1) {
        type = availableProviders[0].type;
      } else {
        const { providerType } = await inquirer.prompt([
          {
            type: 'list',
            name: 'providerType',
            message: 'Select server provider type:',
            choices: availableProviders.map(p => ({
              name: p.displayName,
              value: p.type
            }))
          }
        ]);
        type = providerType;
      }
    } else {
      type = options.type;
      // Validate provider type
      const provider = serverProviderRegistry.getProvider(type);
      if (!provider) {
        const availableTypes = availableProviders.map(p => p.type).join(', ');
        outputFormatter.formatOutput('error', `Unknown provider type "${type}". Available types: ${availableTypes}`);
        return {
          success: false,
          error: {
            code: 'INVALID_PROVIDER',
            message: `Unknown provider type "${type}". Available types: ${availableTypes}`
          }
        };
      }
    }
    
    // Ask for client ID if not provided
    let clientId;
    if (!options.clientId) {
      const { id } = await inquirer.prompt([
        {
          type: 'input',
          name: 'id',
          message: 'Enter the OIDC client ID for this server:',
          validate: (input) => {
            if (!input.trim()) return 'Client ID is required';
            return true;
          }
        }
      ]);
      clientId = id;
    } else {
      clientId = options.clientId;
    }
    
    // Create server context
    const serverContext = {
      name,
      url,
      clientId,
      type,
      providerOptions: {}
    };
    
    // Save the server context
    await configManager.saveServerContext(serverContext);
    
    outputFormatter.formatOutput('success', `Server "${name}" added successfully`);
    
    // Ask if the user wants to set this as the current context
    const { setAsCurrent } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setAsCurrent',
        message: 'Set this as your current server context?',
        default: true
      }
    ]);
    
    if (setAsCurrent) {
      await configManager.setCurrentServerContext(name);
      outputFormatter.formatOutput('info', `Server "${name}" is now your current context`);
    }
    
    return {
      success: true,
      data: {
        server: serverContext,
        isCurrent: setAsCurrent
      }
    };
    
  } catch (error) {
    outputFormatter.formatOutput('error', `Failed to add server: ${error.message}`);
    return {
      success: false,
      error: {
        code: 'ADD_SERVER_ERROR',
        message: `Failed to add server: ${error.message}`,
        details: error.details
      }
    };
  }
}

/**
 * Register the server add command
 */
module.exports = function registerCommand(program) {
  return program
    .command('add')
    .description('Add a new server connection')
    .option('-n, --name <n>', 'Name for the server context')
    .option('-u, --url <url>', 'Server URL')
    .option('-t, --type <type>', 'Server provider type')
    .option('--client-id <id>', 'OIDC client ID for server authentication')
    .action(handler);
};

// Export the handler for testing
module.exports.handler = handler;