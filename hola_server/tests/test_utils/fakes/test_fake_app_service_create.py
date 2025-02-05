"""Tests for the create_app method in FakeAppService."""

import pytest
from datetime import datetime, timezone

from hola_shared.models.app import App, AppStatus, AppHealth, AppCreateRequest
from hola_shared.errors import ValidationException
from hola_server.test_utils.fakes.fake_app_service import FakeAppService


@pytest.fixture
def fake_app_service():
    """Return a fake app service instance."""
    return FakeAppService()


class TestFakeAppServiceCreate:
    """Tests for the create_app method in FakeAppService."""

    @pytest.mark.asyncio
    async def test_create_app_success(self, fake_app_service):
        """Test successful app creation."""
        request = AppCreateRequest(
            name="test-app",
            image="nginx:latest",
            port=8080,
            environment={"ENV": "test"},
            description="Test application",
            version="1.0.0",
        )

        response = await fake_app_service.create_app(request)

        assert response.app.name == "test-app"
        assert response.app.status == AppStatus.CREATED
        assert response.app.health == AppHealth.UNKNOWN
        assert response.app.image == "nginx:latest"
        assert response.app.port == 8080
        assert response.app.environment == {"ENV": "test"}
        assert response.app.description == "Test application"
        assert response.app.version == "1.0.0"
        assert response.app.url is None  # No URL until deployed
        assert response.app.backup_count == 0
        assert response.app.files_count == 0
        assert response.app.files_total_size_bytes == 0
        assert "created successfully" in response.message
        
        # Verify app is stored
        assert fake_app_service.has_app("test-app")
        
        # Verify method was tracked
        assert fake_app_service.get_method_call_count("create_app") == 1

    @pytest.mark.asyncio
    async def test_create_app_minimal_data(self, fake_app_service):
        """Test app creation with minimal required data."""
        request = AppCreateRequest(name="minimal-app")

        response = await fake_app_service.create_app(request)

        assert response.app.name == "minimal-app"
        assert response.app.status == AppStatus.CREATED
        assert response.app.image is None
        assert response.app.port is None
        assert response.app.environment == {}  # Default factory dict, not None
        assert response.app.description is None
        assert response.app.version is None

    @pytest.mark.asyncio
    async def test_create_app_duplicate_name(self, fake_app_service):
        """Test creating app with duplicate name."""
        request = AppCreateRequest(name="test-app", image="nginx:latest")

        # First creation
        await fake_app_service.create_app(request)

        # Second creation with same name should fail
        with pytest.raises(ValidationException) as excinfo:
            await fake_app_service.create_app(request)

        assert "already exists" in str(excinfo.value)
        assert excinfo.value.details["app_name"] == "test-app"

    @pytest.mark.asyncio
    async def test_create_app_forced_failure(self, fake_app_service):
        """Test forced failure when creating an app."""
        fake_app_service.set_failure_mode("create", True)
        
        request = AppCreateRequest(name="test-app", image="nginx:latest")

        with pytest.raises(ValidationException) as excinfo:
            await fake_app_service.create_app(request)

        assert "Forced creation failure" in str(excinfo.value)

    @pytest.mark.asyncio
    async def test_create_app_tracks_timestamps(self, fake_app_service):
        """Test that create_app sets proper timestamps."""
        request = AppCreateRequest(name="test-app")

        before_create = datetime.now(timezone.utc)
        response = await fake_app_service.create_app(request)
        after_create = datetime.now(timezone.utc)

        assert before_create <= response.app.created_at <= after_create
        assert before_create <= response.app.updated_at <= after_create
        assert response.app.created_at == response.app.updated_at

    def test_reset_clears_create_failure_mode(self, fake_app_service):
        """Test that reset clears the create failure mode."""
        fake_app_service.set_failure_mode("create", True)
        assert fake_app_service.should_fail_create is True

        fake_app_service.reset()
        assert fake_app_service.should_fail_create is False

    @pytest.mark.asyncio
    async def test_was_method_called_with_for_create(self, fake_app_service):
        """Test method call tracking for create_app."""
        request = AppCreateRequest(name="test-app", image="nginx:latest")
        
        # Initially not called
        assert not fake_app_service.was_method_called_with("create_app", request=request)
        
        # After calling
        await fake_app_service.create_app(request)
        assert fake_app_service.was_method_called_with("create_app")
