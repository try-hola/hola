"""API endpoints for application file management.

This module provides REST API endpoints for managing application files including
uploads, listings, downloads, and deletions.
"""

import io
import uuid
import time
from fastapi import APIRouter, Depends, File, UploadFile, Path, Request
from fastapi.responses import StreamingResponse, JSONResponse
from typing import List, Optional
from hola_shared.models.response import ApiResponse, ApiError
from hola_shared.models.file import FileInfo, FileListResponse
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..auth import get_api_key
from ..services.app_service import AppService
from ..config.context import get_context
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def get_app_service(context=Depends(get_context)) -> AppService:
    """Get app service with dependency injection."""
    return AppService(context)


@router.get("/", response_model=ApiResponse[FileListResponse])
async def list_files(
    request: Request,
    app_name: str = Path(..., description="Name of the application"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """List all files for an application.

    Args:
        request: FastAPI request object
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
    request_id = str(uuid.uuid4())

    try:
        if not app_name or not app_name.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="App name cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        file_list = await service.list_app_files(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(success=True, data=file_list).model_dump(mode="json"),
        )

    except ValidationException as e:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except NotFoundException as e:
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )
    except ServiceException as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.post("/", response_model=ApiResponse[FileInfo])
async def upload_file(
    request: Request,
    app_name: str = Path(..., description="Name of the application"),
    file: UploadFile = File(...),
    path: Optional[str] = None,
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Upload a file for the application.

    Args:
        request: FastAPI request object
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
    request_id = str(uuid.uuid4())

    try:
        if not app_name or not app_name.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="App name cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        file_info = await service.upload_app_file(app_name, file, path)

        return JSONResponse(
            status_code=201,
            content=ApiResponse(success=True, data=file_info).model_dump(mode="json"),
        )

    except ValidationException as e:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except NotFoundException as e:
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )
    except ServiceException as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.get("/{file_path:path}", response_model=None)
async def get_file(
    request: Request,
    app_name: str = Path(..., description="Name of the application"),
    file_path: str = Path(..., description="Path of the file to retrieve"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Get a specific file.

    Args:
        request: FastAPI request object
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
    request_id = str(uuid.uuid4())

    try:
        if not app_name or not app_name.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="App name cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        if not file_path or not file_path.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="File path cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        file_stream = await service.get_app_file(app_name, file_path)
        if file_stream is None:
            return JSONResponse(
                status_code=404,
                content=ApiResponse(
                    success=False,
                    error=ApiError(code="NOT_FOUND", message="File not found"),
                ).model_dump(mode="json"),
            )

        # Get file info for content type and other metadata
        file_info = await service.file_storage.get_file_info(app_name, file_path)

        def generate():
            yield file_stream.read()

        return StreamingResponse(
            generate(),
            media_type=file_info.content_type,
            headers={
                "Content-Disposition": f"attachment; filename={file_path.split('/')[-1]}",
                "X-Request-ID": request_id,
            },
        )

    except ValidationException as e:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except NotFoundException as e:
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )
    except ServiceException as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.delete("/{file_path:path}", response_model=ApiResponse)
async def delete_file(
    request: Request,
    app_name: str = Path(..., description="Name of the application"),
    file_path: str = Path(..., description="Path of the file to delete"),
    service: AppService = Depends(get_app_service),
    api_key: str = Depends(get_api_key),
):
    """Delete a specific file.

    Args:
        request: FastAPI request object
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
    request_id = str(uuid.uuid4())

    try:
        if not app_name or not app_name.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="App name cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        if not file_path or not file_path.strip():
            return JSONResponse(
                status_code=400,
                content=ApiResponse(
                    success=False,
                    error=ApiError(
                        code="VALIDATION_ERROR", message="File path cannot be empty"
                    ),
                ).model_dump(mode="json"),
            )

        await service.delete_app_file(app_name, file_path)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True, data={"message": "File deleted successfully"}
            ).model_dump(mode="json"),
        )

    except ValidationException as e:
        return JSONResponse(
            status_code=400,
            content=ApiResponse(
                success=False, error=ApiError(code="VALIDATION_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except NotFoundException as e:
        return JSONResponse(
            status_code=404,
            content=ApiResponse(
                success=False, error=ApiError(code="NOT_FOUND", message=str(e))
            ).model_dump(mode="json"),
        )
    except ServiceException as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False, error=ApiError(code="SERVICE_ERROR", message=str(e))
            ).model_dump(mode="json"),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )
