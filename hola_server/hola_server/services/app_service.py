"""Application management service.

This module provides business logic for managing applications including
deployment, lifecycle management, and status monitoring.

Attributes:
    context (ServerContext): Server context containing settings and dependencies.
    settings (Settings): Application settings.
    file_storage (FileStorage): Service for managing application files.
    _apps (Dict[str, App]): In-memory registry of applications.
    _deployment_counter (int): Counter for tracking deployments.
"""

from typing import List, Dict, Any, Optional, BinaryIO
from datetime import datetime, timezone
from fastapi import UploadFile
from hola_shared.models.app import (
    App,
    AppStatus,
    AppHealth,
    AppCreateRequest,
    AppCreateResponse,
    AppDeployRequest,
    AppUpgradeRequest,
    AppActionResponse,
    AppDeployResponse,
    AppListResponse,
)
from hola_shared.models.file import FileInfo, FileListResponse
from hola_shared.models.config import (
    ConfigCreateRequest,
    ConfigUpdateRequest,
    ConfigResponse,
    ConfigListResponse,
    ConfigEntryResponse,
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext

logger = get_logger(__name__)


class AppService:
    """Service for managing applications.

    Provides business logic for application deployment, lifecycle management,
    and status monitoring. Handles validation, error handling, and coordination
    with container runtime providers.

    Attributes:
        context (ServerContext): Server context containing settings and dependencies.
        settings (Settings): Application settings.
        file_storage (FileStorage): Service for managing application files.
        _apps (Dict[str, App]): In-memory registry of applications.
        _deployment_counter (int): Counter for tracking deployments.
    """

    def __init__(self, context: ServerContext):
        """Initialize the app service.

        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.settings = context.settings

        self.file_storage = context.get_file_storage()  # Initialize file storage
        self._apps: Dict[str, App] = {}
        self._deployment_counter = 1

        logger.debug("AppService initialized")

    def _get_config_service(self):
        """Get the configuration service from context.

        Returns:
            ConfigService instance
        """
        return self.context.get_config_service()

    async def create_app(self, request: AppCreateRequest) -> AppCreateResponse:
        """Create a new application without deploying it.

        Args:
            request: Application creation configuration

        Returns:
            Creation response with app details

        Raises:
            ValidationException: If the app name already exists or request is invalid
        """
        logger.info(f"Creating app '{request.name}'")

        # Validate app doesn't already exist
        if request.name in self._apps:
            raise ValidationException(
                message=f"Application '{request.name}' already exists",
                details={"app_name": request.name},
            )

        # Create the app instance in CREATED state
        now = datetime.now(timezone.utc)
        app = App(
            name=request.name,
            status=AppStatus.CREATED,  # New status for created but not deployed
            health=AppHealth.UNKNOWN,
            image=request.image,
            port=request.port,
            environment=request.environment,
            description=request.description,
            version=request.version,
            created_at=now,
            updated_at=now,
            url=None,  # No URL until deployed
            backup_count=0,
            files_count=0,
            files_total_size_bytes=0,
        )

        # Store the app
        self._apps[request.name] = app

        logger.info(f"Successfully created app '{request.name}'")

        return AppCreateResponse(
            app=app,
            message=f"Application '{request.name}' created successfully. Use 'deploy' to start it.",
        )

    async def deploy_app(self, request: AppDeployRequest) -> AppDeployResponse:
        """Deploy an application.

        Can deploy a new application directly or deploy an existing created application.

        Args:
            request: Application deployment configuration

        Returns:
            Deployment response with app details and deployment ID

        Raises:
            ValidationException: If the app is invalid or already deployed
            ServiceException: If deployment fails
        """
        logger.info(f"Starting deployment of app '{request.name}'")

        # Check if app already exists
        existing_app = self._apps.get(request.name)

        if existing_app:
            # If app exists and is already deployed, reject
            if existing_app.status not in [
                AppStatus.CREATED,
                AppStatus.STOPPED,
                AppStatus.ERROR,
            ]:
                raise ValidationException(
                    message=f"Application '{request.name}' is already deployed with status '{existing_app.status}'",
                    details={
                        "app_name": request.name,
                        "current_status": existing_app.status,
                    },
                )

            # Update existing app with new deployment configuration
            app = existing_app
            app.image = request.image
            if request.port:
                app.port = request.port
            if request.environment:
                app.environment.update(request.environment)
            if request.description:
                app.description = request.description
            if request.version:
                app.version = request.version
        else:
            # Create new app instance
            now = datetime.now(timezone.utc)
            app = App(
                name=request.name,
                status=AppStatus.CREATED,
                health=AppHealth.UNKNOWN,
                image=request.image,
                port=request.port,
                environment=request.environment,
                description=request.description,
                version=request.version,
                created_at=now,
                updated_at=now,
                url=None,  # No URL until deployed
                backup_count=0,
                files_count=0,
                files_total_size_bytes=0,
            )

        # Create deployment ID
        deployment_id = f"deploy-{self._deployment_counter:06d}"
        self._deployment_counter += 1

        # Store the app
        self._apps[request.name] = app

        # Simulate deployment process (in real implementation, this would interact with container runtime)
        try:
            # Mark as deploying
            app.status = AppStatus.DEPLOYING
            app.updated_at = datetime.now(timezone.utc)

            # Here we would actually deploy to the container runtime
            # For now, just simulate by updating status
            app.status = AppStatus.RUNNING
            app.health = AppHealth.HEALTHY
            app.url = f"http://localhost:{request.port}" if request.port else None
            app.updated_at = datetime.now(timezone.utc)

            logger.info(
                f"Successfully deployed app '{request.name}' with deployment ID '{deployment_id}'"
            )

            return AppDeployResponse(
                app=app, deployment_id=deployment_id, estimated_duration=30  # seconds
            )

        except Exception as e:
            # Mark deployment as failed
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.error(f"Failed to deploy app '{request.name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to deploy application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": request.name, "deployment_id": deployment_id},
            )

            logger.error(f"Failed to deploy app '{request.name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to deploy application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": request.name, "deployment_id": deployment_id},
            )

    async def list_apps(self) -> AppListResponse:
        """List all deployed applications.

        Returns:
            Response containing list of applications and total count
        """
        apps = list(self._apps.values())
        logger.debug(f"Listing {len(apps)} applications")
        return AppListResponse(apps=apps, total_count=len(apps))

    async def get_app(self, app_name: str) -> App:
        """Get details about a specific application.

        Args:
            app_name: Name of the application to retrieve

        Returns:
            Application details

        Raises:
            NotFoundException: If the application doesn't exist
        """
        logger.debug(f"Getting details for app '{app_name}'")

        if app_name not in self._apps:
            raise NotFoundException(resource_type="application", resource_id=app_name)

        return self._apps[app_name]

    async def upgrade_app(
        self, app_name: str, request: AppUpgradeRequest
    ) -> AppDeployResponse:
        """Upgrade an existing application.

        Args:
            app_name: Name of the application to upgrade
            request: Upgrade configuration

        Returns:
            Deployment response with upgrade details

        Raises:
            NotFoundException: If the application doesn't exist
            ServiceException: If upgrade fails
        """
        logger.info(f"Starting upgrade of app '{app_name}'")

        app = await self.get_app(app_name)

        # Create deployment ID for upgrade
        deployment_id = f"upgrade-{self._deployment_counter:06d}"
        self._deployment_counter += 1

        try:
            # Mark as upgrading
            app.status = AppStatus.UPGRADING
            app.updated_at = datetime.now(timezone.utc)

            # Create backup if requested
            if request.backup_before_upgrade:
                # In real implementation, create backup here
                app.backup_count = (app.backup_count or 0) + 1
                logger.debug(f"Created backup for app '{app_name}' before upgrade")

            # Apply updates
            if request.image:
                app.image = request.image
            if request.environment:
                app.environment.update(request.environment)
            if request.version:
                app.version = request.version

            # Simulate upgrade process
            app.status = AppStatus.RUNNING
            app.health = AppHealth.HEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.info(
                f"Successfully upgraded app '{app_name}' with deployment ID '{deployment_id}'"
            )

            return AppDeployResponse(
                app=app,
                deployment_id=deployment_id,
                estimated_duration=45,  # seconds for upgrade
            )

        except Exception as e:
            # Mark upgrade as failed
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.error(f"Failed to upgrade app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to upgrade application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name, "deployment_id": deployment_id},
            )

    async def delete_app(self, app_name: str) -> AppActionResponse:
        """Remove a deployed application.

        Args:
            app_name: Name of the application to remove

        Returns:
            Action response confirming deletion

        Raises:
            NotFoundException: If the application doesn't exist
            ServiceException: If deletion fails
        """
        logger.info(f"Deleting app '{app_name}'")

        app = await self.get_app(app_name)
        previous_status = app.status

        try:
            # In real implementation, this would stop and remove the container
            del self._apps[app_name]

            # Clean up app configuration
            try:
                config_service = self._get_config_service()
                await config_service.delete_app_config(app_name)
                logger.debug(f"Cleaned up configuration for deleted app '{app_name}'")
            except Exception as config_error:
                logger.warning(
                    f"Failed to clean up configuration for app '{app_name}': {config_error}"
                )
                # Don't fail the app deletion if config cleanup fails

            logger.info(f"Successfully deleted app '{app_name}'")

            return AppActionResponse(
                success=True,
                message=f"Application '{app_name}' deleted successfully",
                previous_status=previous_status,
                new_status=AppStatus.UNKNOWN,  # App no longer exists
            )

        except Exception as e:
            logger.error(f"Failed to delete app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to delete application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name},
            )

    async def start_app(self, app_name: str) -> AppActionResponse:
        """Start an application.

        Args:
            app_name: Name of the application to start

        Returns:
            Action response with status change details

        Raises:
            NotFoundException: If the application doesn't exist
            ValidationException: If the application cannot be started
            ServiceException: If start operation fails
        """
        logger.info(f"Starting app '{app_name}'")

        app = await self.get_app(app_name)
        previous_status = app.status

        if app.status == AppStatus.RUNNING:
            raise ValidationException(
                message=f"Application '{app_name}' is already running",
                details={"app_name": app_name, "current_status": app.status},
            )

        try:
            app.status = AppStatus.STARTING
            app.updated_at = datetime.now(timezone.utc)

            # Simulate start process
            app.status = AppStatus.RUNNING
            app.health = AppHealth.HEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.info(f"Successfully started app '{app_name}'")

            return AppActionResponse(
                success=True,
                message=f"Application '{app_name}' started successfully",
                previous_status=previous_status,
                new_status=app.status,
            )

        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.error(f"Failed to start app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to start application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name},
            )

    async def stop_app(self, app_name: str) -> AppActionResponse:
        """Stop an application.

        Args:
            app_name: Name of the application to stop

        Returns:
            Action response with status change details

        Raises:
            NotFoundException: If the application doesn't exist
            ValidationException: If the application cannot be stopped
            ServiceException: If stop operation fails
        """
        logger.info(f"Stopping app '{app_name}'")

        app = await self.get_app(app_name)
        previous_status = app.status

        if app.status == AppStatus.STOPPED:
            raise ValidationException(
                message=f"Application '{app_name}' is already stopped",
                details={"app_name": app_name, "current_status": app.status},
            )

        try:
            app.status = AppStatus.STOPPING
            app.updated_at = datetime.now(timezone.utc)

            # Simulate stop process
            app.status = AppStatus.STOPPED
            app.health = AppHealth.UNKNOWN
            app.updated_at = datetime.now(timezone.utc)

            logger.info(f"Successfully stopped app '{app_name}'")

            return AppActionResponse(
                success=True,
                message=f"Application '{app_name}' stopped successfully",
                previous_status=previous_status,
                new_status=app.status,
            )

        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.error(f"Failed to stop app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to stop application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name},
            )

    async def restart_app(self, app_name: str) -> AppActionResponse:
        """Restart an application.

        Args:
            app_name: Name of the application to restart

        Returns:
            Action response with status change details

        Raises:
            NotFoundException: If the application doesn't exist
            ServiceException: If restart operation fails
        """
        logger.info(f"Restarting app '{app_name}'")

        app = await self.get_app(app_name)
        previous_status = app.status

        try:
            # Stop first if running
            if app.status == AppStatus.RUNNING:
                app.status = AppStatus.STOPPING
                app.updated_at = datetime.now(timezone.utc)

            # Then start
            app.status = AppStatus.STARTING
            app.updated_at = datetime.now(timezone.utc)

            # Simulate restart process
            app.status = AppStatus.RUNNING
            app.health = AppHealth.HEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.info(f"Successfully restarted app '{app_name}'")

            return AppActionResponse(
                success=True,
                message=f"Application '{app_name}' restarted successfully",
                previous_status=previous_status,
                new_status=app.status,
            )

        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)

            logger.error(f"Failed to restart app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to restart application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name},
            )

    async def list_app_files(self, app_name: str) -> FileListResponse:
        """List files for an application.

        Args:
            app_name: Name of the application

        Returns:
            List of file information

        Raises:
            NotFoundException: If the app doesn't exist
        """
        logger.info(f"Listing files for app '{app_name}'")

        app = await self.get_app(app_name)

        file_list = await self.file_storage.list_files(app_name)

        # Update app's file stats
        app.files_count = file_list.count
        app.files_total_size_bytes = file_list.total_size_bytes

        logger.debug(f"Found {file_list.count} files for app '{app_name}'")
        return file_list

    async def upload_app_file(
        self, app_name: str, file: UploadFile, path: Optional[str] = None
    ) -> FileInfo:
        """Upload a file for an application.

        Args:
            app_name: Name of the application
            file: File to upload
            path: Target path within app's file storage (optional)

        Returns:
            Information about the uploaded file

        Raises:
            NotFoundException: If the app doesn't exist
            ValidationException: If the file is invalid or path conflicts
        """
        logger.info(f"Uploading file for app '{app_name}': {file.filename}")

        app = await self.get_app(app_name)

        # Determine file path
        file_path = path or file.filename
        if file_path is None:
            raise ValidationException(
                message="File path must be provided if file has no filename",
                details={"app_name": app_name},
            )

        # Read file content
        content = await file.read()

        # Upload the file
        file_info = await self.file_storage.upload_file(
            app_name, file_path, content, file.content_type
        )

        # Update app stats
        files = await self.file_storage.list_files(app_name)
        app.files_count = files.count
        app.files_total_size_bytes = files.total_size_bytes

        return file_info

        # This block seems to be a leftover simulation and should be removed
        # as the actual upload logic is above it.
        # logger.info(f"Successfully uploaded file for app '{app_name}': {file_info.path}")
        # return file_info
        pass  # Placeholder if the above lines are removed and nothing else is here.

    async def get_app_file(self, app_name: str, file_path: str) -> Optional[BinaryIO]:
        """Get a file's contents.

        Args:
            app_name: Name of the application
            file_path: Path of the file to retrieve

        Returns:
            File contents as a BytesIO object, or None if not found

        Raises:
            NotFoundException: If the app or file doesn't exist
        """
        logger.info(f"Retrieving file for app '{app_name}': {file_path}")

        _ = await self.get_app(app_name)  # Ensure app exists

        file_io = await self.file_storage.get_file(app_name, file_path)

        if file_io is None:
            raise NotFoundException(
                resource_type="file",
                resource_id=file_path,
                details={
                    "app_name": app_name,
                    "message": f"File '{file_path}' not found in app '{app_name}'.",
                },
            )

        logger.debug(f"Successfully retrieved file for app '{app_name}': {file_path}")
        return file_io

    async def delete_app_file(self, app_name: str, file_path: str) -> None:
        """Delete a file.

        Args:
            app_name: Name of the application
            file_path: Path of the file to delete

        Raises:
            NotFoundException: If the app or file doesn't exist
            ServiceException: If deletion fails in storage
        """
        logger.info(f"Deleting file for app '{app_name}': {file_path}")

        app = await self.get_app(app_name)  # Ensure app exists

        # Check if file exists before attempting deletion to provide a clear NotFoundException
        # This relies on FileStorage.get_file returning None if not found.
        # Alternatively, FileStorage.delete_file could return a more specific status or raise.
        # For now, let's assume FileStorage.delete_file handles non-existence gracefully (returns False)
        # or raises its own NotFoundException if appropriate.
        # The current FileStorage.delete_file returns False if not found.

        existing_file = await self.file_storage.get_file(app_name, file_path)
        if existing_file is None:
            raise NotFoundException(
                resource_type="file",
                resource_id=file_path,
                details={
                    "app_name": app_name,
                    "message": f"File '{file_path}' not found for deletion in app '{app_name}'.",
                },
            )
        if hasattr(existing_file, "close"):  # Close the stream if it was opened
            existing_file.close()

        deleted = await self.file_storage.delete_file(app_name, file_path)

        if not deleted:
            # This case should ideally be caught by the check above,
            # but as a fallback if FileStorage.delete_file itself indicates not found.
            # However, our FileStorage.delete_file raises ServiceException on OS error,
            # and returns False if os.path.exists was false.
            # The check above with get_file should make this redundant.
            # If FileStorage.delete_file returns False because it didn't exist,
            # the NotFoundException above should have caught it.
            # If it returns False for other reasons (e.g. permission denied but not an OSError),
            # then this might be a ServiceException.
            # For now, let's assume the get_file check is sufficient for NotFound.
            logger.warning(
                f"FileStorage.delete_file returned False for '{file_path}' in app '{app_name}', but was expected to exist."
            )
            # Potentially raise ServiceException here if this state is unexpected.

        # Update app stats
        file_list_response = await self.file_storage.list_files(app_name)
        app.files_count = file_list_response.count
        app.files_total_size_bytes = file_list_response.total_size_bytes

        logger.info(
            f"Successfully processed deletion for file for app '{app_name}': {file_path}"
        )

    # --- Configuration Delegation Methods ---
    async def get_app_config(self, app_name: str) -> "ConfigResponse":
        """Get app configuration via delegation to ConfigService."""
        config_service = self._get_config_service()
        return await config_service.get_app_config(app_name)

    async def list_config_entries(self, app_name: str) -> "ConfigListResponse":
        config_service = self._get_config_service()
        return await config_service.list_config_entries(app_name)

    async def get_config_entry(self, app_name: str, key: str) -> "ConfigEntryResponse":
        config_service = self._get_config_service()
        return await config_service.get_config_entry(app_name, key)

    async def create_config_entry(
        self, app_name: str, request: "ConfigCreateRequest"
    ) -> "ConfigEntryResponse":
        config_service = self._get_config_service()
        return await config_service.create_config_entry(app_name, request)

    async def update_config_entry(
        self, app_name: str, key: str, request: "ConfigUpdateRequest"
    ) -> "ConfigEntryResponse":
        config_service = self._get_config_service()
        return await config_service.update_config_entry(app_name, key, request)

    async def delete_config_entry(self, app_name: str, key: str) -> None:
        config_service = self._get_config_service()
        return await config_service.delete_config_entry(app_name, key)

    async def delete_app_config(self, app_name: str) -> None:
        config_service = self._get_config_service()
        return await config_service.delete_app_config(app_name)
