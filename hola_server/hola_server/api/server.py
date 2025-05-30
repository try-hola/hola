"""Server status and health API endpoints.

This module provides REST API endpoints for server status monitoring,
health checks, and resource usage information.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.server import (
    ServerStatus, HealthStatus, VersionInfo, ResourceUsage
)
from hola_shared.errors import ServiceException
from ..auth import get_api_key
from ..services.server_service import ServerService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter(prefix="/api/server", tags=["server"])
logger = get_logger(__name__)


def get_server_service(context = Depends(get_context)) -> ServerService:
    """Get server service instance with dependency injection."""
    return ServerService(context)


@router.get("/status", response_model=ApiResponse[ServerStatus])
async def get_server_status(
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service)
):
    """Get complete server status information.
    
    Returns:
        Complete server status including health, version, and resource usage
    """
    try:
        logger.info("Getting server status")
        status = await server_service.get_server_status()
        
        return ApiResponse(
            success=True,
            data=status,
            message="Server status retrieved successfully"
        )
        
    except ServiceException as e:
        logger.error(f"Service error getting server status: {str(e)}")
        log_api_error(logger, "get_server_status", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error getting server status: {str(e)}")
        log_api_error(logger, "get_server_status", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health", response_model=ApiResponse[HealthStatus])
async def get_health_check(
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service)
):
    """Run server health checks.
    
    Returns:
        Health check results for all server components
    """
    try:
        logger.info("Running server health checks")
        health = await server_service.get_health_check()
        
        return ApiResponse(
            success=True,
            data=health,
            message="Health check completed successfully"
        )
        
    except ServiceException as e:
        logger.error(f"Service error running health check: {str(e)}")
        log_api_error(logger, "get_health_check", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error running health check: {str(e)}")
        log_api_error(logger, "get_health_check", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/version", response_model=ApiResponse[VersionInfo])
async def get_version_info(
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service)
):
    """Get server version information.
    
    Returns:
        Server version details including build information
    """
    try:
        logger.info("Getting server version information")
        version = await server_service.get_version()
        
        return ApiResponse(
            success=True,
            data=version,
            message="Version information retrieved successfully"
        )
        
    except ServiceException as e:
        logger.error(f"Service error getting version info: {str(e)}")
        log_api_error(logger, "get_version_info", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error getting version info: {str(e)}")
        log_api_error(logger, "get_version_info", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/resources", response_model=ApiResponse[ResourceUsage])
async def get_resource_usage(
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service)
):
    """Get server resource usage metrics.
    
    Returns:
        Current server resource usage including CPU, memory, and disk
    """
    try:
        logger.info("Getting server resource usage")
        resources = await server_service.get_resource_usage()
        
        return ApiResponse(
            success=True,
            data=resources,
            message="Resource usage retrieved successfully"
        )
        
    except ServiceException as e:
        logger.error(f"Service error getting resource usage: {str(e)}")
        log_api_error(logger, "get_resource_usage", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error getting resource usage: {str(e)}")
        log_api_error(logger, "get_resource_usage", e)
        raise HTTPException(status_code=500, detail="Internal server error")
