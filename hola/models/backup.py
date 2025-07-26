"""Backup and restore models for Hola application management.

This module defines the data models for backup operations, restore functionality,
and backup metadata management.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from enum import Enum
from datetime import datetime


class BackupStatus(str, Enum):
    """Backup status enumeration."""

    CREATING = "creating"
    COMPLETED = "completed"
    FAILED = "failed"
    DELETED = "deleted"


class RestoreStatus(str, Enum):
    """Restore operation status enumeration."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class BackupInfo(BaseModel):
    """Backup information and metadata."""

    id: str = Field(..., description="Unique backup identifier")
    app_name: str = Field(..., description="Name of the application backed up")
    description: Optional[str] = Field(None, description="Optional backup description")
    status: BackupStatus = Field(..., description="Current backup status")
    size_bytes: Optional[int] = Field(None, description="Backup size in bytes")
    created_at: datetime = Field(..., description="When the backup was created")
    completed_at: Optional[datetime] = Field(
        None, description="When the backup was completed"
    )
    error_message: Optional[str] = Field(
        None, description="Error message if backup failed"
    )

    # Backup content metadata
    includes_config: bool = Field(
        default=True, description="Whether backup includes configuration"
    )
    includes_files: bool = Field(
        default=True, description="Whether backup includes application files"
    )
    includes_data: bool = Field(
        default=True, description="Whether backup includes application data"
    )

    # Version information
    app_version: Optional[str] = Field(
        None, description="Application version at backup time"
    )
    server_version: str = Field(
        ..., description="Server version that created the backup"
    )


class BackupCreateRequest(BaseModel):
    """Request to create a new backup."""

    description: Optional[str] = Field(None, description="Optional backup description")
    include_config: bool = Field(
        default=True, description="Include configuration in backup"
    )
    include_files: bool = Field(
        default=True, description="Include application files in backup"
    )
    include_data: bool = Field(
        default=True, description="Include application data in backup"
    )


class BackupCreateResponse(BaseModel):
    """Response from backup creation request."""

    backup: BackupInfo = Field(..., description="Created backup information")
    message: str = Field(..., description="Success message")


class BackupListResponse(BaseModel):
    """Response containing list of backups."""

    backups: List[BackupInfo] = Field(..., description="List of backup information")
    total_count: int = Field(..., description="Total number of backups")
    total_size_bytes: int = Field(..., description="Total size of all backups in bytes")


class RestoreRequest(BaseModel):
    """Request to restore from a backup."""

    backup_id: str = Field(..., description="ID of backup to restore from")
    target_app_name: Optional[str] = Field(
        None, description="Target application name (defaults to original)"
    )
    restore_config: bool = Field(default=True, description="Restore configuration")
    restore_files: bool = Field(default=True, description="Restore application files")
    restore_data: bool = Field(default=True, description="Restore application data")


class RestoreInfo(BaseModel):
    """Information about a restore operation."""

    id: str = Field(..., description="Unique restore operation identifier")
    backup_id: str = Field(..., description="ID of backup being restored")
    app_name: str = Field(..., description="Name of application being restored")
    target_app_name: str = Field(..., description="Target application name")
    status: RestoreStatus = Field(..., description="Current restore status")
    started_at: datetime = Field(..., description="When the restore operation started")
    completed_at: Optional[datetime] = Field(
        None, description="When the restore operation completed"
    )
    error_message: Optional[str] = Field(
        None, description="Error message if restore failed"
    )
    progress_message: Optional[str] = Field(
        None, description="Current progress message"
    )


class RestoreResponse(BaseModel):
    """Response from restore operation request."""

    restore: RestoreInfo = Field(..., description="Restore operation information")
    message: str = Field(..., description="Status message")
