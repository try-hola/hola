"""Tests for the file operations in FakeAppService."""

import pytest
from datetime import datetime
from unittest.mock import AsyncMock
import io
from fastapi import UploadFile

from hola.shared.errors import ValidationException, NotFoundException
from hola.shared.models.app import App, AppStatus, AppHealth
from hola.shared.models.file import FileInfo, FileListResponse
from hola.test_utils.fakes.fake_app_service import FakeAppService


@pytest.fixture
def fake_app_service():
    """Return a fake app service instance."""
    return FakeAppService()


@pytest.fixture
def fake_app_service_with_app(fake_app_service):
    """Return a fake app service instance with a test app."""
    app = App(
        name="test-app",
        status=AppStatus.RUNNING,
        health=AppHealth.HEALTHY,
        image="test-image:latest",
        port=8080,
        version="1.0.0",  # Added
        description="Test application",  # Added
        url="http://localhost:8080",  # Added
        backup_count=0,  # Added
        created_at=datetime.now(),
        updated_at=datetime.now(),
        files_count=0,
        files_total_size_bytes=0,
    )
    fake_app_service.apps["test-app"] = app
    return fake_app_service


@pytest.fixture
def mock_upload_file():
    """Create a mock UploadFile object."""

    class FakeUploadFile:
        def __init__(self, filename: str, content_type: str, content: bytes):
            self.filename = filename
            self.content_type = content_type
            self.file = io.BytesIO(content)

        async def read(self) -> bytes:
            return self.file.read()

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            self.file.close()

    return FakeUploadFile("test.txt", "text/plain", b"Test content")


class TestFakeAppServiceFiles:
    """Tests for the file operations in FakeAppService."""

    @pytest.mark.asyncio
    async def test_list_app_files_empty(self, fake_app_service_with_app):
        """Test listing files when app has no files."""
        file_list = await fake_app_service_with_app.list_app_files("test-app")

        assert file_list.count == 0
        assert file_list.files == []
        assert file_list.total_size_bytes == 0

        # Verify app stats were updated
        app = fake_app_service_with_app.apps["test-app"]
        assert app.files_count == 0
        assert app.files_total_size_bytes == 0

        # Verify method was tracked
        assert fake_app_service_with_app.get_method_call_count("list_app_files") == 1

    @pytest.mark.asyncio
    async def test_list_app_files_app_not_found(self, fake_app_service):
        """Test listing files for a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service.list_app_files("non-existent-app")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent-app"

    @pytest.mark.asyncio
    async def test_upload_app_file(self, fake_app_service_with_app, mock_upload_file):
        """Test uploading a file."""
        file_info = await fake_app_service_with_app.upload_app_file(
            "test-app", mock_upload_file
        )

        assert file_info.path == "test.txt"
        assert file_info.content_type == "text/plain"
        assert file_info.size > 0

        # Verify file was stored
        assert fake_app_service_with_app.file_storage.has_file("test-app", "test.txt")

        # Verify app stats were updated
        app = fake_app_service_with_app.apps["test-app"]
        assert app.files_count == 1
        assert app.files_total_size_bytes > 0

        # Verify method was tracked
        assert fake_app_service_with_app.get_method_call_count("upload_app_file") == 1

    @pytest.mark.asyncio
    async def test_upload_app_file_with_path(
        self, fake_app_service_with_app, mock_upload_file
    ):
        """Test uploading a file with a specific path."""
        file_info = await fake_app_service_with_app.upload_app_file(
            "test-app", mock_upload_file, path="folder/custom.txt"
        )

        assert file_info.path == "folder/custom.txt"

        # Verify file was stored with the custom path
        assert fake_app_service_with_app.file_storage.has_file(
            "test-app", "folder/custom.txt"
        )

    @pytest.mark.asyncio
    async def test_upload_app_file_app_not_found(
        self, fake_app_service, mock_upload_file
    ):
        """Test uploading a file to a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service.upload_app_file("non-existent-app", mock_upload_file)

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent-app"

    @pytest.mark.asyncio
    async def test_upload_app_file_forced_failure(
        self, fake_app_service_with_app, mock_upload_file
    ):
        """Test forced failure when uploading a file."""
        fake_app_service_with_app.set_failure_mode("file_upload", True)

        with pytest.raises(ValidationException) as excinfo:
            await fake_app_service_with_app.upload_app_file(
                "test-app", mock_upload_file
            )

        assert "Forced file upload failure" in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_upload_app_file_missing_filename(self, fake_app_service_with_app):
        """Test uploading a file with no filename and no path."""
        file = AsyncMock(spec=UploadFile)
        file.filename = None  # No filename

        with pytest.raises(ValidationException) as excinfo:
            await fake_app_service_with_app.upload_app_file("test-app", file)

        assert "path must be provided" in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_get_app_file(self, fake_app_service_with_app):
        """Test getting a file."""
        # Upload a file first
        mock_file = AsyncMock(spec=UploadFile)
        mock_file.filename = "test.txt"
        mock_file.content_type = "text/plain"
        await fake_app_service_with_app.upload_app_file("test-app", mock_file)

        # Get the file
        file_io = await fake_app_service_with_app.get_app_file("test-app", "test.txt")

        assert file_io is not None
        content = file_io.read()
        assert len(content) > 0

        # Verify method was tracked
        assert fake_app_service_with_app.get_method_call_count("get_app_file") == 1

    @pytest.mark.asyncio
    async def test_get_app_file_not_found(self, fake_app_service_with_app):
        """Test getting a non-existent file."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service_with_app.get_app_file("test-app", "non-existent.txt")

        assert excinfo.value.details["resource_type"] == "file"
        assert excinfo.value.details["resource_id"] == "non-existent.txt"

    @pytest.mark.asyncio
    async def test_get_app_file_app_not_found(self, fake_app_service):
        """Test getting a file from a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service.get_app_file("non-existent-app", "test.txt")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent-app"

    @pytest.mark.asyncio
    async def test_delete_app_file(self, fake_app_service_with_app):
        """Test deleting a file."""
        # Upload a file first
        mock_file = AsyncMock(spec=UploadFile)
        mock_file.filename = "test.txt"
        mock_file.content_type = "text/plain"
        await fake_app_service_with_app.upload_app_file("test-app", mock_file)

        # Verify file exists
        assert fake_app_service_with_app.file_storage.has_file("test-app", "test.txt")

        # Delete the file
        await fake_app_service_with_app.delete_app_file("test-app", "test.txt")

        # Verify file was deleted
        assert not fake_app_service_with_app.file_storage.has_file(
            "test-app", "test.txt"
        )

        # Verify app stats were updated
        app = fake_app_service_with_app.apps["test-app"]
        assert app.files_count == 0
        assert app.files_total_size_bytes == 0

        # Verify method was tracked
        assert fake_app_service_with_app.get_method_call_count("delete_app_file") == 1

    @pytest.mark.asyncio
    async def test_delete_app_file_not_found(self, fake_app_service_with_app):
        """Test deleting a non-existent file."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service_with_app.delete_app_file(
                "test-app", "non-existent.txt"
            )

        assert excinfo.value.details["resource_type"] == "file"
        assert excinfo.value.details["resource_id"] == "non-existent.txt"

    @pytest.mark.asyncio
    async def test_delete_app_file_app_not_found(self, fake_app_service):
        """Test deleting a file from a non-existent app."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_app_service.delete_app_file("non-existent-app", "test.txt")

        assert excinfo.value.details["resource_type"] == "application"
        assert excinfo.value.details["resource_id"] == "non-existent-app"

    @pytest.mark.asyncio
    async def test_delete_app_file_forced_failure(self, fake_app_service_with_app):
        """Test forced failure when deleting a file."""
        # Upload a file first
        mock_file = AsyncMock(spec=UploadFile)
        mock_file.filename = "test.txt"
        mock_file.content_type = "text/plain"
        await fake_app_service_with_app.upload_app_file("test-app", mock_file)

        # Set failure mode
        fake_app_service_with_app.set_failure_mode("file_delete", True)

        with pytest.raises(ValidationException) as excinfo:
            await fake_app_service_with_app.delete_app_file("test-app", "test.txt")

        assert "Forced file deletion failure" in str(excinfo.value)
