"""Configuration models for Hola applications.

This module defines the data models for application configurations managed by the Hola platform.
These models are shared between the server and CLI components to ensure consistency.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class ConfigEntry(BaseModel):
    """A single configuration entry."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    key: str = Field(..., description="Configuration key")
    value: Any = Field(..., description="Configuration value")
    description: Optional[str] = Field(None, description="Description of the configuration entry")
    is_secret: bool = Field(False, description="Whether this is a secret value")
    created_at: datetime = Field(..., description="When the configuration was created")
    updated_at: datetime = Field(..., description="When the configuration was last updated")


class ConfigUpdateRequest(BaseModel):
    """Request to update a configuration entry."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    value: Any = Field(..., description="New configuration value")
    description: Optional[str] = Field(None, description="Description of the configuration entry")
    is_secret: bool = Field(False, description="Whether this is a secret value")


class ConfigCreateRequest(BaseModel):
    """Request to create a new configuration entry."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    key: str = Field(..., description="Configuration key")
    value: Any = Field(..., description="Configuration value")
    description: Optional[str] = Field(None, description="Description of the configuration entry")
    is_secret: bool = Field(False, description="Whether this is a secret value")


class AppConfig(BaseModel):
    """Complete configuration for an application."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    app_name: str = Field(..., description="Name of the application")
    config: Dict[str, ConfigEntry] = Field(default_factory=dict, description="Configuration entries")
    created_at: datetime = Field(..., description="When the configuration was created")
    updated_at: datetime = Field(..., description="When the configuration was last updated")


class ConfigResponse(BaseModel):
    """Response containing configuration data."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    success: bool = Field(True, description="Whether the operation was successful")
    config: AppConfig = Field(..., description="Application configuration")


class ConfigListResponse(BaseModel):
    """Response containing list of configuration entries."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    success: bool = Field(True, description="Whether the operation was successful")
    entries: List[ConfigEntry] = Field(..., description="Configuration entries")
    count: int = Field(..., description="Total number of entries")


class ConfigEntryResponse(BaseModel):
    """Response containing a single configuration entry."""
    
    model_config = ConfigDict(
        str_strip_whitespace=True,
        validate_assignment=True,
        extra="forbid"
    )
    
    success: bool = Field(True, description="Whether the operation was successful")
    entry: ConfigEntry = Field(..., description="Configuration entry")
