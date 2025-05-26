"""Tests for application API endpoints."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch
from datetime import datetime, timezone

from hola_server.test_utils.fakes.fake_app_service import FakeAppService
from hola_shared.models.app import AppDeployRequest, AppUpgradeRequest, AppStatus


def test_deploy_app_success(client: TestClient):
    """Test successful app deployment."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        request_data = {
            "name": "test-app",
            "image": "nginx:latest",
            "port": 8080,
            "environment": {"ENV": "test"},
            "description": "Test application"
        }
        
        response = client.post(
            "/api/apps/deploy",
            json=request_data,
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["name"] == "test-app"
        assert data["data"]["deployment_id"].startswith("test-deploy-")
        assert fake_service.has_app("test-app")


def test_deploy_app_duplicate_name(client: TestClient):
    """Test deploying app with duplicate name."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # First deployment
        request_data = {
            "name": "test-app",
            "image": "nginx:latest"
        }
        
        response1 = client.post(
            "/api/apps/deploy",
            json=request_data,
            headers={"X-API-Key": "test-key"}
        )
        assert response1.status_code == 200
        
        # Second deployment with same name
        response2 = client.post(
            "/api/apps/deploy",
            json=request_data,
            headers={"X-API-Key": "test-key"}
        )
        assert response2.status_code == 422
        assert "already exists" in response2.json()["detail"]


def test_list_apps_empty(client: TestClient):
    """Test listing apps when none exist."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        response = client.get(
            "/api/apps/",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["apps"] == []
        assert data["data"]["total_count"] == 0


def test_list_apps_with_apps(client: TestClient):
    """Test listing apps when some exist."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy some apps first
        apps_to_deploy = [
            {"name": "app1", "image": "nginx:latest"},
            {"name": "app2", "image": "redis:latest"}
        ]
        
        for app_data in apps_to_deploy:
            client.post(
                "/api/apps/deploy",
                json=app_data,
                headers={"X-API-Key": "test-key"}
            )
        
        response = client.get(
            "/api/apps/",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["apps"]) == 2
        assert data["data"]["total_count"] == 2
        
        app_names = [app["name"] for app in data["data"]["apps"]]
        assert "app1" in app_names
        assert "app2" in app_names


def test_get_app_success(client: TestClient):
    """Test getting app details."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy an app first
        deploy_response = client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"}
        )
        assert deploy_response.status_code == 200
        
        # Get app details
        response = client.get(
            "/api/apps/test-app",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["name"] == "test-app"
        assert data["data"]["status"] == AppStatus.RUNNING
        assert data["data"]["image"] == "nginx:latest"


def test_get_app_not_found(client: TestClient):
    """Test getting non-existent app."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        response = client.get(
            "/api/apps/nonexistent",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 404
        assert "not found" in response.json()["detail"]


def test_upgrade_app_success(client: TestClient):
    """Test successful app upgrade."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy an app first
        client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:1.0"},
            headers={"X-API-Key": "test-key"}
        )
        
        # Upgrade the app
        upgrade_data = {
            "image": "nginx:2.0",
            "version": "2.0",
            "backup_before_upgrade": True
        }
        
        response = client.post(
            "/api/apps/test-app/upgrade",
            json=upgrade_data,
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["image"] == "nginx:2.0"
        assert data["data"]["app"]["version"] == "2.0"
        assert data["data"]["deployment_id"].startswith("test-upgrade-")


def test_delete_app_success(client: TestClient):
    """Test successful app deletion."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy an app first
        client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"}
        )
        
        # Delete the app
        response = client.delete(
            "/api/apps/test-app",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert "deleted successfully" in data["data"]["message"]
        assert not fake_service.has_app("test-app")


def test_start_app_success(client: TestClient):
    """Test starting a stopped app."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy and stop an app first
        client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"}
        )
        
        client.post(
            "/api/apps/test-app/stop",
            headers={"X-API-Key": "test-key"}
        )
        
        # Start the app
        response = client.post(
            "/api/apps/test-app/start",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.RUNNING


def test_stop_app_success(client: TestClient):
    """Test stopping a running app."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy an app first
        client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"}
        )
        
        # Stop the app
        response = client.post(
            "/api/apps/test-app/stop",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.STOPPED


def test_restart_app_success(client: TestClient):
    """Test restarting an app."""
    with patch('hola_server.api.apps.AppService') as MockAppService:
        fake_service = FakeAppService()
        MockAppService.return_value = fake_service
        
        # Deploy an app first
        client.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"}
        )
        
        # Restart the app
        response = client.post(
            "/api/apps/test-app/restart",
            headers={"X-API-Key": "test-key"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.RUNNING


# def test_unauthorized_request(client: TestClient):
#     """Test request without API key."""
#     response = client.get("/api/apps/")
#     assert response.status_code == 401


# def test_invalid_api_key(client: TestClient):
#     """Test request with invalid API key."""
#     response = client.get(
#         "/api/apps/",
#         headers={"X-API-Key": "invalid-key"}
#     )
#     assert response.status_code == 401
