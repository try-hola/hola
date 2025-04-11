const apiClient = require('../../utils/api-client');

/**
 * Deploy an application package
 * @param appName - Name of the app
 * @param packagePath - Optional path to the package file
 * @param options - Deployment options
 */
async function handler(
  appName: string,
  packagePath: string | undefined,
  options: { force?: boolean }
) {
  try {
    const payload = {
      appName,
      packagePath,
      force: options.force || false,
    };
    const response = await apiClient.post('/api/apps/deploy', payload);
    console.log(`Application '${appName}' deployed successfully.`);
    return { success: true, data: response };
  } catch (error) {
    console.error(`Failed to deploy application '${appName}':`, error.message || error);
    return { success: false, error };
  }
}

const command = 'deploy <appName> [packagePath]';
const describe = 'Deploy an application package';

module.exports = {
  command,
  describe,
  handler,
  default: function(appCommand: import('commander').Command) {
    return appCommand
      .command(command)
      .description(describe)
      .option('--force', 'Force redeploy if app already exists')
      .action((appName: string, packagePath: string | undefined, options: { force?: boolean }) => {
        return handler(appName, packagePath, options);
      })
      .addHelpText('after', `
Examples:
  $ hola app deploy myapp ./path/to/package.tgz
  $ hola app deploy myapp --force
`);
  },
};
