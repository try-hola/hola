# Hola: Application Deployment Platform - Technical Design

## 1. Architecture Overview

Hola is a self-contained application deployment platform built with Python FastAPI and featuring a modern web interface built with HTMX and DaisyUI. The platform provides a complete solution for deploying, managing, and monitoring containerized applications through an intuitive web interface.

### 1.1 Core Architecture

The platform consists of a single deployable server component with two main interfaces:

- **Web UI**: Modern, responsive interface built with HTMX and DaisyUI for interactive application management
- **REST API**: Full-featured API for programmatic access and integration with external tools

### 1.2 Technology Stack

- **Backend**: Python FastAPI with async/await patterns
- **Frontend**: HTMX for dynamic interactions with DaisyUI (Tailwind CSS) for styling
- **Containerization**: Docker for application deployment and management
- **Storage**: File-based storage with configurable backend support
- **Package Management**: ORAS (OCI Registry as Storage) for application package distribution

### 1.3 Deployment Model

The Hola server is designed to be deployed as a single Docker container that provides:

1. **Self-Contained Operation**: All functionality included in one deployable unit
2. **Web-First Interface**: Primary interaction through modern web UI
3. **API Access**: Full REST API for automation and integration
4. **Container Orchestration**: Manages Docker containers on the host system

## 2. Web Interface Design

The web interface is built using HTMX and DaisyUI to provide a modern, responsive experience without complex JavaScript frameworks.

### 2.1 HTMX Integration

HTMX enables dynamic behavior through HTML attributes:

- **hx-get/hx-post**: Fetch content and update page sections
- **hx-trigger**: Define when interactions occur (click, change, etc.)
- **hx-target**: Specify which elements to update
- **hx-swap**: Control how content is replaced
- **hx-indicator**: Show loading states during requests

### 2.2 DaisyUI Components

The interface uses DaisyUI components for consistent styling:

- **Navigation**: Navbar with breadcrumbs and user controls
- **Cards**: Application cards with status indicators
- **Tables**: Data tables with sorting and filtering
- **Forms**: Input forms with validation feedback
- **Modals**: Dialog boxes for confirmations and detailed views
- **Alerts**: Success/error notifications with auto-dismiss

### 2.3 Page Structure

#### Dashboard
- Overview of all deployed applications
- System status and resource usage
- Recent activity feed
- Quick action buttons

#### Application Management
- Application list with search and filtering
- Individual application detail pages
- Deployment wizard for new applications
- Configuration editor with live preview

#### System Configuration
- Global settings management
- Environment variable configuration
- File upload interface
- Backup management

### 2.4 Real-Time Updates

Using HTMX with Server-Sent Events (SSE):

- **Deployment Progress**: Live updates during application deployment
- **Log Streaming**: Real-time log viewing with auto-scroll
- **Status Changes**: Automatic refresh of application status
- **Notifications**: System alerts and status messages

## 3. API Design Principles

The server provides both web interface routes and API endpoints, designed to work seamlessly with HTMX's dynamic behavior patterns.

### 3.1 Endpoint Design Philosophy

**HTMX-First Approach**: Endpoints are designed to serve both HTML fragments for HTMX requests and JSON for programmatic access:

```python
@router.get("/apps")
async def apps_handler(request: Request):
    apps = await get_applications()
    
    # Return HTML fragment for HTMX requests
    if "HX-Request" in request.headers:
        return templates.TemplateResponse("fragments/app_list.html", {
            "request": request, "apps": apps
        })
    
    # Return JSON for API consumers
    return {"success": True, "data": apps}
```

**Content Negotiation**: Endpoints automatically detect request type and respond appropriately:
- HTMX requests receive HTML fragments
- API requests receive JSON responses
- Form submissions can return either based on context

### 3.2 Core Endpoint Categories

Rather than defining specific endpoints upfront, we'll implement them as needed within these categories:

**Application Management**
- Deploy, manage, and monitor applications
- Handle both form submissions and API calls
- Return appropriate HTML fragments or JSON responses

**Configuration Management**
- System and application-level configuration
- Environment variables and secrets
- File uploads and management

**Real-time Features**
- Server-Sent Events for live updates
- Log streaming and status monitoring
- Progress updates during operations

**System Operations**
- Health checks and system status
- Backup and restore operations
- User authentication and session management

### 3.3 Response Patterns

**HTML Fragments for HTMX**:
```html
<!-- App status card that can be swapped in -->
<div id="app-status-{app_name}" class="card bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">
      {app_name}
      <div class="badge badge-{status_color}">{status}</div>
    </h2>
  </div>
</div>
```

**JSON for API Access**:
```json
{
  "success": true,
  "data": {
    "name": "myapp",
    "status": "running",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

### 3.4 Error Handling

Errors are handled contextually based on request type:
- **HTMX requests**: Return error HTML fragments with user-friendly messages
- **API requests**: Return structured JSON error responses
- **Form submissions**: Show inline validation errors or success messages

## 4. Web Interface Implementation

### 4.1 HTMX-Driven Development

Rather than designing all features upfront, we'll implement them iteratively using HTMX patterns:

**Progressive Enhancement**: Start with working HTML forms, then enhance with HTMX for dynamic behavior:

```html
<!-- Base form that works without JavaScript -->
<form action="/apps/deploy" method="post">
  <input name="app_name" required>
  <button type="submit">Deploy</button>
</form>

<!-- Enhanced with HTMX for dynamic updates -->
<form hx-post="/apps/deploy" hx-target="#result" hx-indicator="#spinner">
  <input name="app_name" required>
  <button type="submit">Deploy</button>
  <div id="spinner" class="loading htmx-indicator"></div>
</form>
<div id="result"></div>
```

**Feature-Specific Endpoints**: Create endpoints as needed for each feature, optimized for HTMX:

```python
@router.post("/apps/deploy")
async def deploy_app(request: Request, app_name: str = Form(...)):
    try:
        result = await deploy_application(app_name)
        
        if "HX-Request" in request.headers:
            return templates.TemplateResponse("fragments/deploy_success.html", {
                "request": request, "app": result
            })
        
        return {"success": True, "data": result}
        
    except Exception as e:
        if "HX-Request" in request.headers:
            return templates.TemplateResponse("fragments/deploy_error.html", {
                "request": request, "error": str(e)
            }, status_code=400)
        
        return {"success": False, "error": str(e)}
```

### 4.2 Component-Based Templates

Build reusable HTML components that can be swapped in and out:

**Application Card Component**:
```html
<!-- templates/components/app_card.html -->
<div id="app-{{ app.name }}" class="card bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">
      {{ app.name }}
      <div class="badge badge-{{ app.status_color }}">{{ app.status }}</div>
    </h2>
    <div class="card-actions justify-end">
      <button class="btn btn-primary" 
              hx-get="/apps/{{ app.name }}/manage" 
              hx-target="#main-content">
        Manage
      </button>
    </div>
  </div>
</div>
```

**Dynamic Lists**:
```html
<!-- templates/fragments/app_list.html -->
<div id="app-list" hx-get="/apps/refresh" hx-trigger="every 30s">
  {% for app in apps %}
    {% include "components/app_card.html" %}
  {% endfor %}
</div>
```

### 4.3 Real-Time Features with Server-Sent Events

Implement live updates using HTMX's SSE support:

```html
<!-- Live deployment progress -->
<div hx-sse="connect:/events/deploy/{{ deployment_id }}">
  <div hx-sse="swap:progress" hx-swap="innerHTML">
    <div class="progress w-56">
      <div class="progress-bar" style="width: 0%"></div>
    </div>
  </div>
  <div hx-sse="swap:logs" hx-swap="beforeend" id="deployment-logs">
    <!-- Log entries appear here -->
  </div>
</div>
```

### 4.4 Form Handling and Validation

Create forms that provide immediate feedback:

```html
<!-- Configuration form with live validation -->
<form hx-post="/config/app/{{ app_name }}" hx-target="#config-result">
  <div class="form-control">
    <label class="label">
      <span class="label-text">Environment Variable</span>
    </label>
    <input type="text" name="key" placeholder="KEY_NAME" 
           class="input input-bordered"
           hx-trigger="blur"
           hx-get="/config/validate"
           hx-target="#key-validation">
    <div id="key-validation"></div>
  </div>
  
  <div class="form-control">
    <label class="label">
      <span class="label-text">Value</span>
    </label>
    <input type="text" name="value" placeholder="value" 
           class="input input-bordered">
  </div>
  
  <button type="submit" class="btn btn-primary">Save</button>
</form>
<div id="config-result"></div>
```

The web interface provides comprehensive error handling and user feedback:

### 5.1 Error Categories and Responses

| Error Type     | Description              | Interface Response                                      |
| -------------- | ------------------------ | ------------------------------------------------------ |
| Connection     | Network connectivity issues | Toast notifications with retry options                |
| Authentication | Invalid credentials       | Clear login prompts with instructions                 |
| Validation     | Invalid input parameters  | Inline field validation with specific guidance       |
| Resource       | Resource not found        | Contextual suggestions and navigation options        |
| Permission     | Insufficient permissions  | Clear explanations with escalation paths            |
| Server         | Internal server errors    | Friendly error pages with support contact information |

### 5.2 User Feedback Mechanisms

- **Toast Notifications**: Non-intrusive success/error messages with auto-dismiss
- **Progress Indicators**: Loading spinners and progress bars for long operations
- **Color Coding**: Visual status indicators (green for success, red for errors, yellow for warnings)
- **Real-time Status**: Live updates of application and system status
- **Form Validation**: Immediate feedback on form inputs with helpful error messages
- **Contextual Help**: Tooltips and help text throughout the interface

### 5.3 Accessibility Features

- **Keyboard Navigation**: Full keyboard accessibility for all interface elements
- **Screen Reader Support**: Proper ARIA labels and semantic HTML structure
- **High Contrast**: Support for high contrast themes and color accessibility
- **Focus Management**: Clear focus indicators and logical tab order
- **Responsive Design**: Mobile-friendly interface that works on all devices

## 6. Security

- **Authentication**: Web-based login with session management and API key support for programmatic access
- **Authorization**: Role-based access control with configurable permissions
- **Configuration Security**: Support for encrypting sensitive configuration values at rest
- **Encrypted Values**: Masked in web interface and stored separately from regular configuration
- **Session Security**: Secure session handling with CSRF protection and secure cookies
- **Container Isolation**: Applications run in isolated Docker containers with resource limits

### 6.1 Web Authentication Flow

The web interface uses a multi-layered authentication approach:

1. **Session-Based Authentication**:
   - Web users authenticate through a login form
   - Server maintains secure sessions with HTTP-only cookies
   - Automatic session renewal for active users
   - Secure logout with session cleanup

2. **API Key Authentication**:
   - Programmatic access via API keys in Authorization headers
   - Multiple API keys per user with different permissions
   - Key rotation support through the web interface
   - Automatic key expiration and renewal

3. **Multi-Factor Authentication** (Optional):
   - TOTP-based 2FA for enhanced security
   - Backup codes for account recovery
   - Configurable enforcement policies

### 6.2 Access Control

- **Role-Based Permissions**: Admin, Developer, and Viewer roles with granular permissions
- **Application-Level Access**: Users can be granted access to specific applications
- **Resource Quotas**: Configurable limits on resources per user/application
- **Audit Logging**: Comprehensive logging of all user actions and system changes

## 7. Storage Structure

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
├── hola/                     # Main application package
│   ├── __init__.py
│   ├── main.py              # FastAPI app entry point
│   ├── api/                 # API endpoint controllers
│   ├── web/                 # Web interface (HTMX templates)
│   │   ├── templates/       # Jinja2 templates
│   │   ├── static/          # Static assets (CSS, JS, images)
│   │   └── routes.py        # Web interface routes
│   ├── services/            # Business logic services
│   ├── models/              # Pydantic data models
│   ├── config/              # Configuration management
│   └── utils/               # Utility functions
├── tests/                   # Test directory
│   ├── api/                 # API endpoint tests
│   ├── web/                 # Web interface tests
│   ├── services/            # Service layer tests
│   └── conftest.py          # Test fixtures
├── docs/                    # Project documentation
│   ├── DESIGN.md            # This technical design document
│   ├── API.md               # API documentation
│   └── DEPLOYMENT.md        # Deployment guide
├── docker/                  # Docker configuration
│   ├── Dockerfile          # Main application container
│   ├── docker-compose.yml  # Development environment
│   └── nginx.conf          # Reverse proxy configuration
├── pyproject.toml           # Poetry project configuration
├── poetry.lock              # Dependency lock file
├── .gitignore               # Git ignore file
└── README.md                # Project overview and setup instructions
```

## 12. Benefits

- **Simplified Architecture**: Single module with clear separation of concerns
- **Modern UI**: HTMX and DaisyUI provide responsive, interactive experience
- **Unified Development**: All code in one place, easier to develop and maintain
- **Clean Structure**: Well-organized directories for different concerns
- **Reliable Deployments**: Structured approach to application management
- **Easy Backups**: Comprehensive backup and restore functionality
- **Flexible Configuration**: Multiple levels of configuration management
- **Safe Operations**: Changes isolated until activation
- **Container Security**: Applications run in isolated Docker environments
- **Real-time Updates**: Live status updates and log streaming

## 13. Implementation Notes

- **FastAPI Backend**: Async/await patterns for optimal performance
- **HTMX Frontend**: Dynamic interactions without complex JavaScript frameworks
- **DaisyUI Styling**: Consistent, accessible design system
- **Container Management**: Docker API integration for application lifecycle
- **File-based Storage**: Simple, reliable persistence layer
- **Type Safety**: Pydantic models throughout the application
- **Comprehensive Testing**: Unit, integration, and end-to-end test coverage
- **Security First**: Authentication, authorization, and secure defaults
- **Monitoring**: Built-in application and system monitoring
- **Single Module**: All functionality in one cohesive Python package

## 14. Technology Integration

### 14.1 HTMX Implementation

The web interface leverages HTMX for dynamic behavior:

```html
<!-- Example: Dynamic application list with real-time updates -->
<div id="app-list" hx-get="/api/apps" hx-trigger="load, every 30s" hx-target="#app-list">
  <!-- Application cards are loaded and updated automatically -->
</div>

<!-- Example: Deploy application form with progress updates -->
<form hx-post="/api/apps/deploy" hx-target="#deploy-status" hx-indicator="#deploy-spinner">
  <input name="app_name" placeholder="Application Name" required>
  <button type="submit">Deploy</button>
  <div id="deploy-spinner" class="loading loading-spinner htmx-indicator"></div>
</form>
```

### 14.2 DaisyUI Components

Utilizing DaisyUI's component library for consistent styling:

```html
<!-- Application status card -->
<div class="card bg-base-100 shadow-xl">
  <div class="card-body">
    <h2 class="card-title">
      My Application
      <div class="badge badge-success">Running</div>
    </h2>
    <p>Application description and status information</p>
    <div class="card-actions justify-end">
      <button class="btn btn-primary">Manage</button>
      <button class="btn btn-outline">Logs</button>
    </div>
  </div>
</div>
```

### 14.3 Server-Sent Events Integration

Real-time updates using SSE with HTMX:

```html
<!-- Live log streaming -->
<div hx-sse="connect:/api/apps/myapp/events">
  <div hx-sse="swap:logs" hx-swap="beforeend" id="log-container">
    <!-- Log entries are appended here in real-time -->
  </div>
</div>
```

## 15. Next Steps

1. Implement core FastAPI application structure
2. Create HTMX templates for web interface
3. Integrate DaisyUI styling and components
4. Develop application deployment pipeline
5. Add real-time monitoring and logging
6. Implement user authentication and authorization
7. Create comprehensive test suite
8. Develop Docker deployment configuration
9. Document API endpoints and web interface
10. Optimize performance and security

