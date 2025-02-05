"""File storage service for Hola applications.

This module provides business logic for managing application files,
including uploads, listings, downloads, and deletions.
"""

import os
import asyncio  # Added import
import io  # Added import for consistency with strategy example, though BytesIO is used
from typing import Dict, List, Optional, BinaryIO, Any
from datetime import datetime, timezone
from io import BytesIO
import mimetypes

from hola_shared.models.file import FileInfo, FileListResponse
from hola_shared.errors import NotFoundException, ValidationException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import (
    ServerContext,
)  # This import will be a circular dependency if FileStorage is initialized in ServerContext directly. Will need to fix later.

logger = get_logger(__name__)


class FileStorage:
    """Service for managing application files.

    Provides business logic for file management including uploads, listings,
    downloads, and deletions.
    """

    def __init__(self, context: ServerContext):
        """Initialize the file storage service.

        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.settings = context.settings
        self.base_path = os.path.join(
            self.settings.data_dir, "apps"
        )  # Base path for app files
        os.makedirs(self.base_path, exist_ok=True)  # Ensure base directory exists

        logger.debug(f"FileStorage initialized with base path: {self.base_path}")

    def _get_app_path(self, app_name: str) -> str:
        """Get the base path for a specific application's files."""
        return os.path.join(self.base_path, app_name, "files")

    def _get_file_full_path(self, app_name: str, file_path: str) -> str:
        """Get the full file system path for a given app file."""
        return os.path.join(self._get_app_path(app_name), file_path)

    async def list_files(self, app_name: str) -> FileListResponse:
        """List all files for an application.

        Args:
            app_name: Name of the application

        Returns:
            List of file information
        """
        logger.info(f"Listing files for app '{app_name}'")

        app_files_path = self._get_app_path(app_name)

        if not await asyncio.to_thread(os.path.exists, app_files_path):
            return FileListResponse(files=[], count=0, total_size_bytes=0)

        def _collect_file_details_sync():
            collected_files = []
            current_total_size = 0
            for root, _, filenames in os.walk(app_files_path):
                for filename in filenames:
                    full_path = os.path.join(root, filename)
                    rel_path = os.path.relpath(full_path, app_files_path)

                    try:
                        stat_info = os.stat(full_path)
                        size = stat_info.st_size
                        modified_at_timestamp = stat_info.st_mtime
                        content_type = (
                            mimetypes.guess_type(full_path)[0]
                            or "application/octet-stream"
                        )

                        collected_files.append(
                            {
                                "path": rel_path,
                                "size": size,
                                "modified_at_timestamp": modified_at_timestamp,
                                "content_type": content_type,
                            }
                        )
                        current_total_size += size
                    except FileNotFoundError:
                        # File might have been deleted between os.walk and os.stat
                        logger.warning(
                            f"File not found during stat: {full_path} for app '{app_name}'. Skipping."
                        )
                    except Exception as e:
                        logger.error(
                            f"Error stating file {full_path} for app '{app_name}': {e}"
                        )
                        # Decide if you want to skip or raise
            return {
                "files_details": collected_files,
                "total_size_bytes": current_total_size,
            }

        details_result = await asyncio.to_thread(_collect_file_details_sync)

        processed_files = []
        for file_detail in details_result["files_details"]:
            processed_files.append(
                FileInfo(
                    path=file_detail["path"],
                    size=file_detail["size"],
                    modified_at=datetime.fromtimestamp(
                        file_detail["modified_at_timestamp"], tz=timezone.utc
                    ),
                    content_type=file_detail["content_type"],
                )
            )

        logger.debug(f"Found {len(processed_files)} files for app '{app_name}'")
        return FileListResponse(
            files=processed_files,
            count=len(processed_files),
            total_size_bytes=details_result["total_size_bytes"],
        )

    async def upload_file(
        self,
        app_name: str,
        file_path: str,
        content: bytes,
        content_type: Optional[str] = None,
    ) -> FileInfo:
        """Upload a file for an application.

        Args:
            app_name: Name of the application
            file_path: Target path within app's file storage
            content: File content as bytes
            content_type: MIME type of the file (optional)

        Returns:
            Information about the uploaded file

        Raises:
            ValidationException: If the file path is invalid
        """
        logger.info(f"Uploading file for app '{app_name}': {file_path}")

        full_path = self._get_file_full_path(app_name, file_path)

        dir_name = os.path.dirname(full_path)
        await asyncio.to_thread(os.makedirs, dir_name, exist_ok=True)

        def _write_file_sync():
            try:
                with open(full_path, "wb") as f_sync:
                    f_sync.write(content)
            except IOError as e:
                # This exception will be caught by the caller of asyncio.to_thread
                # and re-raised in the main thread.
                raise ValidationException(message=f"Failed to write file to disk: {e}")

        await asyncio.to_thread(_write_file_sync)

        # Get file stats after writing
        def _stat_file_sync():
            try:
                return os.stat(full_path)
            except FileNotFoundError:
                # Should not happen if write was successful, but good to handle
                raise ServiceException(
                    message=f"File not found after supposedly successful write: {full_path}",
                    service_name="file_storage",
                )
            except OSError as e:
                raise ServiceException(
                    message=f"Failed to stat file after write: {e}",
                    service_name="file_storage",
                )

        stat_info = await asyncio.to_thread(_stat_file_sync)
        size = stat_info.st_size
        modified_at = datetime.fromtimestamp(stat_info.st_mtime, tz=timezone.utc)

        if content_type is None:
            # mimetypes.guess_type can also be blocking if it does complex things,
            # but usually it's fast. For strictness, it could be wrapped.
            # For now, assume it's acceptable.
            content_type = (
                mimetypes.guess_type(full_path)[0] or "application/octet-stream"
            )

        logger.debug(f"Uploaded file '{file_path}' for app '{app_name}'")
        return FileInfo(
            path=file_path,
            size=size,
            modified_at=modified_at,
            content_type=content_type,
        )

    async def get_file(self, app_name: str, file_path: str) -> Optional[BinaryIO]:
        """Get a file's contents.

        Args:
            app_name: Name of the application
            file_path: Path of the file to retrieve

        Returns:
            File content as a BytesIO object, or None if not found
        """
        logger.info(f"Retrieving file for app '{app_name}': {file_path}")

        full_path = self._get_file_full_path(app_name, file_path)

        exists = await asyncio.to_thread(os.path.exists, full_path)
        if not exists:
            return None

        def _read_file_sync():
            try:
                with open(full_path, "rb") as f_sync:
                    return f_sync.read()
            except IOError as e:
                # This exception will be caught by the caller of asyncio.to_thread
                # and re-raised in the main thread.
                raise ServiceException(
                    message=f"Failed to read file from disk: {e}",
                    service_name="file_storage",
                )

        content_bytes = await asyncio.to_thread(_read_file_sync)
        return io.BytesIO(content_bytes)  # Using io.BytesIO as per strategy example

    async def get_file_info(self, app_name: str, file_path: str) -> FileInfo:
        """Get file information without reading content.

        Args:
            app_name: Name of the application
            file_path: Path to the file within app's storage

        Returns:
            File information

        Raises:
            NotFoundException: If file doesn't exist
            ServiceException: If there's an error accessing file
        """
        logger.debug(f"Getting file info for app '{app_name}': {file_path}")

        full_path = self._get_file_full_path(app_name, file_path)

        def _stat_file_sync():
            try:
                return os.stat(full_path)
            except FileNotFoundError:
                raise NotFoundException(
                    resource_type="file",
                    resource_id=file_path,
                    details={"app_name": app_name},
                )
            except OSError as e:
                raise ServiceException(
                    message=f"Failed to access file: {e}", service_name="file_storage"
                )

        try:
            stat_info = await asyncio.to_thread(_stat_file_sync)
            size = stat_info.st_size
            modified_at = datetime.fromtimestamp(stat_info.st_mtime, tz=timezone.utc)
            content_type = (
                mimetypes.guess_type(full_path)[0] or "application/octet-stream"
            )

            return FileInfo(
                path=file_path,
                size=size,
                modified_at=modified_at,
                content_type=content_type,
            )
        except (NotFoundException, ServiceException):
            raise
        except Exception as e:
            raise ServiceException(
                message=f"Unexpected error getting file info: {e}",
                service_name="file_storage",
            )

    async def delete_file(self, app_name: str, file_path: str) -> bool:
        """Delete a file.

        Args:
            app_name: Name of the application
            file_path: Path of the file to delete

        Returns:
            True if deleted, False if not found
        """
        logger.info(f"Deleting file for app '{app_name}': {file_path}")

        full_path = self._get_file_full_path(app_name, file_path)

        exists = await asyncio.to_thread(os.path.exists, full_path)
        if not exists:
            logger.debug(
                f"File '{file_path}' not found for app '{app_name}', nothing to delete."
            )
            return False

        try:
            await asyncio.to_thread(os.remove, full_path)

            # Clean up empty directories
            current_dir = os.path.dirname(full_path)
            app_base_path = self._get_app_path(
                app_name
            )  # Cache this to avoid repeated calls in loop condition

            # Loop condition needs to handle async os.listdir
            while current_dir != app_base_path:
                is_empty = not await asyncio.to_thread(os.listdir, current_dir)
                if is_empty:
                    await asyncio.to_thread(os.rmdir, current_dir)
                    current_dir = os.path.dirname(current_dir)
                else:
                    break  # Directory is not empty, stop cleanup

        except OSError as e:
            # This will catch errors from os.remove, os.listdir, os.rmdir if they occur in the thread
            raise ServiceException(
                message=f"Failed to delete file or cleanup directories: {e}",
                service_name="file_storage",
            )

        logger.info(f"Successfully deleted file for app '{app_name}': {file_path}")
        return True
