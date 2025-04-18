const { Command } = require('commander');
const inquirer = require('inquirer');
const crypto = require('crypto');
const serverProviderRegistry = require('../../utils/server-provider-registry');
const configManager = require('../../utils/config-manager');
const { outputFormatter } = require('../../utils/output-formatter');
const { handleError } = require('../../utils/error-handler');

/**
 * Helper function to generate a random client ID for OIDC
 * @returns {Promise<string>} A randomly generated client ID
 */
async function generateClientId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Stub for the 'server bootstrap' command.
 * This command will guide the user through bootstrapping a new Hola server instance.
 * Wizard-style questions are stubbed below using inquirer.
 */
interface ServerBootstrapOptions {
    name?: string;
    dockerContext?: string;
    nonInteractive?: boolean;
}

interface DockerEnvironmentAnswers {
    dockerEnvironment: 'orbstack' | 'docker-desktop' | 'remote';
    dockerContextName?: string;
    dockerHostAddress?: string;
    testDockerConnection?: boolean;
    domainName?: string;
    subdomainPrefix?: string;
    needsDDNS?: boolean;
    ddnsProvider?: string;
    ddnsProviderOther?: string;
    ddnsApiCredentials?: string;
    ddnsRecord?: string;
    enableLetsEncrypt?: boolean;
    acmeValidationMethod?: string;
    acmeDnsProvider?: string;
    acmeDnsProviderOther?: string;
    acmeDnsApiCredentials?: string;
    acmeHttp01Confirm?: boolean;
    letsEncryptEmail?: string;
    confirmDnsSetup?: boolean;
    serverName?: string;
    adminPassword?: string;
    dataDir?: string;
    hostPort?: string;
    exposeAdditionalPorts?: boolean;
    additionalPorts?: string;
    enableTLS?: boolean;
    tlsCertPath?: string;
    tlsKeyPath?: string;
    cpuLimit?: string;
    memoryLimit?: string;
    behindProxy?: boolean;
    proxySettings?: string;
    confirmDeploy?: boolean;
}

interface InquirerQuestion {
    type: string;
    name: string;
    message: string;
    choices?: Array<string | { name: string; value: string }>;
    default?: string | boolean;
    when?: (answers: DockerEnvironmentAnswers) => boolean | undefined;
    mask?: string;
}

module.exports = function registerCommand(program) {
  return program
    .command('bootstrap')
    .description('Bootstrap a new Hola server')
    .option('-n, --name <name>', 'name for the server context')
    .option('-t, --type <type>', 'server type (defaults to first available)')
    .option('-d, --data-dir <path>', 'data directory path')
    .option('-p, --port <port>', 'server port', '3000')
    .option('--client-id <id>', 'OIDC client ID')
    .option('--issuer-url <url>', 'OIDC issuer URL')
    .option('--non-interactive', 'run in non-interactive mode', false)
    .action(async (options: ServerBootstrapOptions) => {
      try {
        // Get available providers
        const availableProviders = await serverProviderRegistry.getAvailableProviders();
        
        if (availableProviders.length === 0) {
          return handleError(
            new Error('No server providers available. Please install OrbStack or another supported provider.')
          );
        }
        
        // If no type specified, use the first available provider or prompt if interactive
        let provider;
        
        if (options.type) {
          // User specified a provider type
          provider = serverProviderRegistry.getProvider(options.type);
          
          if (!provider) {
            return handleError(
              new Error(`Server provider "${options.type}" not found. Available types: ${availableProviders.map(p => p.type).join(', ')}`)
            );
          }
          
          if (!await provider.isAvailable()) {
            return handleError(
              new Error(`Server provider "${options.type}" is not available on this system.`)
            );
          }
        } else if (availableProviders.length === 1) {
          // Only one provider available, use it
          provider = availableProviders[0];
        } else if (!options.nonInteractive) {
          // Multiple providers available, prompt the user
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
          
          provider = serverProviderRegistry.getProvider(providerType);
        } else {
          // Non-interactive mode with no type specified, use first available
          provider = availableProviders[0];
          outputFormatter.formatOutput(
            'info', 
            `Using ${provider.displayName} provider (first available)`
          );
        }
        
        // Get server name
        let name = options.name;
        
        if (!name && !options.nonInteractive) {
          const { serverName } = await inquirer.prompt([
            {
              type: 'input',
              name: 'serverName',
              message: 'Enter a name for this server:',
              default: 'default'
            }
          ]);
          name = serverName;
        } else if (!name) {
          name = 'default';
        }
        
        // Get provider-specific options through interactive wizard or command line
        let providerOptions = {};
        const configOptions = provider.getConfigOptions();
        
        if (!options.nonInteractive) {
          // For each provider-specific option, prompt the user
          const questions = Object.entries(configOptions).map(([key, config]) => ({
            type: config.type === 'boolean' ? 'confirm' : 'input',
            name: key,
            message: `${config.label}: ${config.description}`,
            default: config.default
          }));
          
          if (questions.length > 0) {
            providerOptions = await inquirer.prompt(questions);
          }
        }
        
        // Prepare bootstrap options
        const bootstrapOptions = {
          name,
          dataDir: options.dataDir,
          port: parseInt(options.port, 10),
          oidc: {
            clientId: options.clientId || await generateClientId(),
            issuerUrl: options.issuerUrl
          },
          providerOptions
        };
        
        // Execute bootstrap process
        outputFormatter.formatOutput('spinner', `Bootstrapping server with ${provider.displayName}...`);
        
        // Call the provider-specific bootstrap method
        const serverContext = await provider.bootstrap(bootstrapOptions);
        
        // Save the server context
        await configManager.saveServerContext(serverContext);
        
        // Set as current context
        await configManager.setCurrentServerContext(name);
        
        outputFormatter.formatOutput(
          'success', 
          `Successfully bootstrapped Hola server "${name}" using ${provider.displayName}`
        );
        
        outputFormatter.formatOutput(
          'info',
          `Server URL: ${serverContext.url}\n` +
          `The OIDC client ID has been securely stored in your configuration.`
        );
        
      } catch (error) {
        handleError(error);
      }
    });
};
