"""API endpoints for log management."""

from typing import Any, Dict, List, Optional
import uuid
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse, Response, JSONResponse
from datetime import datetime
import json

from hola_shared.models import (
    ApiResponse,
    LogEntry,
    LogQueryParams,
    LogResponse,
    LogCreateRequest,
    LogClearRequest,
    LogLevel,
    LogSource,
)
from hola_shared.models.response import ApiError
from hola_shared.logger import get_logger
from ..auth import get_api_key
from ..config.context import ServerContext, get_context
from ..services.log_service import LogService

router = APIRouter()
logger = get_logger(__name__)


@router.get("/api/apps/{app_name}/logs", response_model=ApiResponse[LogResponse])
async def get_logs(
    request: Request,
    app_name: str,
    level: Optional[str] = Query(None, description="Filter by log level"),
    source: Optional[str] = Query(None, description="Filter by log source"),
    start_time: Optional[datetime] = Query(
        None, description="Start time for filtering"
    ),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    limit: int = Query(100, ge=1, le=1000, description="Number of logs to return"),
    offset: int = Query(0, ge=0, description="Number of logs to skip"),
    search: Optional[str] = Query(None, description="Search term in log messages"),
    filter_request_id: Optional[str] = Query(
        None, description="Filter by request ID", alias="request_id"
    ),
    session_id: Optional[str] = Query(None, description="Filter by session ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    context: ServerContext = Depends(get_context),
    api_key: str = Depends(get_api_key),
) -> JSONResponse:
    """Get logs for an application with filtering and pagination."""
    request_id = str(uuid.uuid4())

    try:
        log_service = context.get_log_service()

        # Convert string parameters to enums if provided
        level_enum = None
        if level:
            try:
                level_enum = LogLevel(level.lower())
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=ApiResponse(
                        success=False,
                        error=ApiError(
                            code="VALIDATION_ERROR",
                            message=f"Invalid log level: {level}",
                        ),
                    ).model_dump(mode="json"),
                )

        source_enum = None
        if source:
            try:
                source_enum = LogSource(source.lower())
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=ApiResponse(
                        success=False,
                        error=ApiError(
                            code="VALIDATION_ERROR",
                            message=f"Invalid log source: {source}",
                        ),
                    ).model_dump(mode="json"),
                )

        query_params = LogQueryParams(
            app_name=app_name,
            level=level_enum,
            source=source_enum,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
            message_contains=search,
            request_id=filter_request_id,
            session_id=session_id,
            user_id=user_id,
        )

        log_response = await log_service.get_logs(query_params)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=log_response,
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


@router.get("/api/apps/{app_name}/logs/stream")
async def stream_logs(
    request: Request,
    app_name: str,
    level: Optional[str] = Query(None, description="Filter by log level"),
    source: Optional[str] = Query(None, description="Filter by log source"),
    search: Optional[str] = Query(None, description="Search term in log messages"),
    context: ServerContext = Depends(get_context),
    api_key: str = Depends(get_api_key),
) -> StreamingResponse:
    """Stream real-time logs for an application."""
    request_id = str(uuid.uuid4())

    try:
        log_service = context.get_log_service()

        # Convert string parameters to enums if provided
        level_enum = None
        if level:
            try:
                level_enum = LogLevel(level.lower())
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=ApiResponse(
                        success=False,
                        error=ApiError(
                            code="VALIDATION_ERROR",
                            message=f"Invalid log level: {level}",
                        ),
                    ).model_dump(mode="json"),
                )

        source_enum = None
        if source:
            try:
                source_enum = LogSource(source.lower())
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content=ApiResponse(
                        success=False,
                        error=ApiError(
                            code="VALIDATION_ERROR",
                            message=f"Invalid log source: {source}",
                        ),
                    ).model_dump(mode="json"),
                )

        # Create query params for streaming
        query_params = LogQueryParams(
            app_name=app_name,
            level=level_enum,
            source=source_enum,
            message_contains=search,
            start_time=None,
            end_time=None,
            request_id=None,
            session_id=None,
            user_id=None,
        )

        async def generate_logs():
            """Generate streaming log response."""
            async for log_entry in log_service.get_log_stream(query_params):
                # Convert log entry to JSON and yield with newline
                log_dict = log_entry.model_dump(mode="json")
                yield f"{json.dumps(log_dict)}\n"

        # Log the start of streaming (end will be logged when client disconnects)

        return StreamingResponse(
            generate_logs(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Request-ID": request_id,
            },
        )

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.post("/api/apps/{app_name}/logs", status_code=204)
async def add_log(
    request: Request,
    app_name: str,
    log_request: LogCreateRequest,
    context: ServerContext = Depends(get_context),
    api_key: str = Depends(get_api_key),
):
    """Add a log entry for an application."""
    request_id = str(uuid.uuid4())

    try:
        log_service = context.get_log_service()

        # Add request_id to log entry if not already set
        if not log_request.request_id:
            log_request.request_id = request_id

        await log_service.add_log_entry(app_name, log_request)

        # Return 204 No Content for successful creation
        return Response(status_code=204)

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content=ApiResponse(
                success=False,
                error=ApiError(code="INTERNAL_ERROR", message="Internal server error"),
            ).model_dump(mode="json"),
        )


@router.delete("/api/apps/{app_name}/logs", response_model=ApiResponse[Dict[str, Any]])
async def clear_logs(
    request: Request,
    app_name: str,
    before: Optional[datetime] = Query(
        None, description="Clear logs before this timestamp"
    ),
    context: ServerContext = Depends(get_context),
    api_key: str = Depends(get_api_key),
) -> JSONResponse:
    """Clear logs for an application."""
    request_id = str(uuid.uuid4())

    try:
        log_service = context.get_log_service()

        clear_request = LogClearRequest(
            app_name=app_name,
            before_time=before,
            level=None,
            source=None,
        )

        clear_response = await log_service.clear_logs(clear_request)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data={"cleared_count": clear_response.cleared_count},
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


@router.get(
    "/api/apps/{app_name}/logs/summary", response_model=ApiResponse[Dict[str, Any]]
)
async def get_log_summary(
    request: Request,
    app_name: str,
    hours: int = Query(24, ge=1, le=168, description="Number of hours to summarize"),
    context: ServerContext = Depends(get_context),
    api_key: str = Depends(get_api_key),
) -> JSONResponse:
    """Get log summary statistics for an application."""
    request_id = str(uuid.uuid4())

    try:
        log_service = context.get_log_service()

        summary = await log_service.get_log_summary(app_name, hours)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=summary.model_dump(mode="json"),
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


# Add service accessor function
def get_log_service(context: ServerContext) -> LogService:
    """Get the active log service instance"""
    return LogService(context)
