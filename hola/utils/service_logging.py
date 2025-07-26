"""
Service-specific logging utilities for Hola Server.

This module provides logging helpers specifically designed for service layer operations.
It ensures consistent logging patterns and context information across all services.
"""

import logging
import time
from typing import Any, Optional, Dict
from uuid import UUID

from hola.shared.logger import get_logger


def log_service_operation_start(
    logger: logging.Logger,
    operation_name: str,
    context_id: Optional[str | UUID] = None,
    **kwargs: Any,
) -> float:
    """
    Log the start of a service operation.

    Args:
        logger: Logger instance to use
        operation_name: Name of the service operation
        context_id: Request ID or correlation ID for tracing
        kwargs: Additional context parameters to include in log

    Returns:
        start_time: Start time in seconds for duration calculation
    """
    # Filter out None values and sensitive parameters
    sensitive_params = {"api_key", "password", "token", "credentials"}
    params = {
        k: v for k, v in kwargs.items() if v is not None and k not in sensitive_params
    }

    ctx = f" (context_id: {context_id})" if context_id else ""
    logger.debug(
        f"Service operation '{operation_name}' started{ctx}"
        + (f" with params: {params}" if params else "")
    )

    return time.time()


def log_service_operation_end(
    logger: logging.Logger,
    operation_name: str,
    start_time: float,
    context_id: Optional[str | UUID] = None,
    result: Any = None,
) -> None:
    """
    Log the successful completion of a service operation.

    Args:
        logger: Logger instance to use
        operation_name: Name of the service operation
        start_time: Operation start time from log_service_operation_start
        context_id: Request ID or correlation ID for tracing
        result: Optional operation result to include in log
    """
    duration_ms = (time.time() - start_time) * 1000
    ctx = f" (context_id: {context_id})" if context_id else ""

    # For successful operations, include basic result info if provided
    result_info = ""
    if result is not None:
        if isinstance(result, (dict, list)):
            item_count = len(result)
            result_info = f" - Returned {item_count} items"
        elif hasattr(result, "__len__"):
            result_info = f" - Response size: {len(result)}"

    logger.debug(
        f"Service operation '{operation_name}' completed{ctx}"
        f" - Duration: {duration_ms:.2f}ms{result_info}"
    )


def log_service_error(
    logger: logging.Logger,
    operation_name: str,
    error: Exception,
    context_id: Optional[str | UUID] = None,
    **kwargs: Any,
) -> None:
    """
    Log a service operation error with full context.

    Args:
        logger: Logger instance to use
        operation_name: Name of the service operation
        error: The exception that occurred
        context_id: Request ID or correlation ID for tracing
        kwargs: Additional error context to include in log
    """
    # Filter out None values and sensitive information
    context = {
        k: v
        for k, v in kwargs.items()
        if v is not None
        and not any(
            sensitive in k.lower()
            for sensitive in ["key", "pass", "token", "secret", "cred"]
        )
    }

    ctx = f" (context_id: {context_id})" if context_id else ""
    context_str = f" - Context: {context}" if context else ""

    logger.error(
        f"Service operation '{operation_name}' failed{ctx}"
        f" - Error: {str(error)}{context_str}",
        exc_info=True,
    )


def log_service_warning(
    logger: logging.Logger,
    operation_name: str,
    message: str,
    context_id: Optional[str | UUID] = None,
    **kwargs: Any,
) -> None:
    """
    Log a warning during a service operation.

    Args:
        logger: Logger instance to use
        operation_name: Name of the service operation
        message: Warning message
        context_id: Request ID or correlation ID for tracing
        kwargs: Additional context for the warning
    """
    # Filter out None values and sensitive information
    context = {
        k: v
        for k, v in kwargs.items()
        if v is not None
        and not any(
            sensitive in k.lower()
            for sensitive in ["key", "pass", "token", "secret", "cred"]
        )
    }

    ctx = f" (context_id: {context_id})" if context_id else ""
    context_str = f" - Context: {context}" if context else ""

    logger.warning(
        f"Warning in service operation '{operation_name}'{ctx}"
        f" - {message}{context_str}"
    )


# Example usage in a service:
#
# class ExampleService:
#     def __init__(self):
#         self.logger = get_logger(__name__)
#
#     async def some_operation(self, context_id: str, param: str) -> Dict:
#         start_time = log_service_operation_start(
#             self.logger,
#             "some_operation",
#             context_id,
#             param=param
#         )
#
#         try:
#             result = await self._do_work(param)
#             log_service_operation_end(
#                 self.logger,
#                 "some_operation",
#                 start_time,
#                 context_id,
#                 result
#             )
#             return result
#
#         except Exception as e:
#             log_service_error(
#                 self.logger,
#                 "some_operation",
#                 e,
#                 context_id,
#                 param=param
#             )
#             raise
