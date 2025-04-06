/**
 * Configuration type for storing application settings
 */
interface ConfigStore {
  server_url: string;
  api_key: string;
  timeout: number;
  output_format: "table" | "json" | "yaml";
  color: "auto" | "always" | "never";
  log_level: "debug" | "info" | "warn" | "error";
  auto_update_check: boolean;
}

/**
 * Base response type for API calls
 */
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Application information type
 */
interface AppInfo {
  name: string;
  status: string;
  version: string;
  created_at: string;
  updated_at: string;
}

/**
 * Config value type
 */
interface ConfigValue {
  key: string;
  value: string | number | boolean | object;
}

module.exports = {
  ConfigStore,
  ApiResponse,
  AppInfo,
  ConfigValue,
};
