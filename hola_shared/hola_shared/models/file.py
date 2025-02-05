"""File models for application files."""

from pydantic import BaseModel, Field
from typing import List
from datetime import datetime


class FileInfo(BaseModel):
    """Information about an application file."""

    path: str = Field(..., description="File path relative to app root")
    size: int = Field(..., description="Size in bytes")
    modified_at: datetime = Field(..., description="Last modification timestamp")
    content_type: str = Field(..., description="Content type of the file")


class FileListResponse(BaseModel):
    """Response model for file listing."""

    files: List[FileInfo] = Field(default_factory=list, description="List of files")
    count: int = Field(0, description="Total number of files")
    total_size_bytes: int = Field(0, description="Total size in bytes")
