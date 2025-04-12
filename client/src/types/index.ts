/**
 * Configuration values for storing application settings.
 */
type ConfigStore = {
  server_url: string;
  api_key: string;
  timeout: number;
  output_format: "table" | "json" | "yaml";
  color: "auto" | "always" | "never";
  log_level: "debug" | "info" | "warn" | "error";
  auto_update_check: boolean;
};

/**
 * Standard response structure for API calls.
 */
type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
};

/**
 * Information about an application.
 */
type AppInfo = {
  name: string;
  status: string;
  version: string;
  created_at: string;
  updated_at: string;
};

/**
 * Key-value pair for configuration values.
 */
type ConfigValue = {
  key: string;
  value: string | number | boolean | object;
};

/**
 * Options for the 'app list' command.
 */
interface AppListOptions {
  output: "table" | "json";
}

/**
 * Options for the 'app info' command.
 */
interface AppInfoOptions {
  output: "table" | "json";
}

/**
 * Options for the 'config get' command.
 */
interface ConfigGetOptions {
  app?: string;
  key?: string;
  secret?: boolean;
  output: "table" | "json";
}

/**
 * Options for the 'config set' command.
 */
interface ConfigSetOptions {
  app?: string;
  secret?: boolean;
  output: "table" | "json";
}

/**
 * Options for the 'config delete' command.
 */
interface ConfigDeleteOptions {
  app?: string;
  secret?: boolean;
}

// Export types for CommonJS
module.exports = {
  ConfigStore: undefined,
  ApiResponse: undefined,
  AppInfo: undefined,
  ConfigValue: undefined,
  AppListOptions: undefined,
  AppInfoOptions: undefined,
  ConfigGetOptions: undefined,
  ConfigSetOptions: undefined,
  ConfigDeleteOptions: undefined,
};
