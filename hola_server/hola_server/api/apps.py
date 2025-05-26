"""Application management API endpoints.

This module provides REST API endpoints for managing applications including
deployment, lifecycle operations, and status monitoring.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import List
from hola_shared.models.response import ApiResponse
from hola_shared.models.app import (
    App, AppDeployRequest, AppUpgradeRequest, AppActionResponse,
    AppListResponse, AppDeployResponse
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.app_service import AppService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def get_app_service(context = Depends(get_context)) -> AppService:
    """Get app service instance with dependency injection."""
    return AppService(context)


@router.post("/deploy", response_model=ApiResponse[AppDeployResponse])
async def deploy_app(
    request: AppDeployRequest,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Deploy a new application.
    
    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.
    
    Args:
        request: Application deployment configuration
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Deployment response with app details and deployment ID
        
    Raises:
        422: Validation error - app name already exists or invalid configuration
        500: Internal server error - deployment process failed
    """
    try:
        result = await service.deploy_app(request)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/", response_model=ApiResponse[AppListResponse])
async def list_apps(
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """List all deployed applications.
    
    Retrieves a list of all applications with their current status,
    health information, and metadata.
    
    Args:
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        List of all applications with metadata
        
    Raises:
        500: Internal server error - failed to retrieve applications
    """
    try:
        result = await service.list_apps()
        return ApiResponse(success=True, data=result)
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{app_name}", response_model=ApiResponse[App])
async def get_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Get details about a deployed application.
    
    Retrieves detailed information about a specific application including
    its configuration, current status, health metrics, and metadata.
    
    Args:
        app_name: Name of the application to retrieve
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Application details
        
    Raises:
        404: Application not found
        422: Validation error - invalid app name
        500: Internal server error
    """
    try:
        result = await service.get_app(app_name)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{app_name}/upgrade", response_model=ApiResponse[AppDeployResponse])
async def upgrade_app(
    app_name: str,
    request: AppUpgradeRequest,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Upgrade an application.
    
    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.
    
    Args:
        app_name: Name of the application to upgrade
        request: Upgrade configuration
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Upgrade response with updated app details
        
    Raises:
        404: Application not found
        422: Validation error - invalid configuration
        500: Internal server error - upgrade process failed
    """
    try:
        result = await service.upgrade_app(app_name, request)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{app_name}", response_model=ApiResponse[AppActionResponse])
async def delete_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Remove a deployed application.
    
    Completely removes an application including its containers, data,
    and configuration. This operation cannot be undone.
    
    Args:
        app_name: Name of the application to delete
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Action response confirming deletion
        
    Raises:
        404: Application not found
        422: Validation error - invalid app name
        500: Internal server error - deletion failed
    """
    try:
        result = await service.delete_app(app_name)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{app_name}/start", response_model=ApiResponse[AppActionResponse])
async def start_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Start an application.
    
    Starts a stopped application and monitors its health status.
    
    Args:
        app_name: Name of the application to start
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Action response with status change information
        
    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be started
        500: Internal server error - start operation failed
    """
    try:
        result = await service.start_app(app_name)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{app_name}/stop", response_model=ApiResponse[AppActionResponse])
async def stop_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Stop an application.
    
    Gracefully stops a running application.
    
    Args:
        app_name: Name of the application to stop
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Action response with status change information
        
    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be stopped
        500: Internal server error - stop operation failed
    """
    try:
        result = await service.stop_app(app_name)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{app_name}/restart", response_model=ApiResponse[AppActionResponse])
async def restart_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Restart an application.
    
    Stops and then starts an application, useful for applying configuration
    changes or recovering from errors.
    
    Args:
        app_name: Name of the application to restart
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Action response with status change information
        
    Raises:
        404: Application not found
        422: Validation error - invalid app name or app cannot be restarted
        500: Internal server error - restart operation failed
    """
    try:
        result = await service.restart_app(app_name)
        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=422, detail=str(e))
    except NotFoundException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        log_api_error(logger, e)
        raise HTTPException(status_code=500, detail="Internal server error")
