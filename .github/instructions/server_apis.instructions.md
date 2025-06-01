---
applyTo: "/hola_server/hola_server/api/*.py"
---

# Server APIs Development Instructions

## Overview

This document provides comprehensive guidelines for developing FastAPI endpoints in the hola_server package. All API endpoints must follow these established patterns to ensure consistency, proper error handling, and seamless integration with the client SDK.

## Core Principles

- **Consistency**: All endpoints follow identical patterns for imports, setup, error handling, and responses
- **Type Safety**: Strong typing with Pydantic models and generic ApiResponse wrappers
- **Error Handling**: Structured exception handling with specific HTTP status codes and error types
- **Logging**: Comprehensive request/response logging with correlation IDs
- **Authentication**: Uniform API key authentication across all endpoints
- **Documentation**: Complete OpenAPI specifications for client SDK generation

## Standard API Module Template

### Required Imports

Every API module must include these standard imports:

```python
"""Module docstring describing the API endpoints."""

from fastapi import APIRouter, Depends, Path, Body, Query, Request
from fastapi.responses import JSONResponse
from typing import Optional, List, Dict, Any
import uuid
import time
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..config.context import get_context, ServerContext
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

# Import specific models for your feature
from hola_shared.models.your_feature import YourModel, YourRequest, YourResponse

# Import your service
from ..services.your_service import YourService
```

### Router Setup

```python
router = APIRouter(prefix="/api/your-feature", tags=["your-feature"])
logger = get_logger(__name__)
```

### Service Dependency Injection

```python
def get_your_service(context: ServerContext = Depends(get_context)) -> YourService:
    """Get service instance with dependency injection."""
    return YourService(context)
```

## Endpoint Implementation Pattern

### Complete Endpoint Template

```python
@router.get("/items/{item_id}", response_model=ApiResponse[YourResponse])
async def get_item(
    request: Request,
    item_id: str = Path(..., description="Item identifier"),
    optional_param: Optional[str] = Query(None, description="Optional parameter"),
    service: YourService = Depends(get_your_service),
    api_key: str = Depends(get_api_key)
) -> JSONResponse:
    """Get item by ID.
    
    Detailed endpoint description for OpenAPI documentation.
    """
    # Generate request ID for correlation
    request_id = str(uuid.uuid4())
    method = request.method
    path = request.url.path
    
    try:
        # Business logic through service layer
        result = await service.get_item(item_id, optional_param)
        
        # Return success response
        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=result
            ).model_dump(mode='json')
        )
        
    except ValidationException as e:
        log_api_error(logger, request_id=request_id, method=method, path=path, status_code=400, error_message=str(e))
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, 
                error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode='json')
        )
    except NotFoundException as e:
        log_api_error(logger, request_id=request_id, method=method, path=path, status_code=404, error_message=str(e))
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, 
                error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode='json')
        )
    except ServiceException as e:
        log_api_error(logger, request_id=request_id, method=method, path=path, status_code=500, error_message=str(e))
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, 
                error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode='json')
        )
    except Exception as e:
        log_api_error(logger, request_id=request_id, method=method, path=path, status_code=500, error_message=str(e))
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, 
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error")
            ).model_dump(mode='json')
        )
```

## Response Handling Standards

### Success Responses

All successful responses must use `ApiResponse[T]` wrapper:

```python
# Single item response
return JSONResponse(
    status_code=200,
    content=ApiResponse(success=True, data=item).model_dump(mode='json')
)

# List response
return JSONResponse(
    status_code=200,
    content=ApiResponse(success=True, data=items).model_dump(mode='json')
)

# Create response (201)
return JSONResponse(
    status_code=201,
    content=ApiResponse(success=True, data=created_item).model_dump(mode='json')
)

# No content response (204) - special case, no ApiResponse wrapper
return Response(status_code=204)
```

### Error Response Standards

#### HTTP Status Code Mapping

- **400**: `ValidationException` → `VALIDATION_ERROR`
- **404**: `NotFoundException` → `NOT_FOUND`
- **422**: `ValidationException` with details → `VALIDATION_ERROR`
- **500**: `ServiceException` → `SERVICE_ERROR`
- **500**: Generic `Exception` → `INTERNAL_ERROR`

#### Error Response Format

```python
# Standard error response
return JSONResponse(
    status_code=status_code,
    content=ApiResponse(
        success=False, 
        error=ApiError(
            code="ERROR_CODE", 
            message=str(exception),
            details=getattr(exception, 'details', None)  # Optional details
        )
    ).model_dump(mode='json', exclude_none=True)
)
```

## Authentication Requirements

### API Key Authentication

All endpoints must include API key authentication:

```python
async def your_endpoint(
    api_key: str = Depends(get_api_key),  # Required for all endpoints
    # ... other parameters
):
```

### Public Endpoints

For truly public endpoints (rare), omit the `api_key` dependency, but document why:

```python
@router.get("/health")  # Public health check
async def health_check():
    # No api_key dependency - public endpoint
```

## Logging Standards

### Request Context

Every endpoint must generate a request ID and capture request context:

```python
request_id = str(uuid.uuid4())
method = request.method
path = request.url.path
```

### Error Logging

Use the standardized `log_api_error` function:

```python
log_api_error(
    logger, 
    request_id=request_id, 
    method=method, 
    path=path, 
    status_code=status_code, 
    error_message=str(exception)
)
```

### Success Logging (Optional)

For important operations, add success logging:

```python
logger.info(f"Operation completed successfully (request_id: {request_id})")
```

## Dependency Injection Patterns

### Service Dependencies

Create service dependency functions for each service:

```python
def get_your_service(context: ServerContext = Depends(get_context)) -> YourService:
    """Get service instance with dependency injection."""
    return YourService(context)
```

### Context Dependencies

Always use `ServerContext` for service initialization:

```python
async def your_endpoint(
    context: ServerContext = Depends(get_context),  # For direct context access
    service: YourService = Depends(get_your_service),  # Preferred: use service dependency
):
```

## Request/Response Models

### OpenAPI Response Models

All endpoints must specify explicit response models:

```python
@router.get("/items", response_model=ApiResponse[List[Item]])
@router.get("/items/{id}", response_model=ApiResponse[Item])
@router.post("/items", response_model=ApiResponse[Item], status_code=201)
@router.put("/items/{id}", response_model=ApiResponse[Item])
@router.delete("/items/{id}", status_code=204)  # No response model for 204
```

### Parameter Documentation

Document all parameters with descriptions:

```python
async def get_items(
    app_name: str = Path(..., description="Application name"),
    limit: int = Query(100, ge=1, le=1000, description="Number of items to return"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    search: Optional[str] = Query(None, description="Search term"),
):
```

### Request Body Models

Use Pydantic models for request bodies:

```python
@router.post("/items", response_model=ApiResponse[Item])
async def create_item(
    request_data: ItemCreateRequest = Body(...),  # Use Body() for explicit request body
    service: ItemService = Depends(get_item_service),
    api_key: str = Depends(get_api_key)
):
```

## Error Handling Best Practices

### Exception Hierarchy

Handle exceptions in this specific order:

```python
try:
    # Business logic
    result = await service.method()
    return success_response(result)
    
except ValidationException as e:
    # 400 - Client validation errors
    return validation_error_response(e)
    
except NotFoundException as e:
    # 404 - Resource not found
    return not_found_error_response(e)
    
except ServiceException as e:
    # 500 - Known service errors
    return service_error_response(e)
    
except Exception as e:
    # 500 - Unexpected errors
    return internal_error_response(e)
```

### Custom Error Details

For validation errors with details:

```python
except ValidationException as e:
    return JSONResponse(
        status_code=400,
        content=ApiResponse(
            success=False,
            error=ApiError(
                code="VALIDATION_ERROR",
                message=str(e),
                details=e.details if hasattr(e, 'details') else None
            )
        ).model_dump(exclude_none=True)
    )
```

## File Operations

### File Upload Endpoints

```python
from fastapi import UploadFile, File

@router.post("/upload", response_model=ApiResponse[FileInfo])
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    path: Optional[str] = None,
    service: FileService = Depends(get_file_service),
    api_key: str = Depends(get_api_key)
):
    request_id = str(uuid.uuid4())
    
    try:
        file_info = await service.upload_file(file, path)
        return JSONResponse(
            status_code=201,
            content=ApiResponse(success=True, data=file_info).model_dump(mode='json')
        )
    except ValidationException as e:
        # Handle file validation errors (size, type, etc.)
        log_api_error(logger, request_id=request_id, method=request.method, path=request.url.path, status_code=400, error_message=str(e))
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode='json')
        )
    # ... standard error handling
```

## Streaming Responses

For large data or real-time responses:

```python
from fastapi.responses import StreamingResponse

@router.get("/stream")
async def stream_data(
    api_key: str = Depends(get_api_key)
) -> StreamingResponse:
    async def generate_data():
        # Yield data chunks
        for chunk in data_source:
            yield json.dumps(chunk) + "\n"
    
    return StreamingResponse(
        generate_data(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache"}
    )
```

## Router Registration

### Main Application Integration

In `main.py`, register your router:

```python
from .api import your_feature

app.include_router(your_feature.router)
```

### Router Module Structure

Organize routers by feature in the `api/` package:

```
api/
├── __init__.py
├── apps.py           # Application management
├── backup.py         # Backup operations
├── logs.py           # Log management
├── metrics.py        # Metrics collection
├── server.py         # Server status/health
├── your_feature.py   # Your new feature
```

## Docstring Guidelines

### Module Docstrings

Every API module must include a comprehensive module-level docstring:

```python
"""Application management API endpoints.

This module provides REST API endpoints for managing applications including
deployment, lifecycle operations, and status monitoring.

Endpoints:
- `create_app`: Create a new application without deploying it.
- `deploy_app`: Deploy a new application.
- `list_apps`: List all deployed applications.
- `get_app`: Get details about a deployed application.
- `upgrade_app`: Upgrade an application.
- `delete_app`: Remove a deployed application.

Dependencies:
- `get_app_service`: Provides the app service instance with dependency injection.
"""
```

Required module docstring elements:
1. **Summary Line**: Brief one-line description of the module's purpose
2. **Detailed Description**: Paragraph explaining what the module provides
3. **Endpoints Section**: List all endpoints with format `- `endpoint_name`: Description.`
4. **Dependencies Section**: List all service dependencies used by endpoints

### Function Docstrings

Endpoint docstrings must follow the Google Python Style Guide format:

```python
@router.get("/{app_name}", response_model=ApiResponse[App])
async def get_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Get details about a deployed application.

    Retrieves detailed information about a specific application including
    its configuration, current status, health metrics, and metadata.

    Args:
        app_name (str): Name of the application to retrieve.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[App]: Application details.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid.
        ServiceException: If the retrieval of app details fails.
    """
```

Required function docstring elements:

1. **Summary Line**: Brief one-line description of what the endpoint does 
2. **Detailed Description**: 1-3 sentences explaining purpose and behavior
3. **Args Section**:
   - List all parameters including dependencies
   - Format: `param_name (type): Description.`
4. **Returns Section**:
   - Describe the response model and structure
   - Format: `ApiResponse[Type]: Description.`  
5. **Raises Section**:
   - List all exceptions that might be raised
   - Order: ValidationException, NotFoundException, ServiceException, Exception
   - Format: `ExceptionType: Description of when this occurs.`

### Dependency Function Docstrings

Dependency functions should have concise one-line docstrings:

```python
def get_app_service(context=Depends(get_context)) -> AppService:
    """Get app service instance with dependency injection."""
    return AppService(context)
```

### Docstring Style Rules

1. **Consistency**: Use imperative mood for summary lines ("Get details" not "Gets details")
2. **Completeness**: Document all parameters, returns, and possible exceptions
3. **Clarity**: Explain the "why" and edge cases, not just the obvious functionality
4. **No Type Duplication**: Don't repeat type information already in annotations
5. **Parameter Ordering**: Document all parameters in the same order they appear in the signature

### Advanced Docstrings

For complex endpoints, consider adding code examples in docstrings:

```python
"""Create a new application.

Creates a new application in CREATED status that can be deployed later.
This allows setting up application configuration before actual deployment.

Example:
    ```
    POST /api/apps
    {
        "name": "my-app",
        "image": "nginx:latest",
        "port": 80
    }
    ```

Args:
    ...
"""
```

### API Versioning in Docstrings

When an API endpoint changes behavior or parameters, update the docstring accordingly:

```python
"""Deploy an application.

Deploys an application using the provided configuration.

Version Changes:
    - v1.2.0: Added support for environment variables through `env_vars` parameter
    - v1.1.0: Added `replicas` parameter for scaling deployments
    - v1.0.0: Initial implementation

Args:
    ...
"""
```

### Docstring Maintenance

1. **Keep Synchronized**: Update docstrings whenever endpoint behavior changes
2. **Be Explicit About Breaking Changes**: Note when parameters become required or change meaning
3. **Review Docstrings**: Include docstrings in code reviews to maintain quality and accuracy
4. **Check Generated API Docs**: Verify that docstrings render correctly in OpenAPI documentation

### Special Case Docstrings

#### Streaming Response Endpoints

For endpoints that return streaming responses, include details about the stream format:

```python
@router.get("/{app_name}/logs")
async def stream_logs(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Stream application logs in real-time.
    
    Returns a Server-Sent Events (SSE) stream of log entries as they are generated.
    Each event contains a single log entry in JSON format.
    
    Args:
        app_name (str): Name of the application to stream logs from.
        service (AppService): App service instance.
        api_key (str): API key for authentication.
        
    Returns:
        StreamingResponse: A streaming response with the following format:
            data: {"timestamp": "2023-01-01T12:00:00Z", "level": "INFO", "message": "Log message"}
            
    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid.
    """
```

#### Middleware Docstrings

For middleware components, document the request flow and modifications:

```python
@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    """Validate API key for protected endpoints.
    
    Extracts API key from X-API-Key header and validates it against configuration.
    Public endpoints (health, metrics) are exempt from this check.
    
    Flow:
    1. Check if endpoint is in public_endpoints list
    2. For protected endpoints, extract and validate API key
    3. If valid, attach API key to request state and proceed
    4. If invalid, return 401 Unauthorized response
    
    Args:
        request (Request): FastAPI request object
        call_next (Callable): Next middleware in chain
        
    Returns:
        Response: Either the next middleware's response or a 401 error
    """
```

## Testing Requirements

### Test File Structure

Create corresponding test files:

```
tests/api/
├── test_apps_api.py
├── test_your_feature_api.py
```

### Test Patterns

Follow established testing patterns with fakes:

```python
def test_get_item_success(client, fake_your_service):
    """Test successful item retrieval."""
    # Arrange
    item_id = "test-item"
    expected_item = YourModel(id=item_id, name="Test Item")
    fake_your_service.register_response("get_item", expected_item)
    
    # Act
    response = client.get(
        f"/api/your-feature/items/{item_id}",
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["data"]["id"] == item_id
```

## Documentation Standards

### Endpoint Docstrings

Write comprehensive docstrings for OpenAPI:

```python
@router.post("/items", response_model=ApiResponse[Item])
async def create_item(
    request_data: ItemCreateRequest,
    service: ItemService = Depends(get_item_service),
    api_key: str = Depends(get_api_key)
):
    """Create a new item.
    
    Creates a new item with the provided data. The item name must be unique
    within the application scope.
    
    Args:
        request_data: Item creation data including name and configuration
        
    Returns:
        ApiResponse containing the created item with generated ID and timestamps
        
    Raises:
        ValidationException: When item data is invalid or name conflicts exist
        ServiceException: When the underlying storage system is unavailable
    """
```

### Error Response Documentation

Document error responses in the decorator:

```python
@router.get("/items/{id}", 
    response_model=ApiResponse[Item],
    responses={
        404: {"description": "Item not found"},
        422: {"description": "Invalid item ID format"}
    }
)
```

## Performance Considerations

### Async/Await

All endpoint functions must be async:

```python
async def your_endpoint():  # Always async
    result = await service.async_method()  # Await async operations
    return response
```

### Pagination

For list endpoints, implement pagination:

```python
@router.get("/items", response_model=ApiResponse[List[Item]])
async def list_items(
    limit: int = Query(100, ge=1, le=1000, description="Items per page"),
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    service: ItemService = Depends(get_item_service),
    api_key: str = Depends(get_api_key)
):
    items = await service.list_items(limit=limit, offset=offset)
    return success_response(items)
```

### Response Caching

For expensive operations, consider caching:

```python
from fastapi import Header

@router.get("/expensive-data")
async def get_expensive_data(
    if_none_match: Optional[str] = Header(None),
    service: DataService = Depends(get_data_service),
    api_key: str = Depends(get_api_key)
):
    # Implement ETag-based caching
    data, etag = await service.get_cached_data()
    
    if if_none_match == etag:
        return Response(status_code=304)  # Not Modified
    
    return JSONResponse(
        content=ApiResponse(success=True, data=data).model_dump(mode='json'),
        headers={"ETag": etag}
    )
```

## Security Considerations

### Input Validation

Always validate inputs through Pydantic models:

```python
from pydantic import validator, Field

class ItemRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    config: Dict[str, Any] = Field(default_factory=dict)
    
    @validator('name')
    def validate_name(cls, v):
        if not v.strip():
            raise ValueError('Name cannot be empty or whitespace')
        return v.strip()
```

### Sensitive Data

Never log sensitive information:

```python
# ❌ Don't log sensitive data
logger.info(f"API key: {api_key}")

# ✅ Log safe information only
logger.info(f"Request processed (request_id: {request_id})")
```

### Rate Limiting

For high-traffic endpoints, consider rate limiting:

```python
# Future: Implement rate limiting middleware
# This is a placeholder for future implementation
```

## Migration and Versioning

### API Versioning

When breaking changes are needed:

```python
# Create new versioned router
router_v2 = APIRouter(prefix="/api/v2/your-feature", tags=["your-feature-v2"])

# Maintain backward compatibility in v1
router_v1 = APIRouter(prefix="/api/your-feature", tags=["your-feature"])
```

### Deprecation

Mark deprecated endpoints:

```python
@router.get("/old-endpoint", deprecated=True)
async def old_endpoint():
    """This endpoint is deprecated. Use /new-endpoint instead."""
    # Implementation with deprecation warning
```

## Common Patterns Summary

### Must-Have in Every Endpoint:
1. **Request ID generation**: `request_id = str(uuid.uuid4())`
2. **Request context capture**: `method = request.method; path = request.url.path`
3. **API key authentication**: `api_key: str = Depends(get_api_key)`
4. **Service dependency injection**: `service: YourService = Depends(get_your_service)`
5. **ApiResponse wrapper**: All responses use `ApiResponse[T]`
6. **JSONResponse**: Return `JSONResponse` with `.model_dump(mode='json')`
7. **Structured error handling**: Handle ValidationException, NotFoundException, ServiceException, Exception
8. **Error logging**: Use `log_api_error()` for all exceptions
9. **OpenAPI response model**: `response_model=ApiResponse[T]`

### Optional but Recommended:
1. **Parameter descriptions**: Document all Path, Query, Body parameters
2. **Comprehensive docstrings**: Full endpoint documentation
3. **Response caching**: For expensive operations
4. **Pagination**: For list endpoints
5. **Success logging**: For important operations

This instruction set ensures all server APIs maintain consistency, proper error handling, and seamless integration with the generated client SDK.