"""Metrics collection and monitoring models for Hola applications.

This module defines the data models for metrics collection, time-series data,
and performance monitoring functionality.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any, Union
from enum import Enum
from datetime import datetime


class MetricType(str, Enum):
    """Metric type enumeration."""

    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"
    TIMER = "timer"


class MetricUnit(str, Enum):
    """Metric unit enumeration."""

    BYTES = "bytes"
    SECONDS = "seconds"
    MILLISECONDS = "milliseconds"
    PERCENT = "percent"
    COUNT = "count"
    REQUESTS_PER_SECOND = "requests_per_second"
    BYTES_PER_SECOND = "bytes_per_second"


class MetricPoint(BaseModel):
    """Single metric data point."""

    timestamp: datetime = Field(..., description="Timestamp when metric was recorded")
    value: float = Field(..., description="Metric value")
    labels: Dict[str, str] = Field(
        default_factory=dict, description="Additional metric labels"
    )


class MetricSeries(BaseModel):
    """Time series of metric data points."""

    name: str = Field(..., description="Metric name")
    type: MetricType = Field(..., description="Type of metric")
    unit: MetricUnit = Field(..., description="Unit of measurement")
    app_name: str = Field(..., description="Associated application name")
    description: Optional[str] = Field(None, description="Metric description")
    points: List[MetricPoint] = Field(..., description="List of metric data points")

    # Aggregated statistics
    min_value: Optional[float] = Field(None, description="Minimum value in series")
    max_value: Optional[float] = Field(None, description="Maximum value in series")
    avg_value: Optional[float] = Field(None, description="Average value in series")
    sum_value: Optional[float] = Field(None, description="Sum of all values")
    count: int = Field(..., description="Number of data points")

    # Time range
    start_time: Optional[datetime] = Field(
        None, description="First data point timestamp"
    )
    end_time: Optional[datetime] = Field(None, description="Last data point timestamp")


class MetricsQueryParams(BaseModel):
    """Parameters for querying metrics."""

    # Time range filters
    start_time: Optional[datetime] = Field(
        None, description="Start time for metrics query"
    )
    end_time: Optional[datetime] = Field(None, description="End time for metrics query")

    # Content filters
    metric_names: Optional[List[str]] = Field(
        None, description="Filter by specific metric names"
    )
    metric_type: Optional[MetricType] = Field(None, description="Filter by metric type")

    # Aggregation options
    aggregate: bool = Field(
        default=False, description="Whether to aggregate data points"
    )
    aggregation_interval: Optional[str] = Field(
        None, description="Aggregation interval (e.g., '1m', '5m', '1h')"
    )
    aggregation_function: str = Field(
        default="avg",
        pattern="^(avg|min|max|sum|count)$",
        description="Aggregation function",
    )

    # Pagination
    limit: int = Field(
        default=1000,
        ge=1,
        le=10000,
        description="Maximum number of data points to return",
    )
    offset: int = Field(default=0, ge=0, description="Number of data points to skip")

    # Labels filtering
    labels: Dict[str, str] = Field(
        default_factory=dict, description="Filter by metric labels"
    )


class MetricRecordRequest(BaseModel):
    """Request to record a new metric data point."""

    name: str = Field(..., description="Metric name")
    value: float = Field(..., description="Metric value")
    type: MetricType = Field(default=MetricType.GAUGE, description="Type of metric")
    unit: MetricUnit = Field(
        default=MetricUnit.COUNT, description="Unit of measurement"
    )
    description: Optional[str] = Field(None, description="Metric description")
    labels: Dict[str, str] = Field(
        default_factory=dict, description="Additional metric labels"
    )
    timestamp: Optional[datetime] = Field(
        None, description="Custom timestamp (defaults to current time)"
    )


class MetricDefinition(BaseModel):
    """Metric definition and metadata."""

    name: str = Field(..., description="Metric name")
    type: MetricType = Field(..., description="Type of metric")
    unit: MetricUnit = Field(..., description="Unit of measurement")
    app_name: str = Field(..., description="Associated application name")
    description: Optional[str] = Field(None, description="Metric description")
    labels: List[str] = Field(default_factory=list, description="Available label names")
    created_at: datetime = Field(..., description="When the metric was first recorded")
    last_recorded_at: Optional[datetime] = Field(
        None, description="When the metric was last recorded"
    )
    total_points: int = Field(
        default=0, description="Total number of recorded data points"
    )


class MetricsSummary(BaseModel):
    """Summary of application metrics."""

    app_name: str = Field(..., description="Application name")
    total_metrics: int = Field(..., description="Total number of defined metrics")
    total_data_points: int = Field(..., description="Total number of data points")

    # Resource metrics (if available)
    cpu_usage_percent: Optional[float] = Field(
        None, description="Current CPU usage percentage"
    )
    memory_usage_bytes: Optional[int] = Field(
        None, description="Current memory usage in bytes"
    )
    disk_usage_bytes: Optional[int] = Field(
        None, description="Current disk usage in bytes"
    )
    network_rx_bytes: Optional[int] = Field(None, description="Network bytes received")
    network_tx_bytes: Optional[int] = Field(
        None, description="Network bytes transmitted"
    )

    # Application metrics
    request_count: Optional[int] = Field(
        None, description="Total number of requests processed"
    )
    error_count: Optional[int] = Field(None, description="Total number of errors")
    response_time_ms: Optional[float] = Field(
        None, description="Average response time in milliseconds"
    )
    uptime_seconds: Optional[float] = Field(
        None, description="Application uptime in seconds"
    )

    # Time range
    summary_start_time: datetime = Field(..., description="Start time for summary data")
    summary_end_time: datetime = Field(..., description="End time for summary data")


class MetricsListResponse(BaseModel):
    """Response containing multiple metric series."""

    metrics: Dict[str, MetricSeries] = Field(
        ..., description="Metrics data by metric name"
    )
    summary: MetricsSummary = Field(..., description="Summary statistics")
    query_params: MetricsQueryParams = Field(..., description="Query parameters used")


class MetricDefinitionsResponse(BaseModel):
    """Response containing metric definitions."""

    definitions: List[MetricDefinition] = Field(
        ..., description="List of metric definitions"
    )
    total_count: int = Field(..., description="Total number of metric definitions")


class MetricsClearRequest(BaseModel):
    """Request to clear metrics data."""

    app_name: Optional[str] = Field(
        None, description="Clear metrics for specific application"
    )
    metric_names: Optional[List[str]] = Field(
        None, description="Clear specific metrics"
    )
    before_time: Optional[datetime] = Field(
        None, description="Clear metrics before this timestamp"
    )
    older_than_days: Optional[int] = Field(
        None, description="Clear metrics older than this many days"
    )


class MetricsClearResponse(BaseModel):
    """Response from metrics clearing operation."""

    cleared_metrics: int = Field(
        ..., description="Number of metric definitions cleared"
    )
    cleared_data_points: int = Field(..., description="Number of data points cleared")
    message: str = Field(..., description="Operation status message")
