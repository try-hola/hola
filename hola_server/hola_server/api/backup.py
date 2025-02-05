"""Backup and restore API endpoints.

This module provides REST API endpoints for application backup creation,
management, and restore operations.
"""

from fastapi import APIRouter, Depends, Path, Body
from fastapi.responses import JSONResponse
from typing import Optional
import uuid
import time
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.backup import (
    BackupInfo,
    BackupCreateRequest,
    BackupCreateResponse,
    BackupListResponse,
    RestoreRequest,
    RestoreResponse,
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.backup_service import BackupService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter(prefix="/api/apps", tags=["backup"])
logger = get_logger(__name__)


def get_backup_service(context=Depends(get_context)) -> BackupService:
    """Get backup service instance with dependency injection."""
    return BackupService(context)


@router.post("/{app_name}/backups", response_model=ApiResponse[BackupCreateResponse])
async def create_backup(
    app_name: str = Path(..., description="Application name"),
    request: BackupCreateRequest = Body(...),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service),
):
    """Create a new backup for an application.

    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters

    Returns:
        Created backup information
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/backups"

    try:
        logger.info(f"Creating backup for application: {app_name}")
        response = await backup_service.create_backup(app_name, request)

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


@router.get("/{app_name}/backups", response_model=ApiResponse[BackupListResponse])
async def list_backups(
    app_name: str = Path(..., description="Application name"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service),
):
    """List all backups for an application.

    Args:
        app_name: Application name to list backups for

    Returns:
        List of backup information
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/apps/{app_name}/backups"

    try:
        logger.info(f"Listing backups for application: {app_name}")
        response = await backup_service.list_backups(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
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


@router.get("/{app_name}/backups/{backup_id}", response_model=ApiResponse[BackupInfo])
async def get_backup_info(
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service),
):
    """Get backup information by ID.

    Args:
        app_name: Application name
        backup_id: Backup identifier

    Returns:
        Backup information details
    """
    request_id = str(uuid.uuid4())
    method = "GET"
    path = f"/api/apps/{app_name}/backups/{backup_id}"

    try:
        logger.info(f"Getting backup info: {backup_id} for app: {app_name}")
        backup_info = await backup_service.get_backup_info(backup_id)

        # Verify the backup belongs to the specified app
        if backup_info.app_name != app_name:
            log_api_error(
                logger,
                request_id=request_id,
                method=method,
                path=path,
                status_code=404,
                error_message=f"Backup {backup_id} not found for application {app_name}",
            )
            return JSONResponse(
                status_code=404,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="NOT_FOUND",
                        message=f"Backup {backup_id} not found for application {app_name}",
                    ),
                ).model_dump(mode="json"),
            )

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=backup_info).model_dump(mode="json"),
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


@router.delete("/{app_name}/backups/{backup_id}")
async def delete_backup(
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service),
):
    """Delete a backup.

    Args:
        app_name: Application name
        backup_id: Backup identifier to delete

    Returns:
        Success confirmation
    """
    request_id = str(uuid.uuid4())
    method = "DELETE"
    path = f"/api/apps/{app_name}/backups/{backup_id}"

    try:
        logger.info(f"Deleting backup: {backup_id} for app: {app_name}")

        # Verify the backup belongs to the specified app
        backup_info = await backup_service.get_backup_info(backup_id)
        if backup_info.app_name != app_name:
            log_api_error(
                logger,
                request_id=request_id,
                method=method,
                path=path,
                status_code=404,
                error_message=f"Backup {backup_id} not found for application {app_name}",
            )
            return JSONResponse(
                status_code=404,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="NOT_FOUND",
                        message=f"Backup {backup_id} not found for application {app_name}",
                    ),
                ).model_dump(mode="json"),
            )

        await backup_service.delete_backup(backup_id)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=None).model_dump(mode="json"),
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


@router.post(
    "/{app_name}/backups/{backup_id}/restore",
    response_model=ApiResponse[RestoreResponse],
)
async def restore_backup(
    request: RestoreRequest,
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service),
):
    """Restore an application from a backup.

    Args:
        app_name: Application name
        backup_id: Backup identifier to restore from
        request: Restore operation parameters

    Returns:
        Restore operation information
    """
    request_id = str(uuid.uuid4())
    method = "POST"
    path = f"/api/apps/{app_name}/backups/{backup_id}/restore"

    try:
        logger.info(f"Restoring backup: {backup_id} for app: {app_name}")

        # Verify the backup belongs to the specified app
        backup_info = await backup_service.get_backup_info(backup_id)
        if backup_info.app_name != app_name:
            log_api_error(
                logger,
                request_id=request_id,
                method=method,
                path=path,
                status_code=404,
                error_message=f"Backup {backup_id} not found for application {app_name}",
            )
            return JSONResponse(
                status_code=404,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="NOT_FOUND",
                        message=f"Backup {backup_id} not found for application {app_name}",
                    ),
                ).model_dump(mode="json"),
            )

        # Set the backup_id in the request if not already set
        if not request.backup_id:
            request.backup_id = backup_id

        response = await backup_service.restore_backup(backup_id, request)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=response).model_dump(mode="json"),
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
