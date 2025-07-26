"""Application metrics collection and monitoring service.

This module provides business logic for collecting, storing, and querying
application performance metrics and monitoring data. It supports time-series
data collection with customizable metric types, units, and labels.

The service handles metric recording, querying with filtering options,
statistical analysis of metric data, and maintenance operations such as
data retention management.

Attributes:
    context (ServerContext): Server context containing settings and dependencies.
    settings (Settings): Application settings.
    metrics_path (Path): Path to the metrics storage directory.
    _metrics (Dict[str, Dict[str, List[MetricPoint]]]): In-memory storage for metrics data.
    _metric_definitions (Dict[str, Dict[str, MetricDefinition]]): In-memory storage for metric definitions.
    _max_points_per_metric (int): Maximum points per metric to keep in memory.
"""

import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from hola.models.metrics import (
    MetricPoint,
    MetricSeries,
    MetricType,
    MetricUnit,
    MetricsQueryParams,
    MetricRecordRequest,
    MetricDefinition,
    MetricsSummary,
    MetricsListResponse,
    MetricDefinitionsResponse,
    MetricsClearRequest,
    MetricsClearResponse,
)
from hola.models.errors import ValidationException, NotFoundException, ServiceException
from hola.utils.logging import get_logger
from ..config.context import ServerContext

logger = get_logger(__name__)


class MetricsService:
    """Service for managing application metrics.

    Provides business logic for metrics collection, storage, querying,
    and monitoring with time-series data management. This service handles the
    complete lifecycle of metrics data including creation, storage, filtering,
    analysis, and cleanup operations with comprehensive data validation.

    The service supports different metric types (counter, gauge, histogram),
    units (bytes, milliseconds, count), and customizable labels for detailed
    categorization and filtering capabilities.
    """

    def __init__(self, context: ServerContext):
        """Initialize the metrics service.

        Args:
            context (ServerContext): Server context containing settings and dependencies.
        """
        self.context = context
        self.settings = context.settings

        # Initialize metrics storage
        self.metrics_path = Path(self.settings.data_path) / "metrics"
        self.metrics_path.mkdir(parents=True, exist_ok=True)

        # In-memory metrics storage (in real implementation, use time-series database)
        self._metrics: Dict[str, Dict[str, List[MetricPoint]]] = defaultdict(
            lambda: defaultdict(list)
        )
        self._metric_definitions: Dict[str, Dict[str, MetricDefinition]] = defaultdict(
            dict
        )
        self._max_points_per_metric = 10000  # Maximum points per metric

        logger.debug("MetricsService initialized")

    async def record_metric(self, app_name: str, request: MetricRecordRequest) -> None:
        """Record a new metric data point.

        Stores a new metric data point with the specified value, labels, and optional timestamp.
        If this is the first occurrence of the metric, it also creates a metric definition.
        Otherwise, it updates the existing definition with new information such as label keys
        and totals. The service manages data point limits to prevent memory exhaustion.

        Args:
            app_name (str): Application name for the metric.
            request (MetricRecordRequest): Metric recording request with name, value,
                type, unit, optional labels, and optional timestamp.

        Raises:
            ServiceException: If the metric recording fails for any reason.
        """
        try:
            logger.debug(
                f"Recording metric {request.name} for app {app_name}: {request.value}"
            )

            # Use provided timestamp or current time
            timestamp = request.timestamp or datetime.now(timezone.utc)

            # Create metric point
            metric_point = MetricPoint(
                timestamp=timestamp, value=request.value, labels=request.labels
            )

            # Add to metrics storage
            metric_key = f"{app_name}:{request.name}"
            self._metrics[app_name][request.name].append(metric_point)

            # Maintain max points limit per metric
            if len(self._metrics[app_name][request.name]) > self._max_points_per_metric:
                # Remove oldest points
                self._metrics[app_name][request.name] = self._metrics[app_name][
                    request.name
                ][-self._max_points_per_metric :]

            # Update or create metric definition
            if request.name not in self._metric_definitions[app_name]:
                definition = MetricDefinition(
                    name=request.name,
                    type=request.type,
                    unit=request.unit,
                    app_name=app_name,
                    description=request.description,
                    labels=list(request.labels.keys()),
                    created_at=timestamp,
                    last_recorded_at=timestamp,
                    total_points=1,
                )
                self._metric_definitions[app_name][request.name] = definition
            else:
                # Update existing definition
                definition = self._metric_definitions[app_name][request.name]
                definition.last_recorded_at = timestamp
                definition.total_points += 1

                # Add new labels if they don't exist
                for label_key in request.labels.keys():
                    if label_key not in definition.labels:
                        definition.labels.append(label_key)

            logger.debug(f"Metric recorded: {metric_key}")

        except Exception as e:
            logger.error(f"Failed to record metric: {str(e)}")
            raise ServiceException(
                message=f"Failed to record metric: {str(e)}",
                service_name="metrics_service",
            )

    async def get_metrics(
        self, app_name: str, params: MetricsQueryParams
    ) -> MetricsListResponse:
        """Get metrics data for an application.

        Args:
            app_name (str): Application name.
            params (MetricsQueryParams): Query parameters for filtering metrics.

        Returns:
            MetricsListResponse: Metrics data and summary.
        """
        try:
            logger.debug(
                f"Getting metrics for app {app_name} with params: {params.model_dump()}"
            )

            if app_name not in self._metrics:
                return MetricsListResponse(
                    metrics={},
                    summary=self._generate_empty_summary(app_name, params),
                    query_params=params,
                )

            # Filter metrics by name if specified
            metric_names = params.metric_names or list(self._metrics[app_name].keys())

            metrics_data = {}
            for metric_name in metric_names:
                if metric_name in self._metrics[app_name]:
                    metric_series = await self._build_metric_series(
                        app_name, metric_name, params
                    )
                    if metric_series:
                        metrics_data[metric_name] = metric_series

            # Generate summary
            summary = self._generate_metrics_summary(app_name, params)

            return MetricsListResponse(
                metrics=metrics_data, summary=summary, query_params=params
            )

        except Exception as e:
            logger.error(f"Failed to get metrics: {str(e)}")
            raise ServiceException(
                message=f"Failed to get metrics: {str(e)}",
                service_name="metrics_service",
            )

    async def get_metric_series(
        self, app_name: str, metric_name: str, params: MetricsQueryParams
    ) -> MetricSeries:
        """Get a specific metric series.

        Args:
            app_name (str): Application name.
            metric_name (str): Metric name.
            params (MetricsQueryParams): Query parameters.

        Returns:
            MetricSeries: Time-series data.
        """
        try:
            logger.debug(f"Getting metric series {metric_name} for app {app_name}")

            if (
                app_name not in self._metrics
                or metric_name not in self._metrics[app_name]
            ):
                raise NotFoundException(
                    resource_type="metric", resource_id=f"{app_name}:{metric_name}"
                )

            metric_series = await self._build_metric_series(
                app_name, metric_name, params
            )
            if not metric_series:
                raise NotFoundException(
                    resource_type="metric data", resource_id=f"{app_name}:{metric_name}"
                )

            return metric_series

        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"Failed to get metric series: {str(e)}")
            raise ServiceException(
                message=f"Failed to get metric series: {str(e)}",
                service_name="metrics_service",
            )

    async def get_summary_metrics(self, app_name: str) -> Dict[str, Any]:
        """Get summarized metrics for an application.

        Args:
            app_name (str): Application name.

        Returns:
            Dict[str, Any]: Summary metrics.
        """
        try:
            logger.debug(f"Getting summary metrics for app {app_name}")

            if app_name not in self._metrics:
                return {}

            summary = {}

            # Get latest values for key metrics
            for metric_name, points in self._metrics[app_name].items():
                if points:
                    latest_point = max(points, key=lambda p: p.timestamp)
                    summary[metric_name] = {
                        "latest_value": latest_point.value,
                        "latest_timestamp": latest_point.timestamp,
                        "total_points": len(points),
                    }

                    # Calculate basic statistics
                    values = [p.value for p in points]
                    summary[metric_name].update(
                        {
                            "min_value": min(values),
                            "max_value": max(values),
                            "avg_value": sum(values) / len(values),
                            "sum_value": sum(values),
                        }
                    )

            return summary

        except Exception as e:
            logger.error(f"Failed to get summary metrics: {str(e)}")
            raise ServiceException(
                message=f"Failed to get summary metrics: {str(e)}",
                service_name="metrics_service",
            )

    async def get_metric_definitions(self, app_name: str) -> MetricDefinitionsResponse:
        """Get metric definitions for an application.

        Args:
            app_name (str): Application name.

        Returns:
            MetricDefinitionsResponse: Metric definitions.
        """
        try:
            logger.debug(f"Getting metric definitions for app {app_name}")

            definitions = []
            if app_name in self._metric_definitions:
                definitions = list(self._metric_definitions[app_name].values())

            return MetricDefinitionsResponse(
                definitions=definitions, total_count=len(definitions)
            )

        except Exception as e:
            logger.error(f"Failed to get metric definitions: {str(e)}")
            raise ServiceException(
                message=f"Failed to get metric definitions: {str(e)}",
                service_name="metrics_service",
            )

    async def get_metric_names(self, app_name: str) -> List[str]:
        """Get all metric names for an application.

        Args:
            app_name (str): Application name.

        Returns:
            List[str]: Metric names.
        """
        try:
            logger.debug(f"Getting metric names for app {app_name}")

            if app_name not in self._metrics:
                return []

            return list(self._metrics[app_name].keys())

        except Exception as e:
            logger.error(f"Failed to get metric names: {str(e)}")
            raise ServiceException(
                message=f"Failed to get metric names: {str(e)}",
                service_name="metrics_service",
            )

    async def clear_metrics(
        self,
        app_name: str,
        metric_name: Optional[str] = None,
        before_timestamp: Optional[datetime] = None,
    ) -> MetricsClearResponse:
        """Clear metrics data with optional filtering.

        Args:
            app_name (str): Application name.
            metric_name (Optional[str], optional): Specific metric name to clear. Defaults to None.
            before_timestamp (Optional[datetime], optional): Timestamp to clear metrics before. Defaults to None.

        Returns:
            MetricsClearResponse: Cleared counts.
        """
        try:
            # Create a request object for internal use
            request = MetricsClearRequest(
                app_name=app_name,
                metric_names=[metric_name] if metric_name else None,
                before_time=before_timestamp,
                older_than_days=None,
            )

            return await self._clear_metrics_internal(request)

        except Exception as e:
            logger.error(f"Failed to clear metrics: {str(e)}")
            raise ServiceException(
                message=f"Failed to clear metrics: {str(e)}",
                service_name="metrics_service",
            )

    async def _clear_metrics_internal(
        self, request: MetricsClearRequest
    ) -> MetricsClearResponse:
        """Internal implementation of clear metrics.

        Args:
            request (MetricsClearRequest): Metrics clearing request.

        Returns:
            MetricsClearResponse: Cleared counts.
        """
        try:
            logger.info(f"Clearing metrics with filters: {request.model_dump()}")

            cleared_metrics = 0
            cleared_data_points = 0

            # Determine which apps to clear
            apps_to_process = (
                [request.app_name] if request.app_name else list(self._metrics.keys())
            )

            for app_name in apps_to_process:
                if app_name not in self._metrics:
                    continue

                # Determine which metrics to clear
                metrics_to_clear = request.metric_names or list(
                    self._metrics[app_name].keys()
                )

                for metric_name in metrics_to_clear:
                    if metric_name not in self._metrics[app_name]:
                        continue

                    points_before = len(self._metrics[app_name][metric_name])

                    # Apply time-based filtering
                    if request.before_time or request.older_than_days:
                        cutoff_time = request.before_time
                        if request.older_than_days:
                            cutoff_time = datetime.now(timezone.utc) - timedelta(
                                days=request.older_than_days
                            )

                        if cutoff_time:
                            # Keep points after cutoff time
                            self._metrics[app_name][metric_name] = [
                                point
                                for point in self._metrics[app_name][metric_name]
                                if point.timestamp >= cutoff_time
                            ]
                    else:
                        # Clear all points
                        self._metrics[app_name][metric_name] = []

                    points_after = len(self._metrics[app_name][metric_name])
                    points_cleared = points_before - points_after

                    if points_cleared > 0:
                        cleared_data_points += points_cleared

                        # If no points left, remove the metric entirely
                        if points_after == 0:
                            del self._metrics[app_name][metric_name]
                            if metric_name in self._metric_definitions[app_name]:
                                del self._metric_definitions[app_name][metric_name]
                            cleared_metrics += 1
                        else:
                            # Update total points count
                            if metric_name in self._metric_definitions[app_name]:
                                self._metric_definitions[app_name][
                                    metric_name
                                ].total_points = points_after

                # Clean up empty app entries
                if not self._metrics[app_name]:
                    del self._metrics[app_name]
                    if app_name in self._metric_definitions:
                        del self._metric_definitions[app_name]

            logger.info(
                f"Cleared {cleared_metrics} metrics and {cleared_data_points} data points"
            )

            return MetricsClearResponse(
                cleared_metrics=cleared_metrics,
                cleared_data_points=cleared_data_points,
                message=f"Successfully cleared {cleared_metrics} metrics and {cleared_data_points} data points",
            )

        except Exception as e:
            logger.error(f"Failed to clear metrics: {str(e)}")
            raise ServiceException(
                message=f"Failed to clear metrics: {str(e)}",
                service_name="metrics_service",
            )

    async def _build_metric_series(
        self, app_name: str, metric_name: str, params: MetricsQueryParams
    ) -> Optional[MetricSeries]:
        """Build a metric series from stored data points.

        Creates a time-series data structure by filtering and processing stored metrics
        based on provided query parameters. Handles time range filtering, label filtering,
        pagination, and statistical calculations for the selected data points.

        Args:
            app_name (str): Application name.
            metric_name (str): Metric name.
            params (MetricsQueryParams): Query parameters including time range, labels,
                pagination settings, and other filters.

        Returns:
            Optional[MetricSeries]: Complete metric series with points and statistics,
                or None if no data matches the provided filters.
        """
        if metric_name not in self._metrics[app_name]:
            return None

        points = self._metrics[app_name][metric_name]

        # Apply time range filtering
        filtered_points = []
        for point in points:
            if params.start_time and point.timestamp < params.start_time:
                continue
            if params.end_time and point.timestamp > params.end_time:
                continue

            # Apply label filtering
            if params.labels:
                match = True
                for key, value in params.labels.items():
                    if key not in point.labels or point.labels[key] != value:
                        match = False
                        break
                if not match:
                    continue

            filtered_points.append(point)

        if not filtered_points:
            return None

        # Sort by timestamp
        filtered_points.sort(key=lambda p: p.timestamp)

        # Apply pagination
        start_idx = params.offset
        end_idx = min(start_idx + params.limit, len(filtered_points))
        page_points = filtered_points[start_idx:end_idx]

        # Get metric definition
        definition = self._metric_definitions[app_name].get(metric_name)
        if not definition:
            # Create default definition
            definition = MetricDefinition(
                name=metric_name,
                type=MetricType.GAUGE,
                unit=MetricUnit.COUNT,
                app_name=app_name,
                description=f"Auto-generated definition for {metric_name}",
                created_at=datetime.now(timezone.utc),
                last_recorded_at=None,
                total_points=len(filtered_points),
            )

        # Calculate statistics
        values = [p.value for p in page_points]
        min_value = min(values) if values else None
        max_value = max(values) if values else None
        avg_value = sum(values) / len(values) if values else None
        sum_value = sum(values) if values else None

        # Time range
        start_time = page_points[0].timestamp if page_points else None
        end_time = page_points[-1].timestamp if page_points else None

        return MetricSeries(
            name=metric_name,
            type=definition.type,
            unit=definition.unit,
            app_name=app_name,
            description=definition.description,
            points=page_points,
            min_value=min_value,
            max_value=max_value,
            avg_value=avg_value,
            sum_value=sum_value,
            count=len(page_points),
            start_time=start_time,
            end_time=end_time,
        )

    def _generate_metrics_summary(
        self, app_name: str, params: MetricsQueryParams
    ) -> MetricsSummary:
        """Generate metrics summary for an application.

        Creates a comprehensive summary of all metrics for the specified application,
        including total count, commonly used metrics like CPU and memory usage, and
        time range information. The summary provides an overview of application
        performance and resource utilization at a glance.

        Args:
            app_name (str): Application name.
            params (MetricsQueryParams): Query parameters including time range and filters.

        Returns:
            MetricsSummary: Summary statistics including metric counts, key performance
                indicators, and time range information.
        """
        if app_name not in self._metrics:
            return self._generate_empty_summary(app_name, params)

        total_metrics = len(self._metrics[app_name])
        total_data_points = sum(
            len(points) for points in self._metrics[app_name].values()
        )

        # Get latest values for common metrics
        summary_data = {}

        # Look for common metric names
        common_metrics = {
            "cpu_usage_percent": ["cpu", "cpu_usage", "cpu_percent"],
            "memory_usage_bytes": ["memory", "memory_usage", "memory_bytes"],
            "request_count": ["requests", "request_count", "http_requests"],
            "error_count": ["errors", "error_count", "error_rate"],
            "response_time_ms": ["response_time", "latency", "response_time_ms"],
        }

        for summary_key, possible_names in common_metrics.items():
            for metric_name in possible_names:
                if metric_name in self._metrics[app_name]:
                    points = self._metrics[app_name][metric_name]
                    if points:
                        latest_point = max(points, key=lambda p: p.timestamp)
                        value = latest_point.value

                        # Convert to integer for fields that require integers
                        if summary_key in [
                            "memory_usage_bytes",
                            "disk_usage_bytes",
                            "network_rx_bytes",
                            "network_tx_bytes",
                        ]:
                            value = int(value)

                        summary_data[summary_key] = value
                    break

        return MetricsSummary(
            app_name=app_name,
            total_metrics=total_metrics,
            total_data_points=total_data_points,
            summary_start_time=params.start_time
            or datetime.now(timezone.utc) - timedelta(hours=1),
            summary_end_time=params.end_time or datetime.now(timezone.utc),
            **summary_data,
        )

    def _generate_empty_summary(
        self, app_name: str, params: MetricsQueryParams
    ) -> MetricsSummary:
        """Generate an empty metrics summary.

        Creates a default metrics summary object with null values when no metrics
        data is available for an application. This ensures consistent API responses
        even when metrics data is absent.

        Args:
            app_name (str): Application name.
            params (MetricsQueryParams): Query parameters including time range settings.

        Returns:
            MetricsSummary: Empty summary statistics with default time range and null values.
        """
        return MetricsSummary(
            app_name=app_name,
            total_metrics=0,
            total_data_points=0,
            summary_start_time=params.start_time
            or datetime.now(timezone.utc) - timedelta(hours=1),
            summary_end_time=params.end_time or datetime.now(timezone.utc),
            cpu_usage_percent=None,
            memory_usage_bytes=None,
            disk_usage_bytes=None,
            network_rx_bytes=None,
            network_tx_bytes=None,
            request_count=None,
            error_count=None,
            response_time_ms=None,
            uptime_seconds=None,
        )
