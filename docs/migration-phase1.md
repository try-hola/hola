## Phase 1: Infrastructure and Foundation (4 weeks)

### Project Setup and Core Infrastructure

1. **Monorepo Setup with Poetry**:
   ```toml
   # Root pyproject.toml
   [tool.poetry]
   name = "hola"
   version = "0.1.0"
   description = "Hola application management platform"
   
   [tool.poetry.dependencies]
   python = "^3.10"
   
   [tool.poetry.group.dev.dependencies]
   pytest = "^7.3.1"
   
   [build-system]
   requires = ["poetry-core>=1.0.0"]
   build-backend = "poetry.core.masonry.api"
   
   [tool.poetry.workspace]
   members = ["hola_server", "hola_cli", "hola_shared", "hola_client_sdk"]
   ```

2. **Basic Shared Models**:
   ```python
   # hola_shared/hola_shared/models/response.py
   from pydantic import BaseModel
   from typing import Optional, Generic, TypeVar, Dict, Any
   
   T = TypeVar('T')
   
   class ApiError(BaseModel):
       code: str
       message: str
       details: Optional[Dict[str, Any]] = None
   
   class ApiResponse(BaseModel, Generic[T]):
       success: bool
       data: Optional[T] = None
       error: Optional[ApiError] = None
   ```

3. **Server Foundation**:
   ```python
   # hola_server/hola_server/config.py
    from pydantic import BaseSettings
    from typing import List
    from functools import lru_cache

    class Settings(BaseSettings):
        api_key: str = ""
        cors_origins: List[str] = ["*"]
        log_level: str = "INFO"
        
        class Config:
            env_prefix = "HOLA_"
            env_file = ".env"

    @lru_cache()
    def get_settings() -> Settings:
        """Return cached settings instance."""
        return Settings()

   # hola_server/hola_server/main.py
   from fastapi import FastAPI
   from fastapi.middleware.cors import CORSMiddleware
   from .config import get_settings
   
   app = FastAPI(
       title="Hola API",
       description="API server for Hola application management",
       version="1.0.0"
   )
   
   # Configure CORS middleware
   app.add_middleware(
       CORSMiddleware,
       allow_origins=get_settings().cors_origins,
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```

4. **Authentication System**:  (HOLD AUTH UNTIL A LATER PHASE)
   ```python
   # hola_server/hola_server/auth.py
   from fastapi import Depends, HTTPException, Security
   from fastapi.security import APIKeyHeader
   from starlette.status import HTTP_403_FORBIDDEN
   from .config import get_settings
   
   api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
   
   async def get_api_key(api_key: str = Security(api_key_header)):
       if api_key == get_settings().api_key:
           return api_key
       raise HTTPException(
           status_code=HTTP_403_FORBIDDEN, detail="Invalid API Key"
       )
   ```

5. **CLI Foundation**:
   ```python
   # hola_cli/hola_cli/config/settings.py
   """
   CLI settings management for Hola.
   Handles loading, saving, and accessing user settings.
   """
   import os
   import json
   from pathlib import Path
   from typing import Dict, Optional
   from pydantic import BaseModel
   from functools import lru_cache

   class ServerConnection(BaseModel):
       """Server connection details for API communication."""
       url: str
       api_key: str

   class CliSettings(BaseModel):
       """CLI settings model for Hola."""
       servers: Dict[str, ServerConnection] = {}
       default_server: Optional[str] = None
       editor: Optional[str] = None
       output_format: str = "table"
       log_level: str = "INFO"

   def get_config_dir() -> Path:
       """
       Get the configuration directory for Hola CLI.
       Creates the directory if it doesn't exist.
       
       Returns:
           Path to the configuration directory
       """
       # Use XDG_CONFIG_HOME if set, otherwise use ~/.config
       xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
       if xdg_config_home:
           config_dir = Path(xdg_config_home) / "hola"
       else:
           config_dir = Path.home() / ".config" / "hola"
           
       # Create directory if it doesn't exist
       config_dir.mkdir(parents=True, exist_ok=True)
       
       return config_dir

   def get_settings_path() -> Path:
       """
       Get the path to the settings file.
       
       Returns:
           Path to the settings file
       """
       return get_config_dir() / "settings.json"

   def load_settings(check_legacy: bool = True) -> CliSettings:
       """
       Load settings from the configuration file.
       If the file doesn't exist, check for legacy config and migrate if available.
       If no config exists, return default settings.
       
       Args:
           check_legacy: Whether to check for and migrate legacy config
           
       Returns:
           CliSettings object with user configuration
       """
       settings_path = get_settings_path()
       
       # If settings file exists, load it
       if settings_path.exists():
           try:
               with open(settings_path, "r") as f:
                   data = json.load(f)
               return CliSettings.parse_obj(data)
           except (json.JSONDecodeError, ValueError) as e:
               print(f"Error loading settings: {e}")
               # Fall back to default settings if file is invalid
               return CliSettings()
       
       # If no settings file but check_legacy is True, try to migrate
       if check_legacy:
           try:
               # Import here to avoid circular imports
               from ..utils.migration import migrate_legacy_config
               migrated_settings = migrate_legacy_config()
               
               if migrated_settings:
                   # Save the migrated settings
                   save_settings(migrated_settings)
                   return migrated_settings
           except ImportError:
               # If migration module not available, continue with default settings
               pass
       
       # Return default settings if no config exists
       return CliSettings()

   @lru_cache()
   def get_settings() -> CliSettings:
       """
       Get the current settings, cached for performance.
       
       Returns:
           Current CLI settings
       """
       return load_settings()

   def save_settings(settings: CliSettings) -> None:
       """
       Save settings to the configuration file.
       
       Args:
           settings: CliSettings object to save
       """
       settings_path = get_settings_path()
       
       with open(settings_path, "w") as f:
           json.dump(settings.dict(), f, indent=2)
           
   # hola_cli/hola_cli/utils/version.py
   """Version utility functions for Hola CLI."""
   import importlib.metadata
   from functools import lru_cache

   @lru_cache()
   def get_cli_version() -> str:
       """Return the CLI version from package metadata."""
       try:
           return importlib.metadata.version("hola_cli")
       except importlib.metadata.PackageNotFoundError:
           return "0.1.0-dev"  # Default during development

   # hola_cli/hola_cli/main.py
   import typer
   from rich.console import Console
   from .utils.version import get_cli_version
   
   app = typer.Typer(
       name="hola",
       help="Hola CLI for managing applications",
       add_completion=True,
   )
   
   console = Console()
   
   @app.callback()
   def callback():
       """
       Hola CLI for managing applications.
       """
       pass
   
   @app.command("version")
   def version():
       """Show the CLI version."""
       console.print(f"Hola CLI version: {get_cli_version()}")
   
   if __name__ == "__main__":
       app()
   ```

6. **Output Formatting Framework (Strategy Pattern)**:
   ```python
   # hola_cli/hola_cli/utils/formatting.py
   """
   Output formatting utilities for Hola CLI.
   
   This module implements the Strategy Pattern for formatting output in various
   formats such as tables, JSON, and plain text, providing a consistent user
   experience and easy extensibility for new output formats.
   """
   from typing import Any, List, Dict, Protocol, Dict, Type
   import json
   from rich.table import Table
   from rich.console import Console
   
   console = Console()
   
   class OutputFormatter(Protocol):
       """Protocol defining the interface for output formatters."""
       
       @staticmethod
       def format(data: Any) -> Any:
           """
           Format data in a specific way.
           
           Args:
               data: The data to format
               
           Returns:
               Formatted output
           """
           ...
   
   class JsonFormatter:
       """JSON output formatter strategy."""
       
       @staticmethod
       def format(data: Any) -> str:
           """Format data as JSON."""
           return json.dumps(data, indent=2)
   
   class TableFormatter:
       """Table output formatter strategy."""
       
       @staticmethod
       def format(data: Any) -> Any:
           """Format data as a table."""
           if isinstance(data, list) and data and isinstance(data[0], dict):
               return create_table_from_list(data)
           elif isinstance(data, dict):
               return create_table_from_dict(data)
           else:
               return str(data)
   
   class TextFormatter:
       """Plain text output formatter strategy."""
       
       @staticmethod
       def format(data: Any) -> str:
           """Format data as plain text."""
           return str(data)
   
   # Registry of available formatters
   FORMATTERS: Dict[str, Type[OutputFormatter]] = {
       "json": JsonFormatter,
       "table": TableFormatter,
       "text": TextFormatter,
   }
   
   def format_output(data: Any, format_type: str = "table") -> Any:
       """
       Format output using the appropriate formatter strategy.
       
       Args:
           data: The data to format
           format_type: The desired format (key in FORMATTERS registry)
       
       Returns:
           Formatted output
       """
       formatter = FORMATTERS.get(format_type, TextFormatter)
       return formatter.format(data)
   
   # Helper functions for table formatting
   def create_table_from_list(data: List[Dict[str, Any]]) -> Table:
       """Create a Rich table from a list of dictionaries."""
       # ... existing implementation ...
       
   def create_table_from_dict(data: Dict[str, Any]) -> Table:
       """Create a Rich table from a dictionary."""
       # ... existing implementation ...
   ```

### Tracer Bullet Implementation

To validate the end-to-end architecture, we'll implement a simple "Hello" feature:

1. **"Hello" API Endpoint**:
   ```python
   # hola_server/hola_server/api/hello.py
   from fastapi import APIRouter, Depends
   from hola_shared.models.response import ApiResponse
   from ..auth import get_api_key
   
   router = APIRouter()
   
   @router.get("/", response_model=ApiResponse[str])
   async def hello(name: str = "World", api_key: str = Depends(get_api_key)):
       """Simple hello endpoint to verify API functionality."""
       return ApiResponse(success=True, data=f"Hello, {name}!")
   
   # In hola_server/hola_server/main.py, add:
   from .api import hello
   # ...existing routers...
   app.include_router(hello.router, prefix="/hello", tags=["hello"])
   ```

2. **Generated API Client**:
   ```bash
   # First export OpenAPI schema from FastAPI
   # This will be automatically available at http://localhost:8000/openapi.json
   
   # Then generate Python client using openapi-python-client
   poetry run openapi-python-client generate --url http://localhost:8000/openapi.json --output hola_client_sdk
   
   # This will automatically generate the hello endpoint client
   # in hola_client_sdk/hola_client_sdk/api/hello.py
   # No manual coding required!
   ```

3. **"Hello" CLI Command**:
   ```python
   # hola_cli/hola_cli/commands/hello.py
   import typer
   from rich.console import Console
   from ..services.hello_service import HelloService
   from ..config.context import get_current_server
   from ..utils.formatting import format_output
   
   hello_commands = typer.Typer(help="Hello commands for testing connectivity")
   console = Console()
   
   @hello_commands.command("greet")
   def greet(
       name: str = typer.Argument("World", help="Name to greet"),
       output: str = typer.Option("text", "--output", "-o", help="Output format (text, json)"),
       server: str = typer.Option(None, "--server", "-s", help="Target server"),
   ):
       """Send a greeting to the API and get response."""
       try:
           # Get server context
           server_context = get_current_server(server)
           
           # Call API via service
           service = HelloService(server_context)
           result = service.hello(name)
           
           # Format output
           formatted = format_output(result.data, output)
           console.print(formatted)
       except Exception as e:
           console.print(f"[bold red]Error:[/] {str(e)}")
           raise typer.Exit(code=1)
           
   # In hola_cli/hola_cli/main.py, add:
   from .commands import hello
   # ...existing commands...
   app.add_typer(hello.hello_commands, name="hello")
   ```

4. **"Hello" Service**:
   ```python
   # hola_cli/hola_cli/services/hello_service.py
   from typing import Optional
   from hola_client_sdk.api.hello import hello
   from hola_shared.models.response import ApiResponse
   from ..config.context import ServerContext
   
   class HelloService:
       def __init__(self, server_context: ServerContext):
           self.server_context = server_context
           
       def hello(self, name: str = "World") -> ApiResponse[str]:
           """Say hello via the API."""
           with self.server_context.create_client() as client:
               # Use the auto-generated client
               return hello.sync_detailed(client=client, name=name)
   ```

## Additional Phase 1 Requirements

### 1. Shared Package Documentation

The hola_shared package needs improved documentation following Python standards. While the basic models are defined, proper docstrings should be added to follow PEP 257.

### 2. Test Infrastructure Setup

Our tests follow a well-organized structure across all workspaces, with proper package initialization:

```python
# hola_shared/tests/__init__.py
"""Test package for hola_shared.

This package contains the test suite for the hola_shared library, which provides
common models and utilities shared between the server and client components.

The testing approach follows the project's overall testing strategy:
- Using pytest as the test framework
- Preferring fakes over mocks for testing external dependencies
- Using fixtures to provide standardized test objects
- Organizing tests by feature area with dedicated test files
"""

# hola_server/tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from hola_server.main import app

@pytest.fixture
def client():
    """Return a FastAPI test client for the application."""
    return TestClient(app)

# hola_cli/tests/conftest.py 
import pytest
from unittest.mock import patch
from rich.console import Console
from io import StringIO
from hola_cli.config.settings import CliSettings, ServerConnection

@pytest.fixture
def fake_settings():
    """Return test CLI settings."""
    return CliSettings(
        servers={"test": ServerConnection(url="http://test", api_key="test-key")},
        default_server="test",
        output_format="table"
    )

@pytest.fixture
def captured_output():
    """Fixture to capture console output for testing."""
    string_io = StringIO()
    console = Console(file=string_io, highlight=False)
    yield console, string_io
```

The test directory structure follows a consistent pattern across all workspaces:

```
hola/
├── hola_shared/tests/      # Tests for shared models and utilities
│   ├── models/             # Tests for models
│   └── fakes/              # Shared fake implementations
│
├── hola_server/tests/      # Tests for the server application
│   ├── api/                # API endpoint tests
│   └── fakes/              # Server-specific fake implementations
│
└── hola_cli/tests/         # Tests for the CLI application
    ├── commands/           # CLI command tests
    ├── services/           # Service tests
    ├── utils/              # Utility tests
    └── fakes/              # CLI-specific fake implementations
```

Tests can be run using consistent commands across all workspaces:

```bash
# Run tests for a specific workspace from the project root
poetry run pytest hola_server/tests/
poetry run pytest hola_cli/tests/
poetry run pytest hola_shared/tests/

# Run specific test files from the project root
poetry run pytest hola_server/tests/api/test_hello.py
poetry run pytest hola_cli/tests/commands/test_hello.py

# Run tests with coverage from the project root
poetry run pytest --cov=hola_server --cov=hola_cli --cov=hola_shared
```

### Running Tests

To run tests for a specific package, use the following commands from the root directory:

```bash
poetry run pytest hola_shared/tests/  # Run tests for the shared package
poetry run pytest hola_server/tests/  # Run tests for the server package
poetry run pytest hola_cli/tests/     # Run tests for the CLI package
```

**Note**: Running all tests at once using `poetry run pytest` is currently not supported due to conflicts between `conftest.py` files in different packages.

### 4. Server Context Implementation

The plan references `get_current_server()` but doesn't fully define the server context implementation:

```python
# hola_cli/hola_cli/config/context.py
"""Server context management for API communication."""
from typing import Optional
from contextlib import contextmanager
from hola_client_sdk.client import Client
from ..config.settings import load_settings, CliSettings
from hola_shared.models.response import ApiError

class ServerContext:
    """Context for connecting to a specific server instance."""
    
    def __init__(self, url: str, api_key: str, name: str = "default"):
        """
        Initialize a server context.
        
        Args:
            url: Server URL
            api_key: API key for authentication
            name: Server name for reference
        """
        self.url = url
        self.api_key = api_key
        self.name = name
        
    @contextmanager
    def create_client(self):
        """Create and yield an API client for this server."""
        client = Client(base_url=self.url, headers={"X-API-Key": self.api_key})
        try:
            yield client
        finally:
            # No need to close the client, it's managed by the contextmanager
            pass

def get_current_server(server_name: Optional[str] = None) -> ServerContext:
    """
    Get a server context for the specified or default server.
    
    Args:
        server_name: Optional name of the server to use
        
    Returns:
        ServerContext for API communication
        
    Raises:
        ApiError: If server not found or misconfigured
    """
    settings = load_settings()
    
    # Use specified server or default
    name = server_name or settings.default_server
    
    if not name:
        raise ApiError(
            code="NO_DEFAULT_SERVER",
            message="No default server configured. Use --server or run 'hola server add'."
        )
    
    if name not in settings.servers:
        raise ApiError(
            code="SERVER_NOT_FOUND",
            message=f"Server '{name}' not found. Available servers: {', '.join(settings.servers.keys())}"
        )
    
    server = settings.servers[name]
    return ServerContext(url=server.url, api_key=server.api_key, name=name)
```

### 5. Add Environment Variable Support

Ensure proper environment variable support for both server and client:

```python
# hola_server/.env.example
HOLA_API_KEY=your-api-key-here
HOLA_CORS_ORIGINS=http://localhost:3000,http://localhost:8000
HOLA_LOG_LEVEL=INFO
HOLA_PORT=8000
HOLA_HOST=0.0.0.0
```

### 6. Logging Configuration

Add proper logging configuration for both server and client:

```python
# hola_server/hola_server/logger.py
import logging
import sys
from typing import Dict, Any
from .config import get_settings

def configure_logging(level: str = None) -> None:
    """
    Configure logging for the application.
    
    Args:
        level: Log level override (defaults to config setting)
    """
    log_level = level or get_settings().log_level
    
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )

# Similar implementation for CLI
```

### 7. Error Handling Framework

Add a consistent error handling framework:

```python
# hola_shared/hola_shared/errors.py
"""Error handling utilities for Hola applications."""
from typing import Dict, Any, Optional
from .models.response import ApiError, ApiResponse

class HolaError(Exception):
    """Base exception for Hola applications."""
    
    def __init__(
        self, 
        code: str, 
        message: str, 
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 400
    ):
        """
        Initialize a Hola error.
        
        Args:
            code: Error code
            message: Error message
            details: Additional error details
            status_code: HTTP status code
        """
        self.code = code
        self.message = message
        self.details = details or {}
        self.status_code = status_code
        super().__init__(message)
        
    def to_api_error(self) -> ApiError:
        """Convert to an API error object."""
        return ApiError(
            code=self.code,
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

### 8. Provider Pattern Implementation

Implement the Provider Pattern using Python's Protocol typing for greater extensibility:

```python
# hola_shared/hola_shared/providers/base.py
"""Base provider protocol definitions for server providers."""
from typing import Protocol, Dict, Any, List, Optional, AsyncIterator

class ServerProvider(Protocol):
    """Protocol defining the interface for server providers."""
    
    type: str  # Provider type identifier
    display_name: str  # User-friendly display name
    
    async def is_available(self) -> bool:
        """
        Check if this provider is available on the current system.
        
        Returns:
            True if provider is available, False otherwise
        """
        ...
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """
        Bootstrap a new server instance.
        
        Args:
            options: Provider-specific options for bootstrapping
            
        Returns:
            Provider-specific context data for the new server
        """
        ...
    
    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get information about a server instance.
        
        Args:
            context: Provider-specific context for the server
            
        Returns:
            Server information including status
        """
        ...
    
    async def start_server(self, context: Dict[str, Any]) -> None:
        """
        Start a server instance.
        
        Args:
            context: Provider-specific context for the server
        """
        ...
    
    async def stop_server(self, context: Dict[str, Any]) -> None:
        """
        Stop a server instance.
        
        Args:
            context: Provider-specific context for the server
        """
        ...

# hola_server/hola_server/providers/registry.py
"""Registry for server providers."""
from typing import Dict, List, Type, Optional
from hola_shared.providers.base import ServerProvider

class ServerProviderRegistry:
    """Registry for available server providers."""
    
    def __init__(self):
        """Initialize an empty provider registry."""
        self.providers: Dict[str, ServerProvider] = {}
    
    def register_provider(self, provider: ServerProvider) -> None:
        """
        Register a provider with the registry.
        
        Args:
            provider: Server provider implementation
        """
        self.providers[provider.type] = provider
    
    async def get_available_providers(self) -> List[ServerProvider]:
        """
        Get all providers that are available on the current system.
        
        Returns:
            List of available provider implementations
        """
        available_providers = []
        
        for provider in self.providers.values():
            if await provider.is_available():
                available_providers.append(provider)
        
        return available_providers
    
    def get_provider(self, provider_type: str) -> Optional[ServerProvider]:
        """
        Get a specific provider by type.
        
        Args:
            provider_type: Provider type identifier
            
        Returns:
            Provider implementation or None if not found
        """
        return self.providers.get(provider_type)

# Example provider implementation:
# hola_server/hola_server/providers/orbstack.py
import asyncio
import subprocess
from typing import Dict, Any
from hola_shared.providers.base import ServerProvider

class OrbStackProvider:
    """OrbStack provider implementation."""
    
    type = "orbstack"
    display_name = "OrbStack"
    
    async def is_available(self) -> bool:
        """Check if OrbStack is installed and accessible."""
        try:
            process = await asyncio.create_subprocess_exec(
                "orb", "version",
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, _ = await process.communicate()
            return b"OrbStack" in stdout
        except Exception:
            return False
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Bootstrap a new Hola server on OrbStack."""
        # Implementation specific to OrbStack
        return {"provider": self.type, "status": "created"}
```

By implementing the Provider Pattern using Python's Protocol, we enable:

1. **Duck typing over inheritance** - More Pythonic approach leveraging structural typing
2. **Easy testing with fake implementations** - Can create test doubles without inheritance
3. **Runtime provider discovery** - New providers can be dynamically registered
4. **Decoupled provider implementations** - Each provider encapsulates its own logic

The Provider Pattern is essential for abstracting different deployment environments (like OrbStack or Docker Desktop) behind a consistent interface. This approach follows Python's "protocols" concept while maintaining the benefits of the pattern established in the TypeScript version.

By addressing these areas early in Phase 1, you'll establish better patterns that will be easier to follow throughout the rest of the migration process, leading to more consistent and maintainable code in the Python implementation.

### Deliverables
- Working Poetry monorepo structure
- Basic server and CLI infrastructure
- Protocol-based Provider Pattern implementation
- Strategy Pattern for output formatting
- End-to-end "Hello" feature validating the architecture
- Automated test coverage for the tracer bullet
- CI/CD pipeline for the Python codebase