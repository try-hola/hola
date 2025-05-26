"""Application management service.

This module provides business logic for managing applications including
deployment, lifecycle management, and status monitoring.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from hola_shared.models.app import (
    App, AppStatus, AppHealth, AppDeployRequest, AppUpgradeRequest,
    AppActionResponse, AppDeployResponse, AppListResponse
)
from hola_shared.errors import ValidationException, NotFoundException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext
from ..utils.logging import log_request_start, log_request_end

logger = get_logger(__name__)


class AppService:
    """Service for managing applications.
    
    Provides business logic for application deployment, lifecycle management,
    and status monitoring. Handles validation, error handling, and coordination
    with container runtime providers.
    """
    
    def __init__(self, context: ServerContext):
        """Initialize the app service.
        
        Args:
            context: Server context containing settings and dependencies
        """
        self.context = context
        self.settings = context.settings
        
        # In-memory storage for now - will be replaced with persistent storage
        self._apps: Dict[str, App] = {}
        self._deployment_counter = 1
        
        logger.debug("AppService initialized")
    
    async def deploy_app(self, request: AppDeployRequest) -> AppDeployResponse:
        """Deploy a new application.
        
        Args:
            request: Application deployment configuration
            
        Returns:
            Deployment response with app details and deployment ID
            
        Raises:
            ValidationException: If the app name already exists or request is invalid
            ServiceException: If deployment fails
        """
        logger.info(f"Starting deployment of app '{request.name}'")
        
        # Validate app doesn't already exist
        if request.name in self._apps:
            raise ValidationException(
                message=f"Application '{request.name}' already exists",
                details={"app_name": request.name}
            )
        
        # Create deployment ID
        deployment_id = f"deploy-{self._deployment_counter:06d}"
        self._deployment_counter += 1
        
        # Create the app instance
        now = datetime.now(timezone.utc)
        app = App(
            name=request.name,
            status=AppStatus.DEPLOYING,
            health=AppHealth.UNKNOWN,
            image=request.image,
            port=request.port,
            environment=request.environment,
            description=request.description,
            version=request.version,
            created_at=now,
            updated_at=now
        )
        
        # Store the app
        self._apps[request.name] = app
        
        # Simulate deployment process (in real implementation, this would interact with container runtime)
        try:
            # Here we would actually deploy to the container runtime
            # For now, just simulate by updating status
            app.status = AppStatus.RUNNING
            app.health = AppHealth.HEALTHY
            app.url = f"http://localhost:{request.port}" if request.port else None
            app.updated_at = datetime.now(timezone.utc)
            
            logger.info(f"Successfully deployed app '{request.name}' with deployment ID '{deployment_id}'")
            
            return AppDeployResponse(
                app=app,
                deployment_id=deployment_id,
                estimated_duration=30  # seconds
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
                details={"app_name": request.name, "deployment_id": deployment_id}
            )
    
    async def list_apps(self) -> AppListResponse:
        """List all deployed applications.
        
        Returns:
            Response containing list of applications and total count
        """
        apps = list(self._apps.values())
        logger.debug(f"Listing {len(apps)} applications")
        return AppListResponse(
            apps=apps,
            total_count=len(apps)
        )
    
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
            raise NotFoundException(
                resource_type="application",
                resource_id=app_name
            )
        
        return self._apps[app_name]
    
    async def upgrade_app(self, app_name: str, request: AppUpgradeRequest) -> AppDeployResponse:
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
            
            logger.info(f"Successfully upgraded app '{app_name}' with deployment ID '{deployment_id}'")
            
            return AppDeployResponse(
                app=app,
                deployment_id=deployment_id,
                estimated_duration=45  # seconds for upgrade
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
                details={"app_name": app_name, "deployment_id": deployment_id}
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
            
            logger.info(f"Successfully deleted app '{app_name}'")
            
            return AppActionResponse(
                success=True,
                message=f"Application '{app_name}' deleted successfully",
                previous_status=previous_status,
                new_status=AppStatus.UNKNOWN  # App no longer exists
            )
            
        except Exception as e:
            logger.error(f"Failed to delete app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to delete application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name}
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
                details={"app_name": app_name, "current_status": app.status}
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
                new_status=app.status
            )
            
        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)
            
            logger.error(f"Failed to start app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to start application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name}
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
                details={"app_name": app_name, "current_status": app.status}
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
                new_status=app.status
            )
            
        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)
            
            logger.error(f"Failed to stop app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to stop application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name}
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
                new_status=app.status
            )
            
        except Exception as e:
            app.status = AppStatus.ERROR
            app.health = AppHealth.UNHEALTHY
            app.updated_at = datetime.now(timezone.utc)
            
            logger.error(f"Failed to restart app '{app_name}': {str(e)}")
            raise ServiceException(
                message=f"Failed to restart application: {str(e)}",
                service_name="container_runtime",
                details={"app_name": app_name}
            )
