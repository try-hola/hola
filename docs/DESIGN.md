# Comprehensive Technical Design Document

## 1. Architecture Overview

The project consists of two main components:

- **CLI Component**: A Python CLI application built with Typer that handles user commands, communicates with the server, and processes responses.
- **Server-Side Component**: A Python FastAPI server that manages application deployments, configurations, and file storage. Handles long-running tasks with Server-Sent Events (SSE) for real-time updates.

Both components are organized as a monorepo using Poetry workspaces with shared modules.

### 1.1 CLI-Server Architecture

The CLI component can manage multiple server instances of different types through the Provider Pattern:

- **ServerProvider Interface**: Defined in the shared package, implemented by provider classes in the CLI
- **Provider Registry**: The CLI maintains a registry of available provider types (Docker Desktop, OrbStack, etc.)
- **Instance Manager**: Tracks and manages server instances across different providers
- **Server Commands**: The CLI includes commands for creating, starting, stopping, and managing server instances

Each server instance is a standalone API server that can be run in different environments (Docker, OrbStack, etc.), while the CLI can connect to and manage multiple server instances. This architecture allows:

1. **Flexibility**: Support for multiple execution environments based on user preference
2. **Simplicity**: Each server focuses solely on API functionality without provider-specific code
3. **Centralized Management**: The CLI provides a unified interface for managing multiple servers

## 2. API Endpoints

All API endpoints use the `/api` prefix.

### Configuration Management

| HTTP Method | Endpoint                              | Description                                       |
| ----------- | ------------------------------------- | ------------------------------------------------- |
| GET         | /api/config                           | Retrieve system-wide configuration                |
| GET         | /api/config?key=name                  | Retrieve specific system config value             |
| POST        | /api/config                           | Create or update multiple system config values    |
| PUT         | /api/config/{key}                     | Create or update a specific system config value   |
| DELETE      | /api/config/{key}                     | Remove a specific system config value             |
| DELETE      | /api/config?keys=key1,key2            | Remove multiple system config values              |
| GET         | /api/config/{appName}                 | Retrieve all configuration for an application     |
| GET         | /api/config/{appName}?key=name        | Retrieve specific config value for an application |
| POST        | /api/config/{appName}                 | Create or update multiple app config values       |
| PUT         | /api/config/{appName}/{key}           | Create or update a specific app config value      |
| DELETE      | /api/config/{appName}/{key}           | Remove a specific app config value                |
| DELETE      | /api/config/{appName}?keys=k1,k2      | Remove multiple app config values                 |
| GET         | /api/config/{appName}/encrypted       | Retrieve all encrypted values (masked by default) |
| POST        | /api/config/{appName}/encrypted       | Create or update multiple encrypted values        |
| PUT         | /api/config/{appName}/encrypted/{key} | Create or update a specific encrypted value       |
| DELETE      | /api/config/{appName}/encrypted/{key} | Remove a specific encrypted value                 |

### Application Deployment & Management

| HTTP Method | Endpoint                    | Description                                              |
| ----------- | --------------------------- | -------------------------------------------------------- |
| POST        | /api/apps/deploy            | Deploy a new application.                                |
| GET         | /api/apps                   | List all deployed applications.                          |
| GET         | /api/apps/{appName}         | Get details about a deployed application.                |
| POST        | /api/apps/{appName}/upgrade | Upgrade an application (with backup handled internally). |
| DELETE      | /api/apps/{appName}         | Remove a deployed application.                           |
| POST        | /api/apps/{appName}/start   | Start an application.                                    |
| POST        | /api/apps/{appName}/stop    | Stop an application.                                     |
| POST        | /api/apps/{appName}/restart | Restart an application.                                  |

### File Management

| HTTP Method | Endpoint                                | Description                                 |
| ----------- | --------------------------------------- | ------------------------------------------- |
| POST        | /api/apps/{appName}/files               | Upload additional files for an application. |
| GET         | /api/apps/{appName}/files               | List uploaded files for an application.     |
| GET         | /api/apps/{appName}/files/:filePath(\*) | Get a specific uploaded file.               |
| DELETE      | /api/apps/{appName}/files/:filePath(\*) | Remove a specific uploaded file.            |

### Backup & Restore

| HTTP Method | Endpoint                               | Description                                 |
| ----------- | -------------------------------------- | ------------------------------------------- |
| POST        | /api/apps/{appName}/backup             | Trigger a backup for an application.        |
| GET         | /api/apps/{appName}/backups            | List all backups for an application.        |
| GET         | /api/apps/{appName}/backup/{backupId}  | Retrieve backup details for an application. |
| POST        | /api/apps/{appName}/restore/{backupId} | Restore an application from a backup.       |

### Logs & Monitoring

| HTTP Method | Endpoint                    | Description                                 |
| ----------- | --------------------------- | ------------------------------------------- |
| GET         | /api/apps/{appName}/logs    | Retrieve logs for an application.           |
| GET         | /api/apps/{appName}/metrics | Get performance metrics for an application. |
| GET         | /api/apps/{appName}/health  | Check the health status of an application.  |

### Real-Time Updates (Using SSE)

| HTTP Method | Endpoint                   | Description                                                      |
| ----------- | -------------------------- | ---------------------------------------------------------------- |
| GET         | /api/apps/{appName}/events | Streams logs/status updates for deployment or upgrade processes. |

## 2.1 Suggested CLI Structure

The following CLI structure is designed to offer a cohesive, intuitive interface for end users while cleanly mapping to the underlying API features. All commands follow the pattern:

```
hola <command> <subcommand> [options]
```

### Client Settings Management (Local)

```
hola settings get [--key <key>]
hola settings set <key>=<value>...
hola settings delete <key>...
```

- These commands manage client-side settings stored in the local `~/.hola/config.json` file
- Settings affect client behavior like output format, logging, and connection parameters

### Server Configuration Management (Remote)

```
hola config get [--app <appName>] [--key <key>] [--secret]
hola config set [--app <appName>] [--secret] <key>=<value>...
hola config delete [--app <appName>] [--secret] <key>...
```

- `--app` targets an app-specific config; otherwise, system-wide is assumed.
- `--secret` stores or retrieves values encrypted at rest (masked when retrieved).
- These commands manage server-side configurations used by deployed applications

### Application Lifecycle

```
hola app deploy <appName> [--package <package-ref>] [--env KEY=VALUE...] [--file <file>...]
hola app list
hola app info <appName>
hola app upgrade <appName>
hola app delete <appName>
hola app start <appName>
hola app stop <appName>
hola app restart <appName>
```

### Server Management

```
hola servers providers                                      # List available server providers
hola servers create <name> --provider <provider_type>       # Create a new server instance
                    [--port <port>]                         # Port to expose the server on (default: 8000)
                    [--image <image>]                       # Docker image to use (default: hola:latest)
                    [--env KEY=VALUE...]                    # Environment variables for the server
hola servers list                                           # List all server instances
hola servers info <instance_id>                             # Get info about a server instance
hola servers start <instance_id>                            # Start a server instance
hola servers stop <instance_id>                             # Stop a server instance
hola servers delete <instance_id>                           # Delete a server instance record
```

The CLI supports managing multiple server instances of different types (Docker Desktop, OrbStack, etc.) through the Provider Pattern. Each server instance runs one instance of the Hola API server in its specific environment.

#### Server Management Architecture

The server management functionality follows these principles:

1. **Provider Abstraction**: The CLI implements the Provider Pattern through:
   - `ServerProvider` Protocol defined in the shared library 
   - Provider implementations in the CLI package (OrbStackProvider, DockerDesktopProvider)
   - `ServerProviderRegistry` for managing available providers

2. **Instance Management**: The `ServerInstanceManager` handles:
   - Creating new server instances with specific providers
   - Starting and stopping existing instances
   - Tracking instance status and metadata
   - Persisting instance information to disk (~/.hola/instances)

3. **Environment Isolation**: Each server instance:
   - Runs in its own isolated environment (container)
   - Has its own API key and configuration
   - Can be created, started, stopped independently of other instances

4. **Connection Management**: The CLI stores connection information for each server:
   - URL and port mapping to connect to the server
   - API key for authentication
   - Provider-specific connection context

### File Management

```
hola file upload <appName> <path>...
hola file list <appName>
hola file delete <appName> <filePath>
```

### Backup & Restore

```
hola backup create <appName>
hola backup list <appName>
hola backup info <appName> <backupId>
hola backup restore <appName> <backupId>
```

### Logs & Monitoring

```
hola logs <appName>
hola metrics <appName>
hola health <appName>
```

### Real-Time Updates

```
hola watch <appName> [--events deploy|update|all]
```

This CLI is designed to be clear, minimal, and consistent. Aliases like `cfg`, `ls`, or `rm` can be introduced as optional ergonomic shortcuts. Descriptive error messages and `--help` flags for every command/subcommand ensure a friendly developer experience.

## 2.2 Client Error Handling and Feedback

The CLI client provides clear, actionable feedback for different error scenarios:

### Error Categories and Responses

| Error Type     | Description              | Client Response                                      |
| -------------- | ------------------------ | ---------------------------------------------------- |
| Connection     | Server unreachable       | Clear error with network troubleshooting steps       |
| Authentication | Invalid API key          | Instructions for validating credentials              |
| Validation     | Invalid input parameters | Specific guidance on correcting the input            |
| Resource       | Resource not found       | Suggestions for available resources                  |
| Permission     | Insufficient permissions | Details about required permissions                   |
| Server         | Internal server errors   | Error code and instructions to contact administrator |

### User Feedback Mechanisms

- **Progress Indicators**: Long-running operations display spinners or progress bars
- **Color Coding**: Success (green), warnings (yellow), and errors (red)
- **Verbose Mode**: `--verbose` flag for additional operational details
- **Quiet Mode**: `--quiet` flag for machine-readable output (JSON)
- **Debug Mode**: `--debug` flag for troubleshooting with detailed logs

## 2.3 Client Configuration Options

The CLI client can be customized through a local configuration file (`~/.hola/config.toml`) with the following options:

| Setting             | Default                 | Description                                          |
| ------------------- | ----------------------- | ---------------------------------------------------- |
| `server_url`        | `http://localhost:3000` | Server base URL                                      |
| `api_key`           | -                       | Authentication key (encrypted at rest)               |
| `timeout`           | `60`                    | Request timeout in seconds                           |
| `output_format`     | `table`                 | Default output format (`table`, `json`, `yaml`)      |
| `color`             | `auto`                  | Terminal color support (`auto`, `always`, `never`)   |
| `log_level`         | `info`                  | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `auto_update_check` | `true`                  | Check for CLI updates automatically                  |

These settings can be overridden per command using equivalent command-line options:

```bash
hola app list --output-format json --timeout 30
```

## 2.4 Client Output Formatting

The CLI supports multiple output formats to accommodate different use cases:

### Output Formats

- **Table** (default): Human-readable tabular format
- **JSON**: Machine-readable JSON for scripting and automation
- **YAML**: Human and machine-readable YAML format
- **Tree**: Hierarchical tree view for nested data

### Examples

```bash
# Default tabular output
hola app list

# JSON output for scripting
hola app list --output json

# YAML output
hola app list --output yaml

# Tree view for nested structures
hola app info myapp --output tree
```

### Filter and Query Support

The client supports JMESPath queries for filtering and transforming output:

```bash
# Get only running applications
hola app list --query "[?status=='running']"

# Extract just the names of all applications
hola app list --query "[].name"
```

## 2.5 Client Offline Capabilities

The CLI client is designed to provide meaningful functionality even with limited or no connectivity:

- **Local Caching**: Recent query results are cached locally
- **Documentation**: Help content is available offline with `hola help`
- **Config Validation**: Local validation of configurations before attempting server operations
- **Retry Logic**: Automatic retry with exponential backoff for transient network issues
- **Draft Mode**: Create configurations offline with `--draft` flag and apply later
- **Batch Operations**: Queue operations with `--batch` flag for later execution
- **Sync Command**: Explicit `hola sync` command to synchronize offline changes

## 2.6 CLI Command Implementation Details

### Command Structure

Each CLI command follows a consistent implementation pattern:

1. **Command Definition**: Using Typer for command structure and option parsing
2. **Input Validation**: Local validation before sending requests
3. **API Request**: Communication with the server API
4. **Response Processing**: Transforming the API response for display
5. **Output Formatting**: Rendering the result in the selected format using the `format_output` utility
6. **Error Handling**: Providing clear error messages and recovery steps

### Typer Implementation

The CLI leverages Typer with the following implementation strategies:

1. **Type Hints**: Using Python type hints for argument validation and documentation
2. **Modular Command Structure**: Organizing commands in a directory structure that mirrors the command hierarchy
3. **Consistent Command Pattern**: Maintaining a predictable pattern for all commands to enhance maintainability

Example command implementation structure:

```python
# Example command registration using Typer
import typer
from rich.console import Console
from typing import Optional
from ..utils.formatting import format_output
from ..utils.logging import log_command_start, log_command_success, log_command_error

app_commands = typer.Typer(help="Application management commands")
console = Console()

@app_commands.command("list")
def list_apps(
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json)"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
):
    """List all deployed applications."""
    log_command_start(logger, "app.list", output=output, server=server)
    
    try:
        # Command implementation logic
        result = {"apps": [...]}
        
        # Format and display the output
        format_output(result, output_format=output)
        log_command_success(logger, "app.list", result)
    except Exception as e:
        log_command_error(logger, "app.list", e)
        raise
```

### Plugin Architecture

The CLI supports extensibility through plugins:

- Custom commands can be registered via plugins
- Plugins are discovered in `~/.hola/plugins/`
- Uses Python's entry point system for plugin registration
- Official and community plugins extend functionality without core changes
- Plugins can add new commands, modify existing functionality, and provide integrations

## 3. Communication Protocols

- **REST APIs**: CLI sends requests and receives responses for standard operations.
- **SSE (Server-Sent Events)**: Provides real-time updates from the server to the CLI for long-running tasks.

## 3.1 Server Management & Contexts

The CLI client supports managing multiple Hola server installations through a context-based approach, similar to how Docker and Kubernetes clients operate.

### Server Contexts

Server contexts allow users to define, manage, and switch between multiple Hola server instances:

| Command                               | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `hola server list`                    | List all configured server contexts      |
| `hola server current`                 | Show the currently active server context |
| `hola server switch <name>`           | Switch to a different server context     |
| `hola server rename <old> <new>`      | Rename a server context                  |
| `hola server remove <name>`           | Remove a server context                  |
| `hola server update <name> [options]` | Update server context details            |

Each context contains:

- Server URL
- Authentication settings
- Docker context name
- Custom timeout/retry settings
- Context-specific configuration overrides

### Server Configuration Structure

Server contexts are stored in the user configuration file (`~/.hola/config.toml`), separate from regular client configuration:

```toml
[servers]
current = "local"

[servers.production]
url = "https://hola.example.com"
api_key = "prod-encrypted-key"
docker_context = "production"
timeout = 120000

[servers.staging]
url = "https://staging-hola.example.com"
api_key = "staging-encrypted-key"
docker_context = "staging"
timeout = 60000

[servers.local]
url = "http://localhost:3000"
api_key = "local-encrypted-key"
docker_context = "default"
timeout = 30000
```

All CLI commands implicitly use the active context, but can target a specific server using the --server flag:

```bash
hola app list --server staging
```

## 3.2 Server Bootstrapping

The Hola client provides a server bootstrapping feature to deploy the Hola server container to a fresh Docker host.

### Bootstrap Wizard

The bootstrap process uses an interactive wizard for collecting server deployment parameters:

```bash
hola server bootstrap [--name <context-name>] [--docker-context <docker-context>] [--non-interactive]
```

When run interactively (default), the wizard:

1. Verifies the Docker client is installed and configured
2. Prompts for Docker context selection or creation
3. Validates connectivity to the Docker host
4. Collects server configuration parameters:
   - Server name
   - Admin password
   - Data storage location
   - Host port mapping
   - TLS configuration
   - System resource limits
5. Generates a secure API key
6. Deploys the Hola server container to the selected Docker host
7. Validates server connectivity
8. Saves the new server context

In non-interactive mode, all parameters must be provided through flags or a configuration file.

### Docker Context Integration

The bootstrapping process leverages Docker contexts for remote deployment:

1. Lists available Docker contexts for selection
2. Optionally creates a new Docker context for a remote host:

```bash
hola server bootstrap --create-docker-context remote --docker-host "ssh://user@remote-host"
```

3. Connects to the Docker host using the selected context
4. Deploys the Hola server container
5. Associates the new Hola server with the Docker context

### Docker Compose Template

The bootstrap process uses a Docker Compose template for deploying the Hola server, managed using Python's `docker` package:

```yaml
version: "3.8"
services:
  hola-server:
    image: hola/server:latest
    restart: always
    environment:
      - HOLA_API_KEY=${HOLA_API_KEY}
      - HOLA_ADMIN_PASSWORD=${HOLA_ADMIN_PASSWORD}
      - HOLA_DATA_DIR=/data
    ports:
      - "${HOLA_PORT:-3000}:3000"
    volumes:
      - ${HOLA_DATA_DIR:-./data}:/data
    deploy:
      resources:
        limits:
          cpus: "${HOLA_CPU_LIMIT:-1}"
          memory: ${HOLA_MEMORY_LIMIT:-1G}
```

### Post-Bootstrap Configuration

After successful bootstrap, the client:

1. Configures the new server context using the generated API key
2. Switches to the new context automatically
3. Performs initial system configuration
4. Verifies server health

## 3.3 CLI Command Context Awareness

All CLI commands are context-aware, ensuring they interact with the intended Hola server.

### Context Resolution Order

When determining which server to target, the client follows this resolution order:

1. Explicit server specified with `--server <name>` flag
2. Environment variable: `HOLA_SERVER_CONTEXT`
3. Currently active server context
4. Default server context if none is active

### Command Structure with Context Support

All commands support the `--server` flag to explicitly target a specific server:

```bash
# Target explicit server
hola app deploy myapp --package example.com/myapp:1.0.0 --server production

# Use current context
hola app list

# Temporarily override context
HOLA_SERVER_CONTEXT=staging hola app list
```

### Bulk Operations Across Servers

For operations that need to be performed across multiple servers:

```bash
# Execute a command on all configured servers
hola app list --all-servers

# Execute on specific servers
hola app list --servers staging,production
```

### Context Information in Output

Command outputs include the server context to avoid confusion:

```bash
$ hola app list
SERVER: production
+-------------+--------+----------+
| Application | Status | Version  |
+-------------+--------+----------+
| website     | active | 1.2.0    |
| api         | active | 0.9.1    |
+-------------+--------+----------+
```

### Server Health Check

The client performs a connectivity check before executing commands:

```bash
# Check if the server is accessible
hola server ping [--server <name>]
```

## 4. Security

- **Authentication**: Single API key defined on the server via environment variables.
- **Configuration Security**: Support for encrypting sensitive configuration values at rest.
- **Encrypted Values**: Masked in API responses and stored separately from regular configuration.

## 4.1 Updated Client Authentication Flow

The CLI client authenticates with the server using the following workflow:

1. **Multi-Server API Key Storage**:

   - API keys are stored securely by server context in `~/.hola/servers.json`
   - The configuration file is created with restricted permissions (600)
   - Each server has its own API key

2. **Server Bootstrap Process**:

   - During server bootstrapping, a secure API key is automatically generated
   - The key is stored in the newly created server context
   - The key is configured in the deployed Hola server container

3. **Manual Setup Process**:

   - Users can add existing servers using `hola server add <name> <url>`
   - The API key can be provided manually or via interactive prompt
   - The key is validated against the server before being stored

4. **Authentication Process**:

   - Each API request includes the context's API key in the `Authorization` header
   - The server validates the key before processing any request
   - Authentication failures receive a clear error message with troubleshooting steps

5. **Key Rotation**:
   - Support for key rotation with `hola server rotate-key <name>`
   - For bootstrapped servers, the client can generate a new key and update the server
   - For manually added servers, the user must provide the new key

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
- Secure encryption is handled using Python's `cryptography` library for strong security

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
├── hola_cli/                 # CLI client application
│   ├── pyproject.toml        # Poetry project config
│   ├── poetry.lock           # Lock file for dependencies
│   ├── hola_cli/             # Python package directory
│   │   ├── __init__.py
│   │   ├── main.py           # CLI entry point
│   │   ├── commands/         # Command implementations
│   │   ├── config/           # Configuration management
│   │   ├── services/         # Business logic
│   │   └── utils/            # Utility functions
│   └── tests/                # Test directory
│       ├── commands/         # Command tests
│       ├── services/         # Service tests
│       ├── utils/            # Utility tests
│       └── conftest.py       # Test fixtures
│
├── hola_server/              # API server application
│   ├── pyproject.toml        # Poetry project config
│   ├── poetry.lock           # Lock file for dependencies
│   ├── hola_server/          # Python package directory
│   │   ├── __init__.py
│   │   ├── main.py           # FastAPI app entry point
│   │   ├── api/              # API endpoint controllers
│   │   ├── config/           # Server configuration
│   │   ├── services/         # Business logic
│   │   └── utils/            # Utility functions
│   └── tests/                # Test directory
│
├── hola_shared/              # Shared modules and utilities
│   ├── pyproject.toml        # Poetry project config
│   ├── poetry.lock           # Lock file for dependencies
│   ├── hola_shared/          # Python package directory
│   │   ├── __init__.py
│   │   ├── models/           # Shared Pydantic models
│   │   ├── errors.py         # Error handling
│   │   └── logger.py         # Logging utilities
│   └── tests/                # Test directory
│
├── hola_client_sdk/          # Client SDK for API communication
│   ├── pyproject.toml        # Poetry project config
│   └── hola_client_sdk/      # Python package directory
│
├── docs/                     # Project documentation
│   ├── DESIGN.md             # This comprehensive technical document
│   └── ...                   # Other documentation files
│
├── integration_tests/        # End-to-end tests
├── .gitignore                # Git ignore file
├── pyproject.toml            # Root Poetry workspace config
└── README.md                 # Project overview and setup instructions
```

## 12. Benefits

- **Clean Separation**: Each component maintains its own space
- **Reliable Upgrades**: Clear distinction between versions
- **Easy Backups**: Well-organized structure for backing up state
- **Flexible Configuration**: Multiple levels of configuration
- **Safe Deployment**: Changes isolated until activation
- **Rollback Support**: Previous state can be restored easily
- **Modular Design**: Poetry workspaces for code sharing between packages

## 13. Implementation Notes

- Use symbolic links where possible to save space
- Implement proper cleanup of old versions
- Maintain careful permissions management
- Consider filesystem performance for large deployments
- Plan for disaster recovery scenarios
- Follow Python best practices (PEP 8) for code style
- Use type hints throughout the codebase
- Use Pydantic models for data validation and serialization
- Prefer async implementations in FastAPI endpoints
- Implement proper error handling with standardized ApiResponse structure

## 14. Open Questions and Future Considerations

1. How should we handle dependencies between services in the configuration?
2. Should we provide templates for common service configurations?
3. How do we manage service-specific volumes and networks?
4. Should we add service-level health checks?
5. How do we handle configuration validation across multiple services?

## 15. Next Steps

1. Complete implementation of package, configuration and deployment managers
2. Add comprehensive test coverage using pytest
3. Document the configuration management feature in the user guide
4. Consider adding configuration validation based on application requirements
5. Implement CLI tools for managing docker-compose.override.yml files
6. Design CLI commands for service-level configuration management
7. Implement service detection from docker-compose files
8. Create examples of multi-service configuration scenarios
9. Expand test coverage with integration tests between CLI and server
10. Implement proper logging and error handling across all components
## 16. Python Implementation Specifics

### Error Handling

The Python implementation uses a standardized error handling approach across all components:

```python
# Base exception type in hola_shared
class HolaError(Exception):
    """Base exception for Hola applications."""
    
    def __init__(
        self, 
        message: str,
        status_code: int = 400,
        error_code: str = "bad_request",
        details: Optional[Dict[str, Any]] = None
    ):
        self.message = message
        self.status_code = status_code
        self.error_code = error_code
        self.details = details or {}
        super().__init__(message)
        
    def to_api_error(self) -> ApiError:
        """Convert to an API error object."""
        return ApiError(
            code=self.error_code,
            message=self.message,
            details=self.details
        )
        
    def to_response(self) -> ApiResponse:
        """Convert to an API response object."""
        return ApiResponse(
            success=False,
            error=self.to_api_error()
        )
```

### Response Format

All API responses use a consistent format defined by the `ApiResponse` class:

```python
class ApiResponse(Generic[T]):
    """Standard API response wrapper.
    
    A consistent response structure for all API endpoints that includes
    a success flag, optional data payload, and optional error information.
    
    Attributes:
        success: Boolean indicating if the request was successful.
        data: Optional data payload for successful requests.
        error: Optional error details for failed requests.
    """
    success: bool
    data: Optional[T] = None
    error: Optional[ApiError] = None
```

### Logging

The Python implementation uses a layered approach to logging:

1. **Base Layer**: Shared logging utilities in `hola_shared.logger`
2. **Component Layer**: Component-specific extensions in both server and client
3. **Usage Layer**: Consistent logging patterns across the codebase

```python
# Example CLI command logging pattern
from ..utils.logging import log_command_start, log_command_success, log_command_error

log_command_start(logger, "command.name", arg1="value1")
try:
    # Command execution
    result = do_something()
    log_command_success(logger, "command.name", result)
except Exception as e:
    log_command_error(logger, "command.name", e)
    raise
```

### Output Formatting

The CLI uses a consistent output formatting utility that supports multiple formats:

```python
def format_output(data: Any, format_type: str = "table") -> Any:
    """
    Format output based on format type.
    
    Args:
        data: The data to format
        format_type: The desired format ("json", "table", or "text")
    
    Returns:
        Formatted output as a string
    """
    if format_type == "json":
        return json.dumps(data, indent=2)
    elif format_type == "table":
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return create_table_from_list(data)
        elif isinstance(data, dict):
            return create_table_from_dict(data)
    # Additional formats and default handling
```

### Testing Best Practices

The Python implementation uses pytest for testing with the following best practices:

1. **Isolated Tests**: Each test is independent and does not rely on state from other tests
2. **Fixture Usage**: Shared setup code is in fixtures
3. **Positive and Negative Tests**: Testing both success and failure paths
4. **Test Focus**: Each test focuses on a single functionality
5. **Clear Assertions**: Assertions clearly indicate what's being tested
6. **Standard Utilities**: Using predefined test helpers for consistency
