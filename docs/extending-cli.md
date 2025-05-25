# Architecture Overview

The CLI follows a layered architecture:
1. **Commands Layer** - Typer command definitions with Rich output
2. **Services Layer** - Business logic and API communication
3. **Context Layer** - Server configuration and client management
4. **Shared Layer** - Common utilities, models, and formatting

## Components to Create for New Features

### 1. Service Class (Required)

Create a service class in `hola_cli/services/` that handles API communication:

````python
"""
Your Feature service for the Hola CLI.

This module provides service classes for interacting with the your-feature endpoints
of the Hola API.
"""
from hola_client_sdk.api.your_feature import your_feature_endpoint
from hola_client_sdk.errors import UnexpectedStatus
from hola_shared.models.response import ApiResponse
from hola_shared.models.your_feature import YourFeatureItem  # Import shared models
from hola_shared.errors import ServiceException, AuthenticationException
from ..config.context import ServerContext

class YourFeatureService:
    """
    Service for interacting with the your-feature endpoints of the Hola API.
    """
    
    def __init__(self, server_context: ServerContext):
        """
        Initialize a new YourFeatureService instance.
        
        Args:
            server_context: The server context for API communication
        """
        self.server_context = server_context
        
    def your_method(self, param: str) -> ApiResponse[YourFeatureItem]:
        """
        Call the your-feature endpoint.
        
        Args:
            param: Parameter for the API call
            
        Returns:
            ApiResponse with the YourFeatureItem result
            
        Raises:
            ServiceException: If there's an error communicating with the server
            AuthenticationException: If authentication fails
        """
        try:
            with self.server_context.create_client() as client:
                response = your_feature_endpoint.sync_detailed(
                    param=param,
                    client=client
                )
            
            if response.parsed:
                return response.parsed
            else:
                raise ServiceException(
                    message=f"API request failed with status code: {response.status_code}",
                    service_name="Hola API Server",
                    details={
                        "endpoint": "your-feature",
                        "status_code": response.status_code,
                        "server_url": self.server_context.url
                    }
                )
        except UnexpectedStatus as e:
            raise ServiceException(
                message=f"Unexpected API response: {e.status_code}",
                service_name="Hola API Server",
                details={
                    "status_code": e.status_code,
                    "response_content": e.content.decode('utf-8', errors='replace')
                }
            )
        except Exception as e:
            raise ServiceException(
                message=f"Error communicating with API: {str(e)}",
                service_name="Hola API Server",
                details={
                    "error_type": type(e).__name__,
                    "server_url": self.server_context.url
                }
            )
````

### 2. Command Module (Required)

Create a command module in `hola_cli/commands/`:

````python
"""
Your Feature commands module for Hola CLI.

This module provides commands for managing your feature functionality.
"""
import typer
from rich.panel import Panel
from hola_shared.errors import (
    HolaException, 
    ServiceException, 
    AuthenticationException,
    ConfigurationException
)
from hola_shared.models.your_feature import YourFeatureItem  # Import shared models
from hola_shared.logger import get_logger
from ..services.your_feature_service import YourFeatureService
from ..config.context import get_current_server
from ..utils.formatting import format_output
from ..utils.logging import log_command_start, log_command_success, log_command_error, console, error_console

your_feature_commands = typer.Typer(help="Commands for managing your feature")
logger = get_logger(__name__)

@your_feature_commands.command("action")
def action_command(
    param: str = typer.Argument(..., help="Parameter for the action"),
    output: str = typer.Option("table", "--output", "-o", help="Output format (table, json, yaml)"),
    server: str = typer.Option(None, "--server", "-s", help="Target server"),
):
    """
    Perform an action with your feature.
    
    This command demonstrates the standard pattern for CLI commands.
    """
    log_command_start(logger, "your_feature.action", param=param, output=output, server=server)
    
    try:
        # Get server context (dependency injection)
        server_context = get_current_server(server)
        
        # Create service with injected context
        service = YourFeatureService(server_context)
        result = service.your_method(param)
        
        # Format and display output
        if output == "table":
            _print_table(result.data)
        else:
            formatted = format_output(result.data, output)
            console.print(formatted)
        
        log_command_success(logger, "your_feature.action")
        
    except ConfigurationException as e:
        log_command_error(logger, "your_feature.action", e)
        error_console.print(Panel.fit(
            f"[bold red]Configuration Error:[/] {e.message}",
            title="Error",
            border_style="red"
        ))
        if e.details and "help" in e.details:
            error_console.print(f"[bold yellow]Hint:[/] {e.details['help']}")
        raise typer.Exit(code=1)
        
    except AuthenticationException as e:
        log_command_error(logger, "your_feature.action", e)
        error_console.print(Panel.fit(
            f"[bold red]Authentication Error:[/] {e.message}",
            title="Error",
            border_style="red"
        ))
        raise typer.Exit(code=1)
        
    except ServiceException as e:
        log_command_error(logger, "your_feature.action", e)
        error_console.print(Panel.fit(
            f"[bold red]Service Error:[/] {e.message}",
            title=f"Error with {e.details.get('service_name', 'API')}",
            border_style="red"
        ))
        raise typer.Exit(code=1)

def _print_table(data: YourFeatureItem):
    """Print YourFeatureItem data in table format using Rich."""
    from rich.table import Table
    
    table = Table(title="Your Feature Results")
    table.add_column("ID")
    table.add_column("Name") 
    table.add_column("Status")
    table.add_column("Description")
    
    # Handle single item or list of items
    items = [data] if not isinstance(data, list) else data
    for item in items:
        table.add_row(
            item.id,
            item.name,
            item.status.value,  # Access enum value
            item.description or ""
        )
    
    console.print(table)
````

### 3. Register Commands (Required)

Add your commands to the main CLI app:

````python
# ...existing code...
from .commands import hello
from .commands.servers import servers
from .commands.your_feature import your_feature_commands

# ...existing code...

app.add_typer(hello.hello_commands, name="hello")
app.add_typer(servers, name="servers")
app.add_typer(your_feature_commands, name="your-feature")
````

## CLI-Wide Components to Include

### 1. Configuration Components (Always Use)

- **`config/context.py`** - Use `get_current_server()` for dependency injection
- **`config/settings.py`** - Use `get_settings()` for CLI configuration

### 2. Utility Components (Always Use)

- **`utils/formatting.py`** - Use `format_output()` for consistent output formatting
- **`utils/logging.py`** - Use logging helpers:
  - `log_command_start()`
  - `log_command_success()` 
  - `log_command_error()`
  - `console` and `error_console` for output

### 3. Optional Utility Components

- **`utils/version.py`** - If you need version information
- **Custom formatters** - Create feature-specific formatting utilities if needed

## Dependency Injection Pattern

The CLI uses dependency injection through the `ServerContext` system:

### 1. Context Resolution
```python
# In your command:
server_context = get_current_server(server)  # Resolves server configuration
```

### 2. Service Construction
```python
# Inject context into service:
service = YourFeatureService(server_context)
```

### 3. Client Management
```python
# In your service:
with self.server_context.create_client() as client:
    # Client is properly configured with URL, auth, etc.
    response = api_call(client=client)
```

## Testing New Components

### 1. Create Fakes (Not Mocks)

````python
"""Fake implementation of YourFeatureService for testing."""
from typing import List, Dict, Any
from hola_shared.models.response import ApiResponse
from hola_shared.models.your_feature import YourFeatureItem
from ...services.your_feature_service import YourFeatureService

class FakeYourFeatureService:
    """Fake implementation of YourFeatureService for testing."""
    
    def __init__(self, server_context=None):
        self.method_calls: List[Dict[str, Any]] = []
        self.responses: Dict[str, ApiResponse] = {}
        
    def register_response(self, method: str, response: ApiResponse) -> None:
        """Register a response for a method call."""
        self.responses[method] = response
        
    def your_method(self, param: str) -> ApiResponse[YourFeatureItem]:
        """Fake implementation of your_method."""
        self.method_calls.append({
            "method": "your_method",
            "param": param
        })
        
        # Return registered response or default fake response
        if "your_method" in self.responses:
            return self.responses["your_method"]
        
        # Default fake response using shared model
        fake_item = YourFeatureItem(
            id="fake-id-123",
            name=f"Fake item for {param}",
            status="active"
        )
        return ApiResponse(success=True, data=fake_item)
        
    def reset(self) -> None:
        """Reset the fake state."""
        self.method_calls.clear()
        self.responses.clear()
````

### 2. Write Tests

````python
"""Tests for your feature commands."""
import pytest
from typer.testing import CliRunner
from hola_cli.main import app
from hola_cli.test_utils.fakes.fake_your_feature_service import FakeYourFeatureService
from hola_shared.models.response import ApiResponse
from hola_shared.models.your_feature import YourFeatureItem

@pytest.fixture
def fake_service():
    """Provide a fake service for testing."""
    service = FakeYourFeatureService()
    yield service
    service.reset()

def test_action_command_success(fake_service, monkeypatch):
    """Test successful action command execution."""
    # Arrange
    monkeypatch.setattr("hola_cli.commands.your_feature.YourFeatureService", lambda _: fake_service)
    
    # Create expected response using shared models
    expected_item = YourFeatureItem(
        id="test-123",
        name="Test Item",
        status="active"
    )
    fake_service.register_response("your_method", ApiResponse(
        success=True,
        data=expected_item
    ))
    
    runner = CliRunner()
    
    # Act
    result = runner.invoke(app, ["your-feature", "action", "test-param"])
    
    # Assert
    assert result.exit_code == 0
    assert len(fake_service.method_calls) == 1
    assert fake_service.method_calls[0]["param"] == "test-param"
````

## When to Use or Extend hola_shared

Before implementing a new CLI feature, consider whether any components belong in the shared workspace. The `hola_shared` package contains models, utilities, and interfaces that are used across both server and CLI components.

### 1. Shared Data Models (Required for API Communication)

**Always add to `hola_shared/models/` when:**
- Creating new API request/response structures
- Defining domain objects that both server and CLI need
- Adding data models that will be serialized/deserialized across the API boundary

````python
# Add to hola_shared/hola_shared/models/your_feature.py
from pydantic import BaseModel
from typing import Optional, List
from enum import Enum

class YourFeatureStatus(str, Enum):
    """Status enumeration for your feature."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    PENDING = "pending"

class YourFeatureItem(BaseModel):
    """Domain object shared between server and CLI."""
    id: str
    name: str
    status: YourFeatureStatus
    description: Optional[str] = None

class YourFeatureCreateRequest(BaseModel):
    """Request model for creating items."""
    name: str
    description: Optional[str] = None

# Then import in your service:
from hola_shared.models.your_feature import YourFeatureItem, YourFeatureCreateRequest
````

### 2. Error Handling (Always Use Shared Exceptions)

**Use existing exceptions from `hola_shared.errors`:**
- `ValidationException` - Input validation failures
- `NotFoundException` - Resource not found  
- `AuthenticationException` - Authentication failures
- `ServiceException` - External service errors
- `ConfigurationException` - Configuration problems

````python
# In your service class:
from hola_shared.errors import ValidationException, NotFoundException

class YourFeatureService:
    def your_method(self, param: str) -> ApiResponse:
        if not param:
            raise ValidationException(
                message="Parameter is required",
                details={"field": "param"}
            )
        # ... rest of method
````

**Add new exception types to `hola_shared.errors` when:**
- The error type will be used by both server and CLI
- The error represents a domain-specific business rule
- Multiple services need the same error handling pattern

### 3. Test Utilities and Fakes

**Add to `hola_shared/test_utils/fakes/` when:**
- Multiple packages need the same fake implementation
- Creating domain-specific fakes that represent shared concepts
- The fake implements a protocol/interface used across components

````python
# Add to hola_shared/hola_shared/test_utils/fakes/your_feature_storage.py
from typing import List, Optional, Dict
from hola_shared.models.your_feature import YourFeatureItem

class FakeYourFeatureStorage:
    """Fake storage for testing your feature persistence."""
    
    def __init__(self):
        self._items: Dict[str, YourFeatureItem] = {}
        self._next_id = 1
    
    async def store_item(self, item: YourFeatureItem) -> YourFeatureItem:
        if not item.id:
            item.id = f"item-{self._next_id}"
            self._next_id += 1
        self._items[item.id] = item
        return item
    
    async def get_item(self, item_id: str) -> Optional[YourFeatureItem]:
        return self._items.get(item_id)
    
    def reset(self) -> None:
        self._items.clear()
        self._next_id = 1

# Use in both server and CLI tests:
from hola_shared.test_utils.fakes.your_feature_storage import FakeYourFeatureStorage
````

### 4. Configuration and Environment Variables

**Add to `hola_shared` when both server and CLI need the same configuration:**

````python
# Add to hola_shared/hola_shared/config.py (create if needed)
from hola_shared.environment import Environment

class SharedFeatureConfig:
    """Configuration for your feature used by both server and CLI."""
    api_timeout: int = Environment.get_int("FEATURE_API_TIMEOUT", 30)
    max_items: int = Environment.get_int("FEATURE_MAX_ITEMS", 100)
    enable_feature: bool = Environment.get_bool("FEATURE_ENABLED", True)

# Use in both components:
from hola_shared.config import SharedFeatureConfig
````

### 5. API Response Standards (Always Use)

**Always use `ApiResponse` wrapper for consistency with CLI expectations:**

````python
# Your service should return ApiResponse objects:
from hola_shared.models.response import ApiResponse

def your_method(self, param: str) -> ApiResponse[YourFeatureItem]:
    try:
        # Business logic here
        result = self._process_feature(param)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        # Errors are handled by the command layer
        raise  # Let the command handle error formatting
````

### 6. Logging Integration (Always Use)

**Use shared logging utilities for consistent log formatting:**

````python
# In your service:
from hola_shared.logger import get_logger

class YourFeatureService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context
        self.logger = get_logger(__name__)  # Use shared logger
    
    def your_method(self, param: str) -> ApiResponse:
        self.logger.info("Processing feature request", extra={"param": param})
        # ... rest of method
````

### Guidelines for hola_shared vs Component-Specific Code

**Decision Checklist: Should this go in hola_shared?**

Ask yourself these questions in order:

1. **Will the server also need this exact same data structure/interface?**
   - ✅ Yes → Add to `hola_shared/models/`
   - ❌ No → Keep in CLI component

2. **Is this an error that both server and CLI need to handle consistently?**
   - ✅ Yes → Use existing or add to `hola_shared.errors`
   - ❌ No → Use component-specific error handling

3. **Will multiple test suites need this fake implementation?**
   - ✅ Yes → Add to `hola_shared/test_utils/fakes/`
   - ❌ No → Keep in component-specific test utilities

4. **Is this configuration used by both server and CLI?**
   - ✅ Yes → Add to `hola_shared` config utilities
   - ❌ No → Keep in component-specific config

5. **Does this enforce a contract between server and CLI?**
   - ✅ Yes → Belongs in `hola_shared`
   - ❌ No → Keep in component

**Add to hola_shared when:**
- Data structures are used by both server and CLI
- Error types need consistent handling across components  
- Test utilities represent shared domain concepts
- Configuration affects multiple components
- The functionality enforces cross-component contracts

**Keep in CLI component when:**
- Logic is CLI-specific (Typer commands, Rich formatting)
- Dependencies are CLI-specific (typer, rich)
- Presentation logic differs from server implementation
- Internal CLI state management and caching

**Update shared models when:**
- Adding new fields that both components need
- Changing validation rules that affect API contracts  
- Adding new status values or enum options
- Modifying error structures or response formats

## Working with hola_client_sdk

The `hola_client_sdk` is a generated client library that provides type-safe access to the Hola API. It's automatically generated from the server's OpenAPI specification and should be used for all API communication.

### Understanding the Generated Client

**What is hola_client_sdk?**
- Generated from the server's OpenAPI spec (`hola_server/public/docs/openapi.yaml`)
- Provides typed Python functions for every API endpoint
- Handles request/response serialization automatically
- Includes proper error handling and type hints

**Key Components:**
- `Client` - Basic HTTP client for unauthenticated endpoints
- `AuthenticatedClient` - Client with authentication (used by CLI)
- `api.*` modules - Endpoint functions organized by OpenAPI tags
- `models.*` - Request/response models matching server types
- `errors.UnexpectedStatus` - Exception for undocumented status codes

### Using the Client SDK in Services

**Always use the generated client** for API calls instead of direct HTTP requests:

```python
# ✅ Correct - Use generated client
from hola_client_sdk.api.your_feature import your_feature_list, your_feature_create
from hola_client_sdk.errors import UnexpectedStatus
from hola_shared.models.your_feature import YourFeatureItem, CreateYourFeatureRequest

class YourFeatureService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context

    async def list_items(self) -> ApiResponse[List[YourFeatureItem]]:
        with self.server_context.create_client() as client:
            try:
                # Use sync_detailed for full response info
                response = your_feature_list.sync_detailed(client=client)
                
                if response.status_code == 200:
                    return response.parsed  # Returns ApiResponse[List[YourFeatureItem]]
                else:
                    # Handle documented error responses
                    raise ServiceException(f"API returned status {response.status_code}")
                    
            except UnexpectedStatus as e:
                # Handle undocumented status codes
                raise ServiceException(f"Unexpected API response: {e.status_code}")

    async def create_item(self, request: CreateYourFeatureRequest) -> ApiResponse[YourFeatureItem]:
        with self.server_context.create_client() as client:
            response = your_feature_create.sync_detailed(
                json_body=request,  # Pydantic model auto-serialized
                client=client
            )
            return response.parsed
```

### Client Method Patterns

**Every endpoint generates 4 functions:**

1. **`sync()`** - Returns parsed data or `None` on error
2. **`sync_detailed()`** - Returns full `Response` object with status, headers, etc.
3. **`asyncio()`** - Async version of `sync()`
4. **`asyncio_detailed()`** - Async version of `sync_detailed()`

**Recommended patterns:**

```python
# Use sync_detailed for error handling
response = endpoint.sync_detailed(client=client, param="value")
if response.status_code == 200:
    data = response.parsed
elif response.status_code == 404:
    # Handle specific error cases
    raise NotFoundException("Resource not found")

# Use sync for simple success cases
data = endpoint.sync(client=client, param="value")
if data is None:
    # Handle any error generically
    raise ServiceException("API call failed")
```

### Error Handling with the SDK

**Handle these error scenarios:**

```python
from hola_client_sdk.errors import UnexpectedStatus
from hola_shared.errors import ServiceException, NotFoundException

try:
    response = endpoint.sync_detailed(client=client)
    
    # Check documented status codes
    if response.status_code == 200:
        return response.parsed
    elif response.status_code == 404:
        raise NotFoundException("Resource not found")
    elif response.status_code == 422:
        # Validation error - response.parsed contains error details
        raise ValidationException("Invalid input", details=response.parsed.detail)
    else:
        raise ServiceException(f"API error: {response.status_code}")
        
except UnexpectedStatus as e:
    # Status code not in OpenAPI spec
    raise ServiceException(f"Unexpected API response: {e.status_code}")
    
except httpx.TimeoutException:
    raise ServiceException("API request timed out")
    
except httpx.ConnectError:
    raise ServiceException("Could not connect to server")
```

### Integration with ServerContext

**The ServerContext handles client configuration:**

```python
# ServerContext.create_client() provides:
# - Base URL from server configuration
# - API key authentication headers
# - Timeout and SSL verification settings
# - Proper resource management

class YourFeatureService:
    def __init__(self, server_context: ServerContext):
        self.server_context = server_context

    def make_api_call(self):
        # Context manager ensures proper cleanup
        with self.server_context.create_client() as client:
            # Client is pre-configured with URL, auth, timeout
            response = api_call.sync_detailed(client=client)
            return response.parsed
```

### Testing with the Client SDK

**Create fakes that match the client interface:**

```python
# test_utils/fakes/fake_your_feature_service.py
from typing import Dict, Any
from hola_client_sdk.types import Response

class FakeYourFeatureApiClient:
    def __init__(self):
        self.responses: Dict[str, Any] = {}
        self.calls: List[Dict[str, Any]] = []

    def register_response(self, endpoint: str, status_code: int, data: Any):
        """Pre-configure a response for testing."""
        self.responses[endpoint] = Response(
            status_code=status_code,
            content=b"",
            headers={},
            parsed=data
        )

    def sync_detailed(self, **kwargs) -> Response:
        """Mock the sync_detailed pattern."""
        endpoint_name = self.__class__.__name__
        self.calls.append({"endpoint": endpoint_name, "kwargs": kwargs})
        return self.responses.get(endpoint_name, self._default_response())
```

### Client SDK Best Practices

1. **Always use sync_detailed** for production code to get full response info
2. **Handle documented status codes** explicitly in your service logic
3. **Use the ServerContext** for client creation, never create clients directly
4. **Let Pydantic models serialize** - pass models directly to `json_body` parameters
5. **Wrap SDK exceptions** in domain-specific exceptions from `hola_shared.errors`
6. **Test against fakes** that implement the same response patterns

### When the API Changes

**Client regeneration is automatic** when:
- Server OpenAPI spec changes
- New endpoints are added
- Model schemas are updated

The generated client will include:
- New endpoint functions
- Updated model classes
- Proper type hints for all changes

Your service code should continue working as long as you're using the shared models from `hola_shared.models`.

## Practical Implementation Workflow

When implementing a new CLI feature, follow this step-by-step workflow:

### Step 1: Define Shared Models (If needed)
```bash
# Create shared models first if they don't exist
touch hola_shared/hola_shared/models/your_feature.py
```

### Step 2: Implement Shared Models
Use the patterns shown above to create domain objects, request/response models, and enums.

### Step 3: Create CLI Service
Implement your service class using the shared models and standard error handling patterns.

### Step 4: Create CLI Commands  
Implement commands that use the service and follow the established patterns for output formatting and error handling.

### Step 5: Create Test Fakes
Create fakes for testing, placing them in `hola_shared` if they represent shared domain concepts.

### Step 6: Write Tests
Write comprehensive tests using the fakes and shared models.

### Step 7: Register Commands
Add your command module to the main CLI application.

### Example File Structure for a New Feature
```
hola_shared/hola_shared/models/
├── your_feature.py                    # Shared domain models

hola_cli/hola_cli/
├── services/
│   └── your_feature_service.py        # Business logic
├── commands/
│   └── your_feature.py                # CLI commands
└── test_utils/fakes/
    └── fake_your_feature_service.py   # CLI-specific fakes

hola_cli/tests/
├── services/
│   └── test_your_feature_service.py   # Service tests
└── commands/
    └── test_your_feature.py           # Command tests
```

## Key Principles for Extension

1. **Dependency Injection**: Always use `ServerContext` for API client management
2. **Error Handling**: Use the structured exception types from `hola_shared.errors`
3. **Logging**: Follow the established logging patterns with context
4. **Output Formatting**: Use `format_output()` and Rich components
5. **Testing**: Create fakes, not mocks, for business dependencies
6. **Separation of Concerns**: Commands handle UI/CLI concerns, services handle business logic
7. **Shared Contracts**: Use `hola_shared` for data models and interfaces that cross component boundaries

This architecture ensures consistency, testability, and maintainability as you add new features to the CLI.