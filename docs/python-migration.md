# Feature-Based Iterative Migration Plan for Hola Monorepo (TypeScript to Python)

## Overview

This migration plan will transform the TypeScript monorepo into a Python-based ecosystem using a feature-by-feature "vertical slicing" approach. Each feature will be fully implemented across all layers before moving to the next feature, ensuring working functionality throughout the migration process. This strategy reduces risk, increases visibility, and provides valuable functionality earlier.

## Current Structure vs Target Structure

**Current TypeScript Structure**:
```
packages/
├── client/        # TypeScript CLI client (using ES modules)
├── server/        # TypeScript API server (using ES modules)
└── shared/        # Shared TypeScript code and utilities
```

**Target Python Structure**:
```
hola/
├── hola_cli/        # Python CLI client using Typer
├── hola_server/     # Python FastAPI server
├── hola_shared/     # Shared Pydantic models and utilities
└── hola_client_sdk/ # Generated API client from OpenAPI spec
```

## Migration Strategy

Unlike traditional component-based migrations, we will adopt a feature-first approach:

1. Set up the foundational infrastructure
2. Implement a tracer bullet for end-to-end testing
3. Migrate features iteratively, building out basic functionality across each category first
4. Each feature slice will include:
   - Shared models and utilities
   - Server API endpoints and services
   - Auto-generated client SDK
   - CLI commands and functionality

This approach ensures that we always have a working system with the features implemented so far, reducing risk and providing incremental value. Rather than fully implementing all features in one category before moving to others, we'll implement one feature from each category (app, server, config, settings) to establish a complete structure early in the process.

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

6. **Output Formatting Framework**:
   ```python
   # hola_cli/hola_cli/utils/formatting.py
   from typing import Any, List, Dict
   import json
   from rich.table import Table
   from rich.console import Console
   
   console = Console()
   
   def format_output(data: Any, format_type: str = "table") -> Any:
       """Format output based on format type."""
       if format_type == "json":
           return json.dumps(data, indent=2)
       elif format_type == "table":
           if isinstance(data, list) and data and isinstance(data[0], dict):
               return create_table_from_list(data)
           elif isinstance(data, dict):
               return create_table_from_dict(data)
           else:
               return str(data)
       else:
           return str(data)
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

### Deliverables
- Working Poetry monorepo structure
- Basic server and CLI infrastructure
- End-to-end "Hello" feature validating the architecture
- Automated test coverage for the tracer bullet
- CI/CD pipeline for the Python codebase

## Phase 2: Basic Features Across Categories (4 weeks)

In this phase, we'll implement a basic feature from each category to build out the complete project structure.

### 1. App Listing

#### Shared Models

```python
# hola_shared/models/app.py
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum

class AppStatus(str, Enum):
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"
    
class AppConfig(BaseModel):
    name: str
    image: Optional[str] = None
    status: AppStatus = AppStatus.STOPPED
    ports: Optional[Dict[str, int]] = Field(default_factory=dict)
```

#### Server Implementation

```python
# hola_server/hola_server/services/docker.py
import docker
import asyncio
from typing import List
from hola_shared.models.app import AppConfig, AppStatus

class DockerService:
    def __init__(self):
        self.client = docker.from_env()
        
    async def list_apps(self) -> List[AppConfig]:
        """List all applications managed by Docker."""
        loop = asyncio.get_running_loop()
        containers = await loop.run_in_executor(
            None, self.client.containers.list, {"all": True}
        )
        
        apps = []
        for container in containers:
            if "hola.app" in container.labels:
                app_name = container.labels["hola.app"]
                status = AppStatus.RUNNING if container.status == "running" else AppStatus.STOPPED
                
                app_config = AppConfig(
                    name=app_name,
                    image=container.image.tags[0] if container.image.tags else None,
                    status=status,
                )
                apps.append(app_config)
        
        return apps

# hola_server/hola_server/api/apps.py
from fastapi import APIRouter, Depends
from typing import List
from hola_shared.models.app import AppConfig
from hola_shared.models.response import ApiResponse
from ..services.docker import DockerService
from ..auth import get_api_key

router = APIRouter()

@router.get("/", response_model=ApiResponse[List[AppConfig]])
async def list_apps(api_key: str = Depends(get_api_key)):
    """List all deployed applications."""
    docker_service = DockerService()
    apps = await docker_service.list_apps()
    return ApiResponse(success=True, data=apps)

# In hola_server/hola_server/main.py, add:
from .api import apps
app.include_router(apps.router, prefix="/apps", tags=["apps"])
```

#### CLI Implementation

```python
# hola_cli/hola_cli/services/app_service.py
from typing import List
from hola_client_sdk.api.apps import list_apps
from hola_client_sdk.models import AppConfig
from hola_shared.models.response import ApiResponse
from ..config.context import ServerContext

class AppService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context
        
    def list_apps(self) -> ApiResponse[List[AppConfig]]:
        """List all apps on the server."""
        with self.server_context.create_client() as client:
            return list_apps.sync_detailed(client=client)

# hola_cli/hola_cli/commands/app.py
import typer
from rich.console import Console
from typing import Optional
from ..services.app_service import AppService
from ..config.context import get_current_server
from ..utils.formatting import format_output

app_commands = typer.Typer(help="Application management commands")
console = Console()

@app_commands.command("list")
def list_apps(
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json)"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
):
    """List all deployed applications."""
    try:
        # Get server context
        server_context = get_current_server(server)
        
        # Get apps from service
        service = AppService(server_context)
        result = service.list_apps()
        
        # Format output
        formatted = format_output(result.data, output)
        console.print(formatted)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        raise typer.Exit(code=1)
        
# In hola_cli/hola_cli/main.py, add:
from .commands import app
app.add_typer(app.app_commands, name="app")
```

### 2. Server Status

#### Shared Models

```python
# hola_shared/models/server.py
from pydantic import BaseModel
from typing import Optional, Dict
from datetime import datetime

class ServerStatus(BaseModel):
    version: str
    uptime_seconds: int
    started_at: datetime
    cpu_usage: float
    memory_usage: float
    disk_usage: Dict[str, float]
    docker_status: str
```

#### Server Implementation

```python
# hola_server/hola_server/services/system.py
import psutil
import os
import time
import docker
from datetime import datetime
from hola_shared.models.server import ServerStatus

class SystemService:
    def __init__(self):
        self.start_time = time.time()
        self.version = "1.0.0"  # Should be fetched from package
        
    async def get_status(self) -> ServerStatus:
        """Get system status information."""
        # Get system info
        cpu_usage = psutil.cpu_percent()
        memory = psutil.virtual_memory()
        memory_usage = memory.percent
        
        # Get disk usage
        disk_usage = {}
        for part in psutil.disk_partitions(all=False):
            if os.name == 'nt' or part.fstype != '':
                usage = psutil.disk_usage(part.mountpoint)
                disk_usage[part.mountpoint] = usage.percent
                
        # Check Docker status
        try:
            client = docker.from_env()
            docker_status = "running" if client.ping() else "error"
        except:
            docker_status = "not available"
            
        # Create status object
        uptime = int(time.time() - self.start_time)
        started_at = datetime.fromtimestamp(self.start_time)
        
        return ServerStatus(
            version=self.version,
            uptime_seconds=uptime,
            started_at=started_at,
            cpu_usage=cpu_usage,
            memory_usage=memory_usage,
            disk_usage=disk_usage,
            docker_status=docker_status
        )

# hola_server/hola_server/api/server.py
from fastapi import APIRouter, Depends
from hola_shared.models.response import ApiResponse
from hola_shared.models.server import ServerStatus
from ..services.system import SystemService
from ..auth import get_api_key

router = APIRouter()

@router.get("/status", response_model=ApiResponse[ServerStatus])
async def get_server_status(api_key: str = Depends(get_api_key)):
    """Get server status information."""
    system_service = SystemService()
    status = await system_service.get_status()
    return ApiResponse(success=True, data=status)

# In hola_server/hola_server/main.py, add:
from .api import server
app.include_router(server.router, prefix="/server", tags=["server"])
```

#### CLI Implementation

```python
# hola_cli/hola_cli/services/server_service.py
from hola_client_sdk.api.server import get_server_status
from hola_shared.models.response import ApiResponse
from hola_shared.models.server import ServerStatus
from ..config.context import ServerContext

class ServerService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context
        
    def get_status(self) -> ApiResponse[ServerStatus]:
        """Get server status information."""
        with self.server_context.create_client() as client:
            return get_server_status.sync_detailed(client=client)

# hola_cli/hola_cli/commands/server.py
import typer
from rich.console import Console
from typing import Optional
from ..services.server_service import ServerService
from ..config.context import get_current_server
from ..utils.formatting import format_output

server_commands = typer.Typer(help="Server management commands")
console = Console()

@server_commands.command("status")
def server_status(
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json)"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
):
    """Get server status."""
    try:
        # Get server context
        server_context = get_current_server(server)
        
        # Get status from service
        service = ServerService(server_context)
        result = service.get_status()
        
        # Format output
        formatted = format_output(result.data, output)
        console.print(formatted)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        raise typer.Exit(code=1)
        
# In hola_cli/hola_cli/main.py, add:
from .commands import server
app.add_typer(server.server_commands, name="server")
```

### 3. Config List

#### Shared Models

```python
# hola_shared/models/config.py
from pydantic import BaseModel
from typing import Dict, Any, Optional, List

class ConfigItem(BaseModel):
    key: str
    value: Any
    description: Optional[str] = None
    
class ConfigGroup(BaseModel):
    name: str
    items: Dict[str, ConfigItem]
```

#### Server Implementation

```python
# hola_server/hola_server/services/config.py
import os
import json
from typing import Dict, List
from pathlib import Path
from hola_shared.models.config import ConfigGroup, ConfigItem

class ConfigService:
    def __init__(self, config_path: str = None):
        self.config_path = config_path or os.path.join(os.getcwd(), "data/config")
        
    async def list_config_groups(self) -> List[str]:
        """List all config groups."""
        config_dir = Path(self.config_path)
        if not config_dir.exists():
            return []
            
        groups = []
        for item in config_dir.iterdir():
            if item.is_dir():
                groups.append(item.name)
                
        return groups
        
    async def get_group_configs(self, group: str) -> ConfigGroup:
        """Get all configs for a specific group."""
        group_path = Path(self.config_path) / group
        if not group_path.exists() or not group_path.is_dir():
            return ConfigGroup(name=group, items={})
            
        items = {}
        for config_file in group_path.glob("*.json"):
            key = config_file.stem
            try:
                with open(config_file, 'r') as f:
                    data = json.load(f)
                    items[key] = ConfigItem(
                        key=key,
                        value=data.get("value"),
                        description=data.get("description")
                    )
            except:
                # Skip invalid configs
                pass
                
        return ConfigGroup(name=group, items=items)

# hola_server/hola_server/api/config.py
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from hola_shared.models.response import ApiResponse
from hola_shared.models.config import ConfigGroup
from ..services.config import ConfigService
from ..auth import get_api_key

router = APIRouter()

@router.get("/groups", response_model=ApiResponse[List[str]])
async def list_config_groups(api_key: str = Depends(get_api_key)):
    """List all configuration groups."""
    config_service = ConfigService()
    groups = await config_service.list_config_groups()
    return ApiResponse(success=True, data=groups)

@router.get("/groups/{group}", response_model=ApiResponse[ConfigGroup])
async def get_group_configs(group: str, api_key: str = Depends(get_api_key)):
    """Get all configs for a specific group."""
    config_service = ConfigService()
    configs = await config_service.get_group_configs(group)
    return ApiResponse(success=True, data=configs)

# In hola_server/hola_server/main.py, add:
from .api import config
app.include_router(config.router, prefix="/config", tags=["config"])
```

#### CLI Implementation

```python
# hola_cli/hola_cli/services/config_service.py
from typing import List
from hola_client_sdk.api.config import list_config_groups, get_group_configs
from hola_shared.models.response import ApiResponse
from hola_shared.models.config import ConfigGroup
from ..config.context import ServerContext

class ConfigService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context
        
    def list_groups(self) -> ApiResponse[List[str]]:
        """List all config groups."""
        with self.server_context.create_client() as client:
            return list_config_groups.sync_detailed(client=client)
            
    def get_group_configs(self, group: str) -> ApiResponse[ConfigGroup]:
        """Get all configs for a specific group."""
        with self.server_context.create_client() as client:
            return get_group_configs.sync_detailed(client=client, group=group)

# hola_cli/hola_cli/commands/config.py
import typer
from rich.console import Console
from typing import Optional
from ..services.config_service import ConfigService
from ..config.context import get_current_server
from ..utils.formatting import format_output

config_commands = typer.Typer(help="Configuration management commands")
console = Console()

@config_commands.command("list")
def list_config(
    group: Optional[str] = typer.Argument(None, help="Configuration group"),
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json)"),
    server: Optional[str] = typer.Option(None, "--server", "-s", help="Target server"),
):
    """List configuration groups or items in a group."""
    try:
        # Get server context
        server_context = get_current_server(server)
        service = ConfigService(server_context)
        
        if group:
            # List configs within the group
            result = service.get_group_configs(group)
            formatted = format_output(result.data.items, output)
        else:
            # List available groups
            result = service.list_groups()
            formatted = format_output(result.data, output)
            
        console.print(formatted)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        raise typer.Exit(code=1)
        
# In hola_cli/hola_cli/main.py, add:
from .commands import config
app.add_typer(config.config_commands, name="config")
```

### 4. Settings View

#### Shared Models

```python
# hola_cli/hola_cli/models/settings.py
from pydantic import BaseModel
from typing import Dict, Optional, List

class ServerConnection(BaseModel):
    url: str
    api_key: str
    
class CliSettings(BaseModel):
    servers: Dict[str, ServerConnection] = {}
    current_server: Optional[str] = None
    output_format: str = "table"
    log_level: str = "INFO"
    editor: Optional[str] = None
```

#### CLI Implementation

```python
# hola_cli/hola_cli/config/settings.py
import os
import json
from pathlib import Path
from ..models.settings import CliSettings, ServerConnection

class SettingsManager:
    def __init__(self, config_dir=None):
        # Use the standard config directory from settings module
        from ..config.settings import get_config_dir, get_settings_path
        self.config_dir = config_dir or get_config_dir()
        self.config_file = get_settings_path()
        self.settings = None
        
    def load_settings(self) -> CliSettings:
        """Load settings from config file."""
        # Create directory if it doesn't exist
        self.config_dir.mkdir(exist_ok=True, parents=True)
        
        # Load or create settings
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r') as f:
                    data = json.load(f)
                    self.settings = CliSettings(**data)
            except:
                self.settings = CliSettings()
        else:
            self.settings = CliSettings()
            self.save_settings()
            
        return self.settings
        
    def save_settings(self) -> None:
        """Save settings to config file."""
        if self.settings is None:
            self.load_settings()
            
        with open(self.config_file, 'w') as f:
            json.dump(self.settings.dict(), f, indent=2)
            
    def get_settings(self) -> CliSettings:
        """Get current settings, loading if needed."""
        if self.settings is None:
            return self.load_settings()
        return self.settings
        
    def update_settings(self, updated_settings: CliSettings) -> None:
        """Update settings and save."""
        self.settings = updated_settings
        self.save_settings()

# hola_cli/hola_cli/commands/settings.py
import typer
from rich.console import Console
from typing import Optional
from ..config.settings import SettingsManager
from ..utils.formatting import format_output

settings_commands = typer.Typer(help="CLI settings management")
console = Console()

@settings_commands.command("view")
def view_settings(
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json)"),
):
    """View current CLI settings."""
    try:
        # Get settings
        manager = SettingsManager()
        settings = manager.get_settings()
        
        # Format output
        formatted = format_output(settings.dict(), output)
        console.print(formatted)
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        raise typer.Exit(code=1)
        
# In hola_cli/hola_cli/main.py, add:
from .commands import settings
app.add_typer(settings.settings_commands, name="settings")
```

### Deliverables
- Basic features implemented across all categories
- Complete project structure established
- End-to-end tests for all features
- Updated documentation

## Phase 3: Intermediate Features (3 weeks)

With our basic structure established, we'll now implement a second feature in each category.

### 1. App Details

```python
# Add to hola_server/hola_server/api/apps.py
@router.get("/{app_name}", response_model=ApiResponse[AppConfig])
async def get_app(app_name: str, api_key: str = Depends(get_api_key)):
    """Get details for a specific application."""
    docker_service = DockerService()
    apps = await docker_service.list_apps()
    
    for app in apps:
        if app.name == app_name:
            return ApiResponse(success=True, data=app)
    
    raise HTTPException(
        status_code=404,
        detail=f"Application '{app_name}' not found"
    )
```

### 2. Server Info

```python
# Add to hola_server/hola_server/api/server.py
@router.get("/info", response_model=ApiResponse[Dict[str, Any]])
async def get_server_info(api_key: str = Depends(get_api_key)):
    """Get detailed server information."""
    # Implementation details...
```

### 3. Config Get/Set

```python
# Add to hola_server/hola_server/api/config.py
@router.get("/items/{group}/{key}", response_model=ApiResponse[ConfigItem])
async def get_config(group: str, key: str, api_key: str = Depends(get_api_key)):
    """Get a specific config value."""
    # Implementation details...

@router.put("/items/{group}/{key}", response_model=ApiResponse[ConfigItem])
async def set_config(group: str, key: str, item: ConfigItem, api_key: str = Depends(get_api_key)):
    """Set a specific config value."""
    # Implementation details...
```

### 4. Settings Update

```python
# Add to hola_cli/hola_cli/commands/settings.py
@settings_commands.command("set")
def set_setting(
    key: str = typer.Argument(..., help="Setting key (e.g. output_format, log_level)"),
    value: str = typer.Argument(..., help="Setting value"),
):
    """Update a CLI setting."""
    # Implementation details...
```

### Deliverables
- Intermediate features implemented across all categories
- End-to-end tests for all features
- Updated documentation

## Phase 4: Advanced App Features (4 weeks)

With the foundation and intermediate features established across categories, we'll now focus on implementing more advanced app management features.

### App Deployment

```python
# Adding the deployment feature
# Implementation details...
```

### App Logs

```python
# Adding the app logs feature
# Implementation details...
```

### App Restart

```python
# Adding the app restart feature
# Implementation details...
```

### Deliverables
- Complete app management functionality
- End-to-end tests for all app features
- Updated documentation

## Phase 5: Advanced Server Features (3 weeks)

Implement advanced server management functionality.

### Server Bootstrap

```python
# Server bootstrap implementation
# Implementation details...
```

### Server Add/Remove

```python
# Server management implementation
# Implementation details...
```

### Deliverables
- Complete server management functionality
- End-to-end tests
- Updated documentation

## Phase 6: Advanced Configuration Features (3 weeks)

Implement advanced configuration management functionality.

### Config Import/Export

```python
# Config import/export implementation
# Implementation details...
```

### Config Templates

```python
# Config templates implementation
# Implementation details...
```

### Deliverables
- Complete configuration management functionality
- End-to-end tests
- Updated documentation

## Phase 7: Advanced Settings Features (3 weeks)

Implement advanced CLI settings management functionality.

### Settings Profile Management

```python
# Settings profiles implementation
# Implementation details...
```

### Settings Migration

```python
# Settings migration tools implementation
# Implementation details...
```

### Deliverables
- Complete settings management functionality
- End-to-end tests
- Updated documentation

## Phase 8: Authentication and Security (2 weeks)

As requested, we'll leave authentication and security features for last.

### Login/Logout

```python
# Authentication implementation
# Implementation details...
```

### Token Management

```python
# Token management implementation
# Implementation details...
```

### Deliverables
- Complete authentication system
- End-to-end tests
- Security documentation

## Phase 9: Migration Tools and Final Release (2 weeks)

Create tools for migrating from TypeScript to Python versions.

### Data Migration Scripts

```python
# migration/migrate_config.py
import json
import os
from pathlib import Path

def migrate_config():
    """Migrate configuration from TypeScript to Python format."""
    # Get old config path
    old_config = Path(os.path.expanduser("~/.hola/config.json"))
    if not old_config.exists():
        print("No old config found.")
        return
        
    # Read old config
    with open(old_config, "r") as f:
        old_data = json.load(f)
        
    # Transform to new format
    new_data = {
        "servers": {},
        "currentServer": old_data.get("currentServer")
    }
    
    for server_name, server in old_data.get("servers", {}).items():
        new_data["servers"][server_name] = {
            "url": server["url"],
            "apiKey": server["apiKey"]
        }
        
    # Write to new config path (same for now)
    with open(old_config, "w") as f:
        json.dump(new_data, f, indent=2)
        
    print(f"Migrated configuration to {old_config}")
```

### Deliverables
- Complete migration scripts
- Installation packages
- Final documentation
- Release notes

## Project Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| 1     | 4 weeks  | Infrastructure and Foundation |
| 2     | 4 weeks  | Basic Features Across Categories |
| 3     | 3 weeks  | Intermediate Features |
| 4     | 4 weeks  | Advanced App Features |
| 5     | 3 weeks  | Advanced Server Features |
| 6     | 3 weeks  | Advanced Configuration Features |
| 7     | 3 weeks  | Advanced Settings Features |
| 8     | 2 weeks  | Authentication and Security |
| 9     | 2 weeks  | Migration Tools and Final Release |

**Total Duration**: 28 weeks (approximately 7 months)

## Benefits of Revised Approach

1. **Complete Structure Early**: By implementing one feature from each category early in the process, we establish the project structure from the start.

2. **Balanced Development**: We make progress across all areas of the application rather than heavily focusing on one area.

3. **Foundation for Extension**: With at least one feature from each category implemented early, adding additional features becomes easier as the patterns are established.

4. **Smoother Learning Curve**: Team members can understand how all parts of the system fit together earlier in the process.

5. **Better Risk Management**: If a particular category presents unexpected challenges, it doesn't block the entire migration process.

6. **More Gradual Transition**: Users can become familiar with the new system structure even with limited functionality before the full feature set is available.

7. **More Flexibility**: The team can pivot to focus on specific areas based on user feedback or changing requirements.

## Python CLI Structure

```
hola_cli/
├── pyproject.toml       # Project dependencies and metadata
├── README.md           # CLI documentation
├── hola_cli/           # Main package
│   ├── __init__.py     # Package initialization with version
│   ├── main.py         # CLI entry point with root Typer app
│   ├── commands/       # Command modules (vs. directory per command in TS)
│   │   ├── __init__.py # Registers all commands with the main app
│   │   ├── app.py      # App management commands (deploy, list, info, etc.)
│   │   ├── server.py   # Server management (bootstrap, add)
│   │   ├── config.py   # Configuration commands (get, set, delete)
│   │   ├── settings.py # Local CLI settings management
│   │   └── auth.py     # Authentication commands (login, logout)
│   ├── services/       # Business logic (mirrors commands but separates logic)
│   │   ├── __init__.py
│   │   ├── app_service.py    # App management logic
│   │   ├── server_service.py # Server management logic
│   │   ├── config_service.py # Config management logic 
│   │   └── auth_service.py   # Authentication service
│   ├── config/         # Configuration management
│   │   ├── __init__.py
│   │   ├── manager.py  # Config file handling
│   │   └── context.py  # Server context management
│   └── utils/          # Helper utilities
│       ├── __init__.py
│       ├── formatting.py # Output formatting (tables, JSON, etc.)
│       ├── logger.py     # Logging
│       └── errors.py     # Error handling
└── tests/              # Test directory
    ├── __init__.py
    ├── test_commands/  # Tests for command functionality
    └── test_services/  # Tests for service logic
```

This approach maintains feature parity with the TypeScript CLI while embracing Python idioms and leveraging the strengths of Typer, Pydantic, and FastAPI.
