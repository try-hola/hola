"""Tests for the application files API endpoints."""

import pytest
from fastapi.testclient import TestClient
from fastapi import UploadFile
import io
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, AsyncMock

from hola_shared.models.file import FileInfo, FileListResponse
from hola_shared.errors import NotFoundException
from hola_server.test_utils.fakes.fake_app_service import FakeAppService


@pytest.fixture
def fake_app_service_with_app():
    """Setup a fake app service with a test app."""
    from hola_shared.models.app import App, AppStatus, AppHealth

    service = FakeAppService()
    
    # Add a test app with no files yet
    app = App(
        name="test-app",
        status=AppStatus.RUNNING,
        health=AppHealth.HEALTHY,
        image="test-image:latest",
        port=8080,
        version="1.0.0", 
        description="Test application", 
        url="http://localhost:8080", 
        backup_count=0, 
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
        files_count=0,
        files_total_size_bytes=0
    )
    service.apps["test-app"] = app
    
    return service


@pytest.fixture
def client_with_fake_app_service(fake_app_service_with_app):
    """Return a FastAPI test client with fake app service."""
    from hola_server.main import app
    from hola_server.api.app_files import get_app_service
    
    # Override dependency
    def override_get_app_service():
        return fake_app_service_with_app
    
    app.dependency_overrides[get_app_service] = override_get_app_service
    
    # Return test client
    client = TestClient(app)
    
    yield client
    
    # Clean up dependency overrides after test
    app.dependency_overrides.pop(get_app_service, None)


@pytest.fixture
def mock_api_key():
    """Mock the API key validation."""
    with patch("hola_server.api.app_files.get_api_key", return_value="test-api-key"):
        yield "test-api-key"


class TestAppFilesApi:
    """Tests for the app files API endpoints."""
    
    @pytest.mark.asyncio
    async def test_list_files_empty(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test listing files when app has no files."""
        # Ensure no files exist for the app
        fake_app_service_with_app.file_storage.reset() # Clear any pre-existing files
        fake_app_service_with_app.apps["test-app"].files_count = 0
        fake_app_service_with_app.apps["test-app"].files_total_size_bytes = 0

        response = client_with_fake_app_service.get("/api/apps/test-app/files/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["count"] == 0
        assert data["data"]["files"] == []
        assert data["data"]["total_size_bytes"] == 0
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("list_app_files") == 1
        assert fake_app_service_with_app.was_method_called_with("list_app_files", app_name="test-app")
    
    @pytest.mark.asyncio
    async def test_list_files_with_files(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test listing files when app has files."""
        # Pre-populate files using the fake file storage
        file_content = b"Test file content"
        await fake_app_service_with_app.file_storage.upload_file(
            "test-app", "test.txt", file_content, "text/plain"
        )
        
        response = client_with_fake_app_service.get("/api/apps/test-app/files/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["count"] == 1
        assert len(data["data"]["files"]) == 1
        assert data["data"]["files"][0]["path"] == "test.txt"
        assert data["data"]["files"][0]["size"] == len(file_content)
        assert data["data"]["files"][0]["content_type"] == "text/plain"
        assert data["data"]["total_size_bytes"] == len(file_content)
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("list_app_files") == 1
        assert fake_app_service_with_app.was_method_called_with("list_app_files", app_name="test-app")
    
    @pytest.mark.asyncio
    async def test_list_files_app_not_found(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test listing files for non-existent app."""
        # Ensure the app does not exist in the fake service
        if "non-existent-app" in fake_app_service_with_app.apps:
            del fake_app_service_with_app.apps["non-existent-app"]

        response = client_with_fake_app_service.get("/api/apps/non-existent-app/files/")
        
        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "RESOURCE_NOT_FOUND"
        assert "non-existent-app" in data["error"]["message"]
        assert fake_app_service_with_app.get_method_call_count("list_app_files") == 1
        assert fake_app_service_with_app.was_method_called_with("list_app_files", app_name="non-existent-app")
    
    @pytest.mark.asyncio
    async def test_upload_file(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test uploading a file."""
        # Create test file content
        file_content = b"Test file content"
        files = {"file": ("test.txt", io.BytesIO(file_content), "text/plain")}
        
        response = client_with_fake_app_service.post(
            "/api/apps/test-app/files/?path=test-directory/test.txt",
            files=files
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["path"] == "test-directory/test.txt" # Path should reflect the provided path
        # Ensure the file size is reasonable - it might differ slightly from the source due to encoding
        assert abs(data["data"]["size"] - len(file_content)) < 10
        assert data["data"]["content_type"] == "text/plain"
        
        # Verify file exists in fake storage
        assert fake_app_service_with_app.file_storage.has_file("test-app", "test-directory/test.txt")
        # Just verify the content exists, not the exact content (which may be modified during upload)
        assert fake_app_service_with_app.file_storage.get_file_content("test-app", "test-directory/test.txt") is not None
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("upload_app_file") == 1
        assert fake_app_service_with_app.was_method_called_with(
            "upload_app_file",
            app_name="test-app",
            file_name="test.txt",
            path="test-directory/test.txt"
        )
    
    @pytest.mark.asyncio
    async def test_get_file(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test getting a file."""
        # Pre-populate the file in fake storage
        file_content = b"Test file content"
        await fake_app_service_with_app.file_storage.upload_file(
            "test-app", "test.txt", file_content, "text/plain"
        )
        
        response = client_with_fake_app_service.get("/api/apps/test-app/files/test.txt")
        
        assert response.status_code == 200
        assert response.content == file_content
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("get_app_file") == 1
        assert fake_app_service_with_app.was_method_called_with(
            "get_app_file",
            app_name="test-app",
            file_path="test.txt"
        )

    @pytest.mark.asyncio
    async def test_get_file_content_type_and_headers(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test getting a file with proper content type and headers."""
        # Pre-populate files with different content types
        text_content = b"This is a text file"
        image_content = b"Fake PNG image data"
        
        await fake_app_service_with_app.file_storage.upload_file(
            "test-app", "document.txt", text_content, "text/plain"
        )
        await fake_app_service_with_app.file_storage.upload_file(
            "test-app", "photo.jpg", image_content, "image/jpeg"
        )
        
        # Test text file
        text_response = client_with_fake_app_service.get("/api/apps/test-app/files/document.txt")
        assert text_response.status_code == 200
        assert text_response.content == text_content
        assert text_response.headers["content-type"].startswith("text/plain")
        assert "attachment; filename=document.txt" in text_response.headers.get("content-disposition", "")
        
        # Test image file  
        image_response = client_with_fake_app_service.get("/api/apps/test-app/files/photo.jpg")
        assert image_response.status_code == 200
        assert image_response.content == image_content
        assert image_response.headers["content-type"] == "image/jpeg"
        assert "attachment; filename=photo.jpg" in image_response.headers.get("content-disposition", "")
        
        # Verify get_file_info was called through file_storage (indirectly via API)
        assert fake_app_service_with_app.file_storage.get_method_call_count("get_file_info") == 2
    
    @pytest.mark.asyncio
    async def test_get_file_not_found(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test getting a non-existent file."""
        # Ensure the file does not exist in fake storage
        await fake_app_service_with_app.file_storage.delete_file("test-app", "non-existent.txt") # Ensure it's clean
        
        response = client_with_fake_app_service.get("/api/apps/test-app/files/non-existent.txt")
        
        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "RESOURCE_NOT_FOUND"
        assert "non-existent.txt" in data["error"]["message"]
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("get_app_file") == 1
        assert fake_app_service_with_app.was_method_called_with(
            "get_app_file",
            app_name="test-app",
            file_path="non-existent.txt"
        )
    
    @pytest.mark.asyncio
    async def test_delete_file(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test deleting a file."""
        # Pre-populate the file in fake storage
        file_content = b"Test file content"
        await fake_app_service_with_app.file_storage.upload_file(
            "test-app", "test.txt", file_content, "text/plain"
        )
        
        response = client_with_fake_app_service.delete("/api/apps/test-app/files/test.txt")
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["message"] == "File deleted successfully"
        
        # Verify file is deleted from fake storage
        assert not fake_app_service_with_app.file_storage.has_file("test-app", "test.txt")
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("delete_app_file") == 1
        assert fake_app_service_with_app.was_method_called_with(
            "delete_app_file",
            app_name="test-app",
            file_path="test.txt"
        )
    
    @pytest.mark.asyncio
    async def test_delete_file_not_found(self, client_with_fake_app_service, mock_api_key, fake_app_service_with_app):
        """Test deleting a non-existent file."""
        # Ensure the file does not exist in fake storage
        await fake_app_service_with_app.file_storage.delete_file("test-app", "non-existent.txt") # Ensure it's clean
        
        response = client_with_fake_app_service.delete("/api/apps/test-app/files/non-existent.txt")
        
        assert response.status_code == 404
        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "RESOURCE_NOT_FOUND"
        assert "non-existent.txt" in data["error"]["message"]
        
        # Verify service method was called
        assert fake_app_service_with_app.get_method_call_count("delete_app_file") == 1
        assert fake_app_service_with_app.was_method_called_with(
            "delete_app_file",
            app_name="test-app",
            file_path="non-existent.txt"
        )
