"""Hello API endpoints module.

Contains simple health check and diagnostic endpoints to verify
the API server is functioning correctly.

Endpoints:
- `hello`: Simple hello endpoint to verify API functionality.

Dependencies:
- None currently, but may include authentication in the future.
"""

import uuid
import time
from fastapi import APIRouter, Depends, Request
from hola.shared.models.response import ApiResponse
from hola.shared.logger import get_logger
from ..utils.api_logging import log_api_error

# from ..auth import get_api_key - Will be used in a later phase

router = APIRouter()
logger = get_logger(__name__)


@router.get("/", response_model=ApiResponse[str])
async def hello(
    request: Request, name: str = "World"
):  # api_key: str = Depends(get_api_key) - Will add later
    """Simple hello endpoint to verify API functionality.

    Returns a greeting message with the provided name parameter.

    Args:
        request (Request): The incoming HTTP request.
        name (str): Name to include in the greeting message. Defaults to "World".

    Returns:
        ApiResponse[str]: A successful API response with greeting message.

    Raises:
        Exception: If an unexpected error occurs.
    """
    request_id = str(uuid.uuid4())

    try:
        response = ApiResponse(success=True, data=f"Hello, {name}!")

        return response
    except Exception as e:
        log_api_error(
            logger, request_id, request.method, request.url.path, 500, str(e), exc=e
        )
        raise
