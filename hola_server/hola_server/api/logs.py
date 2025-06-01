"""API endpoints for log management and retrieval.

This module provides REST API endpoints for managing and retrieving application logs,
including filtering, streaming, adding new logs, and clearing existing logs.

Endpoints:
- `get_logs`: Retrieve logs for an application with filtering and pagination.
- `stream_logs`: Stream real-time logs for an application.
- `add_log`: Add a log entry for an application.
- `clear_logs`: Clear logs for an application.
- `get_log_summary`: Get log summary statistics for an application.

Dependencies:
- `get_log_service`: Provides the log service instance.
"""

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
    """Get logs for an application with filtering and pagination.

    Retrieves application logs with optional filtering by level, source, time range,
    and other criteria. Results are paginated and can be searched by content.

    Args:
        request (Request): FastAPI request object.
        app_name (str): Name of the application to retrieve logs for.
        level (Optional[str]): Filter logs by log level (debug, info, warning, error).
        source (Optional[str]): Filter logs by source (app, system, user).
        start_time (Optional[datetime]): Include logs from this time onward.
        end_time (Optional[datetime]): Include logs up to this time.
        limit (int): Maximum number of logs to return (default: 100).
        offset (int): Number of logs to skip for pagination (default: 0).
        search (Optional[str]): Filter logs containing this text in messages.
        filter_request_id (Optional[str]): Filter logs by specific request ID.
        session_id (Optional[str]): Filter logs by specific session ID.
        user_id (Optional[str]): Filter logs by specific user ID.
        context (ServerContext): Server context with service dependencies.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Response containing filtered log entries and metadata.

    Raises:
        ValidationException: If filter parameters are invalid.
        ServiceException: If there is an error retrieving logs.
    """
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
    """Stream real-time logs for an application.

    Provides a streaming response of log entries as they are generated in real-time.
    The stream can be filtered by log level, source, and text content. Each log entry
    is delivered as a separate newline-delimited JSON object.

    Args:
        request (Request): FastAPI request object.
        app_name (str): Name of the application to stream logs from.
        level (Optional[str]): Filter logs by log level (debug, info, warning, error).
        source (Optional[str]): Filter logs by source (app, system, user).
        search (Optional[str]): Filter logs containing this text in messages.
        context (ServerContext): Server context with service dependencies.
        api_key (str): API key for authentication.

    Returns:
        StreamingResponse: A streaming response of newline-delimited JSON objects, each
                          representing a log entry with format:
                          {"timestamp": "ISO-8601", "level": "INFO", "message": "text", ...}

    Raises:
        ValidationException: If filter parameters are invalid.
        ServiceException: If there is an error setting up the log stream.
    """
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
            """Generate streaming log response.

            Internal async generator function that yields log entries as they arrive.
            Each log entry is serialized to JSON and followed by a newline delimiter.
            """
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
) -> Response:
    """Add a log entry for an application.

    Creates a new log entry for the specified application. If the log request doesn't
    include a request_id, one will be automatically generated. Returns 204 No Content
    on success.

    Args:
        request (Request): FastAPI request object.
        app_name (str): Name of the application to add a log entry for.
        log_request (LogCreateRequest): Log entry creation details including message,
                                        level, source, and optional metadata.
        context (ServerContext): Server context with service dependencies.
        api_key (str): API key for authentication.

    Returns:
        Response: 204 No Content response indicating successful log creation.

    Raises:
        ValidationException: If log parameters are invalid.
        ServiceException: If there is an error creating the log entry.
    """
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
    """Clear logs for an application.

    Deletes log entries for the specified application. If a 'before' timestamp
    is provided, only logs before that time will be removed. Returns the number
    of log entries that were deleted.

    Args:
        request (Request): FastAPI request object.
        app_name (str): Name of the application to clear logs for.
        before (Optional[datetime]): If provided, only clear logs before this timestamp.
                                    If not provided, all logs will be cleared.
        context (ServerContext): Server context with service dependencies.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Response containing the number of cleared log entries.

    Raises:
        ValidationException: If parameters are invalid.
        ServiceException: If there is an error clearing the logs.
    """
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
    """Get log summary statistics for an application.

    Provides aggregated statistics about log entries for the specified application
    over the requested time period. Statistics include counts by log level, source,
    most frequent messages, and time-based distribution.

    Args:
        request (Request): FastAPI request object.
        app_name (str): Name of the application to get log summary for.
        hours (int): Number of hours to include in the summary (1-168, default: 24).
        context (ServerContext): Server context with service dependencies.
        api_key (str): API key for authentication.

    Returns:
        JSONResponse: Response containing log summary statistics including:
                     - counts by log level
                     - counts by source
                     - most frequent messages
                     - time-based distribution

    Raises:
        ValidationException: If parameters are invalid.
        ServiceException: If there is an error generating the summary.
    """
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


def get_log_service(context: ServerContext) -> LogService:
    """Get the active log service instance with dependency injection.

    Args:
        context (ServerContext): Server context containing configuration and dependencies.

    Returns:
        LogService: Configured log service instance.
    """
    return LogService(context)
