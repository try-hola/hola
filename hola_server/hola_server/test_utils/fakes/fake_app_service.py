"""Fake implementation of AppService for testing.

This module provides in-memory app management with state tracking for test assertions.
It simulates operations such as app creation, deployment, and file management.

Attributes:
    apps (Dict[str, App]): A dictionary to store applications.
    method_calls (List[Dict[str, Any]]): A list to track method calls for assertions.
    deployment_counter (int): A counter for generating deployment IDs.
    should_fail_* (bool): Flags to simulate failures for various operations.
    file_storage (FakeFileStorage): An instance of FakeFileStorage for file operations.
    _config_service (FakeConfigService): An instance of FakeConfigService for configuration operations.
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
from hola_shared.errors import ValidationException, NotFoundException
from .fake_file_storage import FakeFileStorage


class FakeAppService:
    """
    Fake implementation of AppService for testing.

    This class provides in-memory app management with state tracking for test assertions.
    It simulates operations such as app creation, deployment, and file management.
    """

    def __init__(self):
        """
        Initialize the fake service.

        Attributes:
            apps (Dict[str, App]): A dictionary to store applications.
            method_calls (List[Dict[str, Any]]): A list to track method calls for assertions.
            deployment_counter (int): A counter for generating deployment IDs.
            should_fail_* (bool): Flags to simulate failures for various operations.
            file_storage (FakeFileStorage): An instance of FakeFileStorage for file operations.
            _config_service (FakeConfigService): An instance of FakeConfigService for configuration operations.
        """
        self.apps: Dict[str, App] = {}
        self.method_calls: List[Dict[str, Any]] = []
        self.deployment_counter = 1
        self.should_fail_create = False
        self.should_fail_deploy = False
        self.should_fail_upgrade = False
        self.should_fail_start = False
        self.should_fail_stop = False
        self.should_fail_restart = False
        self.should_fail_delete = False
        self.should_fail_file_upload = False
        self.should_fail_file_delete = False

        # Initialize file storage
        self.file_storage = FakeFileStorage()

        # Initialize config service
        from .fake_config_service import FakeConfigService

        self._config_service = FakeConfigService()

    async def create_app(self, request: AppCreateRequest) -> AppCreateResponse:
        """
        Create a new application without deploying it.

        Args:
            request (AppCreateRequest): The request containing app creation details.

        Returns:
            AppCreateResponse: The response containing the created app and a success message.
        """
        self.method_calls.append(
            {
                "method": "create_app",
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_create:
            raise ValidationException(
                message="Forced creation failure for testing",
                details={"app_name": request.name},
            )

        if request.name in self.apps:
            raise ValidationException(
                message=f"Application '{request.name}' already exists",
                details={"app_name": request.name},
            )

        now = datetime.now(timezone.utc)
        app = App(
            name=request.name,
            status=AppStatus.CREATED,  # Created but not deployed
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

        self.apps[request.name] = app

        return AppCreateResponse(
            app=app,
            message=f"Application '{request.name}' created successfully. Use 'deploy' to start it."
        )

    async def deploy_app(self, request: AppDeployRequest) -> AppDeployResponse:
        """
        Deploy a new application or deploy an existing created application.

        Args:
            request (AppDeployRequest): The request containing deployment details.

        Returns:
            AppDeployResponse: The response containing the deployed app and deployment details.
        """
        self.method_calls.append(
            {
                "method": "deploy_app",
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_deploy:
            raise ValidationException(
                message="Forced deployment failure for testing",
                details={"app_name": request.name},
            )

        # Check if app already exists
        existing_app = self.apps.get(request.name)
        
        if existing_app:
            # If app exists and is already deployed, reject
            if existing_app.status not in [AppStatus.CREATED, AppStatus.STOPPED, AppStatus.ERROR]:
                raise ValidationException(
                    message=f"Application '{request.name}' is already deployed with status '{existing_app.status}'",
                    details={"app_name": request.name, "current_status": existing_app.status},
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
            )
            self.apps[request.name] = app

        deployment_id = f"test-deploy-{self.deployment_counter:06d}"
        self.deployment_counter += 1

        # Deploy the app
        app.status = AppStatus.RUNNING
        app.health = AppHealth.HEALTHY
        app.updated_at = datetime.now(timezone.utc)
        app.url = f"http://localhost:{app.port}" if app.port else None

        return AppDeployResponse(
            app=app, deployment_id=deployment_id, estimated_duration=30
        )

    async def list_apps(self) -> AppListResponse:
        """
        List all applications.
        
        Returns:
            AppListResponse: The response containing a list of all applications.
        """
        self.method_calls.append(
            {"method": "list_apps", "timestamp": datetime.now(timezone.utc)}
        )

        apps = list(self.apps.values())
        return AppListResponse(apps=apps, total_count=len(apps))

    async def get_app(self, app_name: str) -> App:
        """
        Get details of a specific application.
        
        Args:
            app_name (str): The name of the application to retrieve.
            
        Returns:
            App: The application details.
            
        Raises:
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "get_app",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if app_name not in self.apps:
            raise NotFoundException(resource_type="application", resource_id=app_name)

        return self.apps[app_name]

    async def upgrade_app(
        self, app_name: str, request: AppUpgradeRequest
    ) -> AppDeployResponse:
        """
        Upgrade an existing application with new configuration.
        
        Args:
            app_name (str): The name of the application to upgrade.
            request (AppUpgradeRequest): The request containing upgrade details.
            
        Returns:
            AppDeployResponse: The response containing the upgraded app and deployment details.
            
        Raises:
            ValidationException: If the upgrade fails due to validation issues.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "upgrade_app",
                "app_name": app_name,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_upgrade:
            raise ValidationException(
                message="Forced upgrade failure for testing",
                details={"app_name": app_name},
            )

        app = await self.get_app(app_name)

        # Apply updates
        if request.image:
            app.image = request.image
        if request.environment:
            app.environment.update(request.environment)
        if request.version:
            app.version = request.version

        if request.backup_before_upgrade:
            app.backup_count = (app.backup_count or 0) + 1

        app.status = AppStatus.RUNNING
        app.health = AppHealth.HEALTHY
        app.updated_at = datetime.now(timezone.utc)

        deployment_id = f"test-upgrade-{self.deployment_counter:06d}"
        self.deployment_counter += 1

        return AppDeployResponse(
            app=app, deployment_id=deployment_id, estimated_duration=45
        )

    async def delete_app(self, app_name: str) -> AppActionResponse:
        """
        Delete an application.
        
        Args:
            app_name (str): The name of the application to delete.
            
        Returns:
            AppActionResponse: The response containing the result of the delete operation.
            
        Raises:
            ValidationException: If the deletion fails due to validation issues.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "delete_app",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_delete:
            raise ValidationException(
                message="Forced deletion failure for testing",
                details={"app_name": app_name},
            )

        app = await self.get_app(app_name)
        previous_status = app.status

        del self.apps[app_name]

        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' deleted successfully",
            previous_status=previous_status,
            new_status=AppStatus.UNKNOWN,
        )

    async def start_app(self, app_name: str) -> AppActionResponse:
        """
        Start an application.
        
        Args:
            app_name (str): The name of the application to start.
            
        Returns:
            AppActionResponse: The response containing the result of the start operation.
            
        Raises:
            ValidationException: If the start operation fails due to validation issues.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "start_app",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_start:
            raise ValidationException(
                message="Forced start failure for testing",
                details={"app_name": app_name},
            )

        app = await self.get_app(app_name)
        previous_status = app.status

        if app.status == AppStatus.RUNNING:
            raise ValidationException(
                message=f"Application '{app_name}' is already running",
                details={"app_name": app_name, "current_status": app.status},
            )

        app.status = AppStatus.RUNNING
        app.health = AppHealth.HEALTHY
        app.updated_at = datetime.now(timezone.utc)

        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' started successfully",
            previous_status=previous_status,
            new_status=app.status,
        )

    async def stop_app(self, app_name: str) -> AppActionResponse:
        """
        Stop a running application.
        
        Args:
            app_name (str): The name of the application to stop.
            
        Returns:
            AppActionResponse: The response containing the result of the stop operation.
            
        Raises:
            ValidationException: If the stop operation fails due to validation issues.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "stop_app",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_stop:
            raise ValidationException(
                message="Forced stop failure for testing",
                details={"app_name": app_name},
            )

        app = await self.get_app(app_name)
        previous_status = app.status

        if app.status == AppStatus.STOPPED:
            raise ValidationException(
                message=f"Application '{app_name}' is already stopped",
                details={"app_name": app_name, "current_status": app.status},
            )

        app.status = AppStatus.STOPPED
        app.health = AppHealth.UNKNOWN
        app.updated_at = datetime.now(timezone.utc)

        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' stopped successfully",
            previous_status=previous_status,
            new_status=app.status,
        )

    async def restart_app(self, app_name: str) -> AppActionResponse:
        """
        Restart an application.
        
        Args:
            app_name (str): The name of the application to restart.
            
        Returns:
            AppActionResponse: The response containing the result of the restart operation.
            
        Raises:
            ValidationException: If the restart operation fails due to validation issues.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "restart_app",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_restart:
            raise ValidationException(
                message="Forced restart failure for testing",
                details={"app_name": app_name},
            )

        app = await self.get_app(app_name)
        previous_status = app.status

        app.status = AppStatus.RUNNING
        app.health = AppHealth.HEALTHY
        app.updated_at = datetime.now(timezone.utc)

        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' restarted successfully",
            previous_status=previous_status,
            new_status=app.status,
        )

    async def list_app_files(self, app_name: str) -> FileListResponse:
        """
        List files for an application.

        Args:
            app_name (str): The name of the application.

        Returns:
            FileListResponse: The response containing a list of files and their details.
        """
        self.method_calls.append(
            {
                "method": "list_app_files",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        # Ensure app exists
        await self.get_app(app_name)

        file_list = await self.file_storage.list_files(app_name)

        # Update app's file stats
        app = self.apps[app_name]
        app.files_count = file_list.count
        app.files_total_size_bytes = file_list.total_size_bytes

        return file_list

    async def upload_app_file(
        self, app_name: str, file: UploadFile, path: Optional[str] = None
    ) -> FileInfo:
        """
        Upload a file for an application.

        Args:
            app_name (str): The name of the application.
            file (UploadFile): The file to upload.
            path (Optional[str]): The path to upload the file to.

        Returns:
            FileInfo: The details of the uploaded file.
        """
        self.method_calls.append(
            {
                "method": "upload_app_file",
                "app_name": app_name,
                "file_name": file.filename,
                "path": path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_file_upload:
            raise ValidationException(
                message="Forced file upload failure for testing",
                details={"app_name": app_name},
            )

        # Ensure app exists
        await self.get_app(app_name)

        # Determine file path
        file_path = path or file.filename
        if file_path is None:
            raise ValidationException(
                message="File path must be provided if file has no filename",
                details={"app_name": app_name},
            )

        # Read file content - in a real implementation we'd use file.file.read()
        # but for testing we'll simulate with a simple string
        content = f"Content for {file.filename}".encode("utf-8")

        # Upload the file
        file_info = await self.file_storage.upload_file(
            app_name, file_path, content, file.content_type
        )

        # Update app stats
        files = await self.file_storage.list_files(app_name)
        app = self.apps[app_name]
        app.files_count = files.count
        app.files_total_size_bytes = files.total_size_bytes

        return file_info

    async def get_app_file(self, app_name: str, file_path: str) -> BinaryIO:
        """
        Get the content of an application file.
        
        Args:
            app_name (str): The name of the application.
            file_path (str): The path of the file to retrieve.
            
        Returns:
            BinaryIO: The file content as a binary stream.
            
        Raises:
            NotFoundException: If the application or file does not exist.
        """
        self.method_calls.append(
            {
                "method": "get_app_file",
                "app_name": app_name,
                "file_path": file_path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        # Ensure app exists
        await self.get_app(app_name)

        file_content = await self.file_storage.get_file(app_name, file_path)
        if file_content is None:
            raise NotFoundException(
                resource_type="file",
                resource_id=file_path,
                details={"app_name": app_name},
            )

        return file_content

    async def delete_app_file(self, app_name: str, file_path: str) -> None:
        """
        Delete an application file.
        
        Args:
            app_name (str): The name of the application.
            file_path (str): The path of the file to delete.
            
        Raises:
            ValidationException: If the file deletion fails due to validation issues.
            NotFoundException: If the application or file does not exist.
        """
        self.method_calls.append(
            {
                "method": "delete_app_file",
                "app_name": app_name,
                "file_path": file_path,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self.should_fail_file_delete:
            raise ValidationException(
                message="Forced file deletion failure for testing",
                details={"app_name": app_name, "file_path": file_path},
            )

        # Ensure app exists
        await self.get_app(app_name)

        success = await self.file_storage.delete_file(app_name, file_path)
        if not success:
            raise NotFoundException(
                resource_type="file",
                resource_id=file_path,
                details={"app_name": app_name},
            )

        # Update app stats
        files = await self.file_storage.list_files(app_name)
        app = self.apps[app_name]
        app.files_count = files.count
        app.files_total_size_bytes = files.total_size_bytes

    async def get_app_config(self, app_name: str) -> ConfigResponse:
        """
        Get configuration for an application.
        
        Args:
            app_name (str): The name of the application.
            
        Returns:
            ConfigResponse: The response containing the application's configuration.
            
        Raises:
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "get_app_config",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.get_app_config(app_name)

    async def list_config_entries(self, app_name: str) -> ConfigListResponse:
        """
        List configuration entries for an application.
        
        Args:
            app_name (str): The name of the application.
            
        Returns:
            ConfigListResponse: The response containing a list of configuration entries.
            
        Raises:
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "list_config_entries",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.list_config_entries(app_name)

    async def get_config_entry(self, app_name: str, key: str) -> ConfigEntryResponse:
        """
        Get a specific configuration entry for an application.
        
        Args:
            app_name (str): The name of the application.
            key (str): The key of the configuration entry.
            
        Returns:
            ConfigEntryResponse: The response containing the configuration entry.
            
        Raises:
            ValidationException: If the app name or key is invalid.
            NotFoundException: If the application or configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "get_config_entry",
                "app_name": app_name,
                "key": key,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.get_config_entry(app_name, key)

    async def create_config_entry(
        self, app_name: str, request: ConfigCreateRequest
    ) -> ConfigEntryResponse:
        """
        Create a new configuration entry for an application.
        
        Args:
            app_name (str): The name of the application.
            request (ConfigCreateRequest): The request containing configuration entry details.
            
        Returns:
            ConfigEntryResponse: The response containing the created configuration entry.
            
        Raises:
            ValidationException: If the app name or configuration details are invalid.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "create_config_entry",
                "app_name": app_name,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.create_config_entry(app_name, request)

    async def update_config_entry(
        self, app_name: str, key: str, request: ConfigUpdateRequest
    ) -> ConfigEntryResponse:
        """
        Update an existing configuration entry for an application.
        
        Args:
            app_name (str): The name of the application.
            key (str): The key of the configuration entry to update.
            request (ConfigUpdateRequest): The request containing updated configuration details.
            
        Returns:
            ConfigEntryResponse: The response containing the updated configuration entry.
            
        Raises:
            ValidationException: If the app name, key, or updated details are invalid.
            NotFoundException: If the application or configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "update_config_entry",
                "app_name": app_name,
                "key": key,
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.update_config_entry(app_name, key, request)

    async def delete_config_entry(self, app_name: str, key: str) -> None:
        """
        Delete a configuration entry for an application.
        
        Args:
            app_name (str): The name of the application.
            key (str): The key of the configuration entry to delete.
            
        Raises:
            ValidationException: If the app name or key is invalid.
            NotFoundException: If the application or configuration entry does not exist.
        """
        self.method_calls.append(
            {
                "method": "delete_config_entry",
                "app_name": app_name,
                "key": key,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.delete_config_entry(app_name, key)

    async def delete_app_config(self, app_name: str) -> None:
        """
        Delete all configuration entries for an application.
        
        Args:
            app_name (str): The name of the application.
            
        Raises:
            ValidationException: If the app name is invalid.
            NotFoundException: If the application does not exist.
        """
        self.method_calls.append(
            {
                "method": "delete_app_config",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )
        return await self._config_service.delete_app_config(app_name)

    # Helper methods for testing
    def has_app(self, app_name: str) -> bool:
        """
        Check if an app exists.

        Args:
            app_name (str): The name of the application.

        Returns:
            bool: True if the app exists, False otherwise.
        """
        return app_name in self.apps

    def get_app_count(self) -> int:
        """
        Get the number of apps.

        Returns:
            int: The total number of apps.
        """
        return len(self.apps)

    def get_method_call_count(self, method_name: str) -> int:
        """
        Get the number of times a method was called.

        Args:
            method_name (str): The name of the method.

        Returns:
            int: The number of times the method was called.
        """
        return len(
            [call for call in self.method_calls if call["method"] == method_name]
        )

    def was_method_called_with(self, method_name: str, **kwargs) -> bool:
        """
        Check if a method was called with specific arguments.

        Args:
            method_name (str): The name of the method.
            **kwargs: The arguments to check.

        Returns:
            bool: True if the method was called with the specified arguments, False otherwise.
        """
        for call in self.method_calls:
            if call["method"] == method_name:
                matches = True
                for key, value in kwargs.items():
                    if key not in call or call[key] != value:
                        matches = False
                        break
                if matches:
                    return True
        return False

    def set_failure_mode(self, operation: str, should_fail: bool = True) -> None:
        """
        Set a failure mode for a specific operation.

        Args:
            operation (str): The name of the operation.
            should_fail (bool): Whether the operation should fail (default is True).
        """
        failure_map = {
            "create": "should_fail_create",
            "deploy": "should_fail_deploy",
            "upgrade": "should_fail_upgrade",
            "start": "should_fail_start",
            "stop": "should_fail_stop",
            "restart": "should_fail_restart",
            "delete": "should_fail_delete",
            "file_upload": "should_fail_file_upload",
            "file_delete": "should_fail_file_delete",
        }

        if operation in failure_map:
            setattr(self, failure_map[operation], should_fail)

    def reset(self) -> None:
        """
        Reset the fake service state.

        Clears all stored apps, method calls, and failure modes.
        """
        self.apps.clear()
        self.method_calls.clear()
        self.deployment_counter = 1
        self.should_fail_create = False
        self.should_fail_deploy = False
        self.should_fail_upgrade = False
        self.should_fail_start = False
        self.should_fail_stop = False
        self.should_fail_restart = False
        self.should_fail_delete = False
        self.should_fail_file_upload = False
        self.should_fail_file_delete = False
        self.file_storage.reset()
