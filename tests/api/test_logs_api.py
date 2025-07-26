"""Tests for logs API endpoints."""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta
import uuid

from hola.main import app
from hola.config.context import get_context, ServerContext
from hola.shared.models.logs import (
    LogEntry,
    LogLevel,
    LogSource,
    LogQueryParams,
    LogResponse,
    LogSummary,
    LogCreateRequest,
    LogClearRequest,
    LogClearResponse,
)
from hola.test_utils.fakes.fake_log_service import FakeLogService


class FakeServerContext(ServerContext):
    """Fake server context that returns fake services."""

    def __init__(self, fake_log_service):
        # Don't call super().__init__ to avoid real service initialization
        self.fake_log_service = fake_log_service

    def get_log_service(self):
        """Return the fake log service."""
        return self.fake_log_service


@pytest.fixture
def fake_log_service():
    """Fixture providing a fake log service."""
    return FakeLogService()


@pytest.fixture
def client(fake_log_service):
    """Test client fixture with fake log service injected."""
    # Create a fake context that returns our fake service
    fake_context = FakeServerContext(fake_log_service)

    # Override the get_context dependency
    app.dependency_overrides[get_context] = lambda: fake_context

    client = TestClient(app)
    yield client

    # Clean up dependency override
    if get_context in app.dependency_overrides:
        del app.dependency_overrides[get_context]


def test_get_logs(client, fake_log_service):
    """Test GET /api/apps/{app_name}/logs endpoint."""
    # Arrange
    app_name = "test-app"
    now = datetime.now(timezone.utc)

    # Generate some test logs
    log1 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now - timedelta(minutes=5),
        level=LogLevel.INFO,
        source=LogSource.APPLICATION,
        app_name=app_name,
        message="Application started successfully",
        context={"pid": 1234},
    )

    log2 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now - timedelta(minutes=3),
        level=LogLevel.WARNING,
        source=LogSource.SYSTEM,
        app_name=app_name,
        message="High memory usage detected",
        context={"memory_used": "85%"},
    )

    log3 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now - timedelta(minutes=1),
        level=LogLevel.ERROR,
        source=LogSource.APPLICATION,
        app_name=app_name,
        message="Database connection failed",
        context={"error": "Connection timeout"},
        exception_type="ConnectionError",
        exception_message="Connection timeout after 30s",
    )

    # Register logs in the fake service
    fake_log_service.register_log(log1)
    fake_log_service.register_log(log2)
    fake_log_service.register_log(log3)

    # Act
    response = client.get(
        f"/api/apps/{app_name}/logs?limit=10", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["total_count"] == 3
    assert len(response.json()["data"]["entries"]) == 3

    # Verify service was called
    assert len(fake_log_service.method_calls) == 1
    assert fake_log_service.method_calls[0]["method"] == "get_logs"


def test_get_logs_with_filters(client, fake_log_service):
    """Test GET /api/apps/{app_name}/logs with filters."""
    # Arrange
    app_name = "test-app"
    now = datetime.now(timezone.utc)

    # Generate test logs with different levels
    log1 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now - timedelta(hours=2),
        level=LogLevel.INFO,
        source=LogSource.APPLICATION,
        app_name=app_name,
        message="Application started successfully",
        context={"pid": 1234},
    )

    log2 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now - timedelta(hours=1),
        level=LogLevel.WARNING,
        source=LogSource.SYSTEM,
        app_name=app_name,
        message="High memory usage detected",
        context={"memory_used": "85%"},
    )

    log3 = LogEntry(
        id=str(uuid.uuid4()),
        timestamp=now,
        level=LogLevel.ERROR,
        source=LogSource.APPLICATION,
        app_name=app_name,
        message="Database connection failed",
        context={"error": "Connection timeout"},
        exception_type="ConnectionError",
        exception_message="Connection timeout after 30s",
    )

    # Register logs in the fake service
    fake_log_service.register_log(log1)
    fake_log_service.register_log(log2)
    fake_log_service.register_log(log3)

    # Act - filter by level
    response = client.get(
        f"/api/apps/{app_name}/logs?level=error", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["total_count"] == 1
    assert response.json()["data"]["entries"][0]["level"] == "error"
    assert (
        response.json()["data"]["entries"][0]["message"] == "Database connection failed"
    )

    # Act - filter by source
    response = client.get(
        f"/api/apps/{app_name}/logs?source=system", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["total_count"] == 1
    assert response.json()["data"]["entries"][0]["source"] == "system"
    assert (
        response.json()["data"]["entries"][0]["message"] == "High memory usage detected"
    )


def test_add_log_entry(client, fake_log_service):
    """Test POST /api/apps/{app_name}/logs endpoint."""
    # Arrange
    app_name = "test-app"
    log_request = {
        "level": "info",
        "source": "application",
        "message": "Test log message",
        "context": {"test": "value"},
    }

    # Act
    response = client.post(
        f"/api/apps/{app_name}/logs",
        json=log_request,
        headers={"X-API-Key": "test-key"},
    )

    # Assert
    assert response.status_code == 204

    # Verify service was called
    assert len(fake_log_service.method_calls) == 1
    assert fake_log_service.method_calls[0]["method"] == "add_log_entry"
    assert fake_log_service.method_calls[0]["app_name"] == app_name
    assert fake_log_service.method_calls[0]["entry"].message == "Test log message"


def test_clear_logs(client, fake_log_service):
    """Test DELETE /api/apps/{app_name}/logs endpoint."""
    # Arrange
    app_name = "test-app"

    # Generate some test logs
    now = datetime.now(timezone.utc)
    for i in range(5):
        log = LogEntry(
            id=str(uuid.uuid4()),
            timestamp=now - timedelta(hours=i),
            level=LogLevel.INFO,
            source=LogSource.APPLICATION,
            app_name=app_name,
            message=f"Test log {i}",
            context={},
        )
        fake_log_service.register_log(log)

    # Act
    response = client.delete(
        f"/api/apps/{app_name}/logs", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["cleared_count"] == 5

    # Verify service was called
    assert len(fake_log_service.method_calls) == 1
    assert fake_log_service.method_calls[0]["method"] == "clear_logs"


def test_logs_error_handling(client, fake_log_service):
    """Test error handling in logs API."""
    # Arrange
    app_name = "test-app"
    fake_log_service.set_failure_mode("get_logs")

    # Act
    response = client.get(
        f"/api/apps/{app_name}/logs", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 500
    error_message = response.json().get("error", {}).get("message", "")
    # Accept either the simulated failure message or generic error message
    assert "failure" in error_message.lower() or "error" in error_message.lower()
