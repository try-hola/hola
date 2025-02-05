"""Fake backup service implementation for testing."""

from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timezone
import uuid

from hola_shared.errors import NotFoundException

from hola_shared.models.backup import (
    BackupInfo,
    BackupStatus,
    BackupCreateRequest,
    BackupCreateResponse,
    BackupListResponse,
    RestoreRequest,
    RestoreResponse,
    RestoreInfo,
    RestoreStatus,
)


class FakeBackupService:
    """Fake implementation of backup service for testing.

    Provides in-memory backup and restore functionality for testing.
    """

    def __init__(self):
        """Initialize the fake backup service."""
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}

        # Structure: {backup_id: BackupInfo}
        self.backups: Dict[str, BackupInfo] = {}

        # Structure: {restore_id: RestoreInfo}
        self.restores: Dict[str, RestoreInfo] = {}

    def set_failure_mode(self, method_name: str, should_fail: bool = True):
        """Configure a method to fail when called.

        Args:
            method_name: Name of the method that should fail
            should_fail: Whether the method should fail (default: True)
        """
        self._failure_modes[method_name] = should_fail

    def register_backup(self, backup: BackupInfo):
        """Register a predefined backup in the system.

        Args:
            backup: Backup information to add
        """
        self.backups[backup.id] = backup

    def register_restore(self, restore: RestoreInfo):
        """Register a predefined restore operation in the system.

        Args:
            restore: Restore information to add
        """
        self.restores[restore.id] = restore

    def reset(self):
        """Reset the fake service state."""
        self.method_calls = []
        self._failure_modes = {}
        self.backups = {}
        self.restores = {}

    async def create_backup(
        self, app_name: str, request: BackupCreateRequest
    ) -> BackupCreateResponse:
        """Create a new backup of an application."""
        self.method_calls.append(
            {
                "method": "create_backup",
                "app_name": app_name,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("create_backup", False):
            raise Exception(f"Simulated failure in create_backup for {app_name}")

        backup_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        backup = BackupInfo(
            id=backup_id,
            app_name=app_name,
            description=request.description,
            status=BackupStatus.COMPLETED,
            size_bytes=1024 * 1024 * 50,  # 50MB mock size
            created_at=now,
            completed_at=now,
            includes_config=request.include_config,
            includes_files=request.include_files,
            includes_data=request.include_data,
            server_version="1.0.0",
            app_version="1.0.0",  # Add required field
            error_message=None,  # Add required field
        )

        self.backups[backup_id] = backup

        return BackupCreateResponse(
            backup=backup,
            message=f"Backup {backup_id} created successfully for {app_name}",
        )

    async def list_backups(self, app_name: Optional[str] = None) -> BackupListResponse:
        """List available backups, optionally filtered by app name."""
        self.method_calls.append(
            {
                "method": "list_backups",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("list_backups", False):
            raise Exception("Simulated failure in list_backups")

        filtered_backups = []
        for backup in self.backups.values():
            if app_name is None or backup.app_name == app_name:
                filtered_backups.append(backup)

        total_size = sum(b.size_bytes or 0 for b in filtered_backups)

        return BackupListResponse(
            backups=filtered_backups,
            total_count=len(filtered_backups),
            total_size_bytes=total_size,
        )

    async def get_backup_info(self, backup_id: str) -> BackupInfo:
        """Get information about a specific backup."""
        self.method_calls.append(
            {
                "method": "get_backup_info",
                "backup_id": backup_id,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_backup_info", False):
            raise Exception(f"Simulated failure in get_backup_info for {backup_id}")

        if backup_id not in self.backups:
            raise NotFoundException("Backup", backup_id)

        return self.backups[backup_id]

    async def delete_backup(self, backup_id: str) -> None:
        """Delete a backup."""
        self.method_calls.append(
            {
                "method": "delete_backup",
                "backup_id": backup_id,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("delete_backup", False):
            raise Exception(f"Simulated failure in delete_backup for {backup_id}")

        if backup_id not in self.backups:
            raise NotFoundException("Backup", backup_id)
        del self.backups[backup_id]

    async def restore_backup(
        self, backup_id: str, request: RestoreRequest
    ) -> RestoreResponse:
        """Restore an application from a backup."""
        self.method_calls.append(
            {
                "method": "restore_backup",
                "backup_id": backup_id,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("restore_backup", False):
            raise Exception(f"Simulated failure in restore_backup for {backup_id}")

        if backup_id not in self.backups:
            raise NotFoundException("Backup", backup_id)

        backup = self.backups[backup_id]

        # Target app is either specified or defaults to original
        target_app = request.target_app_name or backup.app_name

        restore_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        restore = RestoreInfo(
            id=restore_id,
            backup_id=backup_id,
            app_name=backup.app_name,
            target_app_name=target_app,
            status=RestoreStatus.COMPLETED,
            started_at=now,
            completed_at=now,
            progress_message="Restore completed successfully",
            error_message=None,  # Add required field
        )

        self.restores[restore_id] = restore

        return RestoreResponse(
            restore=restore,
            message=f"Application {target_app} restored successfully from backup {backup_id}",
        )

    async def get_restore_info(self, restore_id: str) -> RestoreInfo:
        """Get information about a specific restore operation."""
        self.method_calls.append(
            {
                "method": "get_restore_info",
                "restore_id": restore_id,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_restore_info", False):
            raise Exception(f"Simulated failure in get_restore_info for {restore_id}")

        if restore_id not in self.restores:
            raise NotFoundException("Restore", restore_id)

        return self.restores[restore_id]

    def has_backup(self, app_name: str, backup_id: str) -> bool:
        """Check if backup exists for app."""
        return (
            backup_id in self.backups and self.backups[backup_id].app_name == app_name
        )
