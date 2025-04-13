const apiClient = require("../../utils/api-client");
const outputFormatter = require("../../utils/output-formatter");
const { ApiResponse } = require("../../types");
const fs = require("fs");
const path = require("path");

/**
 * Deploy an application package using the provided app name and package path.
 * @param appName - Name of the application to deploy
 * @param packagePath - Path to the package file (optional)
 * @param options - DeployOptions (force, output, etc)
 * @returns ApiResponse with deployment result
 */
interface DeployOptions {
  force?: boolean;
  output?: string;
}
async function handler(
  appName: string,
  packagePath: string | undefined,
  options: DeployOptions
): Promise<typeof ApiResponse> {
  // Input validation
  if (!appName || typeof appName !== "string" || !appName.match(/^[a-zA-Z0-9-_]+$/)) {
    const error = {
      code: "DEPLOY_INVALID_APPNAME",
      message: "Invalid or missing application name. App name must be alphanumeric (dashes/underscores allowed).",
    };
    outputFormatter.formatOutput({ error }, options.output);
    return { success: false, error };
  }

  // Prepare payload
  const payload: any = { appName };
  if (options.force) payload.force = true;

  // If a package path is provided, validate it exists and is a file
  if (packagePath) {
    const absPath = path.resolve(packagePath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      const error = {
        code: "DEPLOY_PACKAGE_NOT_FOUND",
        message: `Package file not found: ${absPath}`,
      };
      outputFormatter.formatOutput({ error }, options.output);
      return { success: false, error };
    }
    // For now, just send the path as a string; future: support file upload/multipart
    payload.packagePath = absPath;
  }

  try {
    // Call the API to deploy the app
    const response = await apiClient.post("/api/apps/deploy", payload);
    if (response && response.data) {
      outputFormatter.formatOutput(
        { message: `Deployment started for '${appName}'.`, ...response.data },
        options.output
      );
      return { success: true, data: response.data };
    } else {
      const error = {
        code: response?.error?.code || "DEPLOY_FAILED",
        message: response?.error?.message || "Deployment failed.",
        details: response?.error?.details,
      };
      outputFormatter.formatOutput({ error }, options.output);
      return { success: false, error };
    }
  } catch (err: any) {
    const error = {
      code: err.code || "DEPLOY_ERROR",
      message: err.message || "Unknown error during deployment.",
      details: err.details,
    };
    outputFormatter.formatOutput({ error }, options.output);
    return { success: false, error };
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
      .option("-o, --output <format>", "output format (table, json)", "table")
      .action((appName: string, packagePath: string | undefined, options: DeployOptions) => {
        return handler(appName, packagePath, options);
      })
      .addHelpText(
        "after",
        `\nExamples:\n  $ hola app deploy myapp ./path/to/package.tgz\n  $ hola app deploy myapp --force\n`
      );
  },
};
