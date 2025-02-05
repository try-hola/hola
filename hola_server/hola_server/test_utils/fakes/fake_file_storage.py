"""Fake file storage implementation for testing."""

from typing import Dict, List, Optional, BinaryIO, Any
from datetime import datetime, timezone
from io import BytesIO
import mimetypes
import os.path

from hola_shared.models.file import FileInfo, FileListResponse


class FakeFileStorage:
    """Fake implementation of file storage for testing.

    Provides in-memory file storage with state tracking for test assertions.
    """

    def __init__(self):
        """Initialize the fake file storage."""
        # Structure: {app_name: {file_path: {"content": bytes, "modified_at": datetime, "content_type": str}}}
        self.files: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}

    async def list_files(self, app_name: str) -> FileListResponse:
        """List all files for an application."""
        self.method_calls.append(
            {
                "method": "list_files",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if app_name not in self.files:
            self.files[app_name] = {}

        files = []
        total_size = 0
        for path, file_data in self.files[app_name].items():
            size = len(file_data["content"])
            total_size += size
            files.append(
                FileInfo(
                    path=path,
                    size=size,
                    modified_at=file_data["modified_at"],
                    content_type=file_data["content_type"],
                )
            )

        return FileListResponse(
            files=files, count=len(files), total_size_bytes=total_size
        )

    async def upload_file(
        self,
        app_name: str,
        file_path: str,
        content: bytes,
        content_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file for an application."""
        self.method_calls.append(
            {
                "method": "upload_file",
                "app_name": app_name,
                "file_path": file_path,
                "content_size": len(content),
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if app_name not in self.files:
            self.files[app_name] = {}

        # Determine content type if not provided
        if content_type is None:
            content_type = (
                mimetypes.guess_type(file_path)[0] or "application/octet-stream"
            )

        now = datetime.now(timezone.utc)
        self.files[app_name][file_path] = {
            "content": content,
            "modified_at": now,
            "content_type": content_type,
        }

        return FileInfo(
            path=file_path,
            size=len(content),
            modified_at=now,
            content_type=content_type,
        )

    async def get_file(self, app_name: str, file_path: str) -> Optional[BinaryIO]:
        """Get a file's contents."""
        self.method_calls.append(
            {
                "method": "get_file",
                "app_name": app_name,
                "file_path": file_path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if app_name not in self.files or file_path not in self.files[app_name]:
            return None

        return BytesIO(self.files[app_name][file_path]["content"])

    async def get_file_info(self, app_name: str, file_path: str) -> FileInfo:
        """Get file information without reading content."""
        self.method_calls.append(
            {
                "method": "get_file_info",
                "app_name": app_name,
                "file_path": file_path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if app_name not in self.files or file_path not in self.files[app_name]:
            from hola_shared.errors import NotFoundException

            raise NotFoundException(
                resource_type="file",
                resource_id=file_path,
                details={"app_name": app_name},
            )

        file_data = self.files[app_name][file_path]
        return FileInfo(
            path=file_path,
            size=len(file_data["content"]),
            modified_at=file_data["modified_at"],
            content_type=file_data["content_type"],
        )

    async def delete_file(self, app_name: str, file_path: str) -> bool:
        """Delete a file."""
        self.method_calls.append(
            {
                "method": "delete_file",
                "app_name": app_name,
                "file_path": file_path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._should_fail(
            "file_delete"
        ):  # Check for forced failure (key is "file_delete" in test)
            from hola_shared.errors import ValidationException  # Add import

            raise ValidationException(
                "Forced file deletion failure in fake for testing"
            )

        if app_name not in self.files or file_path not in self.files[app_name]:
            return False

        del self.files[app_name][file_path]
        return True

    # Helper methods for testing
    def has_file(self, app_name: str, file_path: str) -> bool:
        """Check if a file exists."""
        return app_name in self.files and file_path in self.files[app_name]

    def get_file_content(self, app_name: str, file_path: str) -> Optional[bytes]:
        """Get the content of a file."""
        if self.has_file(app_name, file_path):
            return self.files[app_name][file_path]["content"]
        return None

    def get_file_count(self, app_name: str) -> int:
        """Get the number of files for an app."""
        if app_name not in self.files:
            return 0
        return len(self.files[app_name])

    def get_method_call_count(self, method_name: str) -> int:
        """Get the number of times a method was called."""
        return len(
            [call for call in self.method_calls if call["method"] == method_name]
        )

    def was_method_called_with(self, method_name: str, **kwargs) -> bool:
        """Check if a method was called with specific arguments."""
        for call in self.method_calls:
            if call["method"] == method_name:
                matches = True
                for key, value in kwargs.items():
                    if key not in call or call[key] != value:
                        matches = False
                        break
                if matches:
                    return True
        return False

    def reset(self) -> None:
        """Reset the fake file storage state."""
        self.files.clear()
        self.method_calls.clear()
        self._failure_modes.clear()

    def set_failure_mode(self, method_name: str, should_fail: bool):
        """Set a method to fail for testing purposes."""
        self._failure_modes[method_name] = should_fail

    def _should_fail(self, method_name: str) -> bool:
        """Check if a method should fail based on failure modes."""
        return self._failure_modes.get(method_name, False)
