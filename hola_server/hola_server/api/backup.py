"""Backup and restore API endpoints.

This module provides REST API endpoints for application backup creation,
management, and restore operations.
"""

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import JSONResponse
from typing import Optional
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.backup import (
    BackupInfo, BackupCreateRequest, BackupCreateResponse,
    BackupListResponse, RestoreRequest, RestoreResponse
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.backup_service import BackupService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter(prefix="/api/apps", tags=["backup"])
logger = get_logger(__name__)


def get_backup_service(context = Depends(get_context)) -> BackupService:
    """Get backup service instance with dependency injection."""
    return BackupService(context)


@router.post("/{app_name}/backups", response_model=ApiResponse[BackupCreateResponse])
async def create_backup(
    app_name: str = Path(..., description="Application name"),
    request: BackupCreateRequest = BackupCreateRequest(),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service)
):
    """Create a new backup for an application.
    
    Args:
        app_name: Name of the application to backup
        request: Backup creation parameters
        
    Returns:
        Created backup information
    """
    try:
        logger.info(f"Creating backup for application: {app_name}")
        response = await backup_service.create_backup(app_name, request)
        
        return ApiResponse(
            success=True,
            data=response,
            message=f"Backup creation initiated for {app_name}"
        )
        
    except ValidationException as e:
        logger.warning(f"Validation error creating backup: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundException as e:
        logger.warning(f"Application not found: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        logger.error(f"Service error creating backup: {str(e)}")
        log_api_error(logger, "create_backup", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error creating backup: {str(e)}")
        log_api_error(logger, "create_backup", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{app_name}/backups", response_model=ApiResponse[BackupListResponse])
async def list_backups(
    app_name: str = Path(..., description="Application name"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service)
):
    """List all backups for an application.
    
    Args:
        app_name: Application name to list backups for
        
    Returns:
        List of backup information
    """
    try:
        logger.info(f"Listing backups for application: {app_name}")
        response = await backup_service.list_backups(app_name)
        
        return ApiResponse(
            success=True,
            data=response,
            message=f"Found {response.total_count} backups for {app_name}"
        )
        
    except ServiceException as e:
        logger.error(f"Service error listing backups: {str(e)}")
        log_api_error(logger, "list_backups", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error listing backups: {str(e)}")
        log_api_error(logger, "list_backups", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{app_name}/backups/{backup_id}", response_model=ApiResponse[BackupInfo])
async def get_backup_info(
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service)
):
    """Get backup information by ID.
    
    Args:
        app_name: Application name
        backup_id: Backup identifier
        
    Returns:
        Backup information details
    """
    try:
        logger.info(f"Getting backup info: {backup_id} for app: {app_name}")
        backup_info = await backup_service.get_backup_info(backup_id)
        
        # Verify the backup belongs to the specified app
        if backup_info.app_name != app_name:
            raise HTTPException(
                status_code=404, 
                detail=f"Backup {backup_id} not found for application {app_name}"
            )
        
        return ApiResponse(
            success=True,
            data=backup_info,
            message=f"Backup information retrieved for {backup_id}"
        )
        
    except NotFoundException as e:
        logger.warning(f"Backup not found: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except ServiceException as e:
        logger.error(f"Service error getting backup info: {str(e)}")
        log_api_error(logger, "get_backup_info", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error getting backup info: {str(e)}")
        log_api_error(logger, "get_backup_info", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{app_name}/backups/{backup_id}")
async def delete_backup(
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service)
):
    """Delete a backup.
    
    Args:
        app_name: Application name
        backup_id: Backup identifier to delete
        
    Returns:
        Success confirmation
    """
    try:
        logger.info(f"Deleting backup: {backup_id} for app: {app_name}")
        
        # Verify the backup belongs to the specified app
        backup_info = await backup_service.get_backup_info(backup_id)
        if backup_info.app_name != app_name:
            raise HTTPException(
                status_code=404, 
                detail=f"Backup {backup_id} not found for application {app_name}"
            )
        
        await backup_service.delete_backup(backup_id)
        
        return ApiResponse(
            success=True,
            data=None,
            message=f"Backup {backup_id} deleted successfully"
        )
        
    except NotFoundException as e:
        logger.warning(f"Backup not found: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except ValidationException as e:
        logger.warning(f"Validation error deleting backup: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except ServiceException as e:
        logger.error(f"Service error deleting backup: {str(e)}")
        log_api_error(logger, "delete_backup", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error deleting backup: {str(e)}")
        log_api_error(logger, "delete_backup", e)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/{app_name}/backups/{backup_id}/restore", response_model=ApiResponse[RestoreResponse])
async def restore_backup(
    request: RestoreRequest,
    app_name: str = Path(..., description="Application name"),
    backup_id: str = Path(..., description="Backup identifier"),
    api_key: str = Depends(get_api_key),
    backup_service: BackupService = Depends(get_backup_service)
):
    """Restore an application from a backup.
    
    Args:
        app_name: Application name
        backup_id: Backup identifier to restore from
        request: Restore operation parameters
        
    Returns:
        Restore operation information
    """
    try:
        logger.info(f"Restoring backup: {backup_id} for app: {app_name}")
        
        # Verify the backup belongs to the specified app
        backup_info = await backup_service.get_backup_info(backup_id)
        if backup_info.app_name != app_name:
            raise HTTPException(
                status_code=404, 
                detail=f"Backup {backup_id} not found for application {app_name}"
            )
        
        # Set the backup_id in the request if not already set
        if not request.backup_id:
            request.backup_id = backup_id
        
        response = await backup_service.restore_backup(backup_id, request)
        
        return ApiResponse(
            success=True,
            data=response,
            message=f"Restore operation initiated from backup {backup_id}"
        )
        
    except NotFoundException as e:
        logger.warning(f"Backup not found: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except ValidationException as e:
        logger.warning(f"Validation error restoring backup: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    except ServiceException as e:
        logger.error(f"Service error restoring backup: {str(e)}")
        log_api_error(logger, "restore_backup", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"Unexpected error restoring backup: {str(e)}")
        log_api_error(logger, "restore_backup", e)
        raise HTTPException(status_code=500, detail="Internal server error")
