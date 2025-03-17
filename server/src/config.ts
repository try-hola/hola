import path from "path";

export const STORAGE_ROOT = process.env.STORAGE_ROOT || "/var/lib/hola";
export const ORAS_REGISTRY = process.env.ORAS_REGISTRY || "localhost:5000";

export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export const PATHS = {
  packages: (appName: string, version: string) => 
    path.join(STORAGE_ROOT, "packages", appName, version),

  config: (appName: string) =>
    path.join(STORAGE_ROOT, "config", appName),
  
  deployments: {
    root: (appName: string) => 
      path.join(STORAGE_ROOT, "deployments", appName),
    files: (appName: string) => 
      path.join(STORAGE_ROOT, "deployments", appName, "files"),
    compose: (appName: string) => 
      path.join(STORAGE_ROOT, "deployments", appName, "compose"),
    current: (appName: string) => 
      path.join(STORAGE_ROOT, "deployments", appName, "current")
  },

  backups: (appName: string, tag: string) => 
    path.join(STORAGE_ROOT, "backups", appName, tag)
};

/**
 * Validates that an application name meets security requirements
 * @param appName - Name of the application to validate
 * @returns boolean indicating if the name is valid
 */
export const isValidAppName = (appName: string): boolean => {
  // Only allow alphanumeric characters, hyphens, and underscores
  const validNamePattern = /^[a-zA-Z0-9-_]+$/;
  return (
    typeof appName === "string" &&
    appName.length > 0 &&
    appName.length <= 64 &&
    validNamePattern.test(appName) &&
    !appName.startsWith(".") // Prevent hidden directory access
  );
};