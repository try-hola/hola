"""
Test logging functionality for the server application.
"""
import logging
import pytest
from unittest.mock import patch, MagicMock
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


def test_setup_server_logging():
    """Test that setup_server_logging configures logging correctly."""
    # Mock the get_settings function
    mock_settings = MagicMock()
    mock_settings.log_level = "DEBUG"
    
    with patch('hola_server.utils.logging.get_settings', return_value=mock_settings):
        with patch('hola_server.utils.logging.configure_logging') as mock_configure:
            # Call the function
            setup_server_logging()
            
            # Verify configure_logging was called with our settings object
            mock_configure.assert_called_once_with(mock_settings)


def test_log_request_functions():
    """Test request logging functions."""
    # Create a mock logger
    mock_logger = MagicMock(spec=logging.Logger)
    
    # Test log_request_start
    log_request_start(mock_logger, "req-123", "GET", "/api/test")
    mock_logger.debug.assert_called_once()
    assert "req-123" in mock_logger.debug.call_args[0][0]
    assert "GET" in mock_logger.debug.call_args[0][0]
    assert "/api/test" in mock_logger.debug.call_args[0][0]
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test log_request_end
    log_request_end(mock_logger, "req-123", "GET", "/api/test", 200, 150.5)
    mock_logger.debug.assert_called_once()
    assert "req-123" in mock_logger.debug.call_args[0][0]
    assert "200" in mock_logger.debug.call_args[0][0]
    assert "150.50ms" in mock_logger.debug.call_args[0][0]


def test_log_api_error():
    """Test logging API errors."""
    # Create a mock logger
    mock_logger = MagicMock(spec=logging.Logger)
    
    # Test with HolaException
    error = HolaException(code="TEST_ERROR", message="Test error")
    log_api_error(mock_logger, error)
    mock_logger.error.assert_called_once()
    mock_logger.exception.assert_not_called()
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test with request_id
    log_api_error(mock_logger, error, "req-123")
    assert "req-123" in mock_logger.error.call_args[0][0]
    
    # Reset the mock
    mock_logger.reset_mock()
    
    # Test with standard Exception
    error = ValueError("Unexpected error")
    log_api_error(mock_logger, error)
    mock_logger.exception.assert_called_once()


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
    
    # Mock the logger
    with patch('hola_server.utils.logging.get_logger') as mock_get_logger:
        mock_logger = MagicMock()
        mock_get_logger.return_value = mock_logger
        
        # Test endpoint that should be logged
        response = client.get("/test")
        assert response.status_code == 200
        assert mock_logger.debug.call_count >= 2  # Start and end logs
        
        # Reset the mock
        mock_logger.reset_mock()
        
        # Test health endpoint which should be excluded
        response = client.get("/health")
        assert response.status_code == 200
        assert mock_logger.debug.call_count == 0  # No logs for excluded path
