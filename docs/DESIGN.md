# Comprehensive Technical Design Document

## 1. Architecture Overview

The project consists of two main components:

- **CLI Component**: A TypeScript/Node.js CLI application that handles user commands, communicates with the server, and processes responses.
- **Server-Side Component**: A Node.js/TypeScript API server that manages application deployments, configurations, and file storage. Handles long-running tasks with Server-Sent Events (SSE) for real-time updates.

Both components are organized as a monorepo using Yarn workspaces with CommonJS modules.

## 2. API Endpoints

### Configuration Management

| HTTP Method | Endpoint          | Description                                        |
| ----------- | ----------------- | -------------------------------------------------- |
| GET         | /config           | Retrieve system-wide configuration.                |
| GET         | /config/{appName} | Retrieve configuration for a specific application. |
| PUT         | /config/{appName} | Create or update an application's configuration.   |
| DELETE      | /config/{appName} | Remove an application-specific configuration.      |

### Application Deployment & Management

| HTTP Method | Endpoint                | Description                                             |
| ----------- | ----------------------- | ------------------------------------------------------- |
| POST        | /apps/deploy            | Deploy a new application.                               |
| GET         | /apps                   | List all deployed applications.                         |
| GET         | /apps/{appName}         | Get details about a deployed application.               |
| POST        | /apps/{appName}/update  | Update an application (with backup handled internally). |
| DELETE      | /apps/{appName}         | Remove a deployed application.                          |
| POST        | /apps/{appName}/start   | Start an application.                                   |
| POST        | /apps/{appName}/stop    | Stop an application.                                    |
| POST        | /apps/{appName}/restart | Restart an application.                                 |

### File Management

| HTTP Method | Endpoint                       | Description                                 |
| ----------- | ------------------------------ | ------------------------------------------- |
| POST        | /apps/{appName}/files          | Upload additional files for an application. |
| GET         | /apps/{appName}/files          | List uploaded files for an application.     |
| DELETE      | /apps/{appName}/files/{fileId} | Remove a specific uploaded file.            |

### Backup & Restore

| HTTP Method | Endpoint                           | Description                                 |
| ----------- | ---------------------------------- | ------------------------------------------- |
| POST        | /apps/{appName}/backup             | Trigger a backup for an application.        |
| GET         | /apps/{appName}/backups            | List all backups for an application.        |
| GET         | /apps/{appName}/backup/{backupId}  | Retrieve backup details for an application. |
| POST        | /apps/{appName}/restore/{backupId} | Restore an application from a backup.       |

### Logs & Monitoring

| HTTP Method | Endpoint                | Description                                 |
| ----------- | ----------------------- | ------------------------------------------- |
| GET         | /apps/{appName}/logs    | Retrieve logs for an application.           |
| GET         | /apps/{appName}/metrics | Get performance metrics for an application. |
| GET         | /apps/{appName}/health  | Check the health status of an application.  |

### Real-Time Updates (Using SSE)

| HTTP Method | Endpoint               | Description                                                      |
| ----------- | ---------------------- | ---------------------------------------------------------------- |
| GET         | /apps/{appName}/events | Streams logs/status updates for deployment or upgrade processes. |

## 3. Communication Protocols

- **REST APIs**: CLI sends requests and receives responses for standard operations.
- **SSE (Server-Sent Events)**: Provides real-time updates from the server to the CLI for long-running tasks.

## 4. Security

- **Authentication**: Single API key defined on the server via environment variables.
- **Configuration Security**: Support for encrypting sensitive configuration values at rest.
- **Encrypted Values**: Masked in API responses and stored separately from regular configuration.

## 5. Storage Structure

### Consolidated Directory Structure

```
${STORAGE_ROOT}/ (or data/)
├── packages/                           # Downloaded ORAS packages
│   └── {packageName}/
│       ├── version-{timestamp}/
│       │   ├── docker-compose.yml      # Original docker-compose from ORAS
│       │   ├── Dockerfile.*            # Any Dockerfiles from ORAS
│       │   └── ...                     # Other files from ORAS package
│       └── latest -> version-{timestamp}  # Symlink to latest version
│
├── apps/                              # Application configuration
│   └── {appName}/
│       ├── package-ref                # Reference to package being used
│       ├── env/                       # Environment variables
│       │   ├── regular/               # Regular environment variables
│       │   │   └── {KEY_NAME}         # One file per env var, filename is the key
│       │   └── encrypted/             # Encrypted environment variables
│       │       └── {KEY_NAME}         # One file per encrypted env var
│       └── files/
│           ├── app/                   # App-level files
│           │   └── docker-compose.override.yml  # Optional override for the base compose
│           └── services/              # Service-specific files
│               └── {serviceName}/     # One directory per service
│                   ├── Dockerfile     # Custom Dockerfile for this service (if any)
│                   └── config/        # Configuration files for this service
│                       └── {path/to/file}  # Path matches container destination
│
├── deployments/                       # Active deployments
│   └── {deploymentId}/                # Created at deploy time (includes appName)
│       ├── docker-compose.yml         # Main compose file
│       ├── docker-compose.override.yml # Applied if user provided one
│       ├── .env                       # Combined environment variables
│       ├── services/                  # Service-specific files
│       │   └── {serviceName}/
│       │       ├── Dockerfile         # Service Dockerfile (if custom)
│       │       └── config/            # Mounted configuration files
│       │           └── {path/to/file}
│       └── files/                     # Other files needed at the app level
│
├── config/                            # Global configuration storage
│   ├── system/
│   │   ├── config.json                # System-wide configuration
│   │   └── env/                       # Global environment variables
│   │       ├── regular/               # Regular environment variables
│   │       │   └── {KEY_NAME}         # One file per env var, filename is the key
│   │       └── encrypted/             # Encrypted environment variables
│   │           └── {KEY_NAME}         # One file per encrypted env var
│   └── apps/
│       └── {appName}/
│           └── config.json            # App-specific configuration
│
└── backups/                           # Backup storage
    └── {appName}/
        └── {timestamp}/
            ├── files/                 # Snapshot of files
            ├── config/                # Snapshot of config
            └── metadata.json          # Backup metadata
```

## 6. Directory Roles and Operations

### packages/

- Stores downloaded ORAS packages in their original form
- Organized by application name and version
- Preserves original packages for verification and redeployment

### deployments/{appName}/

Contains three key subdirectories for each application:

#### files/

- Permanent storage for user-uploaded files
- Maintains original path structure
- Preserved across deployments
- Example contents:
  ```
  files/
  ├── config/custom-nginx.conf
  ├── ssl/
  │   ├── cert.pem
  │   └── key.pem
  └── static/custom-logo.png
  ```

#### compose/

- Contains active Docker Compose configuration
- Generated during deployment
- Combines package compose file with configurations
- Contains:
  - `docker-compose.yml`: Final compose configuration
  - `.env`: Generated environment variables

#### current/

- Working directory for active deployment
- Recreated during each deployment
- Combines:
  - Extracted package contents
  - Links to uploaded files
  - Generated configurations
- Temporary workspace that represents the complete deployment

### config/

Stores configuration at two levels:

- System-wide settings (`system/config.json`)
- Application-specific settings (`apps/{appName}/config.json`)

### backups/

Stores point-in-time snapshots of applications:

- Complete state including files and configuration
- Organized by timestamp
- Enables reliable rollback capabilities

## 7. Configuration Management

### Environment Variables

All environment variables are stored under a single namespace per application to ensure they work correctly with Docker Compose:

- Variables are stored in `env/regular/{KEY_NAME}` or `env/encrypted/{KEY_NAME}`
- Each variable is stored in a separate file named after the environment variable
- All variables are combined into a single `.env` file during deployment
- This single `.env` file is used by Docker Compose for the entire application
- Since Docker Compose uses a flat namespace for variables, this approach ensures all services have access to the required variables
- Encrypted variables are decrypted during deployment before being written to the `.env` file

### Configuration Files

#### App-Level Configuration Files

- Files that apply to the entire application
- Primarily includes `docker-compose.override.yml`
- Stored in `files/app/`
- Special handling for docker-compose.override.yml:
  - Used by Docker Compose to override settings in the base docker-compose.yml
  - Automatically detected and used by Docker Compose during deployment
  - Useful for customizing services, networks, volumes, etc.

#### Service-Level Configuration Files

- Files specific to individual services/containers
- Stored in `files/services/{serviceName}/config/{path/to/file}`
- Path structure matches target path in container
- Includes custom Dockerfiles for specific services
- Mounted as volumes to the specific service container
- Examples:
  - `files/services/nginx/config/etc/nginx/nginx.conf`
  - `files/services/postgres/config/docker-entrypoint-initdb.d/init.sql`
  - `files/services/app/Dockerfile`

## 8. Special File Handling

### docker-compose.override.yml

The `docker-compose.override.yml` file is a standard Docker Compose feature that allows users to customize their deployments without modifying the base `docker-compose.yml` file. This file can:

- Override service configurations
- Add new services
- Modify environment variables
- Change volumes and networks
- Adjust resource constraints
- Add or modify labels and other metadata

During deployment, Docker Compose automatically merges the base `docker-compose.yml` with the override file if it exists.

### Custom Dockerfiles

Service-specific Dockerfiles allow users to customize individual services:

- Stored as `files/services/{serviceName}/Dockerfile`
- Referenced in docker-compose.override.yml via the `build` directive
- Enables customization of base images, build arguments, etc.

## 9. Deployment Workflow

### 1. Package Download

- ORAS package downloaded to `packages/{appName}/{version}/`
- Package integrity verified

### 2. Deployment Preparation

- Clear `current/` directory
- Extract package contents
- Link or copy uploaded files from `files/`
- Generate compose configuration

### 3. Configuration Merging

- Combine system-wide and app-specific configs
- Generate final environment variables
- Create docker-compose configuration

### 4. Activation

- Start services using generated compose files
- Monitor for successful deployment
- Update application status

## 11. Project Directory

```
project-root/
│
├── packages/                 # Yarn workspace packages
│   ├── client/               # CLI client application
│   │   ├── src/              # TypeScript source code
│   │   ├── tsconfig.json     # TypeScript configuration
│   │   └── package.json      # Package information and dependencies
│   │
│   ├── server/               # API server application
│   │   ├── src/              # TypeScript source code
│   │   ├── public/           # Public assets
│   │   │   └── docs/         # Documentation
│   │   │       └── openapi.yaml  # OpenAPI specification
│   │   ├── tsconfig.json     # TypeScript configuration
│   │   └── package.json      # Package information and dependencies
│   │
│   └── shared/               # Shared types and utilities
│       ├── src/              # TypeScript source code
│       ├── tsconfig.json     # TypeScript configuration
│       └── package.json      # Package information and dependencies
│
├── docs/                     # Project documentation
│   ├── TECHNICAL_COMBINED.md # This comprehensive technical document
│   └── ...                   # Other documentation files
│
├── .gitignore                # Git ignore file
├── package.json              # Root package.json for Yarn workspaces
└── README.md                 # Project overview and setup instructions
```

## 12. Benefits

- **Clean Separation**: Each component maintains its own space
- **Reliable Upgrades**: Clear distinction between versions
- **Easy Backups**: Well-organized structure for backing up state
- **Flexible Configuration**: Multiple levels of configuration
- **Safe Deployment**: Changes isolated until activation
- **Rollback Support**: Previous state can be restored easily
- **Modular Design**: Yarn workspaces for code sharing between packages

## 13. Implementation Notes

- Use symbolic links where possible to save space
- Implement proper cleanup of old versions
- Maintain careful permissions management
- Consider filesystem performance for large deployments
- Plan for disaster recovery scenarios

## 14. Open Questions and Future Considerations

1. How should we handle dependencies between services in the configuration?
2. Should we provide templates for common service configurations?
3. How do we manage service-specific volumes and networks?
4. Should we add service-level health checks?
5. How do we handle configuration validation across multiple services?

## 15. Next Steps

1. Complete implementation of package, configuration and deployment managers
2. Add comprehensive test coverage using Jest
3. Document the configuration management feature in the user guide
4. Consider adding configuration validation based on application requirements
5. Implement CLI tools for managing docker-compose.override.yml files
6. Design CLI commands for service-level configuration management
7. Implement service detection from docker-compose files
8. Create examples of multi-service configuration scenarios
