"""
Test logging functionality for the server application.
"""
import logging
import pytest
from unittest.mock import patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from hola_server.utils.logging import (
    setup_server_logging,
    log_request_start,
    log_request_end,
    log_api_error,
    setup_request_logging,
    RequestLoggingMiddleware
)
from hola_shared.errors import HolaException
from hola_shared.test_utils.fakes.logging import FakeLogger


def test_setup_server_logging():
    """Test that setup_server_logging configures logging correctly."""
    # Create a fake settings object
    class FakeSettings:
        log_level = "DEBUG"
    
    fake_settings = FakeSettings()
    
    with patch('hola_server.utils.logging.get_settings', return_value=fake_settings):
        with patch('hola_server.utils.logging.configure_logging') as mock_configure:
            # Call the function
            setup_server_logging()
            
            # Verify configure_logging was called with our settings object
            mock_configure.assert_called_once_with(fake_settings)


def test_log_request_functions():
    """Test request logging functions."""
    # Create a fake logger
    fake_logger = FakeLogger("test.request")
    
    # Test log_request_start
    log_request_start(fake_logger, "req-123", "GET", "/api/test")  # type: ignore
    
    # Verify the message was logged
    assert len(fake_logger.messages) == 1
    assert fake_logger.has_message("req-123", "DEBUG")
    assert fake_logger.has_message("GET", "DEBUG")
    assert fake_logger.has_message("/api/test", "DEBUG")
    
    # Reset the fake logger
    fake_logger.reset()
    
    # Test log_request_end
    log_request_end(fake_logger, "req-123", "GET", "/api/test", 200, 150.5)  # type: ignore
    
    # Verify the end message was logged
    assert len(fake_logger.messages) == 1
    assert fake_logger.has_message("req-123", "DEBUG")
    assert fake_logger.has_message("200", "DEBUG")
    assert fake_logger.has_message("150.50ms", "DEBUG")


def test_log_api_error():
    """Test logging API errors."""
    # Create a fake logger
    fake_logger = FakeLogger("test.error")
    
    # Test with standard Exception
    error = ValueError("Unexpected error")
    log_api_error(fake_logger, "request-id", "GET", "/test", 500, str(error), exc=error)
    
    # Verify exception was logged with exception info
    assert len(fake_logger.messages) == 1
    error_messages = fake_logger.get_messages("ERROR")
    assert len(error_messages) == 1
    # Check that the exception method was called (exc_info=True in kwargs)
    assert error_messages[0].kwargs.get("exc_info") is True


def test_request_logging_middleware():
    """Test the request logging middleware."""
    # Create a simple FastAPI app for testing
    app = FastAPI()
    
    @app.get("/test")
    def test_endpoint():
        return {"message": "Test"}
    
    @app.get("/health")
    def health_endpoint():
        return {"status": "ok"}
    
    # Add the middleware
    setup_request_logging(app)
    
    # Create a test client
    client = TestClient(app)
    
    # Create a fake logger to use
    fake_logger = FakeLogger("test.request")
    
    with patch('hola_server.utils.logging.get_logger', return_value=fake_logger):
        # Test endpoint that should be logged
        response = client.get("/test")
        assert response.status_code == 200
        assert len(fake_logger.messages) >= 2  # Start and end logs
        
        # Reset the fake logger
        fake_logger.reset()
        
        # Test health endpoint which should be excluded
        response = client.get("/health")
        assert response.status_code == 200
        assert len(fake_logger.messages) == 0  # No logs for excluded path
