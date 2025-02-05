# Current Architecture Overview

The server follows a layered FastAPI architecture with:
- **API Layer**: Route handlers in `api/` modules
- **Service Layer**: Business logic in `services/` (currently empty)
- **Configuration**: Settings and context management in `config/`
- **Utilities**: Logging and shared helpers in `utils/`
- **Authentication**: API key validation (placeholder implementation)

## Working with OpenAPI Specification

The server automatically generates an OpenAPI specification that feeds the `hola_client_sdk`. Understanding this relationship is crucial for maintaining API consistency.

### OpenAPI Generation Best Practices

**Ensure proper response models** for client SDK generation:

````python
# ✅ Correct - Explicit response models
@router.get("/apps", response_model=ApiResponse[List[App]])
async def list_apps():
    return ApiResponse(success=True, data=apps)

# ✅ Correct - Error responses documented
@router.get("/apps/{app_id}", 
    response_model=ApiResponse[App],
    responses={
        404: {"model": ApiResponse[None]},
        422: {"model": ValidationError}
    }
)
async def get_app(app_id: str):
    """Get application by ID."""
    pass
````

**Use shared models for consistency:**

````python
from hola_shared.models.app import App, AppCreateRequest
from hola_shared.models.response import ApiResponse

# This ensures CLI and server use identical data structures
````

**Document endpoints properly** for client generation:

````python
@router.post("/apps", 
    response_model=ApiResponse[App],
    summary="Create Application",
    description="Creates a new application with the specified configuration"
)
async def create_app(request: AppCreateRequest):
    """Create a new application.
    
    This endpoint creates a new application instance with the provided
    configuration and returns the created application details.
    """
    pass
````

### Client SDK Compatibility

**When adding new endpoints:**
1. Use `ApiResponse[T]` wrapper for all responses
2. Document error cases with `responses` parameter
3. Use shared models from `hola_shared.models`
4. Add comprehensive docstrings for OpenAPI documentation

**The generated client SDK will automatically include:**
- Type-safe functions for every endpoint
- Request/response serialization
- Error handling for documented status codes
- Proper authentication integration

## Components to Create for New Features

### 1. API Endpoint Module
Create a new router module in `api/`:

````python
"""Application management API endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from typing import List
from hola_shared.models.response import ApiResponse
from hola_shared.models.app import App, AppCreateRequest
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.app_service import AppService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

@router.get("/", response_model=ApiResponse[List[App]])
async def list_apps(
    context = Depends(get_context),
    api_key: str = Depends(get_api_key)
):
    """List all applications."""
    try:
        service = AppService(context)
        apps = await service.list_apps()
        return ApiResponse(success=True, data=apps)
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/", 
    response_model=ApiResponse[App],
    responses={
        422: {"description": "Validation error"},
        500: {"description": "Internal server error"}
    }
)
async def create_app(
    request: AppCreateRequest,
    context = Depends(get_context),
    api_key: str = Depends(get_api_key)
):
    """Create a new application."""
    try:
        service = AppService(context)
        app = await service.create_app(request)
        return ApiResponse(success=True, data=app)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/{app_id}", 
    response_model=ApiResponse[App],
    responses={
        404: {"description": "Application not found"},
        422: {"description": "Validation error"}
    }
)
async def get_app(
    app_id: str,
    context = Depends(get_context),
    api_key: str = Depends(get_api_key)
):
    """Get application by ID."""
    try:
        service = AppService(context)
        app = await service.get_app(app_id)
        return ApiResponse(success=True, data=app)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")
````

### 2. Service Layer
Create business logic services in `services/`:

````python
"""Application management service."""

from typing import List
from hola_shared.models.app import App, AppCreateRequest
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext

logger = get_logger(__name__)

class AppService:
    """Service for managing applications."""
    
    def __init__(self, context: ServerContext):
        """Initialize the service with server context.
        
        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.logger = get_logger(__name__)
        self._storage = context.get_storage()
        # Initialize any dependencies from context
        # e.g., self.docker = context.get_docker_client()
    
    async def list_apps(self) -> List[App]:
        """List all applications.
        
        Returns:
            List of application instances
        """
        self.logger.debug("Listing applications")
        try:
            # Implementation logic here
            apps = await self._storage.list_apps()
            self.logger.info(f"Retrieved {len(apps)} applications")
            return apps
        except Exception as e:
            self.logger.error(f"Failed to list applications: {e}")
            raise ServiceException(
                message="Failed to retrieve applications",
                service_name="App Storage",
                details={"error": str(e)}
            )
    
    async def create_app(self, request: AppCreateRequest) -> App:
        """Create a new application.
        
        Args:
            request: Application creation request
            
        Returns:
            Created application instance
            
        Raises:
            ValidationException: If request data is invalid
            ServiceException: If creation fails
        """
        self.logger.info(f"Creating application: {request.name}")
        
        # Validate using shared exceptions
        if not request.name:
            raise ValidationException(
                message="Application name is required",
                details={"field": "name"}
            )
        
        if len(request.name) > 100:
            raise ValidationException(
                message="Application name too long",
                details={"field": "name", "max_length": 100}
            )
        
        # Business logic with proper error handling
        try:
            app = await self._storage.create_app(request)
            self.logger.info(f"Created application {app.id}")
            return app
        except Exception as e:
            self.logger.error(f"Failed to create app: {e}")
            raise ServiceException(
                message="Failed to create application",
                service_name="App Storage",
                details={"error": str(e), "app_name": request.name}
            )
    
    async def get_app(self, app_id: str) -> App:
        """Get application by ID.
        
        Args:
            app_id: Application identifier
            
        Returns:
            Application instance
            
        Raises:
            ValidationException: If app_id is invalid
            NotFoundException: If application doesn't exist
        """
        if not app_id:
            raise ValidationException(
                message="Application ID is required",
                details={"field": "app_id"}
            )
        
        app = await self._storage.get_app(app_id)
        if not app:
            raise NotFoundException(
                message=f"Application {app_id} not found",
                details={"app_id": app_id}
            )
        return app
````

### 3. Service Base Classes (Optional)
For consistency across services:

````python
"""Base service classes and interfaces."""

from abc import ABC
from hola_shared.logger import get_logger
from ..config.context import ServerContext

class BaseService(ABC):
    """Base class for all services providing common functionality."""
    
    def __init__(self, context: ServerContext):
        """Initialize service with context.
        
        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.logger = get_logger(self.__class__.__name__)
        self.settings = context.settings
````

## Server-Wide Components Integration

### 1. Register Routes in Main App
Update `main.py`:

````python
# ...existing code...
from .api import hello, apps  # Add new import

# ...existing code...

app.include_router(hello.router, prefix="/hello", tags=["hello"])
app.include_router(apps.router, prefix="/apps", tags=["applications"])  # Add new router
````

### 2. Extend ServerContext for Dependencies
Update `context.py`:

````python
# ...existing code...
from typing import Optional
from functools import lru_cache
from .settings import Settings, get_settings

class ServerContext:
    """Server context for managing application state and dependencies."""
    
    def __init__(self, settings: Optional[Settings] = None):
        """Initialize the server context with optional configuration."""
        self.settings = settings or get_settings()
        # Initialize shared dependencies
        self._storage = None
        self._docker_client = None
    
    def get_storage(self):
        """Get or create storage instance."""
        if self._storage is None:
            # Initialize storage based on settings
            pass
        return self._storage
    
    def get_docker_client(self):
        """Get or create Docker client."""
        if self._docker_client is None:
            # Initialize Docker client
            pass
        return self._docker_client

# ...existing code...
````

### 3. Add Configuration Options
Update `settings.py` as needed:

````python
# ...existing code...
class Settings(BaseSettings):
    """Server configuration settings loaded from environment variables."""
    
    # ...existing code...
    
    # New feature-specific settings
    max_apps_per_user: int = 10
    app_storage_path: str = "./apps"
    enable_app_cleanup: bool = True
    
    # ...existing code...
````

## Dependency Injection Best Practices

### 1. Use FastAPI Dependencies
Always inject dependencies through FastAPI's dependency injection:

````python
@router.post("/")
async def create_app(
    request: AppCreateRequest,
    context: ServerContext = Depends(get_context),  # Server context
    api_key: str = Depends(get_api_key)            # Authentication
):
````

### 2. Service Layer Dependencies
Services receive context and resolve their own dependencies:

````python
class AppService:
    def __init__(self, context: ServerContext):
        self.context = context
        self.storage = context.get_storage()  # Resolve from context
        self.docker = context.get_docker_client()
````

### 3. Testing Dependencies
For testing, create fakes and override dependencies:

````python
from typing import List
from hola_shared.models.app import App, AppCreateRequest
from ...services.app_service import AppService

class FakeAppService:
    """Fake implementation of AppService for testing."""
    
    def __init__(self):
        self.apps: List[App] = []
        self.created_apps: List[AppCreateRequest] = []
        self.method_calls: List[Dict[str, Any]] = []
    
    async def list_apps(self) -> List[App]:
        self.method_calls.append({"method": "list_apps"})
        return self.apps.copy()
    
    async def create_app(self, request: AppCreateRequest) -> App:
        self.method_calls.append({"method": "create_app", "request": request})
        self.created_apps.append(request)
        app = App(id=f"app-{len(self.apps)}", name=request.name, status="created")
        self.apps.append(app)
        return app
    
    async def get_app(self, app_id: str) -> App:
        self.method_calls.append({"method": "get_app", "app_id": app_id})
        for app in self.apps:
            if app.id == app_id:
                return app
        raise NotFoundException(f"App {app_id} not found")
    
    def has_app(self, app_id: str) -> bool:
        """Helper for testing - check if app exists."""
        return any(app.id == app_id for app in self.apps)
    
    def reset(self) -> None:
        self.apps.clear()
        self.created_apps.clear()
        self.method_calls.clear()
````

## Testing Structure

### 1. Test Organization
Create feature-specific test directories:

```
tests/
├── apps/
│   ├── test_app_api.py      # API endpoint tests
│   ├── test_app_service.py  # Service layer tests
│   └── __init__.py
└── conftest.py              # Shared fixtures
```

### 2. Test Implementation Example

````python
"""Tests for application API endpoints."""

import pytest
from fastapi.testclient import TestClient
from hola_server.test_utils.fakes.fake_app_service import FakeAppService

def test_create_app_success(client: TestClient, fake_app_service: FakeAppService):
    """Test successful app creation."""
    response = client.post(
        "/apps/",
        json={"name": "test-app"},
        headers={"X-API-Key": "test-key"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["name"] == "test-app"
    assert len(fake_app_service.created_apps) == 1

def test_create_app_validation_error(client: TestClient, fake_app_service: FakeAppService):
    """Test app creation with validation error."""
    response = client.post(
        "/apps/",
        json={"name": ""},  # Empty name should fail validation
        headers={"X-API-Key": "test-key"}
    )
    
    assert response.status_code == 422
    assert "name is required" in response.json()["detail"]

def test_get_app_not_found(client: TestClient, fake_app_service: FakeAppService):
    """Test getting non-existent app."""
    response = client.get(
        "/apps/nonexistent",
        headers={"X-API-Key": "test-key"}
    )
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"]
````

### 3. Advanced Testing with Fakes

**Create domain-specific fakes** that can be shared:

````python
# hola_shared/hola_shared/test_utils/fakes/app_storage.py
class FakeAppStorage:
    """Fake storage implementation for testing app persistence."""
    
    def __init__(self):
        self._apps: Dict[str, App] = {}
        self._next_id = 1
    
    async def store_app(self, app: App) -> App:
        if not app.id:
            app.id = f"app-{self._next_id}"
            self._next_id += 1
        self._apps[app.id] = app
        return app
    
    async def get_app(self, app_id: str) -> Optional[App]:
        return self._apps.get(app_id)
    
    async def list_apps(self) -> List[App]:
        return list(self._apps.values())
    
    def has_app(self, app_id: str) -> bool:
        """Helper for testing - check if app exists."""
        return app_id in self._apps
    
    def reset(self) -> None:
        self._apps.clear()
        self._next_id = 1

# Use in server tests with dependency injection
def test_create_app_with_storage(fake_app_storage):
    # Override the storage dependency
    app.dependency_overrides[get_storage] = lambda: fake_app_storage
    
    response = client.post("/apps/", json={"name": "test-app"})
    assert response.status_code == 200
    assert fake_app_storage.has_app("app-1")
````

## Summary

When adding new features to hola_server:

1. **Create API endpoint** in `api/` with proper dependency injection and error handling
2. **Implement service layer** in `services/` with business logic using shared exceptions
3. **Register routes** in `main.py` with proper OpenAPI documentation
4. **Extend ServerContext** if new dependencies are needed
5. **Add configuration** to `settings.py` as required
6. **Create fakes** for testing in `test_utils/fakes/` with domain-specific behavior
7. **Write tests** organized by feature with comprehensive error case coverage

This approach maintains separation of concerns, enables proper testing with fakes, leverages FastAPI's dependency injection system effectively, and ensures consistency with the generated client SDK.

## When to Use or Extend hola_shared

### 1. Shared Data Models
Add new models to `hola_shared/models/` when:
- The model will be used by both server and CLI components
- Creating API request/response structures that need consistency
- Defining domain objects that cross component boundaries

````python
# Add to hola_shared/hola_shared/models/app.py
from pydantic import BaseModel
from typing import Optional, List, Dict
from enum import Enum

class AppStatus(str, Enum):
    """Application status enumeration."""
    CREATED = "created"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"

class App(BaseModel):
    """Application model shared between server and CLI."""
    id: str
    name: str
    status: AppStatus
    port: Optional[int] = None
    created_at: Optional[str] = None

class AppCreateRequest(BaseModel):
    """Request model for creating applications."""
    name: str
    port: Optional[int] = None
    environment: Optional[Dict[str, str]] = None
````

### 2. Error Handling
Use `hola_shared.errors` for custom exceptions that need to be handled consistently:

````python
# Server service using shared exceptions
from hola_shared.errors import ValidationException, NotFoundException

class AppService:
    async def get_app(self, app_id: str) -> App:
        if not app_id:
            raise ValidationException(
                message="Application ID is required",
                details={"field": "app_id"}
            )
        
        app = await self._find_app(app_id)
        if not app:
            raise NotFoundException(
                message=f"Application {app_id} not found"
            )
        return app
````

### 3. Logging Configuration
Use `hola_shared.logger` for consistent logging setup:

````python
# Server main.py or service initialization
from hola_shared.logger import configure_logging, get_logger

# Configure logging at startup
configure_logging(level="DEBUG")

# Get logger in services
from hola_shared.logger import get_logger
logger = get_logger(__name__)
````

### 4. Environment Variables
Add shared environment utilities when both components need the same environment configuration:

````python
# Add to hola_shared if both server and CLI need these
from hola_shared.environment import Environment

class SharedConfig:
    """Configuration shared between server and CLI."""
    docker_host: str = Environment.get("DOCKER_HOST", "unix:///var/run/docker.sock")
    app_storage_path: str = Environment.get("APP_STORAGE_PATH", "./apps")
    log_level: str = Environment.get("LOG_LEVEL", "INFO")
````

### 5. API Response Structure
Always use `ApiResponse` for server endpoints to maintain consistency with CLI expectations:

````python
# Server API endpoint
from hola_shared.models.response import ApiResponse

@router.get("/apps", response_model=ApiResponse[List[App]])
async def list_apps():
    apps = await service.list_apps()
    return ApiResponse(success=True, data=apps)

@router.get("/apps/{app_id}", response_model=ApiResponse[App])
async def get_app(app_id: str):
    try:
        app = await service.get_app(app_id)
        return ApiResponse(success=True, data=app)
    except NotFoundException as e:
        return ApiResponse(
            success=False,
            error=ApiError(code="NOT_FOUND", message=str(e))
        )
````

### 6. Test Utilities and Fakes
Add shared test fakes to `hola_shared/test_utils/fakes/` when:
- Multiple packages need the same fake implementation
- Creating domain-specific fakes that represent shared concepts

````python
# Add to hola_shared/hola_shared/test_utils/fakes/app_storage.py
from typing import List, Optional, Dict
from hola_shared.models.app import App

class FakeAppStorage:
    """Fake storage implementation for testing app persistence."""
    
    def __init__(self):
        self._apps: Dict[str, App] = {}
        self._next_id = 1
    
    async def store_app(self, app: App) -> App:
        if not app.id:
            app.id = f"app-{self._next_id}"
            self._next_id += 1
        self._apps[app.id] = app
        return app
    
    async def get_app(self, app_id: str) -> Optional[App]:
        return self._apps.get(app_id)
    
    async def list_apps(self) -> List[App]:
        return list(self._apps.values())
    
    def reset(self) -> None:
        self._apps.clear()
        self._next_id = 1
````

## Integration with Component-Specific Code

### Server-Side Integration
````python
# hola_server/hola_server/services/app_service.py
from hola_shared.models.app import App, AppCreateRequest, AppStatus
from hola_shared.errors import ValidationException, NotFoundException
from hola_shared.logger import get_logger

logger = get_logger(__name__)

class AppService:
    async def create_app(self, request: AppCreateRequest) -> App:
        if not request.name:
            raise ValidationException(
                message="Application name is required",
                details={"field": "name"}
            )
        
        # Business logic here
        return App(
            id="app-123",
            name=request.name,
            status=AppStatus.CREATED
        )
````

### CLI-Side Integration
````python
# hola_cli commands would use the same models
from hola_shared.models.app import App
from hola_shared.models.response import ApiResponse

def handle_app_list(response_data: ApiResponse[List[App]]):
    if response_data.success:
        for app in response_data.data:
            console.print(f"App: {app.name} (Status: {app.status})")
    else:
        console.print(f"Error: {response_data.error.message}")
````

### Testing Integration
````python
# Both server and CLI tests can use shared fakes
from hola_shared.test_utils.fakes.app_storage import FakeAppStorage

@pytest.fixture
def fake_app_storage():
    storage = FakeAppStorage()
    yield storage
    storage.reset()
````

## Guidelines for Adding to hola_shared

**Decision Checklist: Should this go in hola_shared?**

Ask yourself these questions in order:

1. **Will the CLI also need this exact same data structure/interface?**
   - ✅ Yes → Add to `hola_shared/models/`
   - ❌ No → Keep in server component

2. **Is this an error that both server and CLI need to handle consistently?**
   - ✅ Yes → Use existing or add to `hola_shared.errors`
   - ❌ No → Use server-specific error handling

3. **Will multiple test suites need this fake implementation?**
   - ✅ Yes → Add to `hola_shared/test_utils/fakes/`
   - ❌ No → Keep in server-specific test utilities

4. **Is this configuration used by both server and CLI?**
   - ✅ Yes → Add to `hola_shared` config utilities
   - ❌ No → Keep in server-specific config

5. **Does this enforce a contract between server and CLI?**
   - ✅ Yes → Belongs in `hola_shared`
   - ❌ No → Keep in server component

**Add to hola_shared when:**
- Data structures are used by both server and CLI
- Error types need consistent handling across components
- Test utilities represent shared domain concepts
- Configuration affects multiple components
- The functionality enforces cross-component contracts

**Keep in server component when:**
- Logic is specific to server implementation (FastAPI routes, middleware)
- Dependencies are server-specific (FastAPI, databases)
- Presentation logic differs from CLI implementation
- Internal server state management and caching

**Update shared models when:**
- Adding new fields that both components need
- Changing validation rules that affect API contracts
- Adding new status values or enum options
- Modifying error structures or response formats

## Configuration Integration

### Configuration Best Practices

**Use shared configuration** when both components need the same settings:

````python
# hola_shared/hola_shared/config.py
from hola_shared.environment import Environment

class SharedAppConfig:
    """Configuration shared between server and CLI."""
    max_apps_per_user: int = Environment.get_int("MAX_APPS_PER_USER", 10)
    app_timeout: int = Environment.get_int("APP_TIMEOUT", 300)
    enable_app_monitoring: bool = Environment.get_bool("ENABLE_APP_MONITORING", True)

# hola_server/hola_server/config/settings.py
from hola_shared.config import SharedAppConfig

class Settings(BaseSettings):
    # Server-specific settings
    port: int = 8000
    host: str = "0.0.0.0"
    
    # Include shared config
    app_config: SharedAppConfig = SharedAppConfig()
````

**Service layer configuration access:**

````python
class AppService:
    def __init__(self, context: ServerContext):
        self.context = context
        self.settings = context.settings
        self.app_config = self.settings.app_config
    
    async def create_app(self, request: AppCreateRequest) -> App:
        # Use shared configuration
        if len(self.apps) >= self.app_config.max_apps_per_user:
            raise ValidationException(
                message="Maximum number of apps reached",
                details={"max_apps": self.app_config.max_apps_per_user}
            )
````

## Practical Implementation Workflow

When implementing a new server feature, follow this step-by-step workflow:

### Step 1: Define Shared Models (If needed)
```bash
# Create shared models first if they don't exist
touch hola_shared/hola_shared/models/your_feature.py
```

### Step 2: Implement Shared Models
Use the patterns shown above to create domain objects, request/response models, and enums.

### Step 3: Create Server Service
Implement your service class using the shared models and standard error handling patterns.

### Step 4: Create API Endpoints
Implement endpoints that use the service and follow the established patterns for error handling and OpenAPI documentation.

### Step 5: Create Test Fakes
Create fakes for testing, placing them in `hola_shared` if they represent shared domain concepts.

### Step 6: Write Tests
Write comprehensive tests using the fakes and shared models.

### Step 7: Register Routes
Add your router to the main FastAPI application.

### Example File Structure for a New Feature
```
hola_shared/hola_shared/models/
├── your_feature.py                    # Shared domain models

hola_server/hola_server/
├── api/
│   └── your_feature.py                # API endpoints
├── services/
│   └── your_feature_service.py        # Business logic
└── test_utils/fakes/
    └── fake_your_feature_service.py   # Server-specific fakes

hola_server/tests/
├── api/
│   └── test_your_feature_api.py       # API endpoint tests
└── services/
    └── test_your_feature_service.py   # Service tests
```

## Key Principles for Extension

1. **OpenAPI Consistency**: Ensure all endpoints generate proper client SDK types
2. **Dependency Injection**: Always use `ServerContext` for service dependencies
3. **Error Handling**: Use the structured exception types from `hola_shared.errors`
4. **Service Patterns**: Follow consistent service layer patterns with logging
5. **Testing**: Create fakes, not mocks, for business dependencies
6. **Documentation**: Add comprehensive OpenAPI documentation for client generation
7. **Shared Contracts**: Use `hola_shared` for data models and interfaces that cross component boundaries

This architecture ensures consistency, testability, and maintainability as you add new features to the server while maintaining compatibility with the generated client SDK.