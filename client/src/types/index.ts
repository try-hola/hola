/**
 * Configuration type for storing application settings
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
 * Base response type for API calls
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
 * Application information type
 */
type AppInfo = {
  name: string;
  status: string;
  version: string;
  created_at: string;
  updated_at: string;
};

/**
 * Config value type
 */
type ConfigValue = {
  key: string;
  value: string | number | boolean | object;
};

// Export types for TypeScript
module.exports = {};

// Add type exports for TypeScript
module.exports.ConfigStore = undefined;
module.exports.ApiResponse = undefined;
module.exports.AppInfo = undefined;
module.exports.ConfigValue = undefined;
