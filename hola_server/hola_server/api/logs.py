"""API endpoints for log management."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse, Response
from datetime import datetime
import json

from hola_shared.models import ApiResponse, LogEntry, LogQueryParams, LogResponse, LogCreateRequest, LogClearRequest
from ..config.context import ServerContext, get_context
from ..services.log_service import LogService

router = APIRouter()


@router.get("/api/apps/{app_name}/logs", response_model=ApiResponse[LogResponse])
async def get_logs(
    app_name: str,
    level: Optional[str] = Query(None, description="Filter by log level"),
    source: Optional[str] = Query(None, description="Filter by log source"),
    start_time: Optional[datetime] = Query(None, description="Start time for filtering"),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    limit: int = Query(100, ge=1, le=1000, description="Number of logs to return"),
    offset: int = Query(0, ge=0, description="Number of logs to skip"),
    search: Optional[str] = Query(None, description="Search term in log messages"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[LogResponse]:
    """Get logs for an application with filtering and pagination."""
    try:
        log_service = context.get_log_service()
        
        query_params = LogQueryParams(
            app_name=app_name,
            level=level,
            source=source,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            offset=offset,
            message_contains=search,
        )
        
        log_response = await log_service.get_logs(query_params)
        
        return ApiResponse(
            success=True,
            data=log_response,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve logs: {str(e)}",
        )


@router.get("/api/apps/{app_name}/logs/stream")
async def stream_logs(
    app_name: str,
    level: Optional[str] = Query(None, description="Filter by log level"),
    source: Optional[str] = Query(None, description="Filter by log source"),
    search: Optional[str] = Query(None, description="Search term in log messages"),
    context: ServerContext = Depends(get_context),
) -> StreamingResponse:
    """Stream real-time logs for an application."""
    try:
        log_service = context.get_log_service()
        
        async def generate_logs():
            """Generate streaming log response."""
            async for log_entry in log_service.stream_logs(
                app_name=app_name,
                level=level,
                source=source,
                search=search,
            ):
                # Convert log entry to JSON and yield with newline
                log_dict = log_entry.model_dump()
                yield f"{json.dumps(log_dict)}\n"
        
        return StreamingResponse(
            generate_logs(),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to stream logs: {str(e)}",
        )


@router.post("/api/apps/{app_name}/logs", status_code=204)
async def add_log(
    app_name: str,
    log_request: LogCreateRequest,
    context: ServerContext = Depends(get_context),
):
    """Add a log entry for an application."""
    try:
        log_service = context.get_log_service()
        
        await log_service.add_log_entry(app_name, log_request)
        
        # Return 204 No Content for successful creation
        return Response(status_code=204)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to add log entry: {str(e)}",
        )


@router.delete("/api/apps/{app_name}/logs", response_model=ApiResponse[Dict[str, Any]])
async def clear_logs(
    app_name: str,
    before: Optional[datetime] = Query(None, description="Clear logs before this timestamp"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Clear logs for an application."""
    try:
        log_service = context.get_log_service()
        
        clear_request = LogClearRequest(
            app_name=app_name,
            before_time=before
        )
        
        clear_response = await log_service.clear_logs(clear_request)
        
        return ApiResponse(
            success=True,
            data={"cleared_count": clear_response.cleared_count},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clear logs: {str(e)}",
        )


@router.get("/api/apps/{app_name}/logs/summary", response_model=ApiResponse[Dict[str, Any]])
async def get_log_summary(
    app_name: str,
    hours: int = Query(24, ge=1, le=168, description="Number of hours to summarize"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Get log summary statistics for an application."""
    try:
        log_service = context.get_log_service()
        
        summary = await log_service.get_log_summary(app_name, hours)
        
        return ApiResponse(
            success=True,
            data=summary.model_dump(),
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get log summary: {str(e)}",
        )


# Add service accessor function
def get_log_service(context: ServerContext) -> LogService:
    """Get the active log service instance"""
    # Your service initialization logic here
    return LogService(context)
