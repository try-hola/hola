"""API endpoints for metrics management."""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, Body
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
import uuid

from hola_shared.models import (
    ApiResponse,
    ApiError,
    MetricPoint,
    MetricSeries,
    MetricsQueryParams,
    MetricsListResponse,
    MetricRecordRequest,
    MetricsClearRequest,
    MetricType,
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from ..config.context import ServerContext, get_context
from ..services.metrics_service import MetricsService
from ..auth import get_api_key
from ..utils.logging import log_api_error
from hola_shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def get_metrics_service(
    context: ServerContext = Depends(get_context),
) -> MetricsService:
    """Get the active metrics service instance"""
    # Your service initialization logic here
    return MetricsService(context)


@router.post("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def record_metric(
    app_name: str,
    metric: MetricRecordRequest,
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Record a metric point for an application."""
    request_id = str(uuid.uuid4())

    method = "POST"
    path = f"/api/apps/{app_name}/metrics"

    try:
        metrics_service = context.get_metrics_service()

        await metrics_service.record_metric(app_name, metric)

        return JSONResponse(
            status_code=201,
            content=ApiResponse(
                success=True,
                data={
                    "metric_name": metric.name,
                    "timestamp": (
                        metric.timestamp.isoformat() if metric.timestamp else None
                    ),
                    "value": metric.value,
                },
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


@router.get("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def get_metrics(
    app_name: str,
    metric_names: Optional[str] = Query(
        None, description="Comma-separated metric names"
    ),
    start_time: Optional[datetime] = Query(
        None, description="Start time for filtering"
    ),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    aggregation: Optional[str] = Query(
        "avg", description="Aggregation function (avg, sum, min, max, count)"
    ),
    metric_type: Optional[str] = Query(
        None, description="Filter by metric type (counter, gauge, histogram, timer)"
    ),
    interval: Optional[str] = Query(
        None, description="Aggregation interval (1m, 5m, 1h, etc.)"
    ),
    limit: int = Query(
        1000, ge=1, le=10000, description="Maximum number of points per series"
    ),
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Get metrics for an application with filtering and aggregation."""
    request_id = str(uuid.uuid4())

    method = "GET"
    path = f"/api/apps/{app_name}/metrics"

    try:
        metrics_service = context.get_metrics_service()

        # Parse metric names
        metric_name_list = None
        if metric_names:
            metric_name_list = [name.strip() for name in metric_names.split(",")]

        # Convert string metric_type to enum if provided
        metric_type_enum = None
        if metric_type:
            try:
                metric_type_enum = MetricType(metric_type.lower())
            except ValueError:
                log_api_error(
                    logger,
                    request_id=request_id,
                    method=method,
                    path=path,
                    status_code=400,
                    error_message=f"Invalid metric type: {metric_type}",
                )
                return JSONResponse(
                    status_code=400,
                    content=ApiResponse(
                        success=False,
                        error=ApiError(
                            code="VALIDATION_ERROR",
                            message=f"Invalid metric type: {metric_type}. Valid types: counter, gauge, histogram, timer",
                        ),
                    ).model_dump(mode="json"),
                )

        query_params = MetricsQueryParams(
            metric_names=metric_name_list,
            start_time=start_time,
            end_time=end_time,
            limit=limit,
            metric_type=metric_type_enum,
            aggregation_function=aggregation or "avg",
            aggregation_interval=interval,
            aggregate=True if aggregation and aggregation != "raw" else False,
        )

        metrics_response = await metrics_service.get_metrics(app_name, query_params)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data={
                    "metrics": metrics_response.metrics,
                    "summary": metrics_response.summary.model_dump(mode="json"),
                    "query_params": metrics_response.query_params.model_dump(
                        mode="json"
                    ),
                },
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


@router.get(
    "/api/apps/{app_name}/metrics/summary", response_model=ApiResponse[Dict[str, Any]]
)
async def get_metrics_summary(
    app_name: str,
    metric_names: Optional[str] = Query(
        None, description="Comma-separated metric names"
    ),
    hours: int = Query(1, ge=1, le=168, description="Number of hours to summarize"),
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Get metrics summary statistics for an application."""
    request_id = str(uuid.uuid4())

    method = "GET"
    path = f"/api/apps/{app_name}/metrics/summary"

    try:
        metrics_service = context.get_metrics_service()

        # Get summary from the service
        summary = await metrics_service.get_summary_metrics(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=summary,
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


@router.delete(
    "/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]]
)
async def clear_metrics(
    app_name: str,
    clear_request: Optional[MetricsClearRequest] = Body(None),
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Clear metrics for an application."""
    request_id = str(uuid.uuid4())

    method = "DELETE"
    path = f"/api/apps/{app_name}/metrics"

    try:
        metrics_service = context.get_metrics_service()

        # Parse the clear request to determine what to clear
        metric_name = None
        before_timestamp = None

        if clear_request:
            if clear_request.metric_names and len(clear_request.metric_names) == 1:
                metric_name = clear_request.metric_names[0]
            before_timestamp = clear_request.before_time

        response = await metrics_service.clear_metrics(
            app_name=app_name,
            metric_name=metric_name,
            before_timestamp=before_timestamp,
        )

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data={
                    "cleared_count": response.cleared_data_points,
                    "cleared_metrics": response.cleared_metrics,
                },
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


@router.get("/api/apps/{app_name}/metrics/names", response_model=ApiResponse[List[str]])
async def get_metric_names(
    app_name: str,
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Get all available metric names for an application."""
    request_id = str(uuid.uuid4())

    method = "GET"
    path = f"/api/apps/{app_name}/metrics/names"

    try:
        metrics_service = context.get_metrics_service()

        metric_names = await metrics_service.get_metric_names(app_name)

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=metric_names,
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


@router.get(
    "/api/apps/{app_name}/metrics/{metric_name}",
    response_model=ApiResponse[MetricSeries],
)
async def get_specific_metric(
    app_name: str,
    metric_name: str,
    start_time: Optional[datetime] = Query(
        None, description="Start time for filtering"
    ),
    end_time: Optional[datetime] = Query(None, description="End time for filtering"),
    aggregation: Optional[str] = Query(
        "raw", description="Aggregation method (raw, avg, sum, min, max)"
    ),
    interval: Optional[str] = Query(
        None, description="Aggregation interval (1m, 5m, 1h, etc.)"
    ),
    limit: int = Query(1000, ge=1, le=10000, description="Maximum number of points"),
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Get a specific metric for an application."""
    request_id = str(uuid.uuid4())

    method = "GET"
    path = f"/api/apps/{app_name}/metrics/{metric_name}"

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
            app_name=app_name, metric_name=metric_name, params=params
        )

        return JSONResponse(
            status_code=200,
            content=ApiResponse(
                success=True,
                data=metric_series,
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


@router.post(
    "/api/apps/{app_name}/metrics/{metric_name}",
    response_model=ApiResponse[Dict[str, Any]],
)
async def record_metric_by_name(
    app_name: str,
    metric_name: str,
    metric_request: Dict[str, Any],
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Record a metric point for a specific metric."""
    request_id = str(uuid.uuid4())

    method = "POST"
    path = f"/api/apps/{app_name}/metrics/{metric_name}"

    try:
        metrics_service = context.get_metrics_service()

        # Parse the metric request into a proper object
        from hola_shared.models.metrics import MetricRecordRequest

        record_request = MetricRecordRequest(name=metric_name, **metric_request)

        await metrics_service.record_metric(app_name, record_request)

        return JSONResponse(
            status_code=201,
            content=ApiResponse(
                success=True,
                data={
                    "metric_name": metric_name,
                    "app_name": app_name,
                    "value": record_request.value,
                },
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
