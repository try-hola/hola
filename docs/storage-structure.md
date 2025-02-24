# Storage Structure

## Overview

The server maintains a structured storage layout that keeps different components separate until deployment time. This organization enables clean separation of concerns, easy backups, and reliable deployment processes.

## Directory Structure

```plaintext
${STORAGE_ROOT}/
├── packages/                  # Downloaded ORAS packages
│   └── {appName}/
│       └── {version}/
│           └── bundle.tgz    # Original downloaded package
│
├── deployments/              # Active deployments
│   └── {appName}/
│       ├── files/           # App-specific uploaded files
│       ├── compose/         # Generated deployment files
│       └── current/         # Active deployment workspace
│
├── config/                   # Configuration storage
│   ├── system/
│   │   └── config.json      # System-wide configuration
│   └── apps/
│       └── {appName}/
│           └── config.json  # App-specific configuration
│
└── backups/                  # Backup storage
    └── {appName}/
        └── {timestamp}/
            ├── files/       # Snapshot of files
            ├── config/      # Snapshot of config
            └── metadata.json
```

## Directory Roles

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
  ```plaintext
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

## Deployment Workflow

1. **Package Download**
   - ORAS package downloaded to `packages/{appName}/{version}/`
   - Package integrity verified

2. **Deployment Preparation**
   - Clear `current/` directory
   - Extract package contents
   - Link or copy uploaded files from `files/`
   - Generate compose configuration

3. **Configuration Merging**
   - Combine system-wide and app-specific configs
   - Generate final environment variables
   - Create docker-compose configuration

4. **Activation**
   - Start services using generated compose files
   - Monitor for successful deployment
   - Update application status

## Benefits

- **Clean Separation**: Each component maintains its own space
- **Reliable Upgrades**: Clear distinction between versions
- **Easy Backups**: Well-organized structure for backing up state
- **Flexible Configuration**: Multiple levels of configuration
- **Safe Deployment**: Changes isolated until activation
- **Rollback Support**: Previous state can be restored easily

## Implementation Notes

- Use symbolic links where possible to save space
- Implement proper cleanup of old versions
- Maintain careful permissions management
- Consider filesystem performance for large deployments
- Plan for disaster recovery scenarios