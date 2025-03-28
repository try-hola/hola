const path = require("path");
const fs = require("fs-extra");

// Types for exported objects
interface PathFunctions {
  packages: (appName: string, version: string) => string;
  config: (appName: string) => string;
  deployments: {
    root: (appName: string) => string;
    files: (appName: string) => string;
    compose: (appName: string) => string;
    current: (appName: string) => string;
  };
  backups: (appName: string, tag: string) => string;
  apps: (appName?: string) => string;
}

// Use project directory or home directory instead of /var
const defaultPath = path.join(process.cwd(), "data");

export const STORAGE_ROOT = process.env.STORAGE_ROOT || defaultPath;
const ORAS_REGISTRY = process.env.ORAS_REGISTRY || "localhost:5000";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export const PATHS: PathFunctions = {
  packages: (appName: string, version: string): string => 
    path.join(STORAGE_ROOT, "packages", appName, version),

  config: (appName: string): string =>
    path.join(STORAGE_ROOT, "config", appName),
  
  deployments: {
    root: (appName: string): string => 
      path.join(STORAGE_ROOT, "deployments", appName),
    files: (appName: string): string => 
      path.join(STORAGE_ROOT, "deployments", appName, "files"),
    compose: (appName: string): string => 
      path.join(STORAGE_ROOT, "deployments", appName, "compose"),
    current: (appName: string): string => 
      path.join(STORAGE_ROOT, "deployments", appName, "current")
  },

  backups: (appName: string, tag: string): string => 
    path.join(STORAGE_ROOT, "backups", appName, tag),

  apps: (appName?: string) => {
    const base = path.join(STORAGE_ROOT, "apps");
    return appName ? path.join(base, appName) : base;
  }
};

/**
 * Validates that an application name meets security requirements
 * @param appName - Name of the application to validate
 * @returns boolean indicating if the name is valid
 */
export const isValidAppName = (appName: string): boolean => {
  // Only allow alphanumeric characters, hyphens, and underscores
  const validNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/;
  return (
    typeof appName === "string" &&
    appName.length > 0 &&
    appName.length <= 64 &&
    validNamePattern.test(appName) &&
    !appName.startsWith(".") // Prevent hidden directory access
  );
};