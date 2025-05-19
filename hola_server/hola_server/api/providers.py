"""Provider API routes.

This module provides API endpoints for managing server providers and instances.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
import logging

from hola_shared.models.response import ApiResponse
from hola_shared.models.providers import (
    ProviderInfo,
    ProviderListResponse,
    BootstrapRequest,
    ServerContext,
    ServerRequest,
    ServerInstanceInfo,
    ServerInstanceCollection
)
from ..providers.providers import get_provider_registry, get_available_provider_types
from ..providers.instance_manager import get_instance_manager
from ..auth import get_api_key

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/providers",
    tags=["providers"],
    dependencies=[Depends(get_api_key)],
)


@router.get("/", response_model=ApiResponse[ProviderListResponse])
async def list_providers() -> ApiResponse[ProviderListResponse]:
    """
    List all available providers.
    
    Returns:
        Response containing list of available providers
    """
    logger.debug("Handling request to list providers")
    registry = get_provider_registry()
    
    providers_info = []
    for provider in registry.providers.values():
        available = await provider.is_available()
        providers_info.append(
            ProviderInfo(
                type=provider.type,
                display_name=provider.display_name,
                available=available
            )
        )
    
    return ApiResponse(
        success=True,
        data=ProviderListResponse(providers=providers_info)
    )


@router.post("/bootstrap", response_model=ApiResponse[ServerContext])
async def bootstrap_server(request: BootstrapRequest) -> ApiResponse[ServerContext]:
    """
    Bootstrap a new server instance.
    
    Args:
        request: Bootstrap request containing provider type and options
        
    Returns:
        Response containing context for the bootstrapped server
    """
    logger.info(f"Bootstrapping server with provider {request.provider_type}")
    
    registry = get_provider_registry()
    provider = registry.get_provider(request.provider_type)
    
    if not provider:
        logger.error(f"Provider {request.provider_type} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Provider {request.provider_type} not found"
        )
    
    # Check if provider is available
    if not await provider.is_available():
        logger.error(f"Provider {request.provider_type} is not available")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Provider {request.provider_type} is not available"
        )
    
    try:
        # Convert options to dict for provider
        options_dict = request.options.dict()
        
        # Bootstrap the server using the provider
        context = await provider.bootstrap(options_dict)
        
        return ApiResponse(
            success=True,
            data=ServerContext.parse_obj(context)
        )
    except Exception as e:
        logger.exception(f"Error bootstrapping server: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error bootstrapping server: {str(e)}"
        )


@router.get("/instances", response_model=ApiResponse[ServerInstanceCollection])
async def list_instances(
    provider_type: Optional[str] = None
) -> ApiResponse[ServerInstanceCollection]:
    """
    List server instances, optionally filtered by provider type.
    
    Args:
        provider_type: Optional provider type to filter by
    
    Returns:
        Response containing list of server instances
    """
    logger.debug(f"Listing server instances, provider_type={provider_type}")
    
    instance_manager = get_instance_manager()
    
    if provider_type:
        instances = instance_manager.get_instances_by_provider(provider_type)
    else:
        instances = instance_manager.get_instances()
    
    return ApiResponse(
        success=True,
        data=ServerInstanceCollection(instances=instances)
    )


@router.post("/instances", response_model=ApiResponse[ServerInstanceInfo])
async def create_instance(request: BootstrapRequest) -> ApiResponse[ServerInstanceInfo]:
    """
    Create a new server instance.
    
    Args:
        request: Bootstrap request containing provider type and options
    
    Returns:
        Response containing the created server instance
    """
    logger.info(f"Creating server instance with provider {request.provider_type}")
    
    instance_manager = get_instance_manager()
    
    try:
        # Convert options to dict for provider
        options_dict = request.options.dict()
        
        # Use name from options, or generate a name if not provided
        name = options_dict.get("name")
        if not name:
            # Generate a name based on provider type
            name = f"{request.provider_type}-server"
            options_dict["name"] = name
        
        # Create the instance
        instance = await instance_manager.create_instance(
            request.provider_type, name, options_dict
        )
        
        return ApiResponse(
            success=True,
            data=instance
        )
    except Exception as e:
        logger.exception(f"Error creating server instance: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error creating server instance: {str(e)}"
        )


@router.get("/instances/{instance_id}", response_model=ApiResponse[ServerInstanceInfo])
async def get_instance(instance_id: str) -> ApiResponse[ServerInstanceInfo]:
    """
    Get a specific server instance.
    
    Args:
        instance_id: ID of the instance to get
    
    Returns:
        Response containing the server instance
    """
    logger.debug(f"Getting server instance {instance_id}")
    
    instance_manager = get_instance_manager()
    instance = instance_manager.get_instance(instance_id)
    
    if not instance:
        logger.warning(f"Instance {instance_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance {instance_id} not found"
        )
    
    return ApiResponse(
        success=True,
        data=instance
    )


@router.post("/instances/{instance_id}/refresh", response_model=ApiResponse[ServerInstanceInfo])
async def refresh_instance(instance_id: str) -> ApiResponse[ServerInstanceInfo]:
    """
    Refresh the status of a server instance.
    
    Args:
        instance_id: ID of the instance to refresh
    
    Returns:
        Response containing the refreshed server instance
    """
    logger.debug(f"Refreshing server instance {instance_id}")
    
    instance_manager = get_instance_manager()
    instance = await instance_manager.refresh_instance(instance_id)
    
    if not instance:
        logger.warning(f"Instance {instance_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance {instance_id} not found"
        )
    
    return ApiResponse(
        success=True,
        data=instance
    )


@router.post("/instances/{instance_id}/start", response_model=ApiResponse[ServerInstanceInfo])
async def start_instance(instance_id: str) -> ApiResponse[ServerInstanceInfo]:
    """
    Start a server instance.
    
    Args:
        instance_id: ID of the instance to start
    
    Returns:
        Response containing the started server instance
    """
    logger.info(f"Starting server instance {instance_id}")
    
    instance_manager = get_instance_manager()
    instance = await instance_manager.start_instance(instance_id)
    
    if not instance:
        logger.warning(f"Instance {instance_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance {instance_id} not found"
        )
    
    return ApiResponse(
        success=True,
        data=instance
    )


@router.post("/instances/{instance_id}/stop", response_model=ApiResponse[ServerInstanceInfo])
async def stop_instance(instance_id: str) -> ApiResponse[ServerInstanceInfo]:
    """
    Stop a server instance.
    
    Args:
        instance_id: ID of the instance to stop
    
    Returns:
        Response containing the stopped server instance
    """
    logger.info(f"Stopping server instance {instance_id}")
    
    instance_manager = get_instance_manager()
    instance = await instance_manager.stop_instance(instance_id)
    
    if not instance:
        logger.warning(f"Instance {instance_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance {instance_id} not found"
        )
    
    return ApiResponse(
        success=True,
        data=instance
    )


@router.delete("/instances/{instance_id}", response_model=ApiResponse[bool])
async def delete_instance(instance_id: str) -> ApiResponse[bool]:
    """
    Delete a server instance.
    
    Args:
        instance_id: ID of the instance to delete
    
    Returns:
        Response indicating success
    """
    logger.info(f"Deleting server instance {instance_id}")
    
    instance_manager = get_instance_manager()
    success = instance_manager.delete_instance(instance_id)
    
    if not success:
        logger.warning(f"Instance {instance_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instance {instance_id} not found"
        )
    
    return ApiResponse(
        success=True,
        data=True
    )
