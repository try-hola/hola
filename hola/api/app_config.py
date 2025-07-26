"""Configuration API endpoints.

This module provides REST API endpoints for managing application configurations,
including CRUD operations for configuration entries.

Endpoints:
- `get_app_config`: Retrieve all configurations for a specific application.
- `list_config_entries`: List all configuration entries for an application.
- `get_config_entry`: Retrieve a specific configuration entry.
- `create_config_entry`: Create a new configuration entry.
- `update_config_entry`: Update an existing configuration entry.
- `delete_config_entry`: Delete a specific configuration entry.
- `delete_app_config`: Delete all configurations for an application.

Dependencies:
- `get_config_service`: Provides the configuration service.
- `get_app_service`: Provides the app service with configuration delegation.
"""

import uuid
import time
from typing import Any
from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse

from hola.models.response import ApiResponse, ApiError
from hola.models.config import (
    ConfigCreateRequest,
    ConfigUpdateRequest,
    ConfigResponse,
    ConfigListResponse,
    ConfigEntryResponse,
)
from hola.models.errors import ValidationException, NotFoundException, ServiceException
from hola.utils.logging import get_logger
from ..auth import get_api_key
from ..config.context import ServerContext, get_context
from ..utils.api_logging import log_api_error
from ..services.app_service import AppService

logger = get_logger(__name__)
router = APIRouter()


def get_config_service(context: ServerContext = Depends(get_context)):
    """Dependency to get configuration service."""
    return context.get_config_service()


def get_app_service(context: ServerContext = Depends(get_context)) -> AppService:
    """Dependency to get app service with configuration delegation."""
    return AppService(context)


@router.get("/{app_name}", response_model=ApiResponse[ConfigResponse])
async def get_app_config(
    app_name: str,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Retrieve all configurations for a specific application.

    Args:
        app_name (str): Name of the application.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Configuration response with app config.

    Raises:
        ValidationException: If the app name is invalid.
        NotFoundException: If the application is not found.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/config/{app_name}"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json", exclude_none=True),
        )

    try:
        response = await app_service.get_app_config(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
        )

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json", exclude_none=True),
        )

    except NotFoundException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=404,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json", exclude_none=True),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVER_ERROR", message=str(e))
            ).model_dump(mode="json", exclude_none=True),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="SERVER_ERROR", message="Internal server error"),
            ).model_dump(mode="json", exclude_none=True),
        )


@router.get("/{app_name}/entries", response_model=ApiResponse[ConfigListResponse])
async def list_config_entries(
    app_name: str,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """List all configuration entries for a specific application.

    Args:
        app_name (str): Name of the application.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Configuration list response.

    Raises:
        ValidationException: If the app name is invalid.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/config/{app_name}/entries"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        response = await app_service.list_config_entries(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
        )

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.get(
    "/{app_name}/entries/{key}", response_model=ApiResponse[ConfigEntryResponse]
)
async def get_config_entry(
    app_name: str,
    key: str,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Retrieve a specific configuration entry.

    Args:
        app_name (str): Name of the application.
        key (str): Configuration key.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Configuration entry response.

    Raises:
        ValidationException: If the app name or key is invalid.
        NotFoundException: If the entry is not found.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/config/{app_name}/entries/{key}"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    if not key or not key.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="Configuration key cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="Configuration key cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        response = await app_service.get_config_entry(app_name, key)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
        )

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except NotFoundException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=404,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.post(
    "/{app_name}/entries",
    response_model=ApiResponse[ConfigEntryResponse],
    status_code=status.HTTP_201_CREATED,
)
async def create_config_entry(
    app_name: str,
    request: ConfigCreateRequest,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Create a new configuration entry.

    Args:
        app_name (str): Name of the application.
        request (ConfigCreateRequest): Configuration creation request.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Configuration entry response.

    Raises:
        ValidationException: If the app name or key is invalid.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/config/{app_name}/entries"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    if not request.key or not request.key.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="Configuration key cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="Configuration key cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        response = await app_service.create_config_entry(app_name, request)

        return JSONResponse(
            status_code=201,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
        )

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.put(
    "/{app_name}/entries/{key}", response_model=ApiResponse[ConfigEntryResponse]
)
async def update_config_entry(
    app_name: str,
    key: str,
    request: ConfigUpdateRequest,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Update an existing configuration entry.

    Args:
        app_name (str): Name of the application.
        key (str): Configuration key.
        request (ConfigUpdateRequest): Configuration update request.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Configuration entry response.

    Raises:
        ValidationException: If the app name or key is invalid.
        NotFoundException: If the entry is not found.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "PUT"
    path = f"/api/config/{app_name}/entries/{key}"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    if not key or not key.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="Configuration key cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="Configuration key cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        response = await app_service.update_config_entry(app_name, key, request)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
        )

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except NotFoundException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=404,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.delete("/{app_name}/entries/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config_entry(
    app_name: str,
    key: str,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Delete a specific configuration entry.

    Args:
        app_name (str): Name of the application.
        key (str): Configuration key.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Raises:
        ValidationException: If the app name or key is invalid.
        NotFoundException: If the entry is not found.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "DELETE"
    path = f"/api/config/{app_name}/entries/{key}"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    if not key or not key.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="Configuration key cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="Configuration key cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        await app_service.delete_config_entry(app_name, key)

        return JSONResponse(status_code=204, content=None)

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except NotFoundException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=404,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.delete("/{app_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_app_config(
    app_name: str,
    app_service=Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Delete all configurations for an application.

    Args:
        app_name (str): Name of the application.
        app_service: App service with configuration delegation.
        api_key (str): API key for authentication.

    Raises:
        ValidationException: If the app name is invalid.
        ServiceException: If there is an internal server error.
    """
    request_id = str(uuid.uuid4())
    method = "DELETE"
    path = f"/api/config/{app_name}"

    if not app_name or not app_name.strip():
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message="App name cannot be empty",
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR", message="App name cannot be empty"
                ),
            ).model_dump(mode="json"),
        )

    try:
        await app_service.delete_app_config(app_name)

        return JSONResponse(status_code=204, content=None)

    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=400,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )

    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=500,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )
