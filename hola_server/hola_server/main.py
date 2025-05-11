"""Main entry point for the Hola Server FastAPI application.

This module initializes the FastAPI app, configures middleware,
and registers API routes for the Hola server.
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from hola_shared.errors import HolaException
from .config import get_settings
from .api import hello

app = FastAPI(
    title="Hola API",
    description="API server for Hola application management",
    version="1.0.0"
)

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
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_response().dict()
    )

app.include_router(hello.router, prefix="/hello", tags=["hello"])