# Design Patterns and Architectural Approaches

Based on our TypeScript implementation, the following design patterns and architectural approaches are recommended for the Python migration, providing consistent structure regardless of language:

## Core Design Patterns

### Provider Pattern
- **Purpose**: Abstracts specific implementation details behind a consistent interface
- **Implementation**: Server providers (OrbStack, Docker Desktop) implement a common interface
- **Benefits**: Allows adding new providers without changing consumer code
- **Example**: `ServerProviderRegistry` with extensible provider implementations

### Command Pattern
- **Purpose**: Encapsulates commands as objects with consistent execution methods
- **Implementation**: CLI commands grouped by functionality with consistent handler methods
- **Benefits**: Separation of command routing from implementation logic
- **Example**: Command hierarchy with parent/child relationship (app → list, deploy, etc.)

### Adapter Pattern
- **Purpose**: Converts one interface to another expected by clients
- **Implementation**: API client adapts between CLI commands and REST API endpoints
- **Benefits**: Changes to API structure don't require changes to command implementation
- **Example**: Generic API client with feature-specific service adapters

### Strategy Pattern
- **Purpose**: Defines a family of algorithms, encapsulates each one, and makes them interchangeable
- **Implementation**: Output formatting with interchangeable formats (table, JSON, YAML)
- **Benefits**: New output formats can be added without changing command code
- **Example**: OutputFormatter with multiple format strategies

### Registry Pattern
- **Purpose**: Central registry for dynamically discovering and loading components
- **Implementation**: Server provider registry with dynamic capability detection
- **Benefits**: Extensible architecture supporting new implementations
- **Example**: Server providers registered in central registry for discovery

## Architectural Approaches

### Middleware Architecture
- **Purpose**: Chain of responsibility for request processing
- **Implementation**: Express/FastAPI middleware for cross-cutting concerns
- **Benefits**: Separation of core logic from cross-cutting concerns
- **Example**: Authentication, logging, and error-handling middleware

### Layered Architecture
- **Purpose**: Separation of concerns with clear boundaries between layers
- **Implementation**: Routes/controllers → services → data access
- **Benefits**: Improved testability and maintainability
- **Example**: Controllers focusing on request/response handling, delegating to services

### Consistent Response Format
- **Purpose**: Standardized response structure for all API endpoints
- **Implementation**: ApiResponse wrapper with success, data, and error fields
- **Benefits**: Consistent client-side handling of responses
- **Example**: All endpoints return standardized response structure

### Authentication Strategy
- **Purpose**: Flexible authentication with multiple possible implementations
- **Implementation**: Configurable authentication middleware with testing bypass
- **Benefits**: Support for different authentication mechanisms
- **Example**: OIDC authentication with configuration options

### Extensible Command Registration
- **Purpose**: Centralized command registration with modular structure
- **Implementation**: Command modules dynamically register with central program
- **Benefits**: Easy addition of new command groups and commands
- **Example**: Command folders with index.ts aggregating subcommands

## Server Controller Architecture

The server's controller architecture follows a consistent pattern:

### Controller Organization

Controllers are organized by feature area and responsibility:

```
controllers/
├── apps/                    # Application-related controllers
│   ├── backup.py            # Backup and restore functionality
│   ├── info.py              # Application information endpoints
│   ├── lifecycle.py         # Deployment and lifecycle management
│   └── monitoring.py        # Logs, metrics, and health endpoints
├── config/                  # Configuration management controllers
└── files/                   # File management controllers
```

### Controller Responsibilities

Each controller is responsible for:

1. **Input Validation**: Validating request parameters and body
2. **Access Control**: Checking permissions for requested actions
3. **Service Delegation**: Delegating business logic to service layer
4. **Response Formation**: Formatting appropriate responses
5. **Error Handling**: Handling and formatting errors

### Implementation Pattern

Controllers follow a consistent implementation pattern:

```python
async def example_action(request: Request) -> Response:
    """
    Example controller action pattern
    """
    # 1. Input validation
    try:
        data = await request.json()
        required_param = data.get("requiredParam")
        if not required_param:
            return JSONResponse(
                status_code=400,
                content={
                    "success": False,
                    "error": {
                        "code": "missing_parameter",
                        "message": "Required parameter is missing"
                    }
                }
            )
    
        # 2. Service delegation
        result = await example_service.perform_action(required_param)
        
        # 3. Response formatting
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "data": result
            }
        )
    except Exception as error:
        # 4. Error handling
        status_code = getattr(error, "status_code", 500)
        error_code = getattr(error, "error_code", "internal_error")
        
        return JSONResponse(
            status_code=status_code,
            content={
                "success": False,
                "error": {
                    "code": error_code,
                    "message": str(error)
                }
            }
        )
```

### Controller Composition

Controllers can be organized and composed using Python's modules and imports:

```python
# apps/__init__.py - Aggregator file for app controllers
from .monitoring import *
from .lifecycle import *
from .info import *
from .backup import *
```

## Client-Server Provider Architecture

The project implements a Provider Pattern to support multiple server types through the CLI, while each individual server remains typed to a single provider. This design allows for:

1. A single CLI client that can manage multiple server types (Docker Desktop, OrbStack, etc.)
2. Simple server instances that focus on delivering API functionality without provider complexity

### Provider Interface in Shared Library

The Provider interface is defined as a Protocol in the shared package for use by both CLI and server components:

```python
# In hola_shared/hola_shared/providers/base.py
from typing import Protocol, Dict, Any

class ServerProvider(Protocol):
    """Protocol defining the interface for server providers"""
    
    type: str  # Provider type identifier
    display_name: str  # User-friendly display name
    
    # Core provider capabilities
    async def is_available(self) -> bool:
        """Check if this provider is available on the system"""
        ...
    
    async def bootstrap(self, options: Dict[str, Any]) -> Dict[str, Any]:
        """Bootstrap a new server instance"""
        ...
    
    async def get_server_info(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Get information about a server instance"""
        ...
    
    async def start_server(self, context: Dict[str, Any]) -> None:
        """Start a server instance"""
        ...
    
    async def stop_server(self, context: Dict[str, Any]) -> None:
        """Stop a server instance"""
        ...
```

### Client-Side Provider Registry

The CLI maintains a registry of all available provider implementations, allowing users to create and manage servers of different types:

```python
# In hola_cli/hola_cli/providers/registry.py
class ServerProviderRegistry:
    """Registry for server providers"""
    
    def __init__(self):
        self.providers = {}
    
    def register_provider(self, provider: ServerProvider) -> None:
        """Register a provider with the registry"""
        self.providers[provider.type] = provider
    
    async def get_available_providers(self) -> List[ServerProvider]:
        """Get all providers that are available on the current system"""
        available_providers = []
        
        for provider in self.providers.values():
            if await provider.is_available():
                available_providers.append(provider)
        
        return available_providers
```

### Instance Management

The CLI includes a `ServerInstanceManager` that handles the lifecycle of server instances across different providers:

```python
# In hola_cli/hola_cli/providers/instance_manager.py
class ServerInstanceManager:
    """Manages server instances across different providers"""
    
    def __init__(self, data_dir: Optional[Path] = None):
        if data_dir is None:
            home = Path.home()
            data_dir = home / ".hola" / "instances"
        
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.instances: Dict[str, ServerInstanceInfo] = {}
        self._load_instances()
    
    async def create_instance(self, provider_type: str, name: str, options: Dict[str, Any]) -> ServerInstanceInfo:
        """Create a new server instance using the specified provider"""
        # Get provider implementation and bootstrap the server
        registry = get_provider_registry()
        provider = registry.get_provider(provider_type)
        context = await provider.bootstrap(options)
        
        # Create and store instance information
        instance = ServerInstanceInfo(
            id=str(uuid.uuid4()),
            name=name,
            provider_type=provider_type,
            status=ServerStatus(context.get("status", ServerStatus.CREATED)),
            context=context,
            created_at=datetime.now(UTC).isoformat(),
        )
        
        self.instances[instance.id] = instance
        self._save_instance(instance)
        return instance
```

### Provider Implementation Example

Each provider implements the `ServerProvider` protocol for a specific server environment:

```python
# In hola_cli/hola_cli/providers/orbstack.py
class OrbStackProvider:
    """OrbStack provider implementation"""
    
    type = "orbstack"
    display_name = "OrbStack"
    
    async def is_available(self) -> bool:
        """Check if OrbStack is installed and accessible"""
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
        """Bootstrap a new Hola server on OrbStack"""
        # OrbStack-specific implementation for creating a container
        # Returns context with connection information
        ...
```

### CLI-Server Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                  Hola CLI Client                    │
│                                                     │
├─────────────────┬──────────────────┬───────────────┤
│                 │                  │               │
│ ServerProvider  │ ServerProvider   │ ServerProvider│
│ (Docker Desktop)│ (OrbStack)       │ (Other)       │
│                 │                  │               │
└────────┬────────┴────────┬─────────┴───────┬───────┘
         │                 │                 │        
         │                 │                 │        
         ▼                 ▼                 ▼        
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│             │    │             │    │             │
│  Hola API   │    │  Hola API   │    │  Hola API   │
│  Server     │    │  Server     │    │  Server     │
│  (Docker)   │    │  (OrbStack) │    │  (Other)    │
│             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
```

This architecture allows the CLI to create and manage multiple Hola API servers in different environments, while each server instance is focused solely on delivering API functionality.

These patterns provide a solid foundation for maintainable, extensible code across both TypeScript and Python implementations.
