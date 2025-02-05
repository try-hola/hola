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