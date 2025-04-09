/**
 * Config Manager Delete Command
 * 
 * Handles deletion of configuration values, both local and remote app-specific settings.
 */

const configManager = require('../../utils/config-manager');
const apiClient = require('../../utils/api-client');

/**
 * @typedef {Object} DeleteCommandOptions
 * @property {string} [app] - Application name for app-specific deletions
 * @property {boolean} [secret] - Whether to target encrypted configuration values
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} [success] - Indicates if the operation was successful
 * @property {string|Error} [error] - Error message if the operation failed
 */

/**
 * Delete command implementation for configuration values
 */
const deleteCommand = {
    command: 'delete',
    describe: 'Delete configuration values',
    builder: {
        app: {
            alias: 'a',
            type: 'string',
            describe: 'Application name'
        },
        secret: {
            alias: 's',
            type: 'boolean',
            describe: 'Delete encrypted configuration values'
        }
    },
    
    /**
     * Executes the delete command
     * @param {string[]} keys - Configuration keys to delete
     * @param {DeleteCommandOptions} options - Command options
     * @returns {Promise<CommandResult>} Result of the operation
     */
    execute: async function(keys, options) {
        try {
            // Handle local configuration deletion
            if (!options.app) {
                for (const key of keys) {
                    if (key === 'api_key') {
                        console.warn('Warning: Deleting api_key is not recommended');
                    }
                    await configManager.delete(key);
                }
                return { success: true };
            } 
            
            // Handle app-specific configuration deletion
            else {
                const app = options.app;
                
                // If dealing with encrypted values, handle them individually
                if (options.secret) {
                    for (const key of keys) {
                        const endpoint = `/api/config/${app}/encrypted/${key}`;
                        await apiClient.delete(endpoint);
                    }
                } else if (keys.length === 1) {
                    // For a single key, use a direct endpoint
                    const endpoint = `/api/config/${app}/${keys[0]}`;
                    await apiClient.delete(endpoint);
                } else {
                    // For multiple keys, send them in a single request
                    const endpoint = `/api/config/${app}`;
                    await apiClient.delete(endpoint, {
                        params: {
                            keys: keys.join(',')
                        }
                    });
                }
                
                return { success: true };
            }
        } catch (error) {
            return { 
                success: false,
                error: error 
            };
        }
    }
};

module.exports = deleteCommand;
