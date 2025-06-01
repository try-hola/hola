"""Server status and health API endpoints.

This module provides REST API endpoints for server status monitoring,
health checks, version information, and resource usage reporting.

Endpoints:
- `get_server_status`: Get complete server status information.
- `get_health_check`: Run server health checks.
- `get_version_info`: Get server version information.
- `get_resource_usage`: Get server resource usage metrics.

Dependencies:
- `get_server_service`: Provides the server service instance.
"""

import uuid
import time
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.server import (
    ServerStatus,
    HealthStatus,
    VersionInfo,
    ResourceUsage,
)
from hola_shared.errors import ServiceException
from ..auth import get_api_key
from ..services.server_service import ServerService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter(prefix="/api/server", tags=["server"])
logger = get_logger(__name__)


def get_server_service(context=Depends(get_context)) -> ServerService:
    """Get server service instance with dependency injection.

    Args:
        context (ServerContext): Server context containing configuration and dependencies.

    Returns:
        ServerService: Configured server service instance for status and health checks.
    """
    return ServerService(context)


@router.get("/status", response_model=ApiResponse[ServerStatus])
async def get_server_status(
    request: Request,
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service),
):
    """Get complete server status information.

    Retrieves comprehensive status information about the server including health
    status of all components, version information, and current resource usage.
    This endpoint provides a complete overview of the server's operational state.

    Args:
        request (Request): FastAPI request object.
        api_key (str): API key for authentication.
        server_service (ServerService): Server service instance with dependencies.

    Returns:
        JSONResponse: Server status response containing:
                    - Health status of all components
                    - Version information
                    - Resource usage metrics
                    - Uptime information

    Raises:
        ServiceException: If there is an error retrieving server status.
    """
    request_id = str(uuid.uuid4())

    try:
        status = await server_service.get_server_status()

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=status).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=e.status_code,
            error_message=str(e),
        )

        return JSONResponse(
            status_code=e.status_code,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
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


@router.get("/health", response_model=ApiResponse[HealthStatus])
async def get_health_check(
    request: Request,
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service),
):
    """Run server health checks.

    Executes health checks on all server components and dependencies including
    database connections, file system access, external services, and system resources.
    This endpoint is used for monitoring the operational status of the server.

    Args:
        request (Request): FastAPI request object.
        api_key (str): API key for authentication.
        server_service (ServerService): Server service instance with dependencies.

    Returns:
        JSONResponse: Health check response containing:
                    - Overall status (healthy, degraded, unhealthy)
                    - Component-level health status
                    - Timestamps for checks
                    - Error details for unhealthy components

    Raises:
        ServiceException: If there is an error executing health checks.
    """
    request_id = str(uuid.uuid4())

    try:
        health = await server_service.get_health_check()

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=health).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=e.status_code,
            error_message=str(e),
        )

        return JSONResponse(
            status_code=e.status_code,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
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


@router.get("/version", response_model=ApiResponse[VersionInfo])
async def get_version_info(
    request: Request,
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service),
):
    """Get server version information.

    Retrieves detailed version information about the server, including version numbers,
    build time, git commit hash, and dependency versions. This endpoint is useful
    for tracking the deployed server version and debugging version-specific issues.

    Args:
        request (Request): FastAPI request object.
        api_key (str): API key for authentication.
        server_service (ServerService): Server service instance with dependencies.

    Returns:
        JSONResponse: Version information response containing:
                    - Server version number
                    - Build timestamp
                    - Git commit hash
                    - API version
                    - Framework and dependency versions

    Raises:
        ServiceException: If there is an error retrieving version information.
    """
    request_id = str(uuid.uuid4())

    try:
        version = await server_service.get_version()

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=version).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=e.status_code,
            error_message=str(e),
        )

        return JSONResponse(
            status_code=e.status_code,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
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


@router.get("/resources", response_model=ApiResponse[ResourceUsage])
async def get_resource_usage(
    request: Request,
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service),
):
    """Get server resource usage metrics.

    Retrieves current resource utilization metrics for the server, including CPU usage,
    memory consumption, disk space, network throughput, and other system resource metrics.
    This endpoint is useful for monitoring server performance and capacity planning.

    Args:
        request (Request): FastAPI request object.
        api_key (str): API key for authentication.
        server_service (ServerService): Server service instance with dependencies.

    Returns:
        JSONResponse: Resource usage metrics containing:
                    - CPU usage (percentage, load averages)
                    - Memory usage (used, free, total)
                    - Disk usage (used, free, total)
                    - Network throughput
                    - Process information (count, resource usage)

    Raises:
        ServiceException: If there is an error retrieving resource metrics.
    """
    request_id = str(uuid.uuid4())

    try:
        resources = await server_service.get_resource_usage()

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=resources).model_dump(mode="json"),
        )

    except ServiceException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            status_code=e.status_code,
            error_message=str(e),
        )

        return JSONResponse(
            status_code=e.status_code,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=request.method,
            path=request.url.path,
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
