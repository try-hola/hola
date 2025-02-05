"""Application models for Hola applications.

This module defines the data models for applications managed by the Hola platform.
These models are shared between the server and CLI components to ensure consistency.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


class AppStatus(str, Enum):
    """Application status enumeration."""

    UNKNOWN = "unknown"
    CREATED = "created"  # App exists but is not deployed yet
    DEPLOYING = "deploying"
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"
    UPGRADING = "upgrading"
    STARTING = "starting"
    STOPPING = "stopping"


class AppHealth(str, Enum):
    """Application health status enumeration."""

    HEALTHY = "healthy"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class App(BaseModel):
    """Application model shared between server and CLI.

    Represents a deployed application with its configuration, status, and metadata.
    """

    name: str = Field(..., description="Unique application name")
    status: AppStatus = Field(
        default=AppStatus.UNKNOWN, description="Current application status"
    )
    health: AppHealth = Field(
        default=AppHealth.UNKNOWN, description="Application health status"
    )
    image: Optional[str] = Field(
        None, description="Container image used for the application"
    )
    port: Optional[int] = Field(None, description="Port the application is running on")
    environment: Dict[str, str] = Field(
        default_factory=dict, description="Environment variables"
    )
    created_at: Optional[datetime] = Field(
        None, description="Application creation timestamp"
    )
    updated_at: Optional[datetime] = Field(None, description="Last update timestamp")
    version: Optional[str] = Field(None, description="Application version")
    description: Optional[str] = Field(None, description="Application description")
    url: Optional[str] = Field(None, description="Application access URL")
    backup_count: Optional[int] = Field(0, description="Number of available backups")
    files_count: int = Field(0, description="Number of application files")
    files_total_size_bytes: int = Field(
        0, description="Total size of application files in bytes"
    )

    model_config = ConfigDict(use_enum_values=True)


class AppCreateRequest(BaseModel):
    """Request model for creating applications (without deployment)."""

    name: str = Field(
        ..., description="Unique application name", min_length=1, max_length=50
    )
    description: Optional[str] = Field(
        None, description="Application description", max_length=500
    )
    image: Optional[str] = Field(
        None, description="Container image for future deployment", min_length=1
    )
    port: Optional[int] = Field(
        None, description="Port to expose for the application", ge=1, le=65535
    )
    environment: Dict[str, str] = Field(
        default_factory=dict, description="Environment variables"
    )
    version: Optional[str] = Field(
        None, description="Application version tag", max_length=50
    )


class AppCreateResponse(BaseModel):
    """Response model for application creation."""

    app: App = Field(..., description="The created application")
    message: str = Field(..., description="Human-readable creation confirmation")


class AppDeployRequest(BaseModel):
    """Request model for deploying applications."""

    name: str = Field(
        ..., description="Unique application name", min_length=1, max_length=50
    )
    image: str = Field(..., description="Container image to deploy", min_length=1)
    port: Optional[int] = Field(
        None, description="Port to expose for the application", ge=1, le=65535
    )
    environment: Dict[str, str] = Field(
        default_factory=dict, description="Environment variables"
    )
    description: Optional[str] = Field(
        None, description="Application description", max_length=500
    )
    version: Optional[str] = Field(
        None, description="Application version tag", max_length=50
    )


class AppUpgradeRequest(BaseModel):
    """Request model for upgrading applications."""

    image: Optional[str] = Field(None, description="New container image to upgrade to")
    environment: Optional[Dict[str, str]] = Field(
        None, description="Environment variables to update"
    )
    version: Optional[str] = Field(
        None, description="New application version tag", max_length=50
    )
    backup_before_upgrade: bool = Field(
        True, description="Create backup before upgrading"
    )


class AppActionResponse(BaseModel):
    """Response model for application actions (start, stop, restart)."""

    success: bool = Field(..., description="Whether the action was successful")
    message: str = Field(..., description="Human-readable message about the action")
    previous_status: AppStatus = Field(
        ..., description="Application status before the action"
    )
    new_status: AppStatus = Field(
        ..., description="Application status after the action"
    )


class AppListResponse(BaseModel):
    """Response model for listing applications."""

    apps: List[App] = Field(..., description="List of applications")
    total_count: int = Field(..., description="Total number of applications")


class AppDeployResponse(BaseModel):
    """Response model for application deployment."""

    app: App = Field(..., description="The deployed application")
    deployment_id: str = Field(..., description="Unique deployment identifier")
    estimated_duration: Optional[int] = Field(
        None, description="Estimated deployment time in seconds"
    )
