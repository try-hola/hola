"""API endpoints for metrics management and monitoring.

This module provides REST API endpoints for recording, retrieving, and analyzing
application metrics, including time-series data, aggregation, and summary statistics.

Endpoints:
- `record_metric`: Record a metric point for an application.
- `get_metrics`: Get metrics for an application with filtering and aggregation.
- `get_metrics_summary`: Get metrics summary statistics for an application.
- `clear_metrics`: Clear metrics for an application.
- `get_metric_names`: Get all available metric names for an application.
- `get_specific_metric`: Get a specific metric for an application.
- `record_metric_by_name`: Record a metric point for a specific metric.

Dependencies:
- `get_metrics_service`: Provides the metrics service instance.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, Body
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
import uuid

from hola.shared.models import (
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
from hola.shared.errors import ValidationException, NotFoundException, ServiceException
from ..config.context import ServerContext, get_context
from ..services.metrics_service import MetricsService
from ..auth import get_api_key
from ..utils.api_logging import log_api_error
from hola.shared.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def get_metrics_service(
    context: ServerContext = Depends(get_context),
) -> MetricsService:
    """Get the active metrics service instance with dependency injection.

    Args:
        context (ServerContext): Server context containing configuration and dependencies.

    Returns:
        MetricsService: Configured metrics service instance.
    """
    return MetricsService(context)


@router.post("/api/apps/{app_name}/metrics", response_model=ApiResponse[Dict[str, Any]])
async def record_metric(
    app_name: str,
    metric: MetricRecordRequest,
    api_key: str = Depends(get_api_key),
    context: ServerContext = Depends(get_context),
) -> JSONResponse:
    """Record a metric point for an application.

    Stores a new metric data point for the specified application. The metric can be
    a counter, gauge, histogram, or timer type. If no timestamp is provided, the
    current time will be used.

    Args:
        app_name (str): Name of the application to record the metric for.
        metric (MetricRecordRequest): Metric data including name, value, type, and optional timestamp.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Confirmation of the recorded metric with name, timestamp, and value.

    Raises:
        ValidationException: If the metric parameters are invalid.
        ServiceException: If there is an error recording the metric.
    """
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
    """Get metrics for an application with filtering and aggregation.

    Retrieves time-series metric data for the specified application with optional
    filtering by metric names, time range, and metric type. The data can be
    aggregated using various functions and intervals.

    Args:
        app_name (str): Name of the application to retrieve metrics for.
        metric_names (Optional[str]): Comma-separated list of metric names to filter by.
        start_time (Optional[datetime]): Include metrics from this time onward.
        end_time (Optional[datetime]): Include metrics up to this time.
        aggregation (Optional[str]): Aggregation function to apply (avg, sum, min, max, count).
        metric_type (Optional[str]): Filter metrics by type (counter, gauge, histogram, timer).
        interval (Optional[str]): Time interval for aggregation (1m, 5m, 15m, 1h, etc.).
        limit (int): Maximum number of data points to return per metric series.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Response containing:
                    - Metric series with timestamps and values
                    - Summary statistics for each metric
                    - Query parameters used for the request

    Raises:
        ValidationException: If query parameters are invalid.
        ServiceException: If there is an error retrieving metrics.
    """
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
    """Get metrics summary statistics for an application.

    Provides aggregated statistics for application metrics over the specified time period.
    This endpoint returns computed summary data rather than raw time-series data,
    including min/max/avg values, percentiles, and rate of change.

    Args:
        app_name (str): Name of the application to retrieve metric summaries for.
        metric_names (Optional[str]): Comma-separated list of metric names to include.
                                     If not provided, all metrics are summarized.
        hours (int): Number of hours of data to include in the summary (1-168).
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Response containing summary statistics for each metric:
                    - Min/max/avg values
                    - Percentiles (p50, p90, p95, p99)
                    - Rate of change
                    - Latest values
                    - Count of data points

    Raises:
        ValidationException: If parameters are invalid.
        ServiceException: If there is an error generating the summary.
    """
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
    """Clear metrics for an application.

    Deletes metric data points for the specified application. The operation can be
    scoped to specific metrics and/or time ranges using the clear request body.
    Returns a count of deleted data points and affected metrics.

    Args:
        app_name (str): Name of the application to clear metrics for.
        clear_request (Optional[MetricsClearRequest]): Optional request body specifying
                                                      which metrics to clear and time range.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Response containing:
                    - Number of data points cleared
                    - List of metric names that were affected

    Raises:
        ValidationException: If clear request parameters are invalid.
        ServiceException: If there is an error clearing metrics.
    """
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
    """Get all available metric names for an application.

    Retrieves a list of all metric names that have been recorded for the specified
    application. This endpoint is useful for discovering available metrics for
    dashboarding and monitoring purposes.

    Args:
        app_name (str): Name of the application to get metric names for.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Response containing an array of metric names as strings.

    Raises:
        ValidationException: If the application name is invalid.
        ServiceException: If there is an error retrieving metric names.
    """
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
    """Get a specific metric for an application.

    Retrieves time-series data for a specific named metric. Data can be filtered
    by time range and aggregated using various methods and intervals. This endpoint
    is optimized for retrieving a single metric's complete data.

    Args:
        app_name (str): Name of the application to retrieve the metric for.
        metric_name (str): Name of the specific metric to retrieve.
        start_time (Optional[datetime]): Include data from this time onward.
        end_time (Optional[datetime]): Include data up to this time.
        aggregation (Optional[str]): Aggregation method to use (raw, avg, sum, min, max).
        interval (Optional[str]): Time interval for aggregation (1m, 5m, 15m, 1h, etc.).
        limit (int): Maximum number of data points to return.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Response containing metric time series data with:
                    - Data points (timestamp and value pairs)
                    - Metadata about the metric (type, unit, description)
                    - Summary statistics

    Raises:
        ValidationException: If parameters are invalid.
        NotFoundException: If the metric doesn't exist.
        ServiceException: If there is an error retrieving the metric.
    """
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
    """Record a metric point for a specific metric.

    Stores a new metric data point for a specific named metric. This endpoint
    provides a simplified interface compared to the generic record_metric endpoint
    as it automatically uses the metric name from the URL path.

    Args:
        app_name (str): Name of the application to record the metric for.
        metric_name (str): Name of the specific metric to record a data point for.
        metric_request (Dict[str, Any]): Request containing the metric value and optional
                                        metadata such as timestamp and tags.
        api_key (str): API key for authentication.
        context (ServerContext): Server context with service dependencies.

    Returns:
        JSONResponse: Confirmation of the recorded metric with timestamp and value.

    Raises:
        ValidationException: If the metric parameters are invalid.
        ServiceException: If there is an error recording the metric.
    """
    request_id = str(uuid.uuid4())

    method = "POST"
    path = f"/api/apps/{app_name}/metrics/{metric_name}"

    try:
        metrics_service = context.get_metrics_service()

        # Parse the metric request into a proper object
        from hola.shared.models.metrics import MetricRecordRequest

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
