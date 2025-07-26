"""Tests for application service."""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch

from hola.services.app_service import AppService
from hola.config.context import ServerContext
from hola.models.app import (
    AppDeployRequest,
    AppUpgradeRequest,
    AppStatus,
    AppHealth,
)
from hola.models.errors import ValidationException, NotFoundException


@pytest.mark.asyncio
class TestAppService:
    """Test cases for AppService."""

    @pytest.fixture
    def app_service(self):
        """Create an app service instance for testing."""
        context = ServerContext()
        return AppService(context)

    @pytest.fixture
    def sample_deploy_request(self):
        """Sample deployment request for testing."""
        return AppDeployRequest(
            name="test-app",
            image="nginx:latest",
            port=8080,
            environment={"ENV": "test"},
            description="Test application",
            version="1.0",
        )

    async def test_deploy_app_success(self, app_service, sample_deploy_request):
        """Test successful app deployment."""
        result = await app_service.deploy_app(sample_deploy_request)

        assert result.app.name == "test-app"
        assert result.app.image == "nginx:latest"
        assert result.app.port == 8080
        assert result.app.status == AppStatus.RUNNING
        assert result.app.health == AppHealth.HEALTHY
        assert result.deployment_id.startswith("deploy-")
        assert result.estimated_duration == 30

        # Verify app is stored
        stored_app = await app_service.get_app("test-app")
        assert stored_app.name == "test-app"

    async def test_deploy_app_duplicate_name(self, app_service, sample_deploy_request):
        """Test deploying app with duplicate name."""
        # Deploy first app
        await app_service.deploy_app(sample_deploy_request)

        # Attempt to deploy with same name
        with pytest.raises(ValidationException) as exc_info:
            await app_service.deploy_app(sample_deploy_request)

        assert "already deployed" in str(exc_info.value)
        assert exc_info.value.details["app_name"] == "test-app"

    async def test_list_apps_empty(self, app_service):
        """Test listing apps when none exist."""
        result = await app_service.list_apps()

        assert result.apps == []
        assert result.total_count == 0

    async def test_list_apps_with_apps(self, app_service):
        """Test listing apps when some exist."""
        # Deploy multiple apps
        apps_to_deploy = [
            AppDeployRequest(name="app1", image="nginx:latest"),
            AppDeployRequest(name="app2", image="redis:latest"),
            AppDeployRequest(name="app3", image="postgres:latest"),
        ]

        for request in apps_to_deploy:
            await app_service.deploy_app(request)

        result = await app_service.list_apps()

        assert len(result.apps) == 3
        assert result.total_count == 3

        app_names = [app.name for app in result.apps]
        assert "app1" in app_names
        assert "app2" in app_names
        assert "app3" in app_names

    async def test_get_app_success(self, app_service, sample_deploy_request):
        """Test getting app details."""
        # Deploy an app first
        await app_service.deploy_app(sample_deploy_request)

        # Get app details
        app = await app_service.get_app("test-app")

        assert app.name == "test-app"
        assert app.image == "nginx:latest"
        assert app.status == AppStatus.RUNNING

    async def test_get_app_not_found(self, app_service):
        """Test getting non-existent app."""
        with pytest.raises(NotFoundException) as exc_info:
            await app_service.get_app("nonexistent")

        assert exc_info.value.details["resource_type"] == "application"
        assert exc_info.value.details["resource_id"] == "nonexistent"

    async def test_upgrade_app_success(self, app_service, sample_deploy_request):
        """Test successful app upgrade."""
        # Deploy an app first
        await app_service.deploy_app(sample_deploy_request)

        # Upgrade the app
        upgrade_request = AppUpgradeRequest(
            image="nginx:2.0",
            environment={"ENV": "production", "NEW_VAR": "value"},
            version="2.0",
            backup_before_upgrade=True,
        )

        result = await app_service.upgrade_app("test-app", upgrade_request)

        assert result.app.image == "nginx:2.0"
        assert result.app.version == "2.0"
        assert result.app.environment["ENV"] == "production"
        assert result.app.environment["NEW_VAR"] == "value"
        assert result.app.backup_count == 1
        assert result.deployment_id.startswith("upgrade-")
        assert result.estimated_duration == 45

    async def test_upgrade_app_not_found(self, app_service):
        """Test upgrading non-existent app."""
        upgrade_request = AppUpgradeRequest(image="nginx:2.0")

        with pytest.raises(NotFoundException):
            await app_service.upgrade_app("nonexistent", upgrade_request)

    async def test_delete_app_success(self, app_service, sample_deploy_request):
        """Test successful app deletion."""
        # Deploy an app first
        await app_service.deploy_app(sample_deploy_request)

        # Delete the app
        result = await app_service.delete_app("test-app")

        assert result.success is True
        assert "deleted successfully" in result.message
        assert result.previous_status == AppStatus.RUNNING
        assert result.new_status == AppStatus.UNKNOWN

        # Verify app is removed
        with pytest.raises(NotFoundException):
            await app_service.get_app("test-app")

    async def test_delete_app_not_found(self, app_service):
        """Test deleting non-existent app."""
        with pytest.raises(NotFoundException):
            await app_service.delete_app("nonexistent")

    async def test_start_app_success(self, app_service, sample_deploy_request):
        """Test starting a stopped app."""
        # Deploy and stop an app first
        await app_service.deploy_app(sample_deploy_request)
        await app_service.stop_app("test-app")

        # Start the app
        result = await app_service.start_app("test-app")

        assert result.success is True
        assert "started successfully" in result.message
        assert result.previous_status == AppStatus.STOPPED
        assert result.new_status == AppStatus.RUNNING

        # Verify app status
        app = await app_service.get_app("test-app")
        assert app.status == AppStatus.RUNNING
        assert app.health == AppHealth.HEALTHY

    async def test_start_app_already_running(self, app_service, sample_deploy_request):
        """Test starting an already running app."""
        # Deploy an app (starts running by default)
        await app_service.deploy_app(sample_deploy_request)

        # Attempt to start already running app
        with pytest.raises(ValidationException) as exc_info:
            await app_service.start_app("test-app")

        assert "already running" in str(exc_info.value)

    async def test_start_app_not_found(self, app_service):
        """Test starting non-existent app."""
        with pytest.raises(NotFoundException):
            await app_service.start_app("nonexistent")

    async def test_stop_app_success(self, app_service, sample_deploy_request):
        """Test stopping a running app."""
        # Deploy an app first
        await app_service.deploy_app(sample_deploy_request)

        # Stop the app
        result = await app_service.stop_app("test-app")

        assert result.success is True
        assert "stopped successfully" in result.message
        assert result.previous_status == AppStatus.RUNNING
        assert result.new_status == AppStatus.STOPPED

        # Verify app status
        app = await app_service.get_app("test-app")
        assert app.status == AppStatus.STOPPED
        assert app.health == AppHealth.UNKNOWN

    async def test_stop_app_already_stopped(self, app_service, sample_deploy_request):
        """Test stopping an already stopped app."""
        # Deploy and stop an app first
        await app_service.deploy_app(sample_deploy_request)
        await app_service.stop_app("test-app")

        # Attempt to stop already stopped app
        with pytest.raises(ValidationException) as exc_info:
            await app_service.stop_app("test-app")

        assert "already stopped" in str(exc_info.value)

    async def test_stop_app_not_found(self, app_service):
        """Test stopping non-existent app."""
        with pytest.raises(NotFoundException):
            await app_service.stop_app("nonexistent")

    async def test_restart_app_success(self, app_service, sample_deploy_request):
        """Test restarting an app."""
        # Deploy an app first
        await app_service.deploy_app(sample_deploy_request)

        # Restart the app
        result = await app_service.restart_app("test-app")

        assert result.success is True
        assert "restarted successfully" in result.message
        assert result.previous_status == AppStatus.RUNNING
        assert result.new_status == AppStatus.RUNNING

        # Verify app status
        app = await app_service.get_app("test-app")
        assert app.status == AppStatus.RUNNING
        assert app.health == AppHealth.HEALTHY

    async def test_restart_app_not_found(self, app_service):
        """Test restarting non-existent app."""
        with pytest.raises(NotFoundException):
            await app_service.restart_app("nonexistent")

    async def test_deployment_counter_increments(self, app_service):
        """Test that deployment counter increments correctly."""
        request1 = AppDeployRequest(name="app1", image="nginx:latest")
        request2 = AppDeployRequest(name="app2", image="redis:latest")

        result1 = await app_service.deploy_app(request1)
        result2 = await app_service.deploy_app(request2)

        assert result1.deployment_id == "deploy-000001"
        assert result2.deployment_id == "deploy-000002"

    async def test_app_timestamps(self, app_service, sample_deploy_request):
        """Test that app timestamps are set correctly."""
        before_deploy = datetime.now(timezone.utc)
        result = await app_service.deploy_app(sample_deploy_request)
        after_deploy = datetime.now(timezone.utc)

        app = result.app
        assert before_deploy <= app.created_at <= after_deploy
        assert before_deploy <= app.updated_at <= after_deploy

        # Test that updated_at changes on operations
        before_stop = datetime.now(timezone.utc)
        await app_service.stop_app("test-app")
        after_stop = datetime.now(timezone.utc)

        updated_app = await app_service.get_app("test-app")
        assert before_stop <= updated_app.updated_at <= after_stop
        assert updated_app.created_at == app.created_at  # Should not change
