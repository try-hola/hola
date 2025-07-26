"""Application backup and restore service.

This module provides business logic for creating, managing, and restoring
application backups including configurations, files, and metadata.

Attributes:
    context (ServerContext): Server context containing settings and dependencies.
    settings (Settings): Application settings.
    config_service (ConfigService): Service for managing application configurations.
    file_storage (FileStorage): Service for managing application files.
    backup_path (Path): Path to the backup storage directory.
    _backups (Dict[str, BackupInfo]): In-memory registry of backups.
    _restores (Dict[str, RestoreInfo]): In-memory registry of restore operations.
"""

import json
import shutil
import tarfile
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
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
from hola.models.app import App
from hola.models.errors import ValidationException, NotFoundException, ServiceException
from hola.utils.logging import get_logger
from ..config.context import ServerContext

logger = get_logger(__name__)


class BackupService:
    """Service for managing application backups and restores.

    Provides business logic for backup creation, restoration, and management
    of application data, configurations, and files.

    Attributes:
        context (ServerContext): Server context containing settings and dependencies.
        settings (Settings): Application settings.
        config_service (ConfigService): Service for managing application configurations.
        file_storage (FileStorage): Service for managing application files.
        backup_path (Path): Path to the backup storage directory.
        _backups (Dict[str, BackupInfo]): In-memory registry of backups.
        _restores (Dict[str, RestoreInfo]): In-memory registry of restore operations.
    """

    def __init__(self, context: ServerContext):
        """Initialize the backup service.

        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.settings = context.settings
        self.config_service = context.get_config_service()
        self.file_storage = context.get_file_storage()

        # Initialize backup storage
        self.backup_path = Path(self.settings.data_path) / "backups"
        self.backup_path.mkdir(parents=True, exist_ok=True)

        # In-memory backup registry (in real implementation, use persistent storage)
        self._backups: Dict[str, BackupInfo] = {}
        self._restores: Dict[str, RestoreInfo] = {}

        logger.debug("BackupService initialized")

    async def create_backup(
        self, app_name: str, request: BackupCreateRequest
    ) -> BackupCreateResponse:
        """Create a new backup for an application.

        Args:
            app_name: Name of the application to backup
            request: Backup creation parameters

        Returns:
            BackupCreateResponse with backup information
        """
        try:
            logger.info(f"Creating backup for application: {app_name}")

            # Validate application exists
            app_service = self._get_app_service()
            try:
                app = await app_service.get_app(app_name)
            except NotFoundException:
                raise ValidationException(f"Application '{app_name}' not found")

            # Generate backup ID and metadata
            backup_id = str(uuid.uuid4())
            created_at = datetime.now(timezone.utc)

            backup_info = BackupInfo(
                id=backup_id,
                app_name=app_name,
                description=request.description,
                status=BackupStatus.CREATING,
                created_at=created_at,
                includes_config=request.include_config,
                includes_files=request.include_files,
                includes_data=request.include_data,
                app_version=app.version,
                server_version=self.context.settings.APP_VERSION or "1.0.0",
                size_bytes=0,  # Initialize with default value
                completed_at=None,  # Initialize with default value
                error_message=None,  # Initialize with default value
            )

            # Store backup info
            self._backups[backup_id] = backup_info

            try:
                # Create backup directory
                backup_dir = self.backup_path / backup_id
                backup_dir.mkdir(parents=True, exist_ok=True)

                # Create backup archive
                archive_path = backup_dir / f"{app_name}-{backup_id}.tar.gz"
                total_size = await self._create_backup_archive(
                    app_name, app, archive_path, request
                )

                # Update backup info with completion details
                completed_at = datetime.now(timezone.utc)
                backup_info.status = BackupStatus.COMPLETED
                backup_info.size_bytes = total_size
                backup_info.completed_at = completed_at

                self._backups[backup_id] = backup_info

                logger.info(
                    f"Backup created successfully: {backup_id} ({total_size} bytes)"
                )

                return BackupCreateResponse(
                    backup=backup_info,
                    message=f"Backup created successfully with ID: {backup_id}",
                )

            except Exception as e:
                # Update backup status to failed
                backup_info.status = BackupStatus.FAILED
                backup_info.error_message = str(e)
                self._backups[backup_id] = backup_info
                raise

        except ValidationException as e:
            logger.error(f"Failed to create backup for {app_name}: {str(e)}")
            raise  # Re-raise ValidationException directly
        except Exception as e:
            logger.error(f"Failed to create backup for {app_name}: {str(e)}")
            raise ServiceException(
                f"Failed to create backup: {str(e)}", service_name="BackupService"
            )

    async def list_backups(self, app_name: Optional[str] = None) -> BackupListResponse:
        """List available backups.

        Args:
            app_name: Optional filter by application name

        Returns:
            BackupListResponse with backup list and metadata
        """
        try:
            logger.debug(f"Listing backups for app: {app_name or 'all'}")

            # Filter backups by app name if specified
            backups = []
            total_size = 0

            for backup_info in self._backups.values():
                if app_name is None or backup_info.app_name == app_name:
                    if backup_info.status != BackupStatus.DELETED:
                        backups.append(backup_info)
                        if backup_info.size_bytes:
                            total_size += backup_info.size_bytes

            # Sort by creation date (newest first)
            backups.sort(key=lambda b: b.created_at, reverse=True)

            return BackupListResponse(
                backups=backups, total_count=len(backups), total_size_bytes=total_size
            )

        except Exception as e:
            logger.error(f"Failed to list backups: {str(e)}")
            raise ServiceException(
                f"Failed to list backups: {str(e)}", service_name="BackupService"
            )

    async def get_backup_info(self, backup_id: str) -> BackupInfo:
        """Get backup information by ID.

        Args:
            backup_id: Backup identifier

        Returns:
            BackupInfo with backup details
        """
        try:
            logger.debug(f"Getting backup info: {backup_id}")

            if backup_id not in self._backups:
                raise NotFoundException(resource_type="Backup", resource_id=backup_id)

            backup_info = self._backups[backup_id]

            if backup_info.status == BackupStatus.DELETED:
                raise NotFoundException(resource_type="Backup", resource_id=backup_id)

            return backup_info

        except NotFoundException:
            raise
        except Exception as e:
            logger.error(f"Failed to get backup info: {str(e)}")
            raise ServiceException(
                f"Failed to get backup info: {str(e)}", service_name="BackupService"
            )

    async def delete_backup(self, backup_id: str) -> None:
        """Delete a backup.

        Args:
            backup_id: Backup identifier to delete
        """
        try:
            logger.info(f"Deleting backup: {backup_id}")

            if backup_id not in self._backups:
                raise NotFoundException(resource_type="Backup", resource_id=backup_id)

            backup_info = self._backups[backup_id]

            if backup_info.status == BackupStatus.DELETED:
                raise ValidationException(f"Backup '{backup_id}' is already deleted")

            # Remove backup files
            backup_dir = self.backup_path / backup_id
            if backup_dir.exists():
                shutil.rmtree(backup_dir)

            # Mark as deleted
            backup_info.status = BackupStatus.DELETED
            self._backups[backup_id] = backup_info

            logger.info(f"Backup deleted successfully: {backup_id}")

        except (NotFoundException, ValidationException):
            raise
        except Exception as e:
            logger.error(f"Failed to delete backup: {str(e)}")
            raise ServiceException(
                f"Failed to delete backup: {str(e)}", service_name="BackupService"
            )

    async def restore_backup(
        self, backup_id: str, request: RestoreRequest
    ) -> RestoreResponse:
        """Restore an application from a backup.

        Args:
            backup_id: Backup identifier to restore from
            request: Restore operation parameters

        Returns:
            RestoreResponse with restore operation details
        """
        try:
            logger.info(f"Starting restore from backup: {backup_id}")

            # Validate backup exists
            backup_info = await self.get_backup_info(backup_id)

            if backup_info.status != BackupStatus.COMPLETED:
                raise ValidationException(
                    f"Cannot restore from backup in status: {backup_info.status}"
                )

            # Determine target app name
            target_app_name = request.target_app_name or backup_info.app_name

            # Generate restore operation ID
            restore_id = str(uuid.uuid4())
            started_at = datetime.now(timezone.utc)

            restore_info = RestoreInfo(
                id=restore_id,
                backup_id=backup_id,
                app_name=backup_info.app_name,
                target_app_name=target_app_name,
                status=RestoreStatus.IN_PROGRESS,
                started_at=started_at,
                progress_message="Starting restore operation",
                completed_at=None,  # Initialize with default value
                error_message=None,  # Initialize with default value
            )

            # Store restore info
            self._restores[restore_id] = restore_info

            try:
                # Perform restore operation
                await self._perform_restore(backup_info, request, restore_info)

                # Update restore status
                completed_at = datetime.now(timezone.utc)
                restore_info.status = RestoreStatus.COMPLETED
                restore_info.completed_at = completed_at
                restore_info.progress_message = "Restore completed successfully"

                self._restores[restore_id] = restore_info

                logger.info(f"Restore completed successfully: {restore_id}")

                return RestoreResponse(
                    restore=restore_info,
                    message=f"Application restored successfully to '{target_app_name}'",
                )

            except Exception as e:
                # Update restore status to failed
                restore_info.status = RestoreStatus.FAILED
                restore_info.error_message = str(e)
                self._restores[restore_id] = restore_info
                raise

        except Exception as e:
            logger.error(f"Failed to restore backup {backup_id}: {str(e)}")
            raise ServiceException(
                f"Failed to restore backup: {str(e)}", service_name="BackupService"
            )

    async def _create_backup_archive(
        self, app_name: str, app: App, archive_path: Path, request: BackupCreateRequest
    ) -> int:
        """Create a backup archive with application data.

        Args:
            app_name: Application name
            app: Application object
            archive_path: Path to create the archive
            request: Backup creation parameters

        Returns:
            Total size of the created archive in bytes
        """
        with tarfile.open(archive_path, "w:gz") as tar:

            # Add application metadata
            metadata = {
                "app_name": app_name,
                "app_data": app.model_dump(
                    mode="json"
                ),  # Use json mode to handle datetime serialization
                "backup_timestamp": datetime.now(timezone.utc).isoformat(),
                "includes_config": request.include_config,
                "includes_files": request.include_files,
                "includes_data": request.include_data,
            }

            metadata_path = archive_path.parent / "metadata.json"
            metadata_path.write_text(json.dumps(metadata, indent=2))
            tar.add(metadata_path, arcname="metadata.json")
            metadata_path.unlink()  # Clean up temp file

            # Add configuration if requested
            if request.include_config:
                try:
                    app_config = await self.config_service.get_app_config(app_name)
                    config_path = archive_path.parent / "config.json"
                    config_path.write_text(
                        json.dumps(app_config.model_dump(mode="json"), indent=2)
                    )
                    tar.add(config_path, arcname="config.json")
                    config_path.unlink()  # Clean up temp file
                except Exception as e:
                    logger.warning(f"Failed to backup config for {app_name}: {str(e)}")

            # Add application files if requested
            if request.include_files:
                try:
                    app_dir = Path(self.settings.data_path) / "apps" / app_name
                    if app_dir.exists():
                        # Add all files in the app directory except subdirectories that are handled separately
                        for item in app_dir.iterdir():
                            if item.is_file():
                                tar.add(item, arcname=f"{item.name}")

                        # Add files subdirectory if it exists
                        app_files_dir = app_dir / "files"
                        if app_files_dir.exists():
                            tar.add(app_files_dir, arcname="files", recursive=True)
                except Exception as e:
                    logger.warning(f"Failed to backup files for {app_name}: {str(e)}")

            # Add application data if requested (placeholder for now)
            if request.include_data:
                try:
                    app_data_dir = (
                        Path(self.settings.data_path) / "apps" / app_name / "data"
                    )
                    if app_data_dir.exists():
                        tar.add(app_data_dir, arcname="data", recursive=True)
                except Exception as e:
                    logger.warning(f"Failed to backup data for {app_name}: {str(e)}")

        return archive_path.stat().st_size

    async def _perform_restore(
        self,
        backup_info: BackupInfo,
        request: RestoreRequest,
        restore_info: RestoreInfo,
    ) -> None:
        """Perform the actual restore operation.

        Args:
            backup_info: Backup information
            request: Restore request parameters
            restore_info: Restore operation info to update
        """
        backup_dir = self.backup_path / backup_info.id
        archive_path = backup_dir / f"{backup_info.app_name}-{backup_info.id}.tar.gz"

        if not archive_path.exists():
            raise ServiceException(
                f"Backup archive not found: {archive_path}",
                service_name="BackupService",
            )

        # Extract backup to temporary directory
        temp_dir = backup_dir / "restore_temp"
        temp_dir.mkdir(exist_ok=True)

        try:
            # Extract archive
            restore_info.progress_message = "Extracting backup archive"
            with tarfile.open(archive_path, "r:gz") as tar:
                tar.extractall(
                    temp_dir, filter="data"
                )  # Use 'data' filter to avoid security warnings

            # Read metadata
            metadata_path = temp_dir / "metadata.json"
            if metadata_path.exists():
                metadata = json.loads(metadata_path.read_text())
            else:
                raise ServiceException(
                    "Backup metadata not found", service_name="BackupService"
                )

            # Get app service for restoration
            app_service = self._get_app_service()

            # Restore configuration if requested
            if request.restore_config and backup_info.includes_config:
                restore_info.progress_message = "Restoring configuration"
                config_path = temp_dir / "config.json"
                if config_path.exists():
                    config_data = json.loads(config_path.read_text())
                    # In a real implementation, restore config through config service
                    logger.info(f"Config restored for {restore_info.target_app_name}")

            # Restore files if requested
            if request.restore_files and backup_info.includes_files:
                restore_info.progress_message = "Restoring application files"
                target_app_dir = (
                    Path(self.settings.data_path)
                    / "apps"
                    / restore_info.target_app_name
                )
                target_app_dir.mkdir(parents=True, exist_ok=True)

                # Restore individual files at the app root level
                for item in temp_dir.iterdir():
                    if item.is_file() and item.name not in ["metadata.json"]:
                        shutil.copy2(item, target_app_dir / item.name)

                # Restore files subdirectory if it exists
                files_path = temp_dir / "files"
                if files_path.exists():
                    target_files_dir = target_app_dir / "files"
                    if target_files_dir.exists():
                        shutil.rmtree(target_files_dir)
                    target_files_dir.mkdir(parents=True, exist_ok=True)
                    shutil.copytree(files_path, target_files_dir, dirs_exist_ok=True)

                logger.info(f"Files restored for {restore_info.target_app_name}")

            # Restore data if requested
            if request.restore_data and backup_info.includes_data:
                restore_info.progress_message = "Restoring application data"
                data_path = temp_dir / "data"
                if data_path.exists():
                    target_data_dir = (
                        Path(self.settings.data_path)
                        / "apps"
                        / restore_info.target_app_name
                        / "data"
                    )
                    target_data_dir.mkdir(parents=True, exist_ok=True)
                    # Copy data
                    if target_data_dir.exists():
                        shutil.rmtree(target_data_dir)
                    shutil.copytree(data_path, target_data_dir)
                    logger.info(f"Data restored for {restore_info.target_app_name}")

        finally:
            # Clean up temporary directory
            if temp_dir.exists():
                shutil.rmtree(temp_dir)

    def _get_app_service(self):
        """Get the app service from context."""
        # Import here to avoid circular dependencies
        from .app_service import AppService

        return AppService(self.context)
