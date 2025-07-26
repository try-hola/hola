"""Tests for the fake file storage implementation."""

import pytest
from datetime import datetime
import io
from hola.models.file import FileInfo
from hola.models.errors import NotFoundException
from hola.test_utils.fakes.fake_file_storage import FakeFileStorage


@pytest.fixture
def fake_file_storage():
    """Return a fake file storage instance."""
    return FakeFileStorage()


@pytest.fixture
def populated_file_storage():
    """Return a fake file storage instance populated with test files."""
    storage = FakeFileStorage()

    # Add test files for app1
    storage.files["app1"] = {
        "file1.txt": {
            "content": b"File 1 content",
            "modified_at": datetime.now(),
            "content_type": "text/plain",
        },
        "file2.txt": {
            "content": b"File 2 content is longer",
            "modified_at": datetime.now(),
            "content_type": "text/plain",
        },
    }

    # Add test files for app2
    storage.files["app2"] = {
        "image.png": {
            "content": b"Fake image content",
            "modified_at": datetime.now(),
            "content_type": "image/png",
        }
    }

    return storage


class TestFakeFileStorage:
    """Tests for the FakeFileStorage class."""

    @pytest.mark.asyncio
    async def test_list_files_empty(self, fake_file_storage):
        """Test listing files when app has no files."""
        file_list = await fake_file_storage.list_files("new-app")

        assert file_list.count == 0
        assert file_list.files == []
        assert file_list.total_size_bytes == 0

        # Verify method was tracked
        assert fake_file_storage.get_method_call_count("list_files") == 1
        assert fake_file_storage.was_method_called_with(
            "list_files", app_name="new-app"
        )

    @pytest.mark.asyncio
    async def test_list_files_with_files(self, populated_file_storage):
        """Test listing files when app has files."""
        file_list = await populated_file_storage.list_files("app1")

        assert file_list.count == 2
        assert len(file_list.files) == 2
        assert file_list.total_size_bytes == len(b"File 1 content") + len(
            b"File 2 content is longer"
        )

        # Check file details
        file_paths = [file.path for file in file_list.files]
        assert "file1.txt" in file_paths
        assert "file2.txt" in file_paths

        # Get specific file
        file1 = next(file for file in file_list.files if file.path == "file1.txt")
        assert file1.size == len(b"File 1 content")
        assert file1.content_type == "text/plain"

    @pytest.mark.asyncio
    async def test_upload_file_new(self, fake_file_storage):
        """Test uploading a new file."""
        content = b"New file content"
        file_info = await fake_file_storage.upload_file(
            "test-app", "new-file.txt", content, "text/plain"
        )

        assert file_info.path == "new-file.txt"
        assert file_info.size == len(content)
        assert file_info.content_type == "text/plain"

        # Verify file was stored
        assert fake_file_storage.has_file("test-app", "new-file.txt")
        assert fake_file_storage.get_file_content("test-app", "new-file.txt") == content

        # Verify method was tracked
        assert fake_file_storage.get_method_call_count("upload_file") == 1
        assert fake_file_storage.was_method_called_with(
            "upload_file", app_name="test-app", file_path="new-file.txt"
        )

    @pytest.mark.asyncio
    async def test_upload_file_overwrite(self, populated_file_storage):
        """Test overwriting an existing file."""
        new_content = b"Updated file 1 content"
        file_info = await populated_file_storage.upload_file(
            "app1", "file1.txt", new_content, "text/plain"
        )

        assert file_info.path == "file1.txt"
        assert file_info.size == len(new_content)

        # Verify file was updated
        assert (
            populated_file_storage.get_file_content("app1", "file1.txt") == new_content
        )

    @pytest.mark.asyncio
    async def test_upload_file_auto_content_type(self, fake_file_storage):
        """Test uploading a file with auto-detected content type."""
        content = b"Image data"
        file_info = await fake_file_storage.upload_file(
            "test-app", "image.jpg", content
        )

        assert file_info.content_type == "image/jpeg"

    @pytest.mark.asyncio
    async def test_get_file_existing(self, populated_file_storage):
        """Test getting an existing file."""
        file_io = await populated_file_storage.get_file("app1", "file1.txt")

        assert file_io is not None
        assert file_io.read() == b"File 1 content"

        # Verify method was tracked
        assert populated_file_storage.get_method_call_count("get_file") == 1
        assert populated_file_storage.was_method_called_with(
            "get_file", app_name="app1", file_path="file1.txt"
        )

    @pytest.mark.asyncio
    async def test_get_file_non_existent(self, populated_file_storage):
        """Test getting a non-existent file."""
        file_io = await populated_file_storage.get_file("app1", "non-existent.txt")

        assert file_io is None

    @pytest.mark.asyncio
    async def test_get_file_info_existing(self, populated_file_storage):
        """Test getting file info for an existing file."""
        file_info = await populated_file_storage.get_file_info("app1", "file1.txt")

        assert file_info.path == "file1.txt"
        assert file_info.size == len(b"File 1 content")
        assert file_info.content_type == "text/plain"
        assert file_info.modified_at is not None

        # Verify method was tracked
        assert populated_file_storage.get_method_call_count("get_file_info") == 1
        assert populated_file_storage.was_method_called_with(
            "get_file_info", app_name="app1", file_path="file1.txt"
        )

    @pytest.mark.asyncio
    async def test_get_file_info_non_existent(self, fake_file_storage):
        """Test getting file info for a non-existent file."""
        with pytest.raises(NotFoundException) as excinfo:
            await fake_file_storage.get_file_info("test-app", "non-existent.txt")

        assert excinfo.value.details["resource_type"] == "file"
        assert excinfo.value.details["resource_id"] == "non-existent.txt"
        assert excinfo.value.details["app_name"] == "test-app"

    @pytest.mark.asyncio
    async def test_get_file_info_different_content_types(self, populated_file_storage):
        """Test getting file info for files with different content types."""
        # Test PNG file
        png_info = await populated_file_storage.get_file_info("app2", "image.png")
        assert png_info.path == "image.png"
        assert png_info.content_type == "image/png"
        assert png_info.size == len(b"Fake image content")

        # Test text file
        txt_info = await populated_file_storage.get_file_info("app1", "file2.txt")
        assert txt_info.path == "file2.txt"
        assert txt_info.content_type == "text/plain"
        assert txt_info.size == len(b"File 2 content is longer")

    @pytest.mark.asyncio
    async def test_delete_file_existing(self, populated_file_storage):
        """Test deleting an existing file."""
        # Verify file exists first
        assert populated_file_storage.has_file("app1", "file1.txt")

        success = await populated_file_storage.delete_file("app1", "file1.txt")

        assert success is True
        assert populated_file_storage.has_file("app1", "file1.txt") is False

        # Verify method was tracked
        assert populated_file_storage.get_method_call_count("delete_file") == 1
        assert populated_file_storage.was_method_called_with(
            "delete_file", app_name="app1", file_path="file1.txt"
        )

    @pytest.mark.asyncio
    async def test_delete_file_non_existent(self, populated_file_storage):
        """Test deleting a non-existent file."""
        success = await populated_file_storage.delete_file("app1", "non-existent.txt")

        assert success is False

    def test_reset(self, populated_file_storage):
        """Test resetting the file storage."""
        # Verify files exist
        assert populated_file_storage.has_file("app1", "file1.txt")
        assert populated_file_storage.has_file("app2", "image.png")

        # Add a method call for tracking
        populated_file_storage.method_calls.append(
            {"method": "test_method", "timestamp": datetime.now()}
        )

        # Reset
        populated_file_storage.reset()

        # Verify everything was cleared
        assert not populated_file_storage.files
        assert not populated_file_storage.method_calls
        assert populated_file_storage.get_method_call_count("test_method") == 0
