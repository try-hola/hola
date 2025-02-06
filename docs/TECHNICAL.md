# Technical Documentation

## 1. Architecture Overview

CLI Component: Handles user commands, communicates with the server, and processes responses.
Server-Side Component: Manages application deployments, configurations, and file storage. Handles long-running tasks with SSE for updates.

## 2. API Endpoints

### Configuration Management

| HTTP Method | Endpoint          | Description                                        |
| ----------- | ----------------- | -------------------------------------------------- |
| GET         | /config           | Retrieve system-wide configuration.                |
| GET         | /config/{appName} | Retrieve configuration for a specific application. |
| POST        | /config/{appName} | Create or update an application’s configuration.   |
| DELETE      | /config/{appName} | Remove an application-specific configuration.      |

### Application Deployment & Management

| HTTP Method | Endpoint              | Description                                              |
| ----------- | --------------------- | -------------------------------------------------------- |
| POST        | /apps                 | Deploy a new application.                                |
| GET         | /apps                 | List all deployed applications.                          |
| GET         | /apps/{appName}       | Get details about a deployed application.                |
| PUT         | /apps/{appName}       | Upgrade an application (with backup handled internally). |
| DELETE      | /apps/{appName}       | Remove a deployed application.                           |
| POST        | /apps/{appName}/start | Start an application.                                    |
| POST        | /apps/{appName}/stop  | Stop an application.                                     |

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
| GET         | /apps/{appName}/backup             | Retrieve backup details for an application. |
| POST        | /apps/{appName}/restore/{backupId} | Restore an application from a backup.       |

### Repository & Versions

| HTTP Method | Endpoint                           | Description                                |
| ----------- | ---------------------------------- | ------------------------------------------ |
| GET         | /apps/{appName}/versions           | List available versions of an application. |
| GET         | /apps/{appName}/versions/{version} | Get details about a specific version.      |

### Real-Time Updates (Using SSE)

| HTTP Method | Endpoint               | Description                                                      |
| ----------- | ---------------------- | ---------------------------------------------------------------- |
| GET         | /apps/{appName}/events | Streams logs/status updates for deployment or upgrade processes. |

## 3. Communication Protocols

REST APIs: CLI sends requests and receives responses for standard operations.
SSE: Provides real-time updates from the server to the CLI for long-running tasks.

## 4. Project Directory

```
project-root/
│
├── cli/                    # Go CLI code
│   ├── main.go             # Entry point for the Go application
│   ├── commands/            # Go commands for CLI
│   └── ...
│
├── server/                  # Node.js server code
│   ├── index.js          # Entry point for the Node.js server
│   ├── routes/              # API routes
│   └── ...
│
├── config/                  # Shared configuration files
│   └── ...
│
├── docs/                    # Documentation
│   ├── user-guide.md
│   ├── technical-doc.md
│   └── ...
│
└── README.md              # Project overview and setup instructions
```
