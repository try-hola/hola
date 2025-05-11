"""Hello API endpoints module.

Contains simple health check and diagnostic endpoints to verify 
the API server is functioning correctly.
"""

from fastapi import APIRouter, Depends
from hola_shared.models.response import ApiResponse
# from ..auth import get_api_key - Will be used in a later phase

router = APIRouter()

@router.get("/", response_model=ApiResponse[str])
async def hello(name: str = "World"):  # api_key: str = Depends(get_api_key) - Will add later
    """Simple hello endpoint to verify API functionality.
    
    Returns a greeting message with the provided name parameter.
    
    Args:
        name: Name to include in the greeting message. Defaults to "World".
        
    Returns:
        ApiResponse[str]: A successful API response with greeting message.
    """
    return ApiResponse(success=True, data=f"Hello, {name}!")
