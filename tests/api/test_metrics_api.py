"""Tests for metrics API endpoints."""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta

from hola.main import app
from hola.config.context import get_context, ServerContext
from hola.models.metrics import (
    MetricPoint,
    MetricSeries,
    MetricType,
    MetricUnit,
    MetricsQueryParams,
    MetricRecordRequest,
    MetricDefinition,
)
from hola.test_utils.fakes.fake_metrics_service import FakeMetricsService


class FakeServerContext(ServerContext):
    """Fake server context that returns fake services."""

    def __init__(self, fake_metrics_service):
        # Don't call super().__init__ to avoid real service initialization
        self.fake_metrics_service = fake_metrics_service

    def get_metrics_service(self):
        """Return the fake metrics service."""
        return self.fake_metrics_service


@pytest.fixture
def fake_metrics_service():
    """Fixture providing a fake metrics service."""
    return FakeMetricsService()


@pytest.fixture
def client(fake_metrics_service):
    """Test client fixture with fake metrics service injected."""
    # Create a fake context that returns our fake service
    fake_context = FakeServerContext(fake_metrics_service)

    # Override the get_context dependency
    app.dependency_overrides[get_context] = lambda: fake_context

    client = TestClient(app)
    yield client

    # Clean up dependency override
    if get_context in app.dependency_overrides:
        del app.dependency_overrides[get_context]


def test_get_metrics(client, fake_metrics_service):
    """Test GET /api/apps/{app_name}/metrics endpoint."""
    # Arrange
    app_name = "test-app"
    now = datetime.now(timezone.utc)

    # Create a test metric series
    points = []
    for i in range(10):
        point = MetricPoint(
            timestamp=now - timedelta(minutes=i * 10),
            value=50 + i * 5,
            labels={"environment": "test"},
        )
        points.append(point)

    cpu_series = MetricSeries(
        name="cpu_usage",
        type=MetricType.GAUGE,
        unit=MetricUnit.PERCENT,
        app_name=app_name,
        description="CPU usage percentage",
        points=points,
        min_value=50,
        max_value=95,
        avg_value=72.5,
        sum_value=725,
        count=10,
        start_time=points[-1].timestamp,
        end_time=points[0].timestamp,
    )

    memory_series = MetricSeries(
        name="memory_usage",
        type=MetricType.GAUGE,
        unit=MetricUnit.BYTES,
        app_name=app_name,
        description="Memory usage in bytes",
        points=points,
        min_value=50 * 1024 * 1024,
        max_value=95 * 1024 * 1024,
        avg_value=72.5 * 1024 * 1024,
        sum_value=725 * 1024 * 1024,
        count=10,
        start_time=points[-1].timestamp,
        end_time=points[0].timestamp,
    )

    # Register metrics in the fake service
    fake_metrics_service.register_metric_series(cpu_series)
    fake_metrics_service.register_metric_series(memory_series)

    # Act
    response = client.get(
        f"/api/apps/{app_name}/metrics", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert "cpu_usage" in response.json()["data"]["metrics"]
    assert "memory_usage" in response.json()["data"]["metrics"]
    assert response.json()["data"]["metrics"]["cpu_usage"]["count"] == 10
    assert response.json()["data"]["metrics"]["cpu_usage"]["unit"] == "percent"

    # Verify service was called
    assert len(fake_metrics_service.method_calls) == 1
    assert fake_metrics_service.method_calls[0]["method"] == "get_metrics"
    assert fake_metrics_service.method_calls[0]["app_name"] == app_name


def test_get_specific_metric(client, fake_metrics_service):
    """Test GET /api/apps/{app_name}/metrics/{metric_name} endpoint."""
    # Arrange
    app_name = "test-app"
    metric_name = "cpu_usage"
    now = datetime.now(timezone.utc)

    # Create a test metric series
    points = []
    for i in range(10):
        point = MetricPoint(
            timestamp=now - timedelta(minutes=i * 10),
            value=50 + i * 5,
            labels={"environment": "test"},
        )
        points.append(point)

    cpu_series = MetricSeries(
        name=metric_name,
        type=MetricType.GAUGE,
        unit=MetricUnit.PERCENT,
        app_name=app_name,
        description="CPU usage percentage",
        points=points,
        min_value=50,
        max_value=95,
        avg_value=72.5,
        sum_value=725,
        count=10,
        start_time=points[-1].timestamp,
        end_time=points[0].timestamp,
    )

    # Register metrics in the fake service
    fake_metrics_service.register_metric_series(cpu_series)

    # Act
    response = client.get(
        f"/api/apps/{app_name}/metrics/{metric_name}", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["name"] == metric_name
    assert response.json()["data"]["type"] == "gauge"
    assert response.json()["data"]["unit"] == "percent"
    assert len(response.json()["data"]["points"]) == 10

    # Verify service was called
    assert (
        len(fake_metrics_service.method_calls) == 2
    )  # get_metric_series calls get_metrics internally
    assert fake_metrics_service.method_calls[0]["method"] == "get_metric_series"
    assert fake_metrics_service.method_calls[0]["app_name"] == app_name
    assert fake_metrics_service.method_calls[0]["metric_name"] == metric_name


@pytest.mark.asyncio
async def test_get_metrics_summary(client, fake_metrics_service):
    """Test GET /api/apps/{app_name}/metrics/summary endpoint."""
    # Arrange
    app_name = "test-app"
    now = datetime.now(timezone.utc)

    # Generate test metrics using the fake service helper method
    await fake_metrics_service.generate_test_metrics(
        app_name, metric_count=5, points_per_metric=20
    )

    # Act
    response = client.get(
        f"/api/apps/{app_name}/metrics/summary", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True
    assert response.json()["data"]["app_name"] == app_name
    assert response.json()["data"]["metric_count"] == 5
    assert response.json()["data"]["data_point_count"] == 5 * 20

    # Verify service was called
    assert (
        len(fake_metrics_service.method_calls) == 2
    )  # 1 for generate_test_metrics, 1 for get_summary_metrics
    assert fake_metrics_service.method_calls[1]["method"] == "get_summary_metrics"
    assert fake_metrics_service.method_calls[1]["app_name"] == app_name


def test_record_metric(client, fake_metrics_service):
    """Test POST /api/apps/{app_name}/metrics/{metric_name} endpoint."""
    # Arrange
    app_name = "test-app"
    metric_name = "response_time"

    metric_request = {
        "value": 157.5,
        "type": "histogram",
        "unit": "milliseconds",
        "description": "API response time",
        "labels": {"endpoint": "/api/resource", "method": "GET"},
    }

    # Act
    response = client.post(
        f"/api/apps/{app_name}/metrics/{metric_name}",
        json=metric_request,
        headers={"X-API-Key": "test-key"},
    )

    # Assert
    assert response.status_code == 201
    assert response.json()["success"] == True

    # Verify service was called
    assert len(fake_metrics_service.method_calls) == 1
    assert fake_metrics_service.method_calls[0]["method"] == "record_metric"
    assert fake_metrics_service.method_calls[0]["app_name"] == app_name
    assert fake_metrics_service.method_calls[0]["request"].name == metric_name
    assert fake_metrics_service.method_calls[0]["request"].value == 157.5
    assert fake_metrics_service.method_calls[0]["request"].type == MetricType.HISTOGRAM


@pytest.mark.asyncio
async def test_clear_metrics(client, fake_metrics_service):
    """Test DELETE /api/apps/{app_name}/metrics endpoint."""
    # Arrange
    app_name = "test-app"

    # Generate test metrics
    await fake_metrics_service.generate_test_metrics(
        app_name, metric_count=5, points_per_metric=20
    )

    clear_request = {
        "older_than": (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    }

    # Act - Use request method for DELETE with body
    response = client.request(
        "DELETE",
        f"/api/apps/{app_name}/metrics",
        json=clear_request,
        headers={"X-API-Key": "test-key"},
    )

    # Assert
    assert response.status_code == 200
    assert response.json()["success"] == True

    # Verify service was called
    assert (
        len(fake_metrics_service.method_calls) == 2
    )  # 1 for generate_test_metrics, 1 for clear_metrics
    assert fake_metrics_service.method_calls[1]["method"] == "clear_metrics"


def test_metrics_error_handling(client, fake_metrics_service):
    """Test error handling in metrics API."""
    # Arrange
    app_name = "test-app"
    fake_metrics_service.set_failure_mode("get_metrics")

    # Act
    response = client.get(
        f"/api/apps/{app_name}/metrics", headers={"X-API-Key": "test-key"}
    )

    # Assert
    assert response.status_code == 500
    error_message = response.json().get("error", {}).get("message", "")
    # Accept either the simulated failure message or generic error message
    assert "failure" in error_message.lower() or "error" in error_message.lower()
