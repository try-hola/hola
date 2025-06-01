"""Fake metrics service implementation for testing.

Attributes:
    method_calls (List[Dict[str, Any]]): Tracks method calls for assertions during testing.
    _failure_modes (Dict[str, bool]): Simulates failures for specific methods during testing.
    metrics (Dict[str, Dict[str, Dict[datetime, MetricPoint]]]): Stores metric data points, organized by app name and metric name.
    metric_definitions (Dict[str, Dict[str, MetricDefinition]]): Stores metric definitions, organized by app name and metric name.
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timezone, timedelta
import uuid
import math

from hola_shared.models.metrics import (
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


class FakeMetricsService:
    """Fake implementation of metrics service for testing.

    Provides in-memory metrics collection and querying for testing.
    """

    def __init__(self):
        """Initialize the fake metrics service."""
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}

        # Structure: {app_name: {metric_name: {timestamp: MetricPoint}}}
        self.metrics: Dict[str, Dict[str, Dict[datetime, MetricPoint]]] = {}

        # Structure: {app_name: {metric_name: MetricDefinition}}
        self.metric_definitions: Dict[str, Dict[str, MetricDefinition]] = {}

    def set_failure_mode(self, method_name: str, should_fail: bool = True):
        """Configure a method to fail when called.

        Args:
            method_name (str): Name of the method that should fail.
            should_fail (bool): Whether the method should fail (default: True).
        """
        self._failure_modes[method_name] = should_fail

    def register_metric_definition(self, definition: MetricDefinition):
        """Register a predefined metric definition.

        Args:
            definition (MetricDefinition): Metric definition to register.
        """
        if definition.app_name not in self.metric_definitions:
            self.metric_definitions[definition.app_name] = {}

        self.metric_definitions[definition.app_name][definition.name] = definition

    def register_metric_series(self, series: MetricSeries):
        """Register a predefined metric series with data points.

        Args:
            series (MetricSeries): Metric series to register.
        """
        app_name = series.app_name
        metric_name = series.name

        # Create nested dictionaries if they don't exist
        if app_name not in self.metrics:
            self.metrics[app_name] = {}
        if metric_name not in self.metrics[app_name]:
            self.metrics[app_name][metric_name] = {}

        # Register metric definition if not exists
        if app_name not in self.metric_definitions:
            self.metric_definitions[app_name] = {}

        if metric_name not in self.metric_definitions[app_name]:
            now = datetime.now(timezone.utc)
            self.metric_definitions[app_name][metric_name] = MetricDefinition(
                name=metric_name,
                type=series.type,
                unit=series.unit,
                app_name=app_name,
                description=series.description,
                labels=[
                    label for point in series.points for label in point.labels.keys()
                ],
                created_at=now,
                last_recorded_at=now,
                total_points=len(series.points),
            )

        # Add all data points
        for point in series.points:
            self.metrics[app_name][metric_name][point.timestamp] = point

    def reset(self):
        """Reset the fake service state.

        Clears all stored metrics, metric definitions, and method calls.
        """
        self.method_calls = []
        self._failure_modes = {}
        self.metrics = {}
        self.metric_definitions = {}

    async def record_metric(
        self, app_name: str, request: MetricRecordRequest
    ) -> MetricPoint:
        """Record a new metric data point.

        Args:
            app_name (str): Application name.
            request (MetricRecordRequest): Metric record request containing data point details.

        Returns:
            MetricPoint: The recorded metric data point.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "record_metric",
                "app_name": app_name,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("record_metric", False):
            raise Exception(f"Simulated failure in record_metric for {app_name}")

        now = datetime.now(timezone.utc)
        timestamp = request.timestamp or now

        # Create nested dictionaries if they don't exist
        if app_name not in self.metrics:
            self.metrics[app_name] = {}
        if request.name not in self.metrics[app_name]:
            self.metrics[app_name][request.name] = {}

        # Register metric definition if not exists
        if app_name not in self.metric_definitions:
            self.metric_definitions[app_name] = {}

        if request.name not in self.metric_definitions[app_name]:
            now = datetime.now(timezone.utc)
            self.metric_definitions[app_name][request.name] = MetricDefinition(
                name=request.name,
                type=request.type,
                unit=request.unit,
                app_name=app_name,
                description=request.description,
                labels=list(request.labels.keys()) if request.labels else [],
                created_at=now,
                last_recorded_at=now,
                total_points=1,
            )

        # Create metric point
        point = MetricPoint(
            timestamp=timestamp, value=request.value, labels=request.labels or {}
        )

        # Store metric point
        self.metrics[app_name][request.name][timestamp] = point

        return point

    def has_metrics(self, app_name: str) -> bool:
        """Check if metrics exist for an application.

        Args:
            app_name: Application name

        Returns:
            True if metrics exist, False otherwise
        """
        return app_name in self.metrics and bool(self.metrics[app_name])

    async def get_metrics(
        self, app_name: str, params: MetricsQueryParams
    ) -> MetricsListResponse:
        """Get metrics for an application, optionally filtered by name and parameters.

        Args:
            app_name (str): Application name.
            params (MetricsQueryParams): Query parameters for filtering metrics.

        Returns:
            MetricsListResponse: Response containing filtered metrics and summary.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "get_metrics",
                "app_name": app_name,
                "params": params,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_metrics", False):
            raise Exception(f"Simulated failure in get_metrics for {app_name}")

        result_series = {}

        # Check if app exists
        if app_name not in self.metrics:
            # Create empty summary
            now = datetime.now(timezone.utc)
            empty_summary = MetricsSummary(
                app_name=app_name,
                total_metrics=0,
                total_data_points=0,
                summary_start_time=now - timedelta(hours=1),
                summary_end_time=now,
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
            return MetricsListResponse(
                metrics={}, summary=empty_summary, query_params=params
            )

        # Filter by metric name if specified
        metric_names = []
        if params.metric_names:
            # Filter to only include metric names that exist
            metric_names = [
                name for name in params.metric_names if name in self.metrics[app_name]
            ]
            if not metric_names:
                # Create empty summary
                now = datetime.now(timezone.utc)
                empty_summary = MetricsSummary(
                    app_name=app_name,
                    total_metrics=0,
                    total_data_points=0,
                    summary_start_time=now - timedelta(hours=1),
                    summary_end_time=now,
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
                return MetricsListResponse(
                    metrics={}, summary=empty_summary, query_params=params
                )
        elif params.metric_names:
            metric_names = [
                name for name in params.metric_names if name in self.metrics[app_name]
            ]
        else:
            metric_names = list(self.metrics[app_name].keys())

        # Build series for each metric
        for name in metric_names:
            if name not in self.metrics[app_name]:
                continue

            # Get metric definition
            metric_def = self.metric_definitions.get(app_name, {}).get(name)
            if not metric_def:
                continue

            # Filter by metric type
            if params.metric_type and metric_def.type != params.metric_type:
                continue

            # Get all points for this metric
            all_points = list(self.metrics[app_name][name].values())

            # Filter by time range
            if params.start_time:
                all_points = [p for p in all_points if p.timestamp >= params.start_time]
            if params.end_time:
                all_points = [p for p in all_points if p.timestamp <= params.end_time]

            # Filter by labels
            if params.labels:
                filtered_points = []
                for point in all_points:
                    matches = True
                    for key, value in params.labels.items():
                        if key not in point.labels or point.labels[key] != value:
                            matches = False
                            break
                    if matches:
                        filtered_points.append(point)
                all_points = filtered_points

            # Sort by timestamp
            all_points.sort(key=lambda x: x.timestamp)

            # Apply pagination
            paginated_points = all_points[params.offset : params.offset + params.limit]

            # Skip if no points
            if not paginated_points:
                continue

            # Calculate statistics
            values = [p.value for p in paginated_points]
            min_val = min(values) if values else None
            max_val = max(values) if values else None
            avg_val = sum(values) / len(values) if values else None
            sum_val = sum(values) if values else None

            # Create series
            series = MetricSeries(
                name=name,
                type=metric_def.type,
                unit=metric_def.unit,
                app_name=app_name,
                description=metric_def.description,
                points=paginated_points,
                min_value=min_val,
                max_value=max_val,
                avg_value=avg_val,
                sum_value=sum_val,
                count=len(paginated_points),
                start_time=paginated_points[0].timestamp if paginated_points else None,
                end_time=paginated_points[-1].timestamp if paginated_points else None,
            )

            result_series[name] = series

        # Create summary
        now = datetime.now(timezone.utc)
        summary = MetricsSummary(
            app_name=app_name,
            total_metrics=len(result_series),
            total_data_points=sum(series.count for series in result_series.values()),
            summary_start_time=params.start_time or now - timedelta(hours=1),
            summary_end_time=params.end_time or now,
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

        return MetricsListResponse(
            metrics=result_series, summary=summary, query_params=params
        )

    async def get_metric_definitions(
        self, app_name: Optional[str] = None
    ) -> MetricDefinitionsResponse:
        """Get metric definitions, optionally filtered by app name.

        Args:
            app_name (Optional[str]): Application name to filter definitions by.

        Returns:
            MetricDefinitionsResponse: Response containing metric definitions.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "get_metric_definitions",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_metric_definitions", False):
            raise Exception("Simulated failure in get_metric_definitions")

        definitions = []

        if app_name:
            # Get definitions for specific app
            if app_name in self.metric_definitions:
                definitions = list(self.metric_definitions[app_name].values())
        else:
            # Get all definitions
            for app_defs in self.metric_definitions.values():
                definitions.extend(app_defs.values())

        return MetricDefinitionsResponse(
            definitions=definitions, total_count=len(definitions)
        )

    async def get_summary_metrics(self, app_name: str) -> Dict[str, Any]:
        """Get summarized metrics for an application.

        Args:
            app_name (str): Application name.

        Returns:
            Dict[str, Any]: Summary of metrics for the application.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "get_summary_metrics",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_summary_metrics", False):
            raise Exception(f"Simulated failure in get_summary_metrics for {app_name}")

        # Check if app exists
        if app_name not in self.metrics:
            return {"app_name": app_name, "metric_count": 0, "data_point_count": 0}

        # Calculate summary data
        metric_count = len(self.metrics[app_name])
        data_point_count = sum(
            len(points) for points in self.metrics[app_name].values()
        )

        return {
            "app_name": app_name,
            "metric_count": metric_count,
            "data_point_count": data_point_count,
        }

    async def get_metrics_summary(self, app_name: str) -> MetricsSummary:
        """Get summary metrics for an application.

        Args:
            app_name (str): Application name.

        Returns:
            MetricsSummary: Summary of metrics for the application.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "get_metrics_summary",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_metrics_summary", False):
            raise Exception(f"Simulated failure in get_metrics_summary for {app_name}")

        # Check if app exists
        if app_name not in self.metrics:
            now = datetime.now(timezone.utc)
            return MetricsSummary(
                app_name=app_name,
                total_metrics=0,
                total_data_points=0,
                summary_start_time=now - timedelta(hours=1),
                summary_end_time=now,
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

        metrics_by_type = {}
        data_point_count = 0
        earliest = None
        latest = None

        # Calculate stats for each metric
        for metric_name, points in self.metrics[app_name].items():
            metric_def = self.metric_definitions.get(app_name, {}).get(metric_name)
            if not metric_def:
                continue

            # Count data points
            point_count = len(points)
            data_point_count += point_count

            # Track metric by type
            metric_type = metric_def.type.value
            metrics_by_type[metric_type] = metrics_by_type.get(metric_type, 0) + 1

            # Track earliest/latest
            if point_count > 0:
                timestamps = list(points.keys())
                min_ts = min(timestamps)
                max_ts = max(timestamps)

                if earliest is None or min_ts < earliest:
                    earliest = min_ts

                if latest is None or max_ts > latest:
                    latest = max_ts

        now = datetime.now(timezone.utc)
        return MetricsSummary(
            app_name=app_name,
            total_metrics=len(self.metrics[app_name]),
            total_data_points=data_point_count,
            summary_start_time=earliest or now - timedelta(hours=1),
            summary_end_time=latest or now,
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

    async def get_metric_names(self, app_name: str) -> List[str]:
        """Get all metric names for an application.

        Args:
            app_name (str): Application name.

        Returns:
            List[str]: List of metric names.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "get_metric_names",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_metric_names", False):
            raise Exception(f"Simulated failure in get_metric_names for {app_name}")

        if app_name not in self.metrics:
            return []

        return list(self.metrics[app_name].keys())

    async def clear_metrics(
        self,
        app_name: str,
        metric_name: Optional[str] = None,
        before_timestamp: Optional[datetime] = None,
    ) -> MetricsClearResponse:
        """Clear metrics with optional filtering.

        Args:
            app_name (str): Application name.
            metric_name (Optional[str]): Specific metric name to clear.
            before_timestamp (Optional[datetime]): Timestamp to clear metrics before.

        Returns:
            MetricsClearResponse: Response with cleared counts.

        Raises:
            Exception: If the method is configured to fail.
        """
        # Create a request object for internal use
        request = MetricsClearRequest(
            app_name=app_name,
            metric_names=[metric_name] if metric_name else None,
            before_time=before_timestamp,
            older_than_days=None,
        )

        return await self._clear_metrics_internal(request)

    async def _clear_metrics_internal(
        self, request: MetricsClearRequest
    ) -> MetricsClearResponse:
        """Clear metrics based on filter parameters."""
        self.method_calls.append(
            {
                "method": "clear_metrics",
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("clear_metrics", False):
            raise Exception("Simulated failure in clear_metrics")

        deleted_count = 0

        # Filter by app name
        apps_to_clear = []
        if request.app_name:
            if request.app_name in self.metrics:
                apps_to_clear = [request.app_name]
        else:
            apps_to_clear = list(self.metrics.keys())

        # Process each applicable app
        for app_name in apps_to_clear:
            # Filter by metric name
            metrics_to_clear = []
            if request.metric_names and len(request.metric_names) == 1:
                metric_name = request.metric_names[0]
                if metric_name in self.metrics[app_name]:
                    metrics_to_clear = [metric_name]
            else:
                metrics_to_clear = list(self.metrics[app_name].keys())

            # Clear metrics based on parameters
            for metric_name in metrics_to_clear:
                # Get all points for this metric
                points = self.metrics[app_name][metric_name]

                # Filter by time range to determine which to remove
                to_remove = []
                for timestamp, point in points.items():
                    should_remove = True

                    # Filter by time
                    if request.before_time and timestamp > request.before_time:
                        should_remove = False

                    if should_remove:
                        to_remove.append(timestamp)

                # Remove points
                for timestamp in to_remove:
                    del points[timestamp]
                    deleted_count += 1

                # Remove metric if empty
                if not points:
                    del self.metrics[app_name][metric_name]
                    if metric_name in self.metric_definitions.get(app_name, {}):
                        del self.metric_definitions[app_name][metric_name]

            # Remove app if empty
            if not self.metrics[app_name]:
                del self.metrics[app_name]
                if app_name in self.metric_definitions:
                    del self.metric_definitions[app_name]

        return MetricsClearResponse(
            cleared_metrics=0,
            cleared_data_points=deleted_count,
            message=f"Cleared {deleted_count} metric data points",
        )

    async def generate_test_metrics(
        self, app_name: str, metric_count: int = 5, points_per_metric: int = 100
    ) -> Dict[str, MetricSeries]:
        """Generate test metrics for development and testing.

        Args:
            app_name (str): Application name.
            metric_count (int): Number of metrics to generate (default: 5).
            points_per_metric (int): Number of data points per metric (default: 100).

        Returns:
            Dict[str, MetricSeries]: Generated test metrics.

        Raises:
            Exception: If the method is configured to fail.
        """
        self.method_calls.append(
            {
                "method": "generate_test_metrics",
                "app_name": app_name,
                "metric_count": metric_count,
                "points_per_metric": points_per_metric,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("generate_test_metrics", False):
            raise Exception(
                f"Simulated failure in generate_test_metrics for {app_name}"
            )

        # Define sample metrics to generate
        sample_metrics = [
            {
                "name": "cpu_usage",
                "type": MetricType.GAUGE,
                "unit": MetricUnit.PERCENT,
                "description": "CPU usage percentage",
            },
            {
                "name": "memory_usage",
                "type": MetricType.GAUGE,
                "unit": MetricUnit.BYTES,
                "description": "Memory usage in bytes",
            },
            {
                "name": "request_count",
                "type": MetricType.COUNTER,
                "unit": MetricUnit.COUNT,
                "description": "Number of API requests",
            },
            {
                "name": "request_latency",
                "type": MetricType.HISTOGRAM,
                "unit": MetricUnit.MILLISECONDS,
                "description": "API request latency",
            },
            {
                "name": "error_count",
                "type": MetricType.COUNTER,
                "unit": MetricUnit.COUNT,
                "description": "Number of errors",
            },
            {
                "name": "disk_io",
                "type": MetricType.GAUGE,
                "unit": MetricUnit.BYTES_PER_SECOND,
                "description": "Disk I/O throughput",
            },
            {
                "name": "active_sessions",
                "type": MetricType.GAUGE,
                "unit": MetricUnit.COUNT,
                "description": "Number of active sessions",
            },
        ]

        # Generate metrics
        result_series = {}
        now = datetime.now(timezone.utc)

        # Use only the requested number of metrics
        for i in range(min(metric_count, len(sample_metrics))):
            metric = sample_metrics[i]

            # Generate data points over time
            points = []
            for j in range(points_per_metric):
                # Generate timestamp (starting 24 hours ago, up to now)
                point_time = (
                    now
                    - timedelta(hours=24)
                    + timedelta(seconds=(24 * 3600 * j / points_per_metric))
                )

                # Generate value based on metric type
                value = 0
                if metric["type"] == MetricType.GAUGE:
                    # Fluctuating value for gauge
                    value = 50 + 30 * math.sin(j / 10)
                    if metric["name"] == "memory_usage":
                        value = value * 1024 * 1024  # Scale to MB
                    elif metric["name"] == "disk_io":
                        value = value * 1024  # Scale to KB/s
                elif metric["type"] == MetricType.COUNTER:
                    # Increasing value for counter
                    value = j * 10
                elif metric["type"] == MetricType.HISTOGRAM:
                    # Random distribution for histogram
                    import random

                    value = 50 + random.normalvariate(0, 20)

                # Ensure sensible values
                value = max(0, value)
                if metric["unit"] == MetricUnit.PERCENT:
                    value = min(100, value)

                # Create point
                point = MetricPoint(
                    timestamp=point_time, value=value, labels={"environment": "test"}
                )
                points.append(point)

                # Register in internal storage
                if app_name not in self.metrics:
                    self.metrics[app_name] = {}
                if metric["name"] not in self.metrics[app_name]:
                    self.metrics[app_name][metric["name"]] = {}
                self.metrics[app_name][metric["name"]][point_time] = point

            # Register metric definition
            if app_name not in self.metric_definitions:
                self.metric_definitions[app_name] = {}

            now = datetime.now(timezone.utc)
            self.metric_definitions[app_name][metric["name"]] = MetricDefinition(
                created_at=now,
                last_recorded_at=now,
                name=metric["name"],
                type=metric["type"],
                unit=metric["unit"],
                app_name=app_name,
                description=metric["description"],
                labels=["environment"],
            )

            # Calculate statistics for series
            values = [p.value for p in points]

            # Create series
            series = MetricSeries(
                name=metric["name"],
                type=metric["type"],
                unit=metric["unit"],
                app_name=app_name,
                description=metric["description"],
                points=points,
                min_value=min(values),
                max_value=max(values),
                avg_value=sum(values) / len(values),
                sum_value=sum(values),
                count=len(points),
                start_time=points[0].timestamp,
                end_time=points[-1].timestamp,
            )

            result_series[metric["name"]] = series

        return result_series

    async def get_metric(
        self, app_name: str, metric_name: str, **kwargs
    ) -> MetricSeries:
        """Get a single metric series (compatibility method for API).

        Args:
            app_name (str): Application name.
            metric_name (str): Metric name.
            **kwargs: Additional arguments for compatibility.

        Returns:
            MetricSeries: The requested metric series.

        Raises:
            Exception: If the method is configured to fail.
        """
        # Convert kwargs to MetricsQueryParams if needed
        params = MetricsQueryParams(
            metric_names=[metric_name],
            start_time=kwargs.get("start_time"),
            end_time=kwargs.get("end_time"),
            limit=kwargs.get("limit", 1000),
            aggregation_interval=kwargs.get("aggregation_interval"),
            metric_type=kwargs.get("metric_type"),
        )

        # Use existing get_metrics method and extract the specific metric
        metrics_response = await self.get_metrics(app_name, params)

        if metric_name in metrics_response.metrics:
            return metrics_response.metrics[metric_name]

        # If metric not found, return empty series
        now = datetime.now(timezone.utc)
        return MetricSeries(
            name=metric_name,
            type=MetricType.GAUGE,
            unit=MetricUnit.COUNT,
            app_name=app_name,
            description=f"Metric {metric_name} not found",
            points=[],
            min_value=None,
            max_value=None,
            avg_value=None,
            sum_value=None,
            count=0,
            start_time=None,
            end_time=None,
        )

    async def get_metric_series(
        self, app_name: str, metric_name: str, params: MetricsQueryParams
    ) -> MetricSeries:
        """Get a single metric series by name.

        Args:
            app_name: Application name
            metric_name: Name of the metric to retrieve
            params: Query parameters for filtering

        Returns:
            MetricSeries for the specified metric
        """
        self.method_calls.append(
            {
                "method": "get_metric_series",
                "app_name": app_name,
                "metric_name": metric_name,
                "params": params,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_metric_series", False):
            raise Exception(f"Simulated failure in get_metric_series for {metric_name}")

        # Use existing get_metrics method and extract the specific metric
        metrics_response = await self.get_metrics(app_name, params)

        if metric_name in metrics_response.metrics:
            return metrics_response.metrics[metric_name]

        # If metric not found, return empty series
        return MetricSeries(
            name=metric_name,
            type=MetricType.GAUGE,
            unit=MetricUnit.COUNT,
            app_name=app_name,
            description=f"Metric {metric_name} not found",
            points=[],
            min_value=None,
            max_value=None,
            avg_value=None,
            sum_value=None,
            count=0,
            start_time=None,
            end_time=None,
        )
