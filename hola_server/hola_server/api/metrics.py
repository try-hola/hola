"""API endpoints for metrics management."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Body
from datetime import datetime, timedelta

from hola_shared.models import (
    ApiResponse, MetricPoint, MetricSeries, MetricsQueryParams, MetricsListResponse,
    MetricRecordRequest, MetricsClearRequest
)
from ..config.context import ServerContext, get_context
from ..services.metrics_service import MetricsService

router = APIRouter()


def get_metrics_service(context: ServerContext = Depends(get_context)) -> MetricsService:
    """Get the active metrics service instance"""
    # Your service initialization logic here
    return MetricsService(context)


@router.post("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def record_metric(
    app_name: str,
    metric: MetricRecordRequest,
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Record a metric point for an application."""
    try:
        metrics_service = context.get_metrics_service()
        
        await metrics_service.record_metric(app_name, metric)
        
        return ApiResponse(
            success=True,
            data={
                "metric_name": metric.name,
                "timestamp": metric.timestamp.isoformat() if metric.timestamp else None,
                "value": metric.value,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record metric: {str(e)}",
        )


@router.get("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def get_metrics(
    app_name: str,
    metric_names: Optional[str] = Query(None, description="Comma-separated metric names"),
    start_time: Optional[datetime] = Query(None, description="Start time for filtering"),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    aggregation: Optional[str] = Query("raw", description="Aggregation method (raw, avg, sum, min, max)"),
    interval: Optional[str] = Query(None, description="Aggregation interval (1m, 5m, 1h, etc.)"),
    limit: int = Query(1000, ge=1, le=10000, description="Maximum number of points per series"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Get metrics for an application with filtering and aggregation."""
    try:
        metrics_service = context.get_metrics_service()
        
        # Parse metric names
        metric_name_list = None
        if metric_names:
            metric_name_list = [name.strip() for name in metric_names.split(",")]
        
        query_params = MetricsQueryParams(
            metric_names=metric_name_list,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
        )
        
        metrics_response = await metrics_service.get_metrics(app_name, query_params)
        
        return ApiResponse(
            success=True,
            data={
                "metrics": metrics_response.metrics,
                "summary": metrics_response.summary.model_dump(),
                "query_params": metrics_response.query_params.model_dump(),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve metrics: {str(e)}",
        )


@router.get("/api/apps/{app_name}/metrics/summary", response_model=ApiResponse[Dict[str, Any]])
async def get_metrics_summary(
    app_name: str,
    metric_names: Optional[str] = Query(None, description="Comma-separated metric names"),
    hours: int = Query(1, ge=1, le=168, description="Number of hours to summarize"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Get metrics summary statistics for an application."""
    try:
        metrics_service = context.get_metrics_service()
        
        # Get summary from the service
        summary = await metrics_service.get_summary_metrics(app_name)
        
        return ApiResponse(
            success=True,
            data=summary,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get metrics summary: {str(e)}",
        )


@router.delete("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def clear_metrics(
    app_name: str,
    clear_request: Optional[MetricsClearRequest] = Body(None),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Clear metrics for an application."""
    try:
        metrics_service = context.get_metrics_service()
        
        # Parse the clear request to determine what to clear
        metric_name = None
        before_timestamp = None
        
        if clear_request:
            if clear_request.metric_names and len(clear_request.metric_names) == 1:
                metric_name = clear_request.metric_names[0]
            before_timestamp = clear_request.before_time
            
            # Handle "older_than" field from test which becomes before_time
            if hasattr(clear_request, 'older_than') and clear_request.older_than:
                # Parse ISO datetime string if it's a string
                if isinstance(clear_request.older_than, str):
                    from datetime import datetime
                    before_timestamp = datetime.fromisoformat(clear_request.older_than.replace('Z', '+00:00'))
                else:
                    before_timestamp = clear_request.older_than
        
        response = await metrics_service.clear_metrics(
            app_name=app_name,
            metric_name=metric_name,
            before_timestamp=before_timestamp,
        )
        
        return ApiResponse(
            success=True,
            data={
                "cleared_count": response.cleared_data_points,
                "cleared_metrics": response.cleared_metrics,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to clear metrics: {str(e)}",
        )


@router.get("/api/apps/{app_name}/metrics/names", response_model=ApiResponse[List[str]])
async def get_metric_names(
    app_name: str,
    context: ServerContext = Depends(get_context),
) -> ApiResponse[List[str]]:
    """Get all available metric names for an application."""
    try:
        metrics_service = context.get_metrics_service()
        
        metric_names = await metrics_service.get_metric_names(app_name)
        
        return ApiResponse(
            success=True,
            data=metric_names,
            message=f"Retrieved {len(metric_names)} metric names for app '{app_name}'",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get metric names: {str(e)}",
        )


@router.get("/api/apps/{app_name}/metrics/{metric_name}", response_model=ApiResponse[MetricSeries])
async def get_specific_metric(
    app_name: str,
    metric_name: str,
    start_time: Optional[datetime] = Query(None, description="Start time for filtering"),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    aggregation: Optional[str] = Query("raw", description="Aggregation method (raw, avg, sum, min, max)"),
    interval: Optional[str] = Query(None, description="Aggregation interval (1m, 5m, 1h, etc.)"),
    limit: int = Query(1000, ge=1, le=10000, description="Maximum number of points"),
    context: ServerContext = Depends(get_context),
) -> ApiResponse[MetricSeries]:
    """Get a specific metric for an application."""
    try:
        metrics_service = context.get_metrics_service()
        
        params = MetricsQueryParams(
            metric_names=[metric_name],
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            aggregation_interval=interval,
        )
        
        metric_series = await metrics_service.get_metric_series(
            app_name=app_name,
            metric_name=metric_name,
            params=params
        )
        
        return ApiResponse(
            success=True,
            data=metric_series,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retrieve metric: {str(e)}",
        )


@router.post("/api/apps/{app_name}/metrics/{metric_name}", response_model=ApiResponse[Dict[str, Any]])
async def record_metric_by_name(
    app_name: str,
    metric_name: str,
    metric_request: Dict[str, Any],
    context: ServerContext = Depends(get_context),
) -> ApiResponse[Dict[str, Any]]:
    """Record a metric point for a specific metric."""
    try:
        metrics_service = context.get_metrics_service()
        
        # Parse the metric request into a proper object
        from hola_shared.models.metrics import MetricRecordRequest
        
        record_request = MetricRecordRequest(
            name=metric_name,
            **metric_request
        )
        
        await metrics_service.record_metric(app_name, record_request)
        
        return ApiResponse(
            success=True,
            data={
                "metric_name": metric_name,
                "app_name": app_name,
                "value": record_request.value,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to record metric: {str(e)}",
        )
