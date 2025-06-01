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
- `start_app`: Start an application.
- `stop_app`: Stop an application.
- `restart_app`: Restart an application.

Dependencies:
- `get_app_service`: Provides the app service instance with dependency injection.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse  # Added import
from typing import List
import uuid
from hola_shared.models.response import ApiResponse, ApiError  # Added ApiError import
from hola_shared.models.app import (
    App,
    AppCreateRequest,
    AppCreateResponse,
    AppDeployRequest,
    AppUpgradeRequest,
    AppActionResponse,
    AppListResponse,
    AppDeployResponse,
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.app_service import AppService
from ..config.context import get_context
from ..utils.api_logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def get_app_service(context=Depends(get_context)) -> AppService:
    """Get app service instance with dependency injection."""
    return AppService(context)


@router.post("/", response_model=ApiResponse[AppCreateResponse])
async def create_app(
    request: AppCreateRequest,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Create a new application without deploying it.

    Creates a new application in CREATED status that can be deployed later.
    This allows setting up application configuration before actual deployment.

    Args:
        request (AppCreateRequest): Application creation configuration.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppCreateResponse]: Creation response with app details.

    Raises:
        ValidationException: If the app name already exists or configuration is invalid.
        Exception: If the creation process fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = "/api/apps"

    try:
        response = await service.create_app(request)
        return ApiResponse(
            success=True,
            data=response,
            message="Application created successfully",
            request_id=request_id,
        )
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error creating app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.post("/deploy", response_model=ApiResponse[AppDeployResponse])
async def deploy_app(
    request: AppDeployRequest,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Deploy a new application.

    Creates and deploys a new application with the provided configuration.
    The deployment process includes container creation, network setup,
    and health monitoring.

    Args:
        request (AppDeployRequest): Application deployment configuration.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppDeployResponse]: Deployment response with app details and deployment ID.

    Raises:
        ValidationException: If the app name already exists or configuration is invalid.
        Exception: If the deployment process fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = "/api/apps/deploy"

    try:
        result = await service.deploy_app(request)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR",
                    message="Internal server error during app deployment",
                ),
            ).model_dump(exclude_none=True),
        )


@router.get("/", response_model=ApiResponse[AppListResponse])
async def list_apps(
    service: AppService = Depends(get_app_service), api_key: str = Depends(get_api_key)
):
    """List all deployed applications.

    Retrieves a list of all applications with their current status,
    health information, and metadata.

    Args:
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppListResponse]: List of all applications with metadata.

    Raises:
        Exception: If the retrieval of applications fails.
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = "/api/apps"

    try:
        result = await service.list_apps()

        return ApiResponse(success=True, data=result)
    except (
        ServiceException
    ) as e:  # ServiceException should be treated as a server error
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
                error=ApiError(
                    code="SERVER_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error listing apps"
                ),
            ).model_dump(exclude_none=True),
        )


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
        Exception: If the retrieval of app details fails.
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/apps/{app_name}"

    try:
        result = await service.get_app(app_name)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error retrieving app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.post("/{app_name}/upgrade", response_model=ApiResponse[AppDeployResponse])
async def upgrade_app(
    app_name: str,
    request: AppUpgradeRequest,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Upgrade an application.

    Upgrades an existing application with new configuration or image.
    Optionally creates a backup before performing the upgrade.

    Args:
        app_name (str): Name of the application to upgrade.
        request (AppUpgradeRequest): Upgrade configuration.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppDeployResponse]: Upgrade response with updated app details.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the configuration is invalid.
        Exception: If the upgrade process fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/upgrade"

    try:
        result = await service.upgrade_app(app_name, request)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error upgrading app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.delete("/{app_name}", response_model=ApiResponse[AppActionResponse])
async def delete_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Remove a deployed application.

    Completely removes an application including its containers, data,
    and configuration. This operation cannot be undone.

    Args:
        app_name (str): Name of the application to delete.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppActionResponse]: Action response confirming deletion.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid.
        Exception: If the deletion process fails.
    """
    request_id = str(uuid.uuid4())
    method = "DELETE"
    path = f"/api/apps/{app_name}"

    try:
        result = await service.delete_app(app_name)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error deleting app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.post("/{app_name}/start", response_model=ApiResponse[AppActionResponse])
async def start_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Start an application.

    Starts a stopped application and monitors its health status.

    Args:
        app_name (str): Name of the application to start.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppActionResponse]: Action response with status change information.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid or app cannot be started.
        Exception: If the start operation fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/start"

    try:
        result = await service.start_app(app_name)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error starting app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.post("/{app_name}/stop", response_model=ApiResponse[AppActionResponse])
async def stop_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Stop an application.

    Gracefully stops a running application.

    Args:
        app_name (str): Name of the application to stop.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppActionResponse]: Action response with status change information.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid or app cannot be stopped.
        Exception: If the stop operation fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/stop"

    try:
        result = await service.stop_app(app_name)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error stopping app"
                ),
            ).model_dump(exclude_none=True),
        )


@router.post("/{app_name}/restart", response_model=ApiResponse[AppActionResponse])
async def restart_app(
    app_name: str,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Restart an application.

    Stops and then starts an application, useful for applying configuration
    changes or recovering from errors.

    Args:
        app_name (str): Name of the application to restart.
        service (AppService): App service instance.
        api_key (str): API key for authentication.

    Returns:
        ApiResponse[AppActionResponse]: Action response with status change information.

    Raises:
        NotFoundException: If the application is not found.
        ValidationException: If the app name is invalid or app cannot be restarted.
        Exception: If the restart operation fails.
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/restart"

    try:
        result = await service.restart_app(app_name)

        return ApiResponse(success=True, data=result)
    except ValidationException as e:
        log_api_error(
            logger,
            request_id=request_id,
            method=method,
            path=path,
            status_code=422,
            error_message=str(e),
        )
        return JSONResponse(
            status_code=422,
            content=ApiResponse(
                success=False,
                error=ApiError(
                    code="VALIDATION_ERROR",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                success=False,
                error=ApiError(
                    code="NOT_FOUND",
                    message=str(e),
                    details=e.details if hasattr(e, "details") else None,
                ),
            ).model_dump(exclude_none=True),
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
                error=ApiError(
                    code="SERVER_ERROR", message="Internal server error restarting app"
                ),
            ).model_dump(exclude_none=True),
        )
