"""Main entry point for the Hola Server FastAPI appli    # Log the exception using our utility
    log_api_error(logger, exc=exc, method="", path="", status_code=exc.status_code, error_message=str(exc))
    
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_response().model_dump()
    )

This module initializes the FastAPI app, configures middleware,
and registers API routes for the Hola server.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hola_shared.errors import HolaException
from hola_shared.logger import get_logger
from .config.settings import get_settings
from .utils.logging import setup_server_logging, setup_request_logging, log_api_error
from .api import hello, apps, app_files, app_config, server, backup, logs, metrics

# Initialize logging first thing
setup_server_logging()
logger = get_logger(__name__)

# Server start timestamp for uptime calculation
import time
SERVER_START_TIME = time.time()

app = FastAPI(
    title="Hola API",
    description="API server for Hola application management",
    version="1.0.0"
)

# Configure request logging
setup_request_logging(app, exclude_paths=["/health"])

# Configure CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register exception handler for HolaException
@app.exception_handler(HolaException)
async def hola_exception_handler(request: Request, exc: HolaException):
    """
    Handle HolaExceptions by converting them to API responses.
    
    Args:
        request: The FastAPI request
        exc: The HolaException that was raised
        
    Returns:
        JSONResponse with the appropriate status code and error details
    """
    # Log the exception using our utility
    log_api_error(logger, exc=exc, method=request.method, path=request.url.path)
    
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_response().model_dump()
    )

@app.get("/health", tags=["system"])
async def health_check():
    """
    Health check endpoint for monitoring and integration testing.
    
    Returns:
        Health status of the API server
    """
    return {
        "status": "ok",
        "uptime_seconds": time.time() - SERVER_START_TIME
    }

app.include_router(hello.router, prefix="/hello", tags=["hello"])
app.include_router(apps.router, prefix="/api/apps", tags=["applications"])
app.include_router(
    app_files.router,
    prefix="/api/apps/{app_name}/files",
    tags=["files"]
)
app.include_router(
    app_config.router,
    prefix="/api/config",
    tags=["configuration"]
)
app.include_router(server.router)  # Already has prefix in router
app.include_router(backup.router)  # Already has prefix in router
app.include_router(logs.router, tags=["logs"])
app.include_router(metrics.router, tags=["metrics"])