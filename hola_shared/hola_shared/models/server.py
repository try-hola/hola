"""Server status and health models for Hola server management.

This module defines the data models for server status, health checks, and resource monitoring.
These models are shared between the server and CLI components to ensure consistency.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, Dict, Any
from enum import Enum
from datetime import datetime


class HealthCheckStatus(str, Enum):
    """Health check status enumeration."""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    DEGRADED = "degraded"
    UNKNOWN = "unknown"


class ServerState(str, Enum):
    """Server state enumeration."""

    RUNNING = "running"
    STARTING = "starting"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class HealthCheckResult(BaseModel):
    """Individual health check result."""

    name: str = Field(..., description="Name of the health check")
    status: HealthCheckStatus = Field(..., description="Health check status")
    message: Optional[str] = Field(None, description="Optional status message")
    duration_ms: Optional[float] = Field(
        None, description="Health check duration in milliseconds"
    )
    checked_at: datetime = Field(..., description="When the health check was performed")


class HealthStatus(BaseModel):
    """Overall server health status."""

    status: HealthCheckStatus = Field(..., description="Overall health status")
    checks: Dict[str, HealthCheckResult] = Field(
        default_factory=dict, description="Individual health check results"
    )
    checked_at: datetime = Field(..., description="When the health status was checked")


class VersionInfo(BaseModel):
    """Server version information."""

    version: str = Field(..., description="Server version number")
    build_id: Optional[str] = Field(None, description="Build identifier")
    build_date: Optional[datetime] = Field(None, description="Build timestamp")
    git_commit: Optional[str] = Field(None, description="Git commit hash")
    python_version: str = Field(..., description="Python version")


class ResourceUsage(BaseModel):
    """Server resource usage information."""

    cpu_percent: float = Field(..., description="CPU usage percentage")
    memory_used_bytes: int = Field(..., description="Memory used in bytes")
    memory_total_bytes: int = Field(..., description="Total memory in bytes")
    disk_used_bytes: int = Field(..., description="Disk space used in bytes")
    disk_total_bytes: int = Field(..., description="Total disk space in bytes")
    uptime_seconds: float = Field(..., description="Server uptime in seconds")
    measured_at: datetime = Field(..., description="When the metrics were measured")


class ServerStatus(BaseModel):
    """Complete server status information."""

    state: ServerState = Field(..., description="Current server state")
    health: HealthStatus = Field(..., description="Health check results")
    version: VersionInfo = Field(..., description="Version information")
    resources: ResourceUsage = Field(..., description="Resource usage metrics")
    started_at: datetime = Field(..., description="When the server was started")
    status_checked_at: datetime = Field(
        ..., description="When this status was generated"
    )
