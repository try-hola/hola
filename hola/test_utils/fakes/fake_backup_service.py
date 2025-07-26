"""Fake backup service implementation for testing.

This module provides a fake implementation of a backup service for testing purposes.
It includes in-memory backup and restore functionality, allowing simulation of various
operations such as backup creation, listing, retrieval, deletion, and restoration.

Attributes:
    FakeBackupService (class): Provides methods to simulate backup and restore operations.
    BackupInfo (class): Represents information about a backup.
    RestoreInfo (class): Represents information about a restore operation.
    BackupCreateRequest (class): Represents a request to create a backup.
    BackupCreateResponse (class): Represents the response after creating a backup.
    BackupListResponse (class): Represents the response containing a list of backups.
    RestoreRequest (class): Represents a request to restore a backup.
    RestoreResponse (class): Represents the response after restoring a backup.
    BackupStatus (enum): Represents the status of a backup.
    RestoreStatus (enum): Represents the status of a restore operation.
"""

from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timezone
import uuid

from hola.models.errors import NotFoundException

from hola.models.backup import (
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
    """
    Fake implementation of backup service for testing.

    This class provides in-memory backup and restore functionality for testing purposes.
    It allows simulation of backup creation, listing, retrieval, deletion, and restoration.
    Additionally, it supports failure mode configuration for testing error scenarios.

    Attributes:
        method_calls (List[Dict[str, Any]]): A list to track method calls for assertions.
        _failure_modes (Dict[str, bool]): A dictionary to simulate failures for specific methods.
        backups (Dict[str, BackupInfo]): A dictionary to store backup information.
        restores (Dict[str, RestoreInfo]): A dictionary to store restore information.
    """

    def __init__(self):
        """
        Initialize the fake backup service.

        Attributes:
            method_calls (List[Dict[str, Any]]): A list to track method calls for assertions.
            _failure_modes (Dict[str, bool]): A dictionary to simulate failures for specific methods.
            backups (Dict[str, BackupInfo]): A dictionary to store backup information.
            restores (Dict[str, RestoreInfo]): A dictionary to store restore information.
        """
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}

        # Structure: {backup_id: BackupInfo}
        self.backups: Dict[str, BackupInfo] = {}

        # Structure: {restore_id: RestoreInfo}
        self.restores: Dict[str, RestoreInfo] = {}

    def set_failure_mode(self, method_name: str, should_fail: bool = True):
        """
        Configure a method to fail when called.

        Args:
            method_name (str): Name of the method that should fail.
            should_fail (bool): Whether the method should fail (default is True).
        """
        self._failure_modes[method_name] = should_fail

    def register_backup(self, backup: BackupInfo):
        """
        Register a predefined backup in the system.

        Args:
            backup (BackupInfo): Backup information to add.
        """
        self.backups[backup.id] = backup

    def register_restore(self, restore: RestoreInfo):
        """
        Register a predefined restore operation in the system.

        Args:
            restore (RestoreInfo): Restore information to add.
        """
        self.restores[restore.id] = restore

    def reset(self):
        """
        Reset the fake service state.

        Clears all stored backups, restores, and method calls.
        """
        self.method_calls = []
        self._failure_modes = {}
        self.backups = {}
        self.restores = {}

    async def create_backup(
        self, app_name: str, request: BackupCreateRequest
    ) -> BackupCreateResponse:
        """
        Create a new backup of an application.

        Args:
            app_name (str): The name of the application.
            request (BackupCreateRequest): The request containing backup details.

        Returns:
            BackupCreateResponse: The response containing the created backup and a success message.

        Raises:
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        List available backups, optionally filtered by app name.

        Args:
            app_name (Optional[str]): The name of the application to filter backups (default is None).

        Returns:
            BackupListResponse: The response containing a list of backups and their details.

        Raises:
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        Get information about a specific backup.

        Args:
            backup_id (str): The unique identifier of the backup.

        Returns:
            BackupInfo: The backup information.

        Raises:
            NotFoundException: If the backup does not exist.
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        Delete a backup.

        Args:
            backup_id (str): The unique identifier of the backup.

        Raises:
            NotFoundException: If the backup does not exist.
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        Restore an application from a backup.

        Args:
            backup_id (str): The unique identifier of the backup.
            request (RestoreRequest): The request containing restore details.

        Returns:
            RestoreResponse: The response containing the restore information and a success message.

        Raises:
            NotFoundException: If the backup does not exist.
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        Get information about a specific restore operation.

        Args:
            restore_id (str): The unique identifier of the restore operation.

        Returns:
            RestoreInfo: The restore information.

        Raises:
            NotFoundException: If the restore operation does not exist.
            Exception: If the failure mode for this method is enabled.
        """
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
        """
        Check if a backup exists for an application.

        Args:
            app_name (str): The name of the application.
            backup_id (str): The unique identifier of the backup.

        Returns:
            bool: True if the backup exists for the application, False otherwise.
        """
        return (
            backup_id in self.backups and self.backups[backup_id].app_name == app_name
        )
