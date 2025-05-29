"""Configuration API endpoints.

This module provides REST API endpoints for managing application configurations
including CRUD operations for configuration entries.
"""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from hola_shared.models.config import (
    ConfigCreateRequest, ConfigUpdateRequest, ConfigResponse,
    ConfigListResponse, ConfigEntryResponse
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext, get_context
from ..utils.logging import log_api_error
from ..services.app_service import AppService

logger = get_logger(__name__)
router = APIRouter()


def get_config_service(context: ServerContext = Depends(get_context)):
    """Dependency to get configuration service."""
    return context.get_config_service()


def get_app_service(context: ServerContext = Depends(get_context)) -> AppService:
    """Dependency to get app service with configuration delegation."""
    return AppService(context)


@router.get("/{app_name}", response_model=ConfigResponse)
async def get_app_config(
    app_name: str,
    app_service=Depends(get_app_service)
) -> ConfigResponse:
    """Get all configuration for an application.
    
    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        
    Returns:
        Configuration response with app config
        
    Raises:
        HTTPException: If validation fails or app not found
    """
    request_id = f"get-config-{app_name}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")

    try:
        response = await app_service.get_app_config(app_name)
        return response
        
    except ValidationException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except NotFoundException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}", 404, str(e))
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}", 500, str(e))
        logger.exception(f"Unexpected error getting config for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/{app_name}/entries", response_model=ConfigListResponse)
async def list_config_entries(
    app_name: str,
    app_service=Depends(get_app_service)
) -> ConfigListResponse:
    """List all configuration entries for an application.
    
    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        
    Returns:
        Configuration list response
        
    Raises:
        HTTPException: If validation fails
    """
    request_id = f"list-config-{app_name}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")

    try:
        response = await app_service.list_config_entries(app_name)
        return response
        
    except ValidationException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries", 500, str(e))
        logger.exception(f"Unexpected error listing config entries for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/{app_name}/entries/{key}", response_model=ConfigEntryResponse)
async def get_config_entry(
    app_name: str,
    key: str,
    app_service=Depends(get_app_service)
) -> ConfigEntryResponse:
    """Get a specific configuration entry.
    
    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        
    Returns:
        Configuration entry response
        
    Raises:
        HTTPException: If validation fails or entry not found
    """
    request_id = f"get-config-entry-{app_name}-{key}"

    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not key or not key.strip():
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 400, "Configuration key cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configuration key cannot be empty")

    try:
        response = await app_service.get_config_entry(app_name, key)
        return response
        
    except ValidationException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except NotFoundException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 404, str(e))
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "GET", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        logger.exception(f"Unexpected error getting config entry {key} for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.post("/{app_name}/entries", response_model=ConfigEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_config_entry(
    app_name: str,
    request: ConfigCreateRequest,
    app_service=Depends(get_app_service)
) -> ConfigEntryResponse:
    """Create a new configuration entry.
    
    Args:
        app_name: Name of the application
        request: Configuration creation request
        app_service: App service with configuration delegation
        
    Returns:
        Configuration entry response
        
    Raises:
        HTTPException: If validation fails or entry already exists
    """
    request_id = f"create-config-entry-{app_name}-{request.key}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "POST", f"/api/config/{app_name}/entries", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not request.key or not request.key.strip():
        log_api_error(logger, request_id, "POST", f"/api/config/{app_name}/entries", 400, "Configuration key cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configuration key cannot be empty")

    try:
        response = await app_service.create_config_entry(app_name, request)
        return response
        
    except ValidationException as e:
        log_api_error(logger, request_id, "POST", f"/api/config/{app_name}/entries", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "POST", f"/api/config/{app_name}/entries", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "POST", f"/api/config/{app_name}/entries", 500, str(e))
        logger.exception(f"Unexpected error creating config entry for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.put("/{app_name}/entries/{key}", response_model=ConfigEntryResponse)
async def update_config_entry(
    app_name: str,
    key: str,
    request: ConfigUpdateRequest,
    app_service=Depends(get_app_service)
) -> ConfigEntryResponse:
    """Update an existing configuration entry.
    
    Args:
        app_name: Name of the application
        key: Configuration key
        request: Configuration update request
        app_service: App service with configuration delegation
        
    Returns:
        Configuration entry response
        
    Raises:
        HTTPException: If validation fails or entry not found
    """
    request_id = f"update-config-entry-{app_name}-{key}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not key or not key.strip():
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 400, "Configuration key cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configuration key cannot be empty")

    try:
        response = await app_service.update_config_entry(app_name, key, request)
        return response
        
    except ValidationException as e:
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except NotFoundException as e:
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 404, str(e))
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "PUT", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        logger.exception(f"Unexpected error updating config entry {key} for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.delete("/{app_name}/entries/{key}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_config_entry(
    app_name: str,
    key: str,
    app_service=Depends(get_app_service)
) -> None:
    """Delete a configuration entry.
    
    Args:
        app_name: Name of the application
        key: Configuration key
        app_service: App service with configuration delegation
        
    Raises:
        HTTPException: If validation fails or entry not found
    """
    request_id = f"delete-config-entry-{app_name}-{key}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not key or not key.strip():
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 400, "Configuration key cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Configuration key cannot be empty")

    try:
        await app_service.delete_config_entry(app_name, key)

    except ValidationException as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except NotFoundException as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 404, str(e))
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}/entries/{key}", 500, str(e))
        logger.exception(f"Unexpected error deleting config entry {key} for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.delete("/{app_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_app_config(
    app_name: str,
    app_service=Depends(get_app_service)
) -> None:
    """Delete all configuration for an application.
    
    Args:
        app_name: Name of the application
        app_service: App service with configuration delegation
        
    Raises:
        HTTPException: If validation fails
    """
    request_id = f"delete-app-config-{app_name}"
    
    if not app_name or not app_name.strip():
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")

    try:
        await app_service.delete_app_config(app_name)

    except ValidationException as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}", 400, str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    
    except ServiceException as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}", 500, str(e))
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    
    except Exception as e:
        log_api_error(logger, request_id, "DELETE", f"/api/config/{app_name}", 500, str(e))
        logger.exception(f"Unexpected error deleting config for app {app_name}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
