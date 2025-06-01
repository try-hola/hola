"""
Test logging functionality for the server application.
"""

import logging
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from hola_server.utils.api_logging import (
    setup_server_logging,
    log_api_error,
    setup_request_logging,
    log_request_start,
    log_request_end,
    RequestLoggingMiddleware,
)
from hola_shared.errors import HolaException
from hola_shared.test_utils.fakes.logging import FakeLogger


# Fake for settings provider
class FakeSettings:
    log_level = "DEBUG"


# Fake for logging configuration
class FakeLoggingConfigurator:
    def __init__(self):
        self.calls = []
        
    def configure_logging(self, settings):
        self.calls.append(settings)
        
    def was_called_with(self, settings):
        return settings in self.calls
        
    def reset(self):
        self.calls = []


# Fake for logging module
class FakeLoggingModule:
    def __init__(self):
        self.settings = FakeSettings()
        self.configurator = FakeLoggingConfigurator()
        self.loggers = {}
        
    def get_settings(self):
        return self.settings
        
    def configure_logging(self, settings):
        self.configurator.configure_logging(settings)
        
    def get_logger(self, name):
        if name not in self.loggers:
            self.loggers[name] = FakeLogger(name)
        return self.loggers[name]
        
    def reset(self):
        self.configurator.reset()
        self.loggers = {}


def test_setup_server_logging():
    """Test that setup_server_logging configures logging correctly."""
    # Create fake logging module
    fake_logging_module = FakeLoggingModule()
    
    # Save original functions
    original_get_settings = setup_server_logging.__globals__['get_settings']
    original_configure_logging = setup_server_logging.__globals__['configure_logging']
    
    try:
        # Replace with fakes
        setup_server_logging.__globals__['get_settings'] = fake_logging_module.get_settings
        setup_server_logging.__globals__['configure_logging'] = fake_logging_module.configure_logging
        
        # Call the function
        setup_server_logging()
        
        # Verify configure_logging was called with our settings object
        assert fake_logging_module.configurator.was_called_with(fake_logging_module.settings)
    finally:
        # Restore original functions
        setup_server_logging.__globals__['get_settings'] = original_get_settings
        setup_server_logging.__globals__['configure_logging'] = original_configure_logging


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
    log_api_error(fake_logger, "request-id", "GET", "/test", 500, str(error), exc=error) #type: ignore

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

    # Create fake logging module
    fake_logging_module = FakeLoggingModule()
    fake_logger = fake_logging_module.get_logger("test.request")
    
    # Save original function
    original_get_logger = setup_request_logging.__globals__['get_logger']
    
    try:
        # Replace with fake
        setup_request_logging.__globals__['get_logger'] = fake_logging_module.get_logger
        
        # Add the middleware
        setup_request_logging(app)

        # Create a test client
        client = TestClient(app)

















        setup_request_logging.__globals__['get_logger'] = original_get_logger        # Restore original function    finally:        assert len(fake_logger.messages) == 0  # No logs for excluded path        assert response.status_code == 200        response = client.get("/health")        # Test health endpoint which should be excluded        fake_logger.reset()        # Reset the fake logger        assert len(fake_logger.messages) >= 2  # Start and end logs        assert response.status_code == 200        response = client.get("/test")        # Test endpoint that should be logged        # Test endpoint that should be logged
        response = client.get("/test")
        assert response.status_code == 200
        assert len(fake_logger.messages) >= 2  # Start and end logs

        # Reset the fake logger
        fake_logger.reset()

        # Test health endpoint which should be excluded
        response = client.get("/health")
        assert response.status_code == 200
        assert len(fake_logger.messages) == 0  # No logs for excluded path
    finally:
        # Restore original function
        setup_request_logging.__globals__['get_logger'] = original_get_logger
