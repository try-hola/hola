"""Main entry point for the Hola Server FastAPI application.

This module initializes the FastAPI app, configures middleware,
and registers API routes for the Hola server.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

app.include_router(hello.router, prefix="/hello", tags=["hello"])