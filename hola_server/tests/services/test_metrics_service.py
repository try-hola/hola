"""Tests for metrics service."""

import pytest
from datetime import datetime, timedelta, timezone
from typing import Optional
from pathlib import Path
import tempfile
import shutil

from hola_shared.models import MetricPoint, MetricsQueryParams, MetricRecordRequest
from hola_server.services.metrics_service import MetricsService
from hola_server.test_utils.fakes.fake_metrics_service import FakeMetricsService


class TestMetricsService:
    """Test cases for MetricsService."""

    @pytest.fixture
    def mock_context(self):
        """Create a mock server context."""
        from types import SimpleNamespace

        temp_dir = tempfile.mkdtemp()

        context = SimpleNamespace()
        context.settings = SimpleNamespace()
        context.settings.data_path = Path(temp_dir)

        yield context

        # Cleanup
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def metrics_service(self, mock_context):
        """Create a MetricsService instance."""
        service = MetricsService(mock_context)
        yield service

    def create_test_metric(
        self,
        name: str = "cpu_usage",
        value: float = 75.5,
        timestamp: Optional[datetime] = None,
    ) -> MetricRecordRequest:
        """Create a test metric request."""
        return MetricRecordRequest(
            name=name,
            value=value,
            description=f"Test metric for {name}",
            timestamp=timestamp or datetime.now(timezone.utc),
            labels={"host": "test", "env": "dev"},
        )

    @pytest.mark.asyncio
    async def test_record_metric(self, metrics_service):
        """Test recording a metric."""
        app_name = "test-app"
        metric = self.create_test_metric()

        await metrics_service.record_metric(app_name, metric)

        # Verify metric was recorded
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)
        assert len(result.metrics) == 1
        assert "cpu_usage" in result.metrics

    @pytest.mark.asyncio
    async def test_get_metrics_empty(self, metrics_service):
        """Test getting metrics when none exist."""
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics("test-app", query_params)

        assert len(result.metrics) == 0
        assert result.summary.total_metrics == 0

    @pytest.mark.asyncio
    async def test_get_metrics_with_data(self, metrics_service):
        """Test getting metrics with existing data."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        # Add metrics with different names
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 75.5, now)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 45.2, now)
        )
        await metrics_service.record_metric(
            app_name,
            self.create_test_metric("cpu_usage", 80.1, now + timedelta(minutes=1)),
        )

        # Get all metrics
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)

        assert len(result.metrics) == 2  # cpu_usage and memory_usage
        assert "cpu_usage" in result.metrics
        assert "memory_usage" in result.metrics
        assert len(result.metrics["cpu_usage"].points) == 2
        assert len(result.metrics["memory_usage"].points) == 1

    @pytest.mark.asyncio
    async def test_get_metrics_with_name_filter(self, metrics_service):
        """Test getting metrics with name filtering."""
        app_name = "test-app"

        # Add metrics with different names
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 75.5)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 45.2)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("disk_usage", 30.1)
        )

        # Filter by specific metric names
        query_params = MetricsQueryParams(metric_names=["cpu_usage", "memory_usage"])
        result = await metrics_service.get_metrics(app_name, query_params)

        assert len(result.metrics) == 2
        assert "cpu_usage" in result.metrics
        assert "memory_usage" in result.metrics
        assert "disk_usage" not in result.metrics

    @pytest.mark.asyncio
    async def test_get_metrics_with_time_filter(self, metrics_service):
        """Test getting metrics with time filtering."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        # Add metrics at different times
        await metrics_service.record_metric(
            app_name,
            self.create_test_metric("cpu_usage", 75.5, now - timedelta(hours=2)),
        )
        await metrics_service.record_metric(
            app_name,
            self.create_test_metric("cpu_usage", 80.1, now - timedelta(minutes=30)),
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 85.2, now)
        )

        # Filter by time range (last hour)
        query_params = MetricsQueryParams(
            start_time=now - timedelta(hours=1), end_time=now + timedelta(minutes=1)
        )
        result = await metrics_service.get_metrics(app_name, query_params)

        assert len(result.metrics) == 1
        assert "cpu_usage" in result.metrics
        assert len(result.metrics["cpu_usage"].points) == 2  # Only the last 2 metrics

    @pytest.mark.asyncio
    async def test_get_metrics_with_limit(self, metrics_service):
        """Test getting metrics with limit."""
        app_name = "test-app"

        # Add multiple metrics
        for i in range(10):
            await metrics_service.record_metric(
                app_name, self.create_test_metric("cpu_usage", float(i * 10))
            )

        # Limit to 5 points
        query_params = MetricsQueryParams(limit=5)
        result = await metrics_service.get_metrics(app_name, query_params)

        assert len(result.metrics) == 1
        assert "cpu_usage" in result.metrics
        assert len(result.metrics["cpu_usage"].points) <= 5

    @pytest.mark.asyncio
    async def test_get_metrics_summary(self, metrics_service):
        """Test getting metrics summary statistics."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        # Add CPU metrics
        cpu_values = [75.5, 80.1, 85.2, 70.3, 90.7]
        for i, value in enumerate(cpu_values):
            await metrics_service.record_metric(
                app_name,
                self.create_test_metric("cpu_usage", value, now - timedelta(minutes=i)),
            )

        # Add memory metrics
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 1024.0)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 2048.0)
        )

        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)

        assert result.summary.total_metrics == 2  # cpu_usage, memory_usage
        assert result.summary.total_data_points == 7  # 5 cpu + 2 memory
        assert result.summary.app_name == app_name

    @pytest.mark.asyncio
    async def test_clear_metrics_all(self, metrics_service):
        """Test clearing all metrics for an app."""
        app_name = "test-app"

        # Add some metrics
        for i in range(5):
            await metrics_service.record_metric(
                app_name, self.create_test_metric("cpu_usage", float(i * 10))
            )

        # Verify metrics exist
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)
        assert len(result.metrics) == 1
        assert len(result.metrics["cpu_usage"].points) == 5

        # Clear all metrics
        await metrics_service.clear_metrics(app_name)

        # Verify metrics are cleared
        result = await metrics_service.get_metrics(app_name, query_params)
        assert len(result.metrics) == 0
        assert result.summary.total_data_points == 0

    @pytest.mark.asyncio
    async def test_clear_metrics_by_name(self, metrics_service):
        """Test clearing metrics by name."""
        app_name = "test-app"

        # Add different metrics
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 75.5)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 45.2)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("disk_usage", 30.1)
        )

        # Clear specific metric
        await metrics_service.clear_metrics(app_name, metric_name="cpu_usage")

        # Verify only cpu_usage is cleared
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)
        assert len(result.metrics) == 2
        assert "cpu_usage" not in result.metrics
        assert "memory_usage" in result.metrics
        assert "disk_usage" in result.metrics

    @pytest.mark.asyncio
    async def test_clear_metrics_before_timestamp(self, metrics_service):
        """Test clearing metrics before a timestamp."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        # Add old and new metrics
        await metrics_service.record_metric(
            app_name,
            self.create_test_metric("cpu_usage", 75.5, now - timedelta(hours=2)),
        )
        await metrics_service.record_metric(
            app_name,
            self.create_test_metric("cpu_usage", 80.1, now - timedelta(minutes=30)),
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 85.2, now)
        )

        # Clear metrics older than 1 hour
        cutoff_time = now - timedelta(hours=1)
        await metrics_service.clear_metrics(app_name, before_timestamp=cutoff_time)

        # Verify only old metrics are cleared
        query_params = MetricsQueryParams()
        result = await metrics_service.get_metrics(app_name, query_params)
        assert len(result.metrics) == 1
        assert "cpu_usage" in result.metrics
        assert len(result.metrics["cpu_usage"].points) == 2  # Only the recent 2 metrics

    @pytest.mark.asyncio
    async def test_get_metric_names(self, metrics_service):
        """Test getting all metric names for an app."""
        app_name = "test-app"

        # Add metrics with different names
        await metrics_service.record_metric(
            app_name, self.create_test_metric("cpu_usage", 75.5)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("memory_usage", 45.2)
        )
        await metrics_service.record_metric(
            app_name, self.create_test_metric("disk_usage", 30.1)
        )

        # Get metric names
        metric_names = await metrics_service.get_metric_names(app_name)

        assert len(metric_names) == 3
        assert "cpu_usage" in metric_names
        assert "memory_usage" in metric_names
        assert "disk_usage" in metric_names


class TestFakeMetricsService:
    """Test cases for FakeMetricsService."""

    @pytest.fixture
    def fake_service(self):
        """Create a FakeMetricsService instance."""
        service = FakeMetricsService()
        yield service
        service.reset()

    def create_test_metric(
        self, name: str = "cpu_usage", value: float = 75.5
    ) -> MetricRecordRequest:
        """Create a test metric request."""
        return MetricRecordRequest(
            name=name,
            value=value,
            description=f"Test metric for {name}",
            timestamp=datetime.now(timezone.utc),
            labels={"host": "test"},
        )

    @pytest.mark.asyncio
    async def test_record_metric(self, fake_service):
        """Test fake metric recording."""
        metric = self.create_test_metric()
        await fake_service.record_metric("test-app", metric)

        assert fake_service.has_metrics("test-app")
        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "record_metric"

    @pytest.mark.asyncio
    async def test_get_metrics_with_filters(self, fake_service):
        """Test fake metric retrieval with filters."""
        # Add metrics
        await fake_service.record_metric(
            "test-app", self.create_test_metric("cpu_usage", 75.5)
        )
        await fake_service.record_metric(
            "test-app", self.create_test_metric("memory_usage", 45.2)
        )

        # Filter by metric name
        query_params = MetricsQueryParams(metric_names=["cpu_usage"])
        result = await fake_service.get_metrics("test-app", query_params)

        assert len(fake_service.method_calls) == 3  # 2 record + 1 get
        assert fake_service.method_calls[-1]["method"] == "get_metrics"

    @pytest.mark.asyncio
    async def test_get_metrics_summary(self, fake_service):
        """Test fake metrics summary."""
        # Add some metrics
        await fake_service.record_metric(
            "test-app", self.create_test_metric("cpu_usage", 75.5)
        )
        await fake_service.record_metric(
            "test-app", self.create_test_metric("memory_usage", 45.2)
        )

        query_params = MetricsQueryParams()
        result = await fake_service.get_metrics("test-app", query_params)

        # Verify method was called
        assert len(fake_service.method_calls) == 3
        assert fake_service.method_calls[-1]["method"] == "get_metrics"

    @pytest.mark.asyncio
    async def test_clear_metrics(self, fake_service):
        """Test fake metrics clearing."""
        # Add some metrics
        for i in range(3):
            await fake_service.record_metric(
                "test-app", self.create_test_metric(value=float(i * 10))
            )

        # Clear metrics
        await fake_service.clear_metrics("test-app")

        assert len(fake_service.method_calls) == 4  # 3 record + 1 clear
        assert fake_service.method_calls[-1]["method"] == "clear_metrics"

    @pytest.mark.asyncio
    async def test_get_metric_names(self, fake_service):
        """Test fake metric names retrieval."""
        # Add metrics with different names
        await fake_service.record_metric(
            "test-app", self.create_test_metric("cpu_usage", 75.5)
        )
        await fake_service.record_metric(
            "test-app", self.create_test_metric("memory_usage", 45.2)
        )

        # Get metric names
        names = await fake_service.get_metric_names("test-app")

        assert len(fake_service.method_calls) == 3
        assert fake_service.method_calls[-1]["method"] == "get_metric_names"

    @pytest.mark.asyncio
    async def test_reset(self, fake_service):
        """Test resetting fake service."""
        # Add some data
        await fake_service.record_metric("test-app", self.create_test_metric())

        fake_service.reset()
        assert len(fake_service.metrics) == 0
        assert len(fake_service.method_calls) == 0
