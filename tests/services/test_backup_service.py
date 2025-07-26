"""Tests for backup service."""

import pytest
import tempfile
import shutil
from pathlib import Path
from datetime import datetime

from hola.models import BackupInfo, BackupCreateRequest, RestoreRequest
from hola.models.errors import NotFoundException, ValidationException, ServiceException
from hola.services.backup_service import BackupService
from hola.test_utils.fakes.fake_backup_service import FakeBackupService


class TestBackupService:
    """Test cases for BackupService."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        temp_dir = Path(tempfile.mkdtemp())
        yield temp_dir
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def backup_service(self, mock_context, temp_dir):
        """Create a BackupService instance for testing."""
        # Mock settings to use temp directory
        mock_context.settings.data_path = str(temp_dir)
        service = BackupService(mock_context)

        # Create a fake app service and register test apps
        from hola.test_utils.fakes.fake_app_service import FakeAppService
        from hola.models.app import App, AppStatus, AppHealth
        from datetime import datetime, timezone

        fake_app_service = FakeAppService()

        # Register test apps that will be used in tests
        now = datetime.now(timezone.utc)
        test_app = App(
            name="test-app",
            status=AppStatus.RUNNING,
            health=AppHealth.HEALTHY,
            image="test-image:latest",
            port=8080,
            environment={},
            description="Test app",
            version="1.0.0",
            created_at=now,
            updated_at=now,
            url="http://localhost:8080",
            backup_count=0,
            files_count=0,
            files_total_size_bytes=0,
        )
        fake_app_service.apps["test-app"] = test_app

        # Register apps for multi-app tests
        for app_name in ["app1", "app2"]:
            app = App(
                name=app_name,
                status=AppStatus.RUNNING,
                health=AppHealth.HEALTHY,
                image="test-image:latest",
                port=8080,
                environment={},
                description=f"Test {app_name}",
                version="1.0.0",
                created_at=now,
                updated_at=now,
                url=f"http://localhost:8080/{app_name}",
                backup_count=0,
                files_count=0,
                files_total_size_bytes=0,
            )
            fake_app_service.apps[app_name] = app

        # Patch the _get_app_service method to return our fake app service
        def get_fake_app_service(self):
            return fake_app_service

        # Use monkey patching to replace the method
        import types

        service._get_app_service = types.MethodType(get_fake_app_service, service)

        return service

    @pytest.fixture
    def fake_backup_service(self):
        """Create a FakeBackupService instance for testing."""
        service = FakeBackupService()
        yield service
        service.reset()

    def setup_test_app_data(self, temp_dir: Path, app_name: str):
        """Set up test application data."""
        # Fix: Remove "data" from the path since settings.data_path is already set to temp_dir
        app_data_dir = temp_dir / "apps" / app_name
        app_data_dir.mkdir(parents=True, exist_ok=True)

        # Create test files
        (app_data_dir / "test_file.txt").write_text("test content")
        (app_data_dir / "config.json").write_text('{"key": "value"}')

        config_dir = app_data_dir / "config"
        config_dir.mkdir(exist_ok=True)
        (config_dir / "app.conf").write_text("app_setting=value")

        return app_data_dir

    @pytest.mark.asyncio
    async def test_create_backup_success(self, backup_service, temp_dir):
        """Test successful backup creation."""
        app_name = "test-app"
        self.setup_test_app_data(temp_dir, app_name)

        request = BackupCreateRequest(
            include_files=True,
            include_config=True,
            include_data=True,
            description="Test backup",
        )

        response = await backup_service.create_backup(app_name, request)

        # Use correct attribute name based on model structure
        backup_info = response.backup
        assert backup_info.app_name == app_name
        assert backup_info.includes_files is True
        assert backup_info.includes_config is True
        assert backup_info.includes_data is True
        assert backup_info.description == "Test backup"
        assert backup_info.size_bytes > 0

        # Check backup file exists
        backup_dir = backup_service.backup_path
        backup_files = list(backup_dir.glob(f"*/test-app-*.tar.gz"))
        assert len(backup_files) == 1

    @pytest.mark.asyncio
    async def test_create_backup_app_not_found(self, backup_service):
        """Test backup creation for non-existent app."""
        request = BackupCreateRequest(description="Test backup")

        with pytest.raises(ValidationException) as exc_info:
            await backup_service.create_backup("nonexistent", request)
        assert "Application 'nonexistent' not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_list_backups_empty(self, backup_service):
        """Test listing backups when none exist."""
        response = await backup_service.list_backups("test-app")
        assert response.backups == []
        assert response.total_count == 0
        assert response.total_size_bytes == 0

    @pytest.mark.asyncio
    async def test_list_backups_with_data(self, backup_service, temp_dir):
        """Test listing backups with existing backups."""
        app_name = "test-app"
        self.setup_test_app_data(temp_dir, app_name)

        # Create a backup
        request = BackupCreateRequest(description="First backup")
        create_response = await backup_service.create_backup(app_name, request)

        # List backups
        list_response = await backup_service.list_backups(app_name)
        backups = list_response.backups
        backup_info = create_response.backup

        assert len(backups) == 1
        assert backups[0].id == backup_info.id
        assert backups[0].description == "First backup"
        assert list_response.total_count == 1

    @pytest.mark.asyncio
    async def test_list_backups_all_apps(self, backup_service, temp_dir):
        """Test listing backups for all applications."""
        # Create backups for multiple apps
        for app_name in ["app1", "app2"]:
            self.setup_test_app_data(temp_dir, app_name)
            request = BackupCreateRequest(description=f"Backup for {app_name}")
            await backup_service.create_backup(app_name, request)

        # List all backups
        list_response = await backup_service.list_backups()
        assert len(list_response.backups) == 2
        assert list_response.total_count == 2

    @pytest.mark.asyncio
    async def test_get_backup_info_success(self, backup_service, temp_dir):
        """Test getting backup info for existing backup."""
        app_name = "test-app"
        self.setup_test_app_data(temp_dir, app_name)

        # Create a backup
        request = BackupCreateRequest(description="Test backup")
        response = await backup_service.create_backup(app_name, request)
        backup_info = response.backup
        backup_id = backup_info.id

        # Get backup info
        retrieved_backup = await backup_service.get_backup_info(backup_id)
        assert retrieved_backup.id == backup_id
        assert retrieved_backup.app_name == app_name
        assert retrieved_backup.description == "Test backup"

    @pytest.mark.asyncio
    async def test_get_backup_info_not_found(self, backup_service):
        """Test getting backup info for non-existent backup."""
        with pytest.raises(NotFoundException) as exc_info:
            await backup_service.get_backup_info("invalid")
        assert "Backup 'invalid' not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_delete_backup_success(self, backup_service, temp_dir):
        """Test successful backup deletion."""
        app_name = "test-app"
        self.setup_test_app_data(temp_dir, app_name)

        # Create a backup
        request = BackupCreateRequest(description="Test backup")
        response = await backup_service.create_backup(app_name, request)
        backup_info = response.backup
        backup_id = backup_info.id

        # Verify backup exists
        retrieved_backup = await backup_service.get_backup_info(backup_id)
        assert retrieved_backup.id == backup_id

        # Delete backup
        await backup_service.delete_backup(backup_id)

        # Verify backup is marked as deleted
        with pytest.raises(NotFoundException):
            await backup_service.get_backup_info(backup_id)

    @pytest.mark.asyncio
    async def test_delete_backup_not_found(self, backup_service):
        """Test deleting non-existent backup."""
        with pytest.raises(NotFoundException) as exc_info:
            await backup_service.delete_backup("invalid")
        assert "Backup 'invalid' not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_backup_minimal_request(self, backup_service, temp_dir):
        """Test backup creation with minimal parameters."""
        app_name = "test-app"
        self.setup_test_app_data(temp_dir, app_name)

        # Create backup with only description and explicitly set includes to False
        request = BackupCreateRequest(
            description="Minimal backup",
            include_files=False,
            include_config=False,
            include_data=False,
        )
        response = await backup_service.create_backup(app_name, request)

        backup = response.backup
        assert backup.app_name == app_name
        assert backup.description == "Minimal backup"
        assert backup.includes_files is False
        assert backup.includes_config is False
        assert backup.includes_data is False

    @pytest.mark.asyncio
    async def test_restore_backup_success(self, backup_service, temp_dir):
        """Test successful backup restoration."""
        app_name = "test-app"
        app_data_dir = self.setup_test_app_data(temp_dir, app_name)

        # Create a backup
        request = BackupCreateRequest(
            include_files=True,
            include_config=True,
            include_data=True,
            description="Test backup",
        )
        response = await backup_service.create_backup(app_name, request)
        backup_info = response.backup
        backup_id = backup_info.id

        # Delete original files
        shutil.rmtree(app_data_dir)

        # Restore backup
        restore_request = RestoreRequest(
            backup_id=backup_id,
            target_app_name=app_name,
            restore_files=True,
            restore_config=True,
            restore_data=True,
        )
        restore_response = await backup_service.restore_backup(
            backup_id, restore_request
        )

        assert restore_response.restore.backup_id == backup_id
        assert restore_response.restore.id is not None
        assert restore_response.restore.status == "completed"
        assert restore_response.message is not None

        # Verify files were restored
        assert (app_data_dir / "test_file.txt").exists()
        assert (app_data_dir / "config.json").exists()


class TestFakeBackupService:
    """Test cases for FakeBackupService."""

    @pytest.fixture
    def fake_service(self):
        """Create a FakeBackupService instance."""
        service = FakeBackupService()
        yield service
        service.reset()

    @pytest.mark.asyncio
    async def test_create_backup(self, fake_service):
        """Test fake backup creation."""
        request = BackupCreateRequest(description="Test backup")
        response = await fake_service.create_backup("test-app", request)

        # Use correct attribute name based on model structure
        backup_info = response.backup
        assert backup_info.app_name == "test-app"
        assert backup_info.description == "Test backup"
        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "create_backup"

    @pytest.mark.asyncio
    async def test_list_backups(self, fake_service):
        """Test fake backup listing."""
        # Create some backups
        await fake_service.create_backup(
            "app1", BackupCreateRequest(description="Test backup")
        )
        await fake_service.create_backup(
            "app1", BackupCreateRequest(description="Another test backup")
        )
        await fake_service.create_backup(
            "app2", BackupCreateRequest(description="Test backup")
        )

        # List backups for app1
        list_response = await fake_service.list_backups("app1")
        backups1 = list_response.backups
        assert len(backups1) == 2
        assert list_response.total_count == 2

        # List backups for app2
        list_response = await fake_service.list_backups("app2")
        backups2 = list_response.backups
        assert len(backups2) == 1
        assert list_response.total_count == 1

    @pytest.mark.asyncio
    async def test_restore_backup(self, fake_service):
        """Test fake backup restoration."""
        # Create a backup
        request = BackupCreateRequest(description="Test backup")
        response = await fake_service.create_backup("test-app", request)
        backup_info = response.backup
        backup_id = backup_info.id

        # Restore backup
        restore_request = RestoreRequest(
            backup_id=backup_id,
            target_app_name="test-app",
            restore_files=True,
            restore_config=True,
        )
        restore_response = await fake_service.restore_backup(backup_id, restore_request)

        assert restore_response.restore.backup_id == backup_id
        assert restore_response.restore.id is not None
        assert restore_response.restore.status == "completed"
        assert restore_response.message is not None

    @pytest.mark.asyncio
    async def test_get_backup_info(self, fake_service):
        """Test getting backup info from fake service."""
        # Create a backup
        request = BackupCreateRequest(description="Test backup")
        response = await fake_service.create_backup("test-app", request)
        backup_id = response.backup.id

        # Get backup info
        backup_info = await fake_service.get_backup_info(backup_id)
        assert backup_info.id == backup_id
        assert backup_info.app_name == "test-app"
        assert backup_info.description == "Test backup"

    @pytest.mark.asyncio
    async def test_delete_backup(self, fake_service):
        """Test deleting backup from fake service."""
        # Create a backup
        request = BackupCreateRequest(description="Test backup")
        response = await fake_service.create_backup("test-app", request)
        backup_id = response.backup.id

        # Verify backup exists
        backup_info = await fake_service.get_backup_info(backup_id)
        assert backup_info.id == backup_id

        # Delete backup
        await fake_service.delete_backup(backup_id)

        # Verify backup is gone
        with pytest.raises(NotFoundException):
            await fake_service.get_backup_info(backup_id)

    @pytest.mark.asyncio
    async def test_list_backups_empty(self, fake_service):
        """Test listing backups when none exist."""
        list_response = await fake_service.list_backups("test-app")
        assert len(list_response.backups) == 0
        assert list_response.total_count == 0
        assert list_response.total_size_bytes == 0

    @pytest.mark.asyncio
    async def test_method_call_tracking(self, fake_service):
        """Test that method calls are properly tracked."""
        request = BackupCreateRequest(description="Test backup")

        # Create backup
        response = await fake_service.create_backup("test-app", request)
        backup_id = response.backup.id

        # List backups
        await fake_service.list_backups("test-app")

        # Get backup info
        await fake_service.get_backup_info(backup_id)

        # Delete backup
        await fake_service.delete_backup(backup_id)

        # Verify all method calls were tracked
        assert len(fake_service.method_calls) == 4
        method_names = [call["method"] for call in fake_service.method_calls]
        assert "create_backup" in method_names
        assert "list_backups" in method_names
        assert "get_backup_info" in method_names
        assert "delete_backup" in method_names

    @pytest.mark.asyncio
    async def test_has_backup(self, fake_service):
        """Test checking if backup exists."""
        # Check if fake service has has_backup method, if not use alternative
        if hasattr(fake_service, "has_backup"):
            assert not fake_service.has_backup("test-app", "invalid")

            # Create a backup
            request = BackupCreateRequest(description="Test backup")
            response = await fake_service.create_backup("test-app", request)
            backup_info = response.backup
            backup_id = backup_info.id

            assert fake_service.has_backup("test-app", backup_id)
        else:
            # Alternative: check via get_backup_info
            with pytest.raises(NotFoundException):
                await fake_service.get_backup_info("invalid")

            # Create a backup
            request = BackupCreateRequest(description="Test backup")
            response = await fake_service.create_backup("test-app", request)
            backup_info = response.backup
            backup_id = backup_info.id

            # Should not raise exception for existing backup
            retrieved = await fake_service.get_backup_info(backup_id)
            assert retrieved.id == backup_id

    def test_reset(self, fake_service):
        """Test resetting fake service."""
        # Create some data (async method called with asyncio)
        import asyncio

        asyncio.run(
            fake_service.create_backup(
                "test-app", BackupCreateRequest(description="Test backup")
            )
        )

        fake_service.reset()
        assert len(fake_service.backups) == 0
        assert len(fake_service.method_calls) == 0

    @pytest.mark.asyncio
    async def test_backup_not_found_errors(self, fake_service):
        """Test error handling for non-existent backups."""
        # Test get_backup_info with invalid ID
        with pytest.raises(NotFoundException):
            await fake_service.get_backup_info("invalid-id")

        # Test delete_backup with invalid ID
        with pytest.raises(NotFoundException):
            await fake_service.delete_backup("invalid-id")

        # Test restore_backup with invalid ID
        restore_request = RestoreRequest(
            backup_id="invalid-id", target_app_name="test-app"
        )
        with pytest.raises(NotFoundException):
            await fake_service.restore_backup("invalid-id", restore_request)
