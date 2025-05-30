"""Tests for server API endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone

from hola_server.main import app
from hola_shared.models.server import (
    ServerStatus, ServerState, HealthStatus, HealthCheckStatus, HealthCheckResult,
    VersionInfo, ResourceUsage
)
from hola_server.test_utils.fakes.fake_server_service import FakeServerService
from hola_server.api.server import get_server_service
from hola_server.auth import get_api_key


@pytest.fixture
def fake_server_service():
    """Fixture providing a fake server service."""
    return FakeServerService()


@pytest.fixture
def client(fake_server_service):
    """Test client fixture with fake server service injected."""
    app.dependency_overrides[get_server_service] = lambda: fake_server_service
    # Override the API key dependency to accept any key
    app.dependency_overrides[get_api_key] = lambda: "test-api-key"
    
    test_client = TestClient(app)
    yield test_client
    
    # Clean up overrides after test
    app.dependency_overrides.pop(get_server_service, None)
    app.dependency_overrides.pop(get_api_key, None)


def test_get_server_status(client, fake_server_service):
    """Test GET /api/server/status endpoint."""
    # Arrange
    now = datetime.now(timezone.utc)
    fake_server_service.reset()  # Reset the service state
    
    # Act
    response = client.get("/api/server/status", headers={"X-API-Key": "test-key"})
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["state"] == "running"
    assert response.json()["data"]["resources"]["cpu_percent"] == 25.5
    
    # Verify server status service was called
    method_names = [call["method"] for call in fake_server_service.method_calls]
    assert "get_server_status" in method_names
    # Note: get_server_status internally calls get_health_check, get_version, and get_resource_usage


def test_get_health_check(client, fake_server_service):
    """Test GET /api/server/health endpoint."""
    # Arrange
    now = datetime.now(timezone.utc)
    
    # Act
    response = client.get("/api/server/health", headers={"X-API-Key": "test-key"})
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["status"] == "healthy"
    assert "system" in response.json()["data"]["checks"]
    assert "database" in response.json()["data"]["checks"]
    
    # Verify service was called
    assert len(fake_server_service.method_calls) == 1
    assert fake_server_service.method_calls[0]["method"] == "get_health_check"


def test_get_version(client, fake_server_service):
    """Test GET /api/server/version endpoint."""
    # Arrange
    custom_version = VersionInfo(
        version="2.0.0-beta",
        build_id="custom-build-123",
        build_date=datetime.now(timezone.utc),
        git_commit="1234567890abcdef",
        python_version="3.13.0"
    )
    fake_server_service.register_version_info(custom_version)
    
    # Act
    response = client.get("/api/server/version", headers={"X-API-Key": "test-key"})
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["version"] == "2.0.0-beta"
    assert response.json()["data"]["build_id"] == "custom-build-123"
    assert response.json()["data"]["git_commit"] == "1234567890abcdef"
    
    # Verify service was called
    assert len(fake_server_service.method_calls) == 1
    assert fake_server_service.method_calls[0]["method"] == "get_version"


def test_get_resources(client, fake_server_service):
    """Test GET /api/server/resources endpoint."""
    # Arrange
    custom_resources = ResourceUsage(
        cpu_percent=75.5,
        memory_used_bytes=1024 * 1024 * 1024 * 4,  # 4 GB
        memory_total_bytes=1024 * 1024 * 1024 * 16,  # 16 GB
        disk_used_bytes=1024 * 1024 * 1024 * 500,  # 500 GB
        disk_total_bytes=1024 * 1024 * 1024 * 1000,  # 1 TB
        uptime_seconds=60 * 60 * 24 * 7,  # 7 days
        measured_at=datetime.now(timezone.utc)
    )
    fake_server_service.register_resource_usage(custom_resources)
    
    # Act
    response = client.get("/api/server/resources", headers={"X-API-Key": "test-key"})
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["cpu_percent"] == 75.5
    assert response.json()["data"]["memory_used_bytes"] == 1024 * 1024 * 1024 * 4
    
    # Verify service was called
    assert len(fake_server_service.method_calls) == 1
    assert fake_server_service.method_calls[0]["method"] == "get_resource_usage"


def test_server_status_error(client, fake_server_service):
    """Test error handling in GET /api/server/status endpoint."""
    # Arrange
    fake_server_service.set_failure_mode("get_server_status")
    
    # Act
    response = client.get("/api/server/status", headers={"X-API-Key": "test-key"})
    
    # Assert
    assert response.status_code == 500
    assert "Simulated failure" in response.json().get("detail", "")
