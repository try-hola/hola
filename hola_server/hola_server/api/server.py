"""Server status and health API endpoints.

This module provides REST API endpoints for server status, health checks, and resource usage information.
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
    """Get server service instance with dependency injection."""
    return ServerService(context)


@router.get("/status", response_model=ApiResponse[ServerStatus])
async def get_server_status(
    request: Request,
    api_key: str = Depends(get_api_key),
    server_service: ServerService = Depends(get_server_service),
):
    """Get complete server status information.

    Returns:
        Complete server status including health, version, and resource usage
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

    Returns:
        Health check results for all server components
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

    Returns:
        Server version details including build information
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

    Returns:
        Current server resource usage including CPU, memory, and disk
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
