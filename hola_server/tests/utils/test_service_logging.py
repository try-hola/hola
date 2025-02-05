"""
Tests for service-specific logging utilities.
"""

import time
import uuid
from typing import Any, Dict

import pytest
from hola_shared.test_utils.fakes.logging import FakeLogger
from hola_server.utils.service_logging import (
    log_service_operation_start,
    log_service_operation_end,
    log_service_error,
    log_service_warning,
)


def test_log_service_operation_start():
    """Test service operation start logging."""
    logger = FakeLogger("test.service")
    context_id = str(uuid.uuid4())
    params = {
        "param1": "value1",
        "param2": 42,
        "api_key": "secret",  # Should be filtered
        "password": "secret",  # Should be filtered
    }

    # Call the function and verify returned start time
    start_time = log_service_operation_start(
        logger, "test_operation", context_id, **params
    )
    assert isinstance(start_time, float)
    assert start_time <= time.time()

    # Verify logged message
    assert len(logger.messages) == 1
    debug_messages = logger.get_messages("DEBUG")
    assert len(debug_messages) == 1

    # Check message contains required information
    message = debug_messages[0].message
    assert "test_operation" in message
    assert context_id in message
    assert "value1" in message  # Regular param included
    assert "42" in message  # Regular param included
    assert "secret" not in message  # Sensitive params filtered
    assert "api_key" not in message  # Sensitive params filtered
    assert "password" not in message  # Sensitive params filtered


def test_log_service_operation_end():
    """Test service operation end logging."""
    logger = FakeLogger("test.service")
    context_id = str(uuid.uuid4())
    start_time = time.time() - 0.5  # Simulate 500ms operation

    # Test with different result types
    test_cases = [
        ({"key": "value"}, "Returned 1 items"),
        (["item1", "item2"], "Returned 2 items"),
        ("simple result", "Response size: 13"),
        (None, ""),  # No result info for None
    ]

    for result, expected_info in test_cases:
        logger.reset()
        log_service_operation_end(
            logger, "test_operation", start_time, context_id, result
        )

        assert len(logger.messages) == 1
        debug_messages = logger.get_messages("DEBUG")
        assert len(debug_messages) == 1

        message = debug_messages[0].message
        assert "test_operation" in message
        assert context_id in message
        assert "Duration:" in message
        assert "ms" in message
        if expected_info:
            assert expected_info in message


def test_log_service_error():
    """Test service error logging."""
    logger = FakeLogger("test.service")
    context_id = str(uuid.uuid4())
    error = ValueError("Test error")
    context = {
        "param1": "value1",
        "api_token": "secret",  # Should be filtered
        "credentials": "secret",  # Should be filtered
    }

    log_service_error(logger, "test_operation", error, context_id, **context)

    assert len(logger.messages) == 1
    error_messages = logger.get_messages("ERROR")
    assert len(error_messages) == 1

    message = error_messages[0].message
    assert "test_operation" in message
    assert context_id in message
    assert "Test error" in message
    assert "value1" in message  # Regular param included
    assert "secret" not in message  # Sensitive params filtered
    assert "api_token" not in message  # Sensitive param filtered
    assert "credentials" not in message  # Sensitive param filtered

    # Verify exception info was included
    assert error_messages[0].kwargs.get("exc_info") is True


def test_log_service_warning():
    """Test service warning logging."""
    logger = FakeLogger("test.service")
    context_id = str(uuid.uuid4())
    warning_message = "Resource nearly exhausted"
    context = {
        "usage": 95,
        "limit": 100,
        "secret_key": "secret",  # Should be filtered
    }

    log_service_warning(
        logger, "test_operation", warning_message, context_id, **context
    )

    assert len(logger.messages) == 1
    warning_messages = logger.get_messages("WARNING")
    assert len(warning_messages) == 1

    message = warning_messages[0].message
    assert "test_operation" in message
    assert context_id in message
    assert warning_message in message
    assert "95" in message  # Regular param included
    assert "100" in message  # Regular param included
    assert "secret" not in message  # Sensitive param filtered


def test_log_service_operations_without_context_id():
    """Test logging functions work correctly without context_id."""
    logger = FakeLogger("test.service")

    # Test start logging
    start_time = log_service_operation_start(logger, "test_operation", param="value")
    assert "context_id" not in logger.messages[0].message

    logger.reset()

    # Test end logging
    log_service_operation_end(logger, "test_operation", start_time)
    assert "context_id" not in logger.messages[0].message

    logger.reset()

    # Test error logging
    log_service_error(logger, "test_operation", ValueError("Test error"))
    assert "context_id" not in logger.messages[0].message

    logger.reset()

    # Test warning logging
    log_service_warning(logger, "test_operation", "Warning message")
    assert "context_id" not in logger.messages[0].message
