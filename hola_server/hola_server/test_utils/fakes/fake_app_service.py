"""Fake implementation of AppService for testing."""

from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from hola_shared.models.app import (
    App, AppStatus, AppHealth, AppDeployRequest, AppUpgradeRequest,
    AppActionResponse, AppDeployResponse, AppListResponse
)
from hola_shared.errors import ValidationException, NotFoundException


class FakeAppService:
    """Fake implementation of AppService for testing.
    
    Provides in-memory app management with state tracking for test assertions.
    """
    
    def __init__(self):
        """Initialize the fake service."""
        self.apps: Dict[str, App] = {}
        self.method_calls: List[Dict[str, Any]] = []
        self.deployment_counter = 1
        self.should_fail_deploy = False
        self.should_fail_upgrade = False
        self.should_fail_start = False
        self.should_fail_stop = False
        self.should_fail_restart = False
        self.should_fail_delete = False
    
    async def deploy_app(self, request: AppDeployRequest) -> AppDeployResponse:
        """Deploy a new application."""
        self.method_calls.append({
            "method": "deploy_app",
            "request": request,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_deploy:
            raise ValidationException(
                message="Forced deployment failure for testing",
                details={"app_name": request.name}
            )
        
        if request.name in self.apps:
            raise ValidationException(
                message=f"Application '{request.name}' already exists",
                details={"app_name": request.name}
            )
        
        deployment_id = f"test-deploy-{self.deployment_counter:06d}"
        self.deployment_counter += 1
        
        now = datetime.now(timezone.utc)
        app = App(
            name=request.name,
            status=AppStatus.RUNNING,
            health=AppHealth.HEALTHY,
            image=request.image,
            port=request.port,
            environment=request.environment,
            description=request.description,
            version=request.version,
            created_at=now,
            updated_at=now,
            url=f"http://localhost:{request.port}" if request.port else None
        )
        
        self.apps[request.name] = app
        
        return AppDeployResponse(
            app=app,
            deployment_id=deployment_id,
            estimated_duration=30
        )
    
    async def list_apps(self) -> AppListResponse:
        """List all deployed applications."""
        self.method_calls.append({
            "method": "list_apps",
            "timestamp": datetime.now(timezone.utc)
        })
        
        apps = list(self.apps.values())
        return AppListResponse(
            apps=apps,
            total_count=len(apps)
        )
    
    async def get_app(self, app_name: str) -> App:
        """Get details about a specific application."""
        self.method_calls.append({
            "method": "get_app",
            "app_name": app_name,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if app_name not in self.apps:
            raise NotFoundException(
                resource_type="application",
                resource_id=app_name
            )
        
        return self.apps[app_name]
    
    async def upgrade_app(self, app_name: str, request: AppUpgradeRequest) -> AppDeployResponse:
        """Upgrade an existing application."""
        self.method_calls.append({
            "method": "upgrade_app",
            "app_name": app_name,
            "request": request,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_upgrade:
            raise ValidationException(
                message="Forced upgrade failure for testing",
                details={"app_name": app_name}
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
            app=app,
            deployment_id=deployment_id,
            estimated_duration=45
        )
    
    async def delete_app(self, app_name: str) -> AppActionResponse:
        """Remove a deployed application."""
        self.method_calls.append({
            "method": "delete_app",
            "app_name": app_name,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_delete:
            raise ValidationException(
                message="Forced deletion failure for testing",
                details={"app_name": app_name}
            )
        
        app = await self.get_app(app_name)
        previous_status = app.status
        
        del self.apps[app_name]
        
        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' deleted successfully",
            previous_status=previous_status,
            new_status=AppStatus.UNKNOWN
        )
    
    async def start_app(self, app_name: str) -> AppActionResponse:
        """Start an application."""
        self.method_calls.append({
            "method": "start_app",
            "app_name": app_name,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_start:
            raise ValidationException(
                message="Forced start failure for testing",
                details={"app_name": app_name}
            )
        
        app = await self.get_app(app_name)
        previous_status = app.status
        
        if app.status == AppStatus.RUNNING:
            raise ValidationException(
                message=f"Application '{app_name}' is already running",
                details={"app_name": app_name, "current_status": app.status}
            )
        
        app.status = AppStatus.RUNNING
        app.health = AppHealth.HEALTHY
        app.updated_at = datetime.now(timezone.utc)
        
        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' started successfully",
            previous_status=previous_status,
            new_status=app.status
        )
    
    async def stop_app(self, app_name: str) -> AppActionResponse:
        """Stop an application."""
        self.method_calls.append({
            "method": "stop_app",
            "app_name": app_name,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_stop:
            raise ValidationException(
                message="Forced stop failure for testing",
                details={"app_name": app_name}
            )
        
        app = await self.get_app(app_name)
        previous_status = app.status
        
        if app.status == AppStatus.STOPPED:
            raise ValidationException(
                message=f"Application '{app_name}' is already stopped",
                details={"app_name": app_name, "current_status": app.status}
            )
        
        app.status = AppStatus.STOPPED
        app.health = AppHealth.UNKNOWN
        app.updated_at = datetime.now(timezone.utc)
        
        return AppActionResponse(
            success=True,
            message=f"Application '{app_name}' stopped successfully",
            previous_status=previous_status,
            new_status=app.status
        )
    
    async def restart_app(self, app_name: str) -> AppActionResponse:
        """Restart an application."""
        self.method_calls.append({
            "method": "restart_app",
            "app_name": app_name,
            "timestamp": datetime.now(timezone.utc)
        })
        
        if self.should_fail_restart:
            raise ValidationException(
                message="Forced restart failure for testing",
                details={"app_name": app_name}
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
            new_status=app.status
        )
    
    # Helper methods for testing
    def has_app(self, app_name: str) -> bool:
        """Check if an app exists."""
        return app_name in self.apps
    
    def get_app_count(self) -> int:
        """Get the number of apps."""
        return len(self.apps)
    
    def get_method_call_count(self, method_name: str) -> int:
        """Get the number of times a method was called."""
        return len([call for call in self.method_calls if call["method"] == method_name])
    
    def was_method_called_with(self, method_name: str, **kwargs) -> bool:
        """Check if a method was called with specific arguments."""
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
        """Set failure mode for testing error conditions."""
        failure_map = {
            "deploy": "should_fail_deploy",
            "upgrade": "should_fail_upgrade",
            "start": "should_fail_start",
            "stop": "should_fail_stop",
            "restart": "should_fail_restart",
            "delete": "should_fail_delete"
        }
        
        if operation in failure_map:
            setattr(self, failure_map[operation], should_fail)
    
    def reset(self) -> None:
        """Reset the fake service state."""
        self.apps.clear()
        self.method_calls.clear()
        self.deployment_counter = 1
        self.should_fail_deploy = False
        self.should_fail_upgrade = False
        self.should_fail_start = False
        self.should_fail_stop = False
        self.should_fail_restart = False
        self.should_fail_delete = False
