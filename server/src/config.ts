const path = require("path");
const fs = require("fs-extra");

/**
 * Path functions for file system organization
 * Provides standardized paths for all application components
 */
interface PathFunctions {
  packages: {
    root: (appName: string) => string;
    version: (appName: string, version: string) => string;
    bundle: (appName: string, version: string) => string;
  };
  apps: {
    root: (appName: string) => string;
    packageRef: (appName: string) => string;
    env: {
      app: {
        regular: (appName: string) => string;
        encrypted: (appName: string) => string;
        variable: (appName: string, key: string, encrypted: boolean) => string;
      };
      service: {
        regular: (appName: string, serviceName: string) => string;
        encrypted: (appName: string, serviceName: string) => string;
        variable: (
          appName: string,
          serviceName: string,
          key: string,
          encrypted: boolean
        ) => string;
      };
    };
    files: {
      app: (appName: string) => string;
      service: {
        root: (appName: string, serviceName: string) => string;
        config: (appName: string, serviceName: string) => string;
        dockerfile: (appName: string, serviceName: string) => string;
      };
    };
  };
  config: {
    system: () => string;
    app: (appName: string) => string;
  };
  deployments: {
    root: (appName: string) => string;
    files: (appName: string) => string;
    compose: (appName: string) => string;
    current: (appName: string) => string;
    services: (appName: string) => string;
    service: (appName: string, serviceName: string) => string;
  };
  backups: {
    root: (appName: string) => string;
    timestamp: (appName: string, tag: string) => string;
    files: (appName: string, tag: string) => string;
    config: (appName: string, tag: string) => string;
    metadata: (appName: string, tag: string) => string;
  };
}

// Use project directory or home directory instead of /var
const defaultPath =
  process.env.NODE_ENV === "test"
    ? path.join(process.cwd(), "data")
    : process.env.DATA_DIR || "data";

export const STORAGE_ROOT = process.env.STORAGE_ROOT || defaultPath;
export const ORAS_REGISTRY = process.env.ORAS_REGISTRY || "localhost:5000";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// OIDC configuration
export const OIDC_ENABLED = !!process.env.HOLA_OIDC_ISSUER;
export const OIDC_ISSUER = process.env.HOLA_OIDC_ISSUER || '';
export const OIDC_CLIENT_ID = process.env.HOLA_OIDC_CLIENT_ID || '';

// Storage path structure for all application components
export const PATHS: PathFunctions = {
  packages: {
    root: (appName: string): string =>
      path.join(STORAGE_ROOT, "packages", appName),
    version: (appName: string, version: string): string =>
      version === "latest"
        ? path.join(STORAGE_ROOT, "packages", appName, version)
        : path.join(STORAGE_ROOT, "packages", appName, `version-${version}`),
    bundle: (appName: string, version: string): string =>
      path.join(
        STORAGE_ROOT,
        "packages",
        appName,
        version === "latest" ? version : `version-${version}`,
        "bundle.tgz"
      ),
  },
  apps: {
    root: (appName: string): string => path.join(STORAGE_ROOT, "apps", appName),
    packageRef: (appName: string): string =>
      path.join(STORAGE_ROOT, "apps", appName, "package-ref"),
    env: {
      app: {
        regular: (appName: string): string =>
          path.join(STORAGE_ROOT, "apps", appName, "env", "regular"),
        encrypted: (appName: string): string =>
          path.join(STORAGE_ROOT, "apps", appName, "env", "encrypted"),
        variable: (appName: string, key: string, encrypted: boolean): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "env",
            encrypted ? "encrypted" : "regular",
            key
          ),
      },
      service: {
        regular: (appName: string, serviceName: string): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "env",
            "services",
            serviceName,
            "regular"
          ),
        encrypted: (appName: string, serviceName: string): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "env",
            "services",
            serviceName,
            "encrypted"
          ),
        variable: (
          appName: string,
          serviceName: string,
          key: string,
          encrypted: boolean
        ): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "env",
            "services",
            serviceName,
            encrypted ? "encrypted" : "regular",
            key
          ),
      },
    },
    files: {
      app: (appName: string): string =>
        path.join(STORAGE_ROOT, "apps", appName, "files", "app"),
      service: {
        root: (appName: string, serviceName: string): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "files",
            "services",
            serviceName
          ),
        config: (appName: string, serviceName: string): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "files",
            "services",
            serviceName,
            "config"
          ),
        dockerfile: (appName: string, serviceName: string): string =>
          path.join(
            STORAGE_ROOT,
            "apps",
            appName,
            "files",
            "services",
            serviceName,
            "Dockerfile"
          ),
      },
    },
  },
  config: {
    system: (): string => path.join(STORAGE_ROOT, "config", "system"),
    app: (appName: string): string =>
      path.join(STORAGE_ROOT, "config", "apps", appName),
  },
  deployments: {
    root: (appName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName),
    files: (appName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName, "files"),
    compose: (appName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName, "compose"),
    current: (appName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName, "current"),
    services: (appName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName, "services"),
    service: (appName: string, serviceName: string): string =>
      path.join(STORAGE_ROOT, "deployments", appName, "services", serviceName),
  },
  backups: {
    root: (appName: string): string =>
      path.join(STORAGE_ROOT, "backups", appName),
    timestamp: (appName: string, tag: string): string =>
      path.join(STORAGE_ROOT, "backups", appName, tag),
    files: (appName: string, tag: string): string =>
      path.join(STORAGE_ROOT, "backups", appName, tag, "files"),
    config: (appName: string, tag: string): string =>
      path.join(STORAGE_ROOT, "backups", appName, tag, "config"),
    metadata: (appName: string, tag: string): string =>
      path.join(STORAGE_ROOT, "backups", appName, tag, "metadata.json"),
  },
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

module.exports = {
  PORT,
  ORAS_REGISTRY,
  STORAGE_ROOT,
  PATHS,
  isValidAppName,
  oidc: {
    enabled: OIDC_ENABLED,
    issuer: OIDC_ISSUER,
    clientId: OIDC_CLIENT_ID,
  }
};
