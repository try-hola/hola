"""Log management models for Hola application logging.

This module defines the data models for log entries, log queries,
and log management operations.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime


class LogLevel(str, Enum):
    """Log level enumeration."""
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class LogSource(str, Enum):
    """Log source enumeration."""
    APPLICATION = "application"
    SYSTEM = "system"
    DEPLOYMENT = "deployment"
    HEALTH_CHECK = "health_check"
    BACKUP = "backup"
    RESTORE = "restore"


class LogEntry(BaseModel):
    """Individual log entry."""
    id: str = Field(..., description="Unique log entry identifier")
    timestamp: datetime = Field(..., description="Log entry timestamp")
    level: LogLevel = Field(..., description="Log level")
    source: LogSource = Field(..., description="Log source")
    app_name: Optional[str] = Field(None, description="Associated application name")
    message: str = Field(..., description="Log message content")
    context: Dict[str, Any] = Field(default_factory=dict, description="Additional context data")
    
    # Optional metadata
    request_id: Optional[str] = Field(None, description="Associated request ID")
    session_id: Optional[str] = Field(None, description="Associated session ID")
    user_id: Optional[str] = Field(None, description="Associated user ID")
    
    # Technical details
    module: Optional[str] = Field(None, description="Source module or component")
    function: Optional[str] = Field(None, description="Source function")
    line_number: Optional[int] = Field(None, description="Source line number")
    
    # Exception details (for error logs)
    exception_type: Optional[str] = Field(None, description="Exception type name")
    exception_message: Optional[str] = Field(None, description="Exception message")
    stack_trace: Optional[str] = Field(None, description="Exception stack trace")


class LogQueryParams(BaseModel):
    """Parameters for querying logs."""
    # Time range filters
    start_time: Optional[datetime] = Field(None, description="Start time for log query")
    end_time: Optional[datetime] = Field(None, description="End time for log query")
    
    # Content filters
    level: Optional[LogLevel] = Field(None, description="Filter by log level")
    source: Optional[LogSource] = Field(None, description="Filter by log source")
    app_name: Optional[str] = Field(None, description="Filter by application name")
    message_contains: Optional[str] = Field(None, description="Filter by message content")
    
    # Pagination
    limit: int = Field(default=100, ge=1, le=1000, description="Maximum number of entries to return")
    offset: int = Field(default=0, ge=0, description="Number of entries to skip")
    
    # Sorting
    sort_order: str = Field(default="desc", pattern="^(asc|desc)$", description="Sort order by timestamp")
    
    # Additional filters
    request_id: Optional[str] = Field(None, description="Filter by request ID")
    session_id: Optional[str] = Field(None, description="Filter by session ID")
    user_id: Optional[str] = Field(None, description="Filter by user ID")


class LogSummary(BaseModel):
    """Summary statistics for logs."""
    total_entries: int = Field(..., description="Total number of log entries")
    entries_by_level: Dict[str, int] = Field(..., description="Count of entries by log level")
    entries_by_source: Dict[str, int] = Field(..., description="Count of entries by source")
    earliest_entry: Optional[datetime] = Field(None, description="Timestamp of earliest log entry")
    latest_entry: Optional[datetime] = Field(None, description="Timestamp of latest log entry")
    size_bytes: int = Field(..., description="Total size of log data in bytes")


class LogResponse(BaseModel):
    """Response containing log entries and metadata."""
    entries: List[LogEntry] = Field(..., description="List of log entries")
    total_count: int = Field(..., description="Total number of matching entries")
    has_more: bool = Field(..., description="Whether more entries are available")
    query_params: LogQueryParams = Field(..., description="Query parameters used")
    summary: Optional[LogSummary] = Field(None, description="Log summary statistics")


class LogCreateRequest(BaseModel):
    """Request to create a new log entry."""
    level: LogLevel = Field(..., description="Log level")
    source: LogSource = Field(..., description="Log source")
    message: str = Field(..., description="Log message content")
    context: Dict[str, Any] = Field(default_factory=dict, description="Additional context data")
    
    # Optional metadata
    request_id: Optional[str] = Field(None, description="Associated request ID")
    session_id: Optional[str] = Field(None, description="Associated session ID")
    user_id: Optional[str] = Field(None, description="Associated user ID")
    
    # Technical details
    module: Optional[str] = Field(None, description="Source module or component")
    function: Optional[str] = Field(None, description="Source function")
    line_number: Optional[int] = Field(None, description="Source line number")
    
    # Exception details
    exception_type: Optional[str] = Field(None, description="Exception type name")
    exception_message: Optional[str] = Field(None, description="Exception message")
    stack_trace: Optional[str] = Field(None, description="Exception stack trace")


class LogClearRequest(BaseModel):
    """Request to clear logs with optional filtering."""
    app_name: Optional[str] = Field(None, description="Clear logs for specific application")
    before_time: Optional[datetime] = Field(None, description="Clear logs before this timestamp")
    level: Optional[LogLevel] = Field(None, description="Clear logs of specific level")
    source: Optional[LogSource] = Field(None, description="Clear logs from specific source")


class LogClearResponse(BaseModel):
    """Response from log clearing operation."""
    cleared_count: int = Field(..., description="Number of log entries cleared")
    message: str = Field(..., description="Operation status message")
