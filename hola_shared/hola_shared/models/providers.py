"""Provider API models.

This module defines the models used by the provider API for server management.
These models form the shared contract between the CLI and server components
for managing servers across different provider implementations.
"""

from typing import Optional, Dict, Any, List
from enum import Enum
from pydantic import BaseModel, Field


class ServerStatus(str, Enum):
    """Enum representing possible server status values.

    This enumeration defines all possible states a server can be in
    throughout its lifecycle. It inherits from str to ensure JSON serialization
    works correctly while maintaining type safety.

    Attributes:
        CREATED: Initial state after server creation before it's started
        RUNNING: Server is currently running and available for requests
        STOPPED: Server was running but has been stopped
        PAUSED: Server execution is temporarily paused
        ERROR: Server encountered an error during operation
        UNKNOWN: Server state cannot be determined
        NOT_FOUND: Server no longer exists or is not available
    """

    CREATED = "created"
    RUNNING = "running"
    STOPPED = "stopped"
    PAUSED = "paused"
    ERROR = "error"
    UNKNOWN = "unknown"
    NOT_FOUND = "not_found"


class ProviderInfo(BaseModel):
    """Information about a server provider."""

    type: str = Field(..., description="Provider type identifier")
    display_name: str = Field(..., description="User-friendly name for the provider")
    available: bool = Field(
        ..., description="Whether the provider is available on the current system"
    )


class ProviderListResponse(BaseModel):
    """Response model for the provider list endpoint."""

    providers: List[ProviderInfo] = Field(
        ..., description="List of available providers"
    )


class BootstrapOptions(BaseModel):
    """Options for bootstrapping a new server."""

    image: str = Field(
        "python:3.10-slim", description="Docker image to use for the server"
    )
    name: Optional[str] = Field(None, description="Name for the server")
    port: int = Field(8000, description="Port to expose for the server")
    env: Dict[str, str] = Field(
        default_factory=dict, description="Environment variables to set"
    )


class BootstrapRequest(BaseModel):
    """Request model for bootstrapping a new server."""

    provider_type: str = Field(..., description="Provider type to use")
    options: BootstrapOptions = Field(
        default_factory=lambda: BootstrapOptions(), description="Bootstrap options"
    )


class ServerContext(BaseModel):
    """Provider-specific context for a server."""

    provider: str = Field(..., description="Provider type")
    container_id: Optional[str] = Field(None, description="Container ID for the server")
    name: Optional[str] = Field(None, description="Server name")
    status: str = Field(..., description="Server status")
    ip_address: Optional[str] = Field(None, description="Server IP address")
    started_at: Optional[str] = Field(
        None, description="Timestamp when the server was started"
    )
    error: Optional[str] = Field(
        None, description="Error message if the operation failed"
    )


class ServerRequest(BaseModel):
    """Request model for server operations."""

    provider_type: str = Field(..., description="Provider type")
    context: Dict[str, Any] = Field(..., description="Provider-specific context")


class ServerInfo(BaseModel):
    """Information about a server."""

    id: str = Field(..., description="Server identifier")
    name: str = Field(..., description="Server name")
    provider_type: str = Field(..., description="Provider type")
    status: ServerStatus = Field(ServerStatus.UNKNOWN, description="Current status")
    context: Dict[str, Any] = Field(
        default_factory=dict, description="Provider-specific context"
    )
    url: Optional[str] = Field(None, description="URL to access the server")
    created_at: str = Field(..., description="ISO timestamp when server was created")
    started_at: Optional[str] = Field(
        None, description="ISO timestamp when server was last started"
    )
    error: Optional[str] = Field(None, description="Error message if status is ERROR")


class ServerCollection(BaseModel):
    """Collection of servers."""

    servers: List[ServerInfo] = Field(
        default_factory=list, description="List of servers"
    )
