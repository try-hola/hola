"""Tests for app service file operations."""

import pytest
import io
import os
from datetime import datetime, timezone
from typing import Optional  # Added
from unittest.mock import patch, MagicMock, AsyncMock
from fastapi import UploadFile
from pathlib import Path

from hola.services.app_service import AppService
from hola.config.context import ServerContext
from hola.models.app import App, AppStatus, AppHealth
from hola.models.file import FileInfo, FileListResponse
from hola.models.errors import ValidationException, NotFoundException


class FakeUploadFile(UploadFile):
    """Fake implementation of UploadFile for testing."""

    def __init__(self, filename: Optional[str], content_type: str, content: bytes):
        self.filename = filename
        self._content_type = content_type
        self.file = io.BytesIO(content)
        self._size = len(content)

    @property
    def content_type(self) -> str:
        return self._content_type

    async def read(self) -> bytes:
        return self.file.read()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self.file.close()


@pytest.mark.asyncio
class TestAppServiceFiles:
    """Test cases for AppService file operations."""

    @pytest.fixture
    def app_service(self, monkeypatch):
        """Create an app service instance for testing with fake file storage."""
        context = ServerContext()

        # Use monkeypatch to replace the get_file_storage method
        from hola.test_utils.fakes.fake_file_storage import FakeFileStorage

        fake_file_storage_instance = FakeFileStorage()

        def mock_get_file_storage():
            return fake_file_storage_instance

        monkeypatch.setattr(context, "get_file_storage", mock_get_file_storage)

        service = AppService(context)

        # Add a test app to the service
        app = App(
            name="test-app",
            status=AppStatus.RUNNING,
            health=AppHealth.HEALTHY,
            image="test:latest",
            port=8080,
            version="1.0.0",
            description="Test application",
            url="http://localhost:8080",
            backup_count=0,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
            files_count=0,
            files_total_size_bytes=0,
        )
        service._apps["test-app"] = app

        return service

    async def test_list_app_files(self, app_service):
        """Test listing app files."""
        # Pre-populate files using the fake file storage
        await app_service.file_storage.upload_file(
            "test-app", "file1.txt", b"content1", "text/plain"
        )
        await app_service.file_storage.upload_file(
            "test-app", "file2.txt", b"content2", "text/plain"
        )

        file_list = await app_service.list_app_files("test-app")

        # Verify the response structure
        assert isinstance(file_list, FileListResponse)
        assert len(file_list.files) == 2
        assert file_list.count == 2

        # Check that app stats were updated
        app = app_service._apps["test-app"]
        assert app.files_count == 2
        assert app.files_total_size_bytes == len(b"content1") + len(b"content2")

    async def test_list_app_files_app_not_found(self, app_service):
        """Test listing files for a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await app_service.list_app_files("non-existent")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent"

    async def test_upload_app_file(self, app_service):
        """Test uploading an app file."""
        # Create test file
        test_file = FakeUploadFile(
            filename="test.txt",
            content_type="text/plain",
            content=b"This is a test file",
        )

        file_info = await app_service.upload_app_file("test-app", test_file)

        # Verify file was stored
        assert app_service.file_storage.has_file("test-app", "test.txt")

        # Verify app stats were updated
        app = app_service._apps["test-app"]
        assert app.files_count == 1
        assert app.files_total_size_bytes == len(b"This is a test file")

        # Verify response
        assert isinstance(file_info, FileInfo)
        assert file_info.path == "test.txt"
        assert file_info.content_type == "text/plain"
        assert file_info.size == len(b"This is a test file")

    async def test_upload_app_file_with_path(self, app_service):
        """Test uploading an app file with a specific path."""
        # Create test file
        test_file = FakeUploadFile(
            filename="test.txt",
            content_type="text/plain",
            content=b"This is a test file",
        )

        file_info = await app_service.upload_app_file(
            "test-app", test_file, path="subfolder/renamed.txt"
        )

        # Verify file was stored with the custom path
        assert app_service.file_storage.has_file("test-app", "subfolder/renamed.txt")

        # Verify response
        assert file_info.path == "subfolder/renamed.txt"

    async def test_upload_app_file_no_filename_no_path(self, app_service):
        """Test uploading a file with no filename and no path."""
        # Create test file with no filename
        test_file = FakeUploadFile(
            filename=None, content_type="text/plain", content=b"This is a test file"
        )

        with pytest.raises(ValidationException) as excinfo:
            await app_service.upload_app_file("test-app", test_file)

        assert "file path must be provided" in str(excinfo.value).lower()

    async def test_get_app_file(self, app_service):
        """Test getting an app file."""
        # Upload a file first
        await app_service.file_storage.upload_file(
            "test-app", "test.txt", b"test file content", "text/plain"
        )

        # Get the file
        file_io = await app_service.get_app_file("test-app", "test.txt")

        assert file_io is not None
        content = file_io.read()
        assert content == b"test file content"

        # Verify method was tracked on the fake file storage
        assert app_service.file_storage.get_method_call_count("get_file") == 1

    async def test_get_app_file_not_found(self, app_service):
        """Test getting a non-existent file."""
        with pytest.raises(NotFoundException) as excinfo:
            await app_service.get_app_file("test-app", "non-existent.txt")

        assert excinfo.value.details["resource_type"] == "file"
        assert excinfo.value.details["resource_id"] == "non-existent.txt"

    async def test_get_app_file_app_not_found(self, app_service):
        """Test getting a file from a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await app_service.get_app_file("non-existent", "test.txt")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent"

    async def test_delete_app_file(self, app_service):
        """Test deleting an app file."""
        # Upload a file first
        await app_service.file_storage.upload_file(
            "test-app", "test.txt", b"test file content", "text/plain"
        )

        # Verify file exists
        assert app_service.file_storage.has_file("test-app", "test.txt")

        # Delete the file
        await app_service.delete_app_file("test-app", "test.txt")

        # Verify file was deleted
        assert not app_service.file_storage.has_file("test-app", "test.txt")

        # Verify app stats were updated
        app = app_service._apps["test-app"]
        assert app.files_count == 0
        assert app.files_total_size_bytes == 0

        # Verify method was tracked on the fake file storage
        assert app_service.file_storage.get_method_call_count("delete_file") == 1

    async def test_delete_app_file_not_found(self, app_service):
        """Test deleting a non-existent file."""
        with pytest.raises(NotFoundException) as excinfo:
            await app_service.delete_app_file("test-app", "non-existent.txt")

        assert excinfo.value.details["resource_type"] == "file"
        assert excinfo.value.details["resource_id"] == "non-existent.txt"

    async def test_delete_app_file_app_not_found(self, app_service):
        """Test deleting a file from a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await app_service.delete_app_file("non-existent", "test.txt")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent"

    async def test_delete_app_file_forced_failure(self, app_service):
        """Test forced failure when deleting a file."""
        # Upload a file first
        await app_service.file_storage.upload_file(
            "test-app", "test.txt", b"test file content", "text/plain"
        )

        # Set failure mode
        app_service.file_storage.set_failure_mode("file_delete", True)

        with pytest.raises(ValidationException) as excinfo:
            await app_service.delete_app_file("test-app", "test.txt")

        assert "Forced file deletion failure" in str(excinfo.value)
