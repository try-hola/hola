# Hola

Hola is a modern application deployment platform built with Python. It provides a self-contained server with an intuitive web interface for managing containerized applications, featuring real-time monitoring, configuration management, and streamlined deployment workflows.

## Project Overview

Hola is designed as a single deployable server that provides:

- **Web Interface**: Modern, responsive interface built with HTMX and DaisyUI for interactive application management
- **REST API**: Complete API for programmatic access and automation
- **Container Management**: Docker integration for application deployment and lifecycle management
- **Real-time Updates**: Live status updates and log streaming through Server-Sent Events

## Features

- **Application Lifecycle Management**: Deploy, monitor, start, stop, and delete containerized applications
- **Web-First Interface**: Intuitive web interface with dynamic updates and responsive design
- **File Management**: Upload, organize, and manage application configuration files
- **Backup & Restore**: Automated backup creation and point-in-time restoration
- **Real-Time Monitoring**: Live log streaming, metrics, and application health monitoring
- **Configuration Management**: Environment variables, secrets, and application-specific settings
- **ORAS Package Support**: Deploy applications from OCI Registry packages

## Project Structure

```
project-root/
├── hola/                        # Main application package
│   ├── api/                     # REST API endpoints
│   ├── web/                     # Web interface (HTMX/DaisyUI)
│   │   ├── templates/           # Jinja2 templates
│   │   └── static/              # CSS, JS, and assets
│   ├── services/                # Business logic
│   ├── models/                  # Pydantic data models
│   ├── config/                  # Configuration management
│   └── utils/                   # Utility functions
├── tests/                       # Test suite
├── docs/                        # Project documentation
├── docker/                      # Docker configuration
├── pyproject.toml              # Poetry configuration
└── README.md                   # Project overview
```

## Technical Stack

- **Language**: Python 3.10+
- **Backend Framework**: FastAPI with async/await patterns
- **Frontend**: HTMX for dynamic behavior, DaisyUI for styling
- **Templates**: Jinja2 templating engine
- **Package Management**: Poetry with workspaces
- **Testing Framework**: pytest
- **Type Validation**: Pydantic models throughout
- **Container Platform**: Docker for application deployment
- **Real-time Features**: Server-Sent Events (SSE) for live updates

## Getting Started

### Prerequisites

- Python 3.10+
- Poetry (package manager)
- Docker (for application deployment)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/try-hola/hola.git
   cd hola
   ```
2. Install dependencies:
   ```bash
   poetry install
   ```
3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit the .env file with your configuration
   ```

## Environment Variables

### Server Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `HOLA_HOST` | Server host address | `0.0.0.0` |
| `HOLA_PORT` | Server port | `8000` |
| `HOLA_DEBUG` | Enable debug mode | `false` |
| `HOLA_API_KEY` | API authentication key | (required) |
| `HOLA_CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `*` |
| `HOLA_LOG_LEVEL` | Logging level | `INFO` |
| `HOLA_DATA_DIR` | Data storage directory | `./data` |
| `HOLA_DOCKER_SOCKET` | Docker socket path | (auto-detected) |
| `HOLA_SESSION_SECRET` | Session encryption key | (auto-generated) |
| `HOLA_ADMIN_PASSWORD` | Initial admin password | (required) |

## Quick Start

### Running the Server

1. **Development Mode**:
   ```bash
   poetry run uvicorn hola.main:app --reload
   ```

2. **Production Mode**:
   ```bash
   HOLA_API_KEY=your-secure-key poetry run uvicorn hola.main:app --host 0.0.0.0 --port 8000
   ```

3. **Using Docker**:
   ```bash
   docker build -t hola-server .
   docker run -p 8000:8000 -v ./data:/data hola-server
   ```

### Accessing the Interface

- **Web Interface**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/health

## Development

### Starting the Development Server

```bash
# Run the FastAPI server with auto-reload
poetry run uvicorn hola.main:app --reload --host 0.0.0.0 --port 8000
```

### Building the Project

```bash
# Build the distribution package
poetry build
```

## Web Interface

The web interface provides a complete application management experience:

### Key Features

- **Dashboard**: Overview of all deployed applications with status indicators
- **Application Management**: Deploy, configure, start, stop, and monitor applications
- **File Management**: Upload and manage configuration files and assets
- **Real-time Monitoring**: Live log streaming and metrics display
- **Configuration Editor**: Environment variables and settings management
- **Backup Management**: Create and restore application backups

### Usage Examples

1. **Deploy an Application**:
   - Navigate to "Deploy New App"
   - Enter application name and ORAS package reference
   - Configure environment variables and upload files
   - Click "Deploy" and monitor progress

2. **Monitor Applications**:
   - View application status on the dashboard
   - Click on an application for detailed monitoring
   - Stream logs in real-time
   - View metrics and health status

3. **Manage Configuration**:
   - Edit environment variables through the web interface
   - Upload configuration files with drag-and-drop
   - Manage encrypted secrets securely

## Testing

The project uses pytest for comprehensive testing of both API endpoints and web interface functionality.

### Running Tests

```bash
# Run all tests
poetry run pytest

# Run specific test categories
poetry run pytest tests/api/         # API endpoint tests
poetry run pytest tests/web/         # Web interface tests  
poetry run pytest tests/services/    # Service layer tests

# Run specific test files
poetry run pytest tests/api/test_apps.py

# Run tests with coverage
poetry run pytest --cov=hola

# Run tests in watch mode during development
poetry run pytest-watch tests/
```

### Test Structure

Tests are organized by feature area:

```
tests/
├── api/                    # API endpoint tests
├── web/                    # Web interface tests  
├── services/               # Business logic tests
└── conftest.py            # Test fixtures
```
hola_server/tests/
├── api/                    # API endpoint tests
├── web/                    # Web interface tests  
├── services/               # Business logic tests
└── conftest.py            # Test fixtures
```

### Test Best Practices

Tests follow a consistent structure:

1. Use fakes instead of mocks for better test reliability
2. Organize tests by feature area (API, web interface, services)
3. Write both positive and negative test cases
4. Include integration tests for end-to-end functionality

Example test structure:

```python
# Import fakes first
from hola.test_utils.fakes.app_service import FakeAppService

# Import module under test
from hola.services.app_service import AppService

@pytest.fixture
def fake_app_service():
    service = FakeAppService()
    service.reset()
    return service

def test_deploy_app_successfully(fake_app_service):
    # Test implementation with clear assertions
    result = fake_app_service.deploy("test-app")
    assert result.success is True
    assert len(fake_app_service.deployed_apps) == 1
```

## Architecture

The application uses a layered architecture:

- **Web Layer**: HTMX templates and static assets for the user interface
- **API Layer**: FastAPI endpoints for programmatic access
- **Service Layer**: Business logic for application management
- **Storage Layer**: File-based persistence with Docker integration

Communication flows through well-defined interfaces:
- Web interface uses HTMX for dynamic updates
- API endpoints serve both web interface and external consumers
- Services handle all business logic and Docker operations
- Models ensure consistency across layers

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed information on how to contribute to this project, including our development workflow, testing guidelines, and documentation standards.

## License

This project is licensed under the terms specified in the [LICENSE](LICENSE) file.
