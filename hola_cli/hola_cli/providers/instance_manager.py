"""Server instance manager.

This module provides functionality for managing server instances
across different providers from the client side.
"""
import os
import json
import logging
import uuid
from typing import Dict, List, Optional, Any
from datetime import datetime, UTC
import asyncio
from pathlib import Path
from functools import lru_cache

from hola_shared.models.providers import ServerInstanceInfo, ServerStatus
from .registry import ServerProviderRegistry
from .providers import get_provider_registry

logger = logging.getLogger(__name__)


class ServerInstanceManager:
    """Manages server instances across different providers.
    
    This class provides a persistent store for server instances and
    functionality to manage their lifecycle across different providers.
    
    The manager handles:
    1. Storing instance metadata on disk for persistence across CLI invocations
    2. Creating, starting, stopping, and removing server instances
    3. Listing instances and retrieving status information
    4. Delegating provider-specific operations to the appropriate provider
    5. Finding available ports and generating unique instance names
    """
    
    def __init__(self, data_dir: Optional[Path] = None):
        """Initialize the server instance manager.
        
        Args:
            data_dir: Directory to store instance data, defaults to ~/.hola/instances
        """
        if data_dir is None:
            home = Path.home()
            data_dir = home / ".hola" / "instances"
        
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.instances: Dict[str, ServerInstanceInfo] = {}
        self._load_instances()
        
        logger.debug(f"Initialized ServerInstanceManager with data_dir={data_dir}")
    
    def _load_instances(self) -> None:
        """Load instances from the data directory."""
        logger.debug("Loading instances from data directory")
        for file_path in self.data_dir.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    instance_data = json.load(f)
                    instance = ServerInstanceInfo.parse_obj(instance_data)
                    self.instances[instance.id] = instance
                    logger.debug(f"Loaded instance {instance.id} ({instance.name})")
            except Exception as e:
                logger.error(f"Error loading instance file {file_path}: {str(e)}")
    
    def _save_instance(self, instance: ServerInstanceInfo) -> None:
        """Save an instance to the data directory.
        
        Args:
            instance: Instance to save
        """
        file_path = self.data_dir / f"{instance.id}.json"
        try:
            with open(file_path, "w") as f:
                f.write(instance.model_dump_json(indent=2))
            logger.debug(f"Saved instance {instance.id} to {file_path}")
        except Exception as e:
            logger.error(f"Error saving instance {instance.id}: {str(e)}")
    
    def get_instance(self, instance_id: str) -> Optional[ServerInstanceInfo]:
        """Get a server instance by ID.
        
        Args:
            instance_id: ID of the instance to get
            
        Returns:
            Instance info or None if not found
        """
        return self.instances.get(instance_id)
    
    def get_instances(self) -> List[ServerInstanceInfo]:
        """Get all server instances.
        
        Returns:
            List of all server instances
        """
        return list(self.instances.values())
    
    def get_instances_by_provider(self, provider_type: str) -> List[ServerInstanceInfo]:
        """Get server instances by provider type.
        
        Args:
            provider_type: Provider type to filter by
            
        Returns:
            List of server instances for the specified provider
        """
        return [i for i in self.instances.values() if i.provider_type == provider_type]
    
    async def create_instance(
        self, provider_type: str, name: str, options: Dict[str, Any]
    ) -> ServerInstanceInfo:
        """Create a new server instance.
        
        Args:
            provider_type: Type of provider to use
            name: Name for the server instance
            options: Provider-specific options
            
        Returns:
            Info about the created instance
        
        Raises:
            RuntimeError: If the provider is not available
        """
        logger.info(f"Creating server instance {name} with provider {provider_type}")
        
        # Get the provider
        registry = get_provider_registry()
        provider = registry.get_provider(provider_type)
        
        if not provider:
            error_msg = f"Provider {provider_type} not found"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        # Check if provider is available
        if not await provider.is_available():
            error_msg = f"Provider {provider_type} is not available"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        # Set name in options
        if options is None:
            options = {}
        options["name"] = name
        
        # Bootstrap the server
        try:
            context = await provider.bootstrap(options)
            logger.info(f"Bootstrapped server {name} with provider {provider_type}")
        except Exception as e:
            error_msg = f"Failed to bootstrap server: {str(e)}"
            logger.error(error_msg)
            raise RuntimeError(error_msg) from e
        
        # Create and save the instance
        instance_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()
        
        instance = ServerInstanceInfo(
            id=instance_id,
            name=name,
            provider_type=provider_type,
            status=ServerStatus(context.get("status", ServerStatus.CREATED)),
            context=context,
            created_at=now,
        )
        
        self.instances[instance_id] = instance
        self._save_instance(instance)
        
        return instance
    
    async def refresh_instance(self, instance_id: str) -> Optional[ServerInstanceInfo]:
        """Refresh the status of a server instance.
        
        Args:
            instance_id: ID of the instance to refresh
            
        Returns:
            Updated instance info or None if not found
        """
        instance = self.get_instance(instance_id)
        if not instance:
            logger.warning(f"Instance {instance_id} not found")
            return None
        
        # Get the provider
        registry = get_provider_registry()
        provider = registry.get_provider(instance.provider_type)
        
        if not provider:
            logger.error(f"Provider {instance.provider_type} not found")
            instance.status = ServerStatus.ERROR
            instance.error = f"Provider {instance.provider_type} not found"
            self._save_instance(instance)
            return instance
        
        # Get server info
        try:
            logger.debug(f"Refreshing server info for instance {instance_id}")
            context = await provider.get_server_info(instance.context)
            
            # Update instance with latest info
            instance.context = context
            instance.status = ServerStatus(context.get("status", ServerStatus.UNKNOWN))
            if "error" in context:
                instance.error = context["error"]
            if "started_at" in context:
                instance.started_at = context["started_at"]
            
            self._save_instance(instance)
            logger.debug(f"Updated instance {instance_id} status: {instance.status}")
            
        except Exception as e:
            logger.error(f"Error refreshing instance {instance_id}: {str(e)}")
            instance.status = ServerStatus.ERROR
            instance.error = str(e)
            self._save_instance(instance)
        
        return instance
    
    async def start_instance(self, instance_id: str) -> Optional[ServerInstanceInfo]:
        """Start a server instance.
        
        Args:
            instance_id: ID of the instance to start
            
        Returns:
            Updated instance info or None if not found
        """
        instance = self.get_instance(instance_id)
        if not instance:
            logger.warning(f"Instance {instance_id} not found")
            return None
        
        # Get the provider
        registry = get_provider_registry()
        provider = registry.get_provider(instance.provider_type)
        
        if not provider:
            logger.error(f"Provider {instance.provider_type} not found")
            instance.status = ServerStatus.ERROR
            instance.error = f"Provider {instance.provider_type} not found"
            self._save_instance(instance)
            return instance
        
        # Start the server
        try:
            logger.info(f"Starting server instance {instance_id}")
            await provider.start_server(instance.context)
            
            # Update the instance status
            await asyncio.sleep(2)  # Give the server a moment to start
            return await self.refresh_instance(instance_id)
            
        except Exception as e:
            logger.error(f"Error starting instance {instance_id}: {str(e)}")
            instance.status = ServerStatus.ERROR
            instance.error = str(e)
            self._save_instance(instance)
            return instance
    
    async def stop_instance(self, instance_id: str) -> Optional[ServerInstanceInfo]:
        """Stop a server instance.
        
        Args:
            instance_id: ID of the instance to stop
            
        Returns:
            Updated instance info or None if not found
        """
        instance = self.get_instance(instance_id)
        if not instance:
            logger.warning(f"Instance {instance_id} not found")
            return None
        
        # Get the provider
        registry = get_provider_registry()
        provider = registry.get_provider(instance.provider_type)
        
        if not provider:
            logger.error(f"Provider {instance.provider_type} not found")
            instance.status = ServerStatus.ERROR
            instance.error = f"Provider {instance.provider_type} not found"
            self._save_instance(instance)
            return instance
        
        # Stop the server
        try:
            logger.info(f"Stopping server instance {instance_id}")
            await provider.stop_server(instance.context)
            
            # Update the instance status
            await asyncio.sleep(2)  # Give the server a moment to stop
            return await self.refresh_instance(instance_id)
            
        except Exception as e:
            logger.error(f"Error stopping instance {instance_id}: {str(e)}")
            instance.status = ServerStatus.ERROR
            instance.error = str(e)
            self._save_instance(instance)
            return instance
    
    def delete_instance(self, instance_id: str) -> bool:
        """Delete a server instance from the manager (not the provider).
        
        Note: This does not stop or delete the actual server, just its record.
        
        Args:
            instance_id: ID of the instance to delete
            
        Returns:
            True if the instance was deleted, False if not found
        """
        instance = self.get_instance(instance_id)
        if not instance:
            logger.warning(f"Instance {instance_id} not found")
            return False
        
        # Delete the instance file
        file_path = self.data_dir / f"{instance_id}.json"
        try:
            if file_path.exists():
                file_path.unlink()
            logger.info(f"Deleted instance file for {instance_id}")
        except Exception as e:
            logger.error(f"Error deleting instance file {file_path}: {str(e)}")
        
        # Remove from memory
        if instance_id in self.instances:
            del self.instances[instance_id]
        
        return True


@lru_cache()
def get_instance_manager() -> ServerInstanceManager:
    """Get the server instance manager singleton.
    
    Returns:
        Server instance manager
    """
    return ServerInstanceManager()
