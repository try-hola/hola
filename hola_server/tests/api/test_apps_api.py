"""Tests for application API endpoints."""

import pytest
from fastapi.testclient import TestClient

from hola_server.test_utils.fakes.fake_app_service import FakeAppService
from hola_shared.models.app import AppStatus


class TestAppsAPI:
    """Tests for the application API endpoints."""

    def test_create_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test successful app creation."""
        request_data = {
            "name": "test-app",
            "image": "nginx:latest",
            "port": 8080,
            "environment": {"ENV": "test"},
            "description": "Test application",
            "version": "1.0.0",
        }

        response = client_with_fake_app_service.post(
            "/api/apps", json=request_data, headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["name"] == "test-app"
        assert data["data"]["app"]["status"] == AppStatus.CREATED
        assert data["data"]["app"]["image"] == "nginx:latest"
        assert data["data"]["app"]["port"] == 8080
        assert data["data"]["app"]["environment"] == {"ENV": "test"}
        assert data["data"]["app"]["description"] == "Test application"
        assert data["data"]["app"]["version"] == "1.0.0"
        assert data["data"]["app"]["url"] is None  # No URL until deployed
        assert "created successfully" in data["data"]["message"]
        assert fake_app_service.has_app("test-app")

    def test_create_app_minimal_data(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test app creation with minimal required data."""
        request_data = {"name": "minimal-app"}

        response = client_with_fake_app_service.post(
            "/api/apps", json=request_data, headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["name"] == "minimal-app"
        assert data["data"]["app"]["status"] == AppStatus.CREATED
        assert data["data"]["app"]["image"] is None
        assert data["data"]["app"]["port"] is None
        assert fake_app_service.has_app("minimal-app")

    def test_create_app_duplicate_name(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test creating app with duplicate name."""
        request_data = {"name": "test-app", "image": "nginx:latest"}

        # First creation
        response1 = client_with_fake_app_service.post(
            "/api/apps", json=request_data, headers={"X-API-Key": "test-key"}
        )
        assert response1.status_code == 200

        # Second creation with same name
        response2 = client_with_fake_app_service.post(
            "/api/apps", json=request_data, headers={"X-API-Key": "test-key"}
        )
        assert response2.status_code == 422
        data = response2.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
        assert "already exists" in data["error"]["message"]

    def test_create_app_invalid_data(
        self, client_with_fake_app_service: TestClient
    ):
        """Test app creation with invalid data."""
        # Missing required name field
        request_data = {"image": "nginx:latest"}

        response = client_with_fake_app_service.post(
            "/api/apps", json=request_data, headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 422

    @pytest.mark.skip(reason="Authentication not implemented yet")
    def test_create_app_unauthorized(
        self, client_with_fake_app_service: TestClient
    ):
        """Test app creation without API key."""
        request_data = {"name": "test-app", "image": "nginx:latest"}

        response = client_with_fake_app_service.post("/api/apps", json=request_data)

        assert response.status_code == 403

    def test_deploy_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test successful app deployment."""
        request_data = {
            "name": "test-app",
            "image": "nginx:latest",
            "port": 8080,
            "environment": {"ENV": "test"},
            "description": "Test application",
        }

        response = client_with_fake_app_service.post(
            "/api/apps/deploy", json=request_data, headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["name"] == "test-app"
        assert data["data"]["deployment_id"].startswith("test-deploy-")
        assert fake_app_service.has_app("test-app")

    def test_deploy_app_duplicate_name(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test deploying app with duplicate name when already deployed."""
        request_data = {"name": "test-app", "image": "nginx:latest"}

        # First deployment
        response1 = client_with_fake_app_service.post(
            "/api/apps/deploy", json=request_data, headers={"X-API-Key": "test-key"}
        )
        assert response1.status_code == 200

        # Second deployment with same name should fail if already deployed
        response2 = client_with_fake_app_service.post(
            "/api/apps/deploy", json=request_data, headers={"X-API-Key": "test-key"}
        )
        assert response2.status_code == 422
        response_data = response2.json()
        assert not response_data["success"]
        assert "already deployed" in response_data["error"]["message"]

    def test_deploy_created_app(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test deploying an app that was previously created."""
        # First create the app
        create_data = {
            "name": "test-app",
            "image": "nginx:latest",
            "port": 8080,
            "description": "Test app"
        }
        create_response = client_with_fake_app_service.post(
            "/api/apps", json=create_data, headers={"X-API-Key": "test-key"}
        )
        assert create_response.status_code == 200
        
        # Verify app is in CREATED state
        app_data = create_response.json()["data"]["app"]
        assert app_data["status"] == AppStatus.CREATED
        assert app_data["url"] is None

        # Now deploy the created app
        deploy_data = {
            "name": "test-app",
            "image": "nginx:updated",  # Different image to test updates
            "port": 9090,  # Different port
            "environment": {"ENV": "production"}
        }
        deploy_response = client_with_fake_app_service.post(
            "/api/apps/deploy", json=deploy_data, headers={"X-API-Key": "test-key"}
        )
        assert deploy_response.status_code == 200
        
        # Verify app is now deployed with updated config
        deploy_data_response = deploy_response.json()
        assert deploy_data_response["success"] is True
        deployed_app = deploy_data_response["data"]["app"]
        assert deployed_app["status"] == AppStatus.RUNNING
        assert deployed_app["image"] == "nginx:updated"
        assert deployed_app["port"] == 9090
        assert deployed_app["environment"] == {"ENV": "production"}
        assert deployed_app["url"] is not None

    def test_list_apps_empty(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test listing apps when none exist."""
        response = client_with_fake_app_service.get(
            "/api/apps/", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["apps"] == []
        assert data["data"]["total_count"] == 0

    def test_list_apps_with_apps(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test listing apps when some exist."""
        # Deploy some apps first
        apps_to_deploy = [
            {"name": "app1", "image": "nginx:latest"},
            {"name": "app2", "image": "redis:latest"},
        ]

        for app_data in apps_to_deploy:
            client_with_fake_app_service.post(
                "/api/apps/deploy", json=app_data, headers={"X-API-Key": "test-key"}
            )

        response = client_with_fake_app_service.get(
            "/api/apps/", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert len(data["data"]["apps"]) == 2
        assert data["data"]["total_count"] == 2

        app_names = [app["name"] for app in data["data"]["apps"]]
        assert "app1" in app_names
        assert "app2" in app_names

    def test_get_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test getting app details."""
        # Deploy an app first
        deploy_response = client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"},
        )
        assert deploy_response.status_code == 200

        # Get app details
        response = client_with_fake_app_service.get(
            "/api/apps/test-app", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["name"] == "test-app"
        assert data["data"]["status"] == AppStatus.RUNNING
        assert data["data"]["image"] == "nginx:latest"

    def test_get_app_not_found(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test getting non-existent app."""
        response = client_with_fake_app_service.get(
            "/api/apps/nonexistent", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 404
        response_data = response.json()
        assert not response_data["success"]
        assert "not found" in response_data["error"]["message"]

    def test_upgrade_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test successful app upgrade."""
        # Deploy an app first
        client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:1.0"},
            headers={"X-API-Key": "test-key"},
        )

        # Upgrade the app
        upgrade_data = {
            "image": "nginx:2.0",
            "version": "2.0",
            "backup_before_upgrade": True,
        }

        response = client_with_fake_app_service.post(
            "/api/apps/test-app/upgrade",
            json=upgrade_data,
            headers={"X-API-Key": "test-key"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["app"]["image"] == "nginx:2.0"
        assert data["data"]["app"]["version"] == "2.0"
        assert data["data"]["deployment_id"].startswith("test-upgrade-")

    def test_delete_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test successful app deletion."""
        # Deploy an app first
        client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"},
        )

        # Delete the app
        response = client_with_fake_app_service.delete(
            "/api/apps/test-app", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert "deleted successfully" in data["data"]["message"]
        assert not fake_app_service.has_app("test-app")

    def test_start_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test starting a stopped app."""
        # Deploy and stop an app first
        client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"},
        )

        client_with_fake_app_service.post(
            "/api/apps/test-app/stop", headers={"X-API-Key": "test-key"}
        )

        # Start the app
        response = client_with_fake_app_service.post(
            "/api/apps/test-app/start", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.RUNNING

    def test_stop_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test stopping a running app."""
        # Deploy an app first
        client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"},
        )

        # Stop the app
        response = client_with_fake_app_service.post(
            "/api/apps/test-app/stop", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.STOPPED

    def test_restart_app_success(
        self, client_with_fake_app_service: TestClient, fake_app_service: FakeAppService
    ):
        """Test restarting an app."""
        # Deploy an app first
        client_with_fake_app_service.post(
            "/api/apps/deploy",
            json={"name": "test-app", "image": "nginx:latest"},
            headers={"X-API-Key": "test-key"},
        )

        # Restart the app
        response = client_with_fake_app_service.post(
            "/api/apps/test-app/restart", headers={"X-API-Key": "test-key"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"]["success"] is True
        assert data["data"]["new_status"] == AppStatus.RUNNING


# class TestAppsAPIAuth:
#     """Tests for authentication on application API endpoints."""

#     def test_unauthorized_request(self, client: TestClient):
#         """Test request without API key."""
#         response = client.get("/api/apps/")
#         assert response.status_code == 401

#     def test_invalid_api_key(self, client: TestClient):
#         """Test request with invalid API key."""
#         response = client.get(
#             "/api/apps/",
#             headers={"X-API-Key": "invalid-key"}
#         )
#         assert response.status_code == 401
