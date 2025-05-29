"""API endpoints for application file management.

This module provides REST API endpoints for managing application files including
uploads, listings, downloads, and deletions.
"""

import io
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Path, Response, status
from fastapi.responses import StreamingResponse, JSONResponse
from typing import List, Optional
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.file import FileInfo, FileListResponse
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.app_service import AppService
from ..config.context import get_context
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

def get_app_service(context = Depends(get_context)) -> AppService:
    """Get app service with dependency injection."""
    return AppService(context)

@router.get("/", response_model=ApiResponse[FileListResponse])
async def list_files(
    app_name: str = Path(..., description="Name of the application"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """List all files for an application.
    
    Args:
        app_name: Name of the application
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        List of files for the application
        
    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error
    """
    if not app_name or not app_name.strip():
        log_api_error(logger, None, "GET", f"/api/apps/{app_name}/files", 400, "App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")

    try:
        file_list = await service.list_app_files(app_name)
        return ApiResponse(success=True, data=file_list)
    except NotFoundException as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files", status_code=404, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except ValidationException as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files", status_code=400, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except Exception as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files", status_code=500, error_message=str(e))
        # Convert generic exceptions to HolaException for consistent handling
        from hola_shared.errors import ServiceException
        raise ServiceException(
            message="An unexpected error occurred while listing files",
            service_name="file_service",
            details={"error": str(e)}
        ) from e

@router.post("/", response_model=ApiResponse[FileInfo])
async def upload_file(
    app_name: str = Path(..., description="Name of the application"),
    file: UploadFile = File(...),
    path: Optional[str] = None,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Upload a file for the application.
    
    Args:
        app_name: Name of the application
        file: File to upload
        path: Target path within the application's file storage
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Information about the uploaded file
        
    Raises:
        400: Validation error
        404: Application not found
        500: Internal server error
    """
    if not app_name or not app_name.strip():
        log_api_error(logger, method="POST", path=f"/api/apps/{app_name}/files", status_code=400, error_message="App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")

    try:
        file_info = await service.upload_app_file(app_name, file, path)
        return ApiResponse(success=True, data=file_info)
    except NotFoundException as e:
        log_api_error(logger, exc=e, method="POST", path=f"/api/apps/{app_name}/files", status_code=404, error_message=str(e))
        raise e
    except ValidationException as e:
        log_api_error(logger, exc=e, method="POST", path=f"/api/apps/{app_name}/files", status_code=400, error_message=str(e))
        raise e
    except Exception as e:
        log_api_error(logger, exc=e, method="POST", path=f"/api/apps/{app_name}/files", status_code=500, error_message=str(e))
        # Convert generic exceptions to HolaException for consistent handling
        from hola_shared.errors import ServiceException
        raise ServiceException(
            message="An unexpected error occurred while uploading file",
            service_name="file_service",
            details={"error": str(e)}
        ) from e

@router.get("/{file_path:path}", response_model=None)
async def get_file(
    app_name: str = Path(..., description="Name of the application"),
    file_path: str = Path(..., description="Path of the file to retrieve"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Get a specific file.
    
    Args:
        app_name: Name of the application
        file_path: Path of the file to retrieve
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        The file content as a streaming response
        
    Raises:
        400: Validation error
        404: File not found
        500: Internal server error
    """
    if not app_name or not app_name.strip():
        log_api_error(logger, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message="App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not file_path or not file_path.strip():
        log_api_error(logger, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message="File path cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File path cannot be empty")

    try:
        file_stream = await service.get_app_file(app_name, file_path) # Expecting Optional[BinaryIO]
        if file_stream is None: # Should be caught by NotFoundException from service layer, but as a safeguard
            log_api_error(logger, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=404, error_message="File not found by API layer after service call.")
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ApiResponse(success=False, error=ApiError(code="NOT_FOUND", message="File not found.")).model_dump(exclude_none=True)
            )
        
        # Get file info for content type and other metadata
        file_info = await service.file_storage.get_file_info(app_name, file_path)
        
        def generate():
            yield file_stream.read()
        
        return StreamingResponse(
            generate(),
            media_type=file_info.content_type,
            headers={"Content-Disposition": f"attachment; filename={file_path.split('/')[-1]}"}
        )
    except NotFoundException as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=404, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except ValidationException as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except Exception as e:
        log_api_error(logger, exc=e, method="GET", path=f"/api/apps/{app_name}/files/{file_path}", status_code=500, error_message=str(e))
        # Convert generic exceptions to HolaException for consistent handling
        from hola_shared.errors import ServiceException
        raise ServiceException(
            message="An unexpected error occurred while retrieving file",
            service_name="file_service",
            details={"error": str(e), "file_path": file_path}
        ) from e

@router.delete("/{file_path:path}", response_model=ApiResponse)
async def delete_file(
    app_name: str = Path(..., description="Name of the application"),
    file_path: str = Path(..., description="Path of the file to delete"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key)
):
    """Delete a specific file.
    
    Args:
        app_name: Name of the application
        file_path: Path of the file to delete
        service: App service instance
        api_key: API key for authentication
        
    Returns:
        Success confirmation
        
    Raises:
        400: Validation error
        404: File not found
        500: Internal server error
    """
    if not app_name or not app_name.strip():
        log_api_error(logger, method="DELETE", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message="App name cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="App name cannot be empty")
    
    if not file_path or not file_path.strip():
        log_api_error(logger, method="DELETE", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message="File path cannot be empty")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File path cannot be empty")

    try:
        await service.delete_app_file(app_name, file_path)
        return ApiResponse(
            success=True,
            data={"message": "File deleted successfully"}
        )
    except NotFoundException as e:
        log_api_error(logger, exc=e, method="DELETE", path=f"/api/apps/{app_name}/files/{file_path}", status_code=404, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except ValidationException as e:
        log_api_error(logger, exc=e, method="DELETE", path=f"/api/apps/{app_name}/files/{file_path}", status_code=400, error_message=str(e))
        # Let the global exception handler handle this
        raise e
    except Exception as e:
        log_api_error(logger, exc=e, method="DELETE", path=f"/api/apps/{app_name}/files/{file_path}", status_code=500, error_message=str(e))
        # Convert generic exceptions to HolaException for consistent handling
        from hola_shared.errors import ServiceException
        raise ServiceException(
            message="An unexpected error occurred while deleting file",
            service_name="file_service",
            details={"error": str(e), "file_path": file_path}
        ) from e