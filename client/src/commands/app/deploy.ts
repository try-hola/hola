const apiClient = require("../../utils/api-client");
const { ApiResponse } = require("../../types");

/**
 * Deploy an application package
 * @param appName - Name of the app
 * @param packagePath - Optional path to the package file
 * @param options - Deployment options
 * @returns {Promise<ApiResponse>}
 */
async function handler(
  appName: string,
  packagePath: string | undefined,
  options: { force?: boolean }
): Promise<typeof ApiResponse> {
  try {
    const payload = {
      appName,
      packagePath,
      force: options.force || false,
    };
    const response = await apiClient.post("/api/apps/deploy", payload);
    console.log(`Application '${appName}' deployed successfully.`);
    return { success: true, data: response.data };
  } catch (error) {
    let code = "DEPLOY_ERROR";
    let message = "Unknown error";
    let details;
    if (error && typeof error === "object") {
      if ("code" in error && typeof error.code === "string") {
        code = error.code;
      }
      if (error instanceof Error) {
        message = error.message;
      } else if ("message" in error && typeof error.message === "string") {
        message = error.message;
      }
      if ("details" in error) {
        details = error.details;
      }
    } else if (typeof error === "string") {
      message = error;
    }
    console.error(
      `Failed to deploy application '${appName}':`,
      message
    );
    return {
      success: false,
      error: {
        code,
        message,
        details,
      },
    };
  }
}

const command = "deploy <appName> [packagePath]";
const describe = "Deploy an application package";

module.exports = {
  command,
  describe,
  handler,
  default: function (appCommand: import("commander").Command) {
    return appCommand
      .command(command)
      .description(describe)
      .option("--force", "Force redeploy if app already exists")
      .action(
        (
          appName: string,
          packagePath: string | undefined,
          options: { force?: boolean }
        ) => {
          return handler(appName, packagePath, options);
        }
      )
      .addHelpText(
        "after",
        `
Examples:
  $ hola app deploy myapp ./path/to/package.tgz
  $ hola app deploy myapp --force
`
      );
  },
};
