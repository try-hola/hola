"""
Server-specific logging utilities for Hola.

This module extends the shared logging functionality with server-specific features
and provides helpers for consistent logging across API endpoints and services.
"""

import logging
import time
from typing import Any, Callable, Dict, Optional
from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp  # Import ASGIApp
from hola_shared.logger import get_logger, configure_logging
from hola_shared.errors import HolaException
from ..config.settings import get_settings

# Default log format for server
DEFAULT_LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"


def setup_server_logging() -> None:
    """
    Configure logging specifically for the server application.

    This ensures the log level from settings is applied and sets up
    appropriate logging configuration for a server environment.
    """
    settings = get_settings()
    configure_logging(settings)

    # Set level for server-specific loggers
    logging.getLogger("hola_server").setLevel(
        getattr(logging, settings.log_level.upper())
    )

    # Configure uvicorn loggers to reduce verbosity
    uvicorn_access_logger = logging.getLogger("uvicorn.access")
    uvicorn_access_logger.setLevel(logging.WARNING)

    # Configure other third-party loggers as needed
    # e.g., sqlalchemy, celery, etc.


def log_request_start(
    logger: logging.Logger, request_id: str, method: str, path: str
) -> None:
    """
    Log the start of an API request.

    Args:
        logger: Logger instance to use
        request_id: Unique identifier for this request
        method: HTTP method (GET, POST, etc.)
        path: Request path
    """
    logger.debug(f"Request {request_id} started: {method} {path}")


def log_request_end(
    logger: logging.Logger,
    request_id: str,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
) -> None:
    """
    Log the completion of an API request.

    Args:
        logger: Logger instance to use
        request_id: Unique identifier for this request
        method: HTTP method (GET, POST, etc.)
        path: Request path
        status_code: HTTP status code of the response
        duration_ms: Request duration in milliseconds
    """
    logger.debug(
        f"Request {request_id} completed: {method} {path} "
        f"- Status: {status_code} - Duration: {duration_ms:.2f}ms"
    )


def log_api_error(
    logger: logging.Logger,
    request_id: Optional[str] = None,
    method: Optional[str] = None,
    path: Optional[str] = None,
    status_code: Optional[int] = None,
    error_message: Optional[str] = None,
    exc: Optional[Exception] = None,
) -> None:
    """
    Log API errors with appropriate context.

    Args:
        logger: Logger instance to use
        request_id: Request identifier for correlation
        method: HTTP method of the request
        path: Path of the request
        status_code: HTTP status code of the response
        error_message: Error message to log
        exc: Optional HolaException object to extract details from
    """
    if exc:
        if isinstance(exc, HolaException):
            status_code = exc.status_code
            error_message = exc.message
        else:
            status_code = status_code if status_code is not None else 500
            error_message = str(exc)

    context = f" (request_id: {request_id})" if request_id else ""
    method_path = f"{method} {path}" if method and path else ""
    status_info = f" - Status: {status_code}" if status_code is not None else ""
    error_info = f" - Error: {error_message}" if error_message else ""

    if isinstance(exc, Exception) and not isinstance(exc, HolaException):
        logger.exception(f"API error{context}: {method_path}{status_info}{error_info}")
    else:
        logger.error(f"API error{context}: {method_path}{status_info}{error_info}")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware for logging API requests and responses.

    This middleware logs the start and end of each request, including
    duration and status code.
    """

    def __init__(self, app: ASGIApp, exclude_paths: Optional[list] = None) -> None:
        """
        Initialize the middleware.

        Args:
            app: The FastAPI application
            exclude_paths: List of paths to exclude from logging (e.g., health checks)
        """
        super().__init__(app)
        self.logger = get_logger("hola_server.api.requests")
        self.exclude_paths = exclude_paths or ["/health", "/metrics"]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """
        Process a request through the middleware.

        Args:
            request: The incoming HTTP request
            call_next: Function to call the next middleware or route handler

        Returns:
            The HTTP response
        """
        # Skip logging for excluded paths
        if any(request.url.path.startswith(path) for path in self.exclude_paths):
            return await call_next(request)

        # Generate a unique ID for this request
        request_id = f"{time.time():.6f}"

        # Log request start
        start_time = time.time()
        log_request_start(self.logger, request_id, request.method, request.url.path)

        # Process the request
        try:
            response = await call_next(request)

            # Calculate request duration
            duration_ms = (time.time() - start_time) * 1000

            # Log request completion
            log_request_end(
                self.logger,
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )

            return response
        except Exception as e:
            # Log unexpected errors
            duration_ms = (time.time() - start_time) * 1000
            log_api_error(
                self.logger,
                request_id,
                request.method,
                request.url.path,
                500,
                str(e),
                exc=e,
            )
            raise


def setup_request_logging(app: FastAPI, exclude_paths: Optional[list] = None) -> None:
    """
    Configure request logging for a FastAPI application.

    This adds the RequestLoggingMiddleware to the application.

    Args:
        app: The FastAPI application
        exclude_paths: Optional list of paths to exclude from logging
    """
    app.add_middleware(RequestLoggingMiddleware, exclude_paths=exclude_paths)
