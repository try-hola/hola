"""Application models for Hola.

This module contains Pydantic models for application-related data structures.
"""

from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

class AppStatus(str, Enum):
    """Application status enumeration."""
    RUNNING = "running"
    STOPPED = "stopped"
    ERROR = "error"
    STARTING = "starting"
    STOPPING = "stopping"
    DEPLOYING = "deploying"

class App(BaseModel):
    """Application model."""
    name: str = Field(..., description="Application name")
    status: AppStatus = Field(..., description="Current application status")
    description: Optional[str] = Field(None, description="Application description")
    version: Optional[str] = Field(None, description="Application version")
    port: Optional[int] = Field(None, description="Application port")
    package_ref: Optional[str] = Field(None, description="ORAS package reference")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    environment: Dict[str, str] = Field(default_factory=dict, description="Environment variables")
    
    class Config:
        use_enum_values = True

class AppCreateRequest(BaseModel):
    """Request model for creating a new application."""
    name: str = Field(..., description="Application name", min_length=1, max_length=100)
    package_ref: str = Field(..., description="ORAS package reference")
    description: Optional[str] = Field(None, description="Application description", max_length=500)
    environment: Dict[str, str] = Field(default_factory=dict, description="Environment variables")

class AppUpdateRequest(BaseModel):
    """Request model for updating an application."""
    description: Optional[str] = Field(None, description="Application description", max_length=500)
    environment: Optional[Dict[str, str]] = Field(None, description="Environment variables")

class AppStats(BaseModel):
    """Application statistics model."""
    total_apps: int = Field(..., description="Total number of applications")
    running_apps: int = Field(..., description="Number of running applications")
    stopped_apps: int = Field(..., description="Number of stopped applications") 
    error_apps: int = Field(0, description="Number of applications with errors")
    issues: int = Field(0, description="Number of applications with issues")

class AppList(BaseModel):
    """Application list response model."""
    apps: List[App] = Field(..., description="List of applications")
    total: int = Field(..., description="Total number of applications")
    page: int = Field(1, description="Current page number")
    per_page: int = Field(20, description="Items per page")
