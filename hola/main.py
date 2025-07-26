"""Main entry point for the Hola Server FastAPI application.

This module initializes the FastAPI app, configures middleware,
and registers both API routes and web interface routes for the Hola server.
"""

import time
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from hola.models.errors import HolaException
from hola.utils.logging import get_logger
from .config.settings import get_settings
from .utils.api_logging import setup_server_logging, setup_request_logging, log_api_error
from .api import hello, apps, app_files, app_config, server, backup, logs, metrics
from .web import routes as web_routes

# Initialize logging first thing
setup_server_logging()
logger = get_logger(__name__)

# Server start timestamp for uptime calculation
SERVER_START_TIME = time.time()

app = FastAPI(
    title="Hola API",
    description="Application deployment platform with HTMX/DaisyUI web interface",
    version="1.0.0",
)

# Mount static files for web interface
static_path = Path(__file__).parent / "web" / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")

# Configure request logging
setup_request_logging(app, exclude_paths=["/health", "/static"])

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
        status_code=exc.status_code, content=exc.to_response().model_dump(mode="json")
    )


@app.get("/health", tags=["system"])
async def health_check():
    """
    Health check endpoint for monitoring and integration testing.

    Returns:
        Health status of the API server
    """
    return {"status": "ok", "uptime_seconds": time.time() - SERVER_START_TIME}


# Register web interface routes (HTMX/DaisyUI)
app.include_router(web_routes.router, tags=["web"])

# Register API routes
app.include_router(hello.router, prefix="/hello", tags=["hello"])
app.include_router(apps.router, prefix="/api/apps", tags=["applications"])
app.include_router(
    app_files.router, prefix="/api/apps/{app_name}/files", tags=["files"]
)
app.include_router(app_config.router, prefix="/api/config", tags=["configuration"])
app.include_router(server.router)  # Already has prefix in router
app.include_router(backup.router)  # Already has prefix in router
app.include_router(logs.router, tags=["logs"])
app.include_router(metrics.router, tags=["metrics"])
