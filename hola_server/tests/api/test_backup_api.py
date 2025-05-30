"""Tests for backup API endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone
import uuid

from hola_server.main import app
from hola_shared.models.backup import (
    BackupInfo, BackupStatus, BackupCreateRequest, BackupCreateResponse,
    BackupListResponse, RestoreRequest, RestoreResponse, RestoreInfo, RestoreStatus
)
from hola_server.test_utils.fakes.fake_backup_service import FakeBackupService
from hola_server.api.backup import get_backup_service
from hola_server.auth import get_api_key


@pytest.fixture
def fake_backup_service():
    """Fixture providing a fake backup service."""
    return FakeBackupService()


@pytest.fixture
def client(fake_backup_service):
    """Test client fixture with fake backup service injected."""
    app.dependency_overrides[get_backup_service] = lambda: fake_backup_service
    # Override the API key dependency to accept any key
    app.dependency_overrides[get_api_key] = lambda: "test-api-key"
    
    test_client = TestClient(app)
    yield test_client
    
    # Clean up overrides after test
    app.dependency_overrides.pop(get_backup_service, None)
    app.dependency_overrides.pop(get_api_key, None)


def test_create_backup(client, fake_backup_service):
    """Test POST /api/apps/{app_name}/backups endpoint."""
    # Arrange
    app_name = "test-app"
    request = {
        "description": "Test backup",
        "include_config": True,
        "include_files": True,
        "include_data": False
    }
    
    # Act
    response = client.post(
        f"/api/apps/{app_name}/backups",
        json=request,
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["backup"]["app_name"] == app_name
    assert response.json()["data"]["backup"]["description"] == "Test backup"
    assert response.json()["data"]["backup"]["includes_config"] == True
    assert response.json()["data"]["backup"]["includes_files"] == True
    assert response.json()["data"]["backup"]["includes_data"] == False
    
    # Verify service was called
    assert len(fake_backup_service.method_calls) == 1
    assert fake_backup_service.method_calls[0]["method"] == "create_backup"
    assert fake_backup_service.method_calls[0]["app_name"] == app_name


def test_list_backups(client, fake_backup_service):
    """Test GET /api/apps/{app_name}/backups endpoint."""
    # Arrange
    app_name = "test-app"
    backup_id1 = str(uuid.uuid4())
    backup_id2 = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    backup1 = BackupInfo(
        id=backup_id1,
        app_name=app_name,
        description="First backup",
        status=BackupStatus.COMPLETED,
        size_bytes=1024 * 1024 * 100,  # 100MB
        created_at=now,
        completed_at=now,
        includes_config=True,
        includes_files=True,
        includes_data=True,
        server_version="1.0.0"
    )
    
    backup2 = BackupInfo(
        id=backup_id2,
        app_name=app_name,
        description="Second backup",
        status=BackupStatus.COMPLETED,
        size_bytes=1024 * 1024 * 150,  # 150MB
        created_at=now,
        completed_at=now,
        includes_config=True,
        includes_files=True,
        includes_data=True,
        server_version="1.0.0"
    )
    
    fake_backup_service.register_backup(backup1)
    fake_backup_service.register_backup(backup2)
    
    # Act
    response = client.get(
        f"/api/apps/{app_name}/backups",
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["total_count"] == 2
    assert len(response.json()["data"]["backups"]) == 2
    assert response.json()["data"]["backups"][0]["id"] == backup_id1
    assert response.json()["data"]["backups"][1]["id"] == backup_id2
    
    # Verify service was called
    assert len(fake_backup_service.method_calls) == 1
    assert fake_backup_service.method_calls[0]["method"] == "list_backups"
    assert fake_backup_service.method_calls[0]["app_name"] == app_name


def test_get_backup(client, fake_backup_service):
    """Test GET /api/apps/{app_name}/backups/{backup_id} endpoint."""
    # Arrange
    app_name = "test-app"
    backup_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    backup = BackupInfo(
        id=backup_id,
        app_name=app_name,
        description="Test backup",
        status=BackupStatus.COMPLETED,
        size_bytes=1024 * 1024 * 100,  # 100MB
        created_at=now,
        completed_at=now,
        includes_config=True,
        includes_files=True,
        includes_data=True,
        server_version="1.0.0"
    )
    
    fake_backup_service.register_backup(backup)
    
    # Act
    response = client.get(
        f"/api/apps/{app_name}/backups/{backup_id}",
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["id"] == backup_id
    assert response.json()["data"]["app_name"] == app_name
    assert response.json()["data"]["description"] == "Test backup"
    
    # Verify service was called
    assert len(fake_backup_service.method_calls) == 1
    assert fake_backup_service.method_calls[0]["method"] == "get_backup_info"
    assert fake_backup_service.method_calls[0]["backup_id"] == backup_id


def test_delete_backup(client, fake_backup_service):
    """Test DELETE /api/apps/{app_name}/backups/{backup_id} endpoint."""
    # Arrange
    app_name = "test-app"
    backup_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    backup = BackupInfo(
        id=backup_id,
        app_name=app_name,
        description="Test backup",
        status=BackupStatus.COMPLETED,
        size_bytes=1024 * 1024 * 100,  # 100MB
        created_at=now,
        completed_at=now,
        includes_config=True,
        includes_files=True,
        includes_data=True,
        server_version="1.0.0"
    )
    
    fake_backup_service.register_backup(backup)
    
    # Act
    response = client.delete(
        f"/api/apps/{app_name}/backups/{backup_id}",
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    
    # Verify delete_backup was called
    method_names = [call["method"] for call in fake_backup_service.method_calls]
    assert "delete_backup" in method_names
    assert fake_backup_service.method_calls[0]["backup_id"] == backup_id


def test_restore_backup(client, fake_backup_service):
    """Test POST /api/apps/{app_name}/backups/{backup_id}/restore endpoint."""
    # Arrange
    app_name = "test-app"
    target_app = "new-app"
    backup_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    
    backup = BackupInfo(
        id=backup_id,
        app_name=app_name,
        description="Test backup",
        status=BackupStatus.COMPLETED,
        size_bytes=1024 * 1024 * 100,  # 100MB
        created_at=now,
        completed_at=now,
        includes_config=True,
        includes_files=True,
        includes_data=True,
        server_version="1.0.0"
    )
    
    fake_backup_service.register_backup(backup)
    
    request = {
        "backup_id": backup_id,  # This is required in the RestoreRequest model
        "target_app_name": target_app,
        "restore_config": True,
        "restore_files": True,
        "restore_data": True
    }
    
    # Act
    response = client.post(
        f"/api/apps/{app_name}/backups/{backup_id}/restore",
        json=request,
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["restore"]["backup_id"] == backup_id
    assert response.json()["data"]["restore"]["app_name"] == app_name
    assert response.json()["data"]["restore"]["target_app_name"] == target_app
    assert response.json()["data"]["restore"]["status"] == "completed"
    
    # Verify restore backup was called
    method_names = [call["method"] for call in fake_backup_service.method_calls]
    assert "restore_backup" in method_names
    assert fake_backup_service.method_calls[0]["backup_id"] == backup_id


def test_backup_not_found(client, fake_backup_service):
    """Test error handling for non-existent backup."""
    # Arrange
    app_name = "test-app"
    backup_id = str(uuid.uuid4())
    fake_backup_service.set_failure_mode("get_backup_info")
    
    # Act
    response = client.get(
        f"/api/apps/{app_name}/backups/{backup_id}",
        headers={"X-API-Key": "test-key"}
    )
    
    # Assert
    assert response.status_code == 500
    assert "Simulated failure" in response.json().get("detail", "")
