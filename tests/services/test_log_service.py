"""Tests for log service."""

import pytest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import shutil

from hola.shared.models.logs import (
    LogEntry,
    LogQueryParams,
    LogLevel,
    LogSource,
    LogClearRequest,
    LogCreateRequest,
)
from hola.services.log_service import LogService
from hola.test_utils.fakes.fake_log_service import FakeLogService


class TestLogService:
    """Test cases for LogService."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        temp_dir = Path(tempfile.mkdtemp())
        yield temp_dir
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.fixture
    def log_service(self, mock_context, temp_dir):
        """Create a LogService instance for testing."""
        mock_context.settings.data_dir = str(temp_dir)
        return LogService(mock_context)

    @pytest.fixture
    def fake_log_service(self):
        """Create a FakeLogService instance for testing."""
        service = FakeLogService()
        yield service
        service.reset()

    def create_test_log_entry(
        self,
        level: LogLevel = LogLevel.INFO,
        message: str = "Test message",
        source: LogSource = LogSource.APPLICATION,
    ) -> LogEntry:
        """Create a test log entry."""
        return LogEntry(
            id=f"log-{datetime.now(timezone.utc).timestamp()}",
            timestamp=datetime.now(timezone.utc),
            level=level,
            message=message,
            source=source,
            app_name="test-app",
            request_id="test-req",
            session_id="test-session",
            user_id="test-user",
            module="test_module",
            function="test_function",
            line_number=1,
            exception_type=None,
            exception_message=None,
            stack_trace=None,
            context={},
        )

    @pytest.mark.asyncio
    async def test_add_log_entry(self, log_service):
        """Test adding a log entry."""
        app_name = "test-app"
        # Create a LogCreateRequest instead of LogEntry
        from hola.shared.models.logs import LogCreateRequest

        log_request = LogCreateRequest(
            level=LogLevel.INFO,
            source=LogSource.APPLICATION,
            message="Test message",
            context={},
            request_id="test-req",
            session_id="test-session",
            user_id="test-user",
            module="test_module",
            function="test_function",
            line_number=1,
        )

        await log_service.add_log_entry(app_name, log_request)

        # Verify log was added to in-memory storage
        # Filter logs to find the one we just added
        matching_logs = [log for log in log_service._logs if log.app_name == app_name]
        assert len(matching_logs) == 1

    @pytest.mark.asyncio
    async def test_get_logs_empty(self, log_service):
        """Test getting logs when none exist."""
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=None,
            source=None,
            app_name="test-app",
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
        )
        response = await log_service.get_logs(query_params)

        assert response.entries == []
        assert response.total_count == 0
        assert response.query_params.offset == 0
        assert response.query_params.limit == 100

    @pytest.mark.asyncio
    async def test_get_logs_with_data(self, log_service):
        """Test getting logs with existing data."""
        app_name = "test-app"

        # Add some logs
        for i in range(5):
            log_entry = self.create_test_log_entry(message=f"Message {i}")
            await log_service.add_log_entry(app_name, log_entry)

        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=None,
            source=None,
            app_name=app_name,
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
        )
        response = await log_service.get_logs(query_params)

        assert len(response.entries) == 5
        assert response.total_count == 5
        assert response.query_params.offset == 0
        assert response.query_params.limit == 100

    @pytest.mark.asyncio
    async def test_get_logs_with_level_filter(self, log_service):
        """Test getting logs with level filtering."""
        app_name = "test-app"

        # Add logs with different levels
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(level=LogLevel.INFO)
        )
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(level=LogLevel.ERROR)
        )
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(level=LogLevel.INFO)
        )

        # Filter by ERROR level
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=LogLevel.ERROR,
            source=None,
            app_name=app_name,
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
        )
        response = await log_service.get_logs(query_params)

        assert len(response.entries) == 1
        assert response.entries[0].level == LogLevel.ERROR

    @pytest.mark.asyncio
    async def test_get_logs_with_pagination(self, log_service):
        """Test getting logs with pagination."""
        app_name = "test-app"

        # Add 10 logs
        for i in range(10):
            log_entry = self.create_test_log_entry(message=f"Message {i}")
            await log_service.add_log_entry(app_name, log_entry)

        # Get first page
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=None,
            source=None,
            app_name=app_name,
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
            limit=3,
            offset=0,
        )
        response = await log_service.get_logs(query_params)

        assert len(response.entries) == 3
        assert response.total_count == 10
        assert response.query_params.offset == 0
        assert response.query_params.limit == 3

        # Get second page
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=None,
            source=None,
            app_name=app_name,
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
            limit=3,
            offset=3,
        )
        response = await log_service.get_logs(query_params)

        assert len(response.entries) == 3
        assert response.query_params.offset == 3

    @pytest.mark.asyncio
    async def test_get_logs_with_search(self, log_service):
        """Test getting logs with search filtering."""
        app_name = "test-app"

        # Add logs with different messages
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(message="User login successful")
        )
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(message="Database connection failed")
        )
        await log_service.add_log_entry(
            app_name, self.create_test_log_entry(message="User logout")
        )

        # Search for "user" messages
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=None,
            source=None,
            app_name=app_name,
            message_contains="user",
            request_id=None,
            session_id=None,
            user_id=None,
        )
        response = await log_service.get_logs(query_params)

        assert len(response.entries) == 2
        for log in response.entries:
            assert "user" in log.message.lower()

    @pytest.mark.asyncio
    async def test_clear_logs_all(self, log_service):
        """Test clearing all logs for an app."""
        app_name = "test-app"

        # Add some logs
        for i in range(5):
            await log_service.add_log_entry(app_name, self.create_test_log_entry())

        request = LogClearRequest(app_name=app_name)
        response = await log_service.clear_logs(request)

        assert response.cleared_count == 5
        # Verify logs are cleared by checking that no logs for this app_name exist
        assert len([log for log in log_service._logs if log.app_name == app_name]) == 0

    @pytest.mark.asyncio
    async def test_clear_logs_before_timestamp(self, log_service):
        """Test clearing logs before a specific timestamp."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        from hola.shared.models.logs import LogCreateRequest

        # Create two log entries directly
        old_log = LogEntry(
            id="old-log-id",
            timestamp=now - timedelta(hours=2),
            level=LogLevel.INFO,
            message="Old message",
            source=LogSource.APPLICATION,
            app_name=app_name,
            request_id="test-req",
            session_id="test-session",
            user_id="test-user",
            module="test_module",
            function="test_function",
            line_number=1,
            context={},
            exception_type=None,
            exception_message=None,
            stack_trace=None,
        )

        new_log = LogEntry(
            id="new-log-id",
            timestamp=now,
            level=LogLevel.INFO,
            message="New message",
            source=LogSource.APPLICATION,
            app_name=app_name,
            request_id="test-req",
            session_id="test-session",
            user_id="test-user",
            module="test_module",
            function="test_function",
            line_number=1,
            context={},
            exception_type=None,
            exception_message=None,
            stack_trace=None,
        )

        # Add logs directly to in-memory storage
        log_service._logs.append(old_log)
        log_service._logs.append(new_log)

        # Clear logs before 1 hour ago
        cutoff = now - timedelta(hours=1)
        request = LogClearRequest(app_name=app_name, before_time=cutoff)
        response = await log_service.clear_logs(request)

        assert response.cleared_count == 1
        # Verify only one log remains and it's the newer one
        remaining_logs = [log for log in log_service._logs if log.app_name == app_name]
        assert len(remaining_logs) == 1
        assert remaining_logs[0].id == "new-log-id"

    @pytest.mark.asyncio
    async def test_get_log_summary(self, log_service):
        """Test getting log summary statistics."""
        app_name = "test-app"
        now = datetime.now(timezone.utc)

        # Add logs with different levels
        await log_service.add_log_entry(
            app_name,
            LogEntry(
                id="info1",
                timestamp=now - timedelta(minutes=30),
                level=LogLevel.INFO,
                message="Info message",
                source=LogSource.APPLICATION,
                app_name=app_name,
                request_id="test-req",
                session_id="test-session",
                user_id="test-user",
                module="test_module",
                function="test_function",
                line_number=1,
                exception_type=None,
                exception_message=None,
                stack_trace=None,
                context={},
            ),
        )
        await log_service.add_log_entry(
            app_name,
            LogEntry(
                id="error1",
                timestamp=now - timedelta(minutes=20),
                level=LogLevel.ERROR,
                message="Error message",
                source=LogSource.APPLICATION,
                app_name=app_name,
                request_id="test-req",
                session_id="test-session",
                user_id="test-user",
                module="test_module",
                function="test_function",
                line_number=1,
                exception_type=None,
                exception_message=None,
                stack_trace=None,
                context={},
            ),
        )
        await log_service.add_log_entry(
            app_name,
            LogEntry(
                id="info2",
                timestamp=now - timedelta(minutes=10),
                level=LogLevel.INFO,
                message="Another info",
                source=LogSource.APPLICATION,
                app_name=app_name,
                request_id="test-req",
                session_id="test-session",
                user_id="test-user",
                module="test_module",
                function="test_function",
                line_number=1,
                exception_type=None,
                exception_message=None,
                stack_trace=None,
                context={},
            ),
        )

        # Get logs and use the summary from the response since get_log_summary doesn't exist
        query_params = LogQueryParams(
            start_time=now - timedelta(hours=1),
            end_time=None,
            level=None,
            source=None,
            app_name=app_name,
        )
        response = await log_service.get_logs(query_params)
        summary = response.summary

        assert summary is not None
        assert summary.total_entries == 3
        assert summary.entries_by_level[LogLevel.INFO.value] == 2
        assert summary.entries_by_level[LogLevel.ERROR.value] == 1
        assert summary.latest_entry is not None

    @pytest.mark.asyncio
    async def test_stream_logs(self, log_service):
        """Test streaming logs."""
        app_name = "test-app"

        # Add some logs
        for i in range(3):
            await log_service.add_log_entry(
                app_name, self.create_test_log_entry(message=f"Stream message {i}")
            )

        # Stream logs using get_log_stream instead of stream_logs
        query_params = LogQueryParams(app_name=app_name)
        streamed_logs = []
        async for log_entry in log_service.get_log_stream(query_params):
            streamed_logs.append(log_entry)
            if len(streamed_logs) >= 3:  # Prevent infinite streaming in test
                break

        assert len(streamed_logs) == 3
        for i, log in enumerate(streamed_logs):
            assert log.message is not None


class TestFakeLogService:
    """Test cases for FakeLogService."""

    @pytest.fixture
    def fake_service(self):
        """Create a FakeLogService instance."""
        service = FakeLogService()
        yield service
        service.reset()

    def create_test_log_entry(
        self, level: LogLevel = LogLevel.INFO, message: str = "Test message"
    ) -> LogEntry:
        """Create a test log entry."""
        return LogEntry(
            id=f"log-{datetime.now(timezone.utc).timestamp()}",
            timestamp=datetime.now(timezone.utc),
            level=level,
            message=message,
            source=LogSource.APPLICATION,
            app_name="test-app",
            request_id="test-req",
            session_id="test-session",
            user_id="test-user",
            module="test_module",
            function="test_function",
            line_number=1,
            exception_type=None,
            exception_message=None,
            stack_trace=None,
            context={},
        )

    @pytest.mark.asyncio
    async def test_add_log(self, fake_service):
        """Test fake log addition."""
        log_entry = self.create_test_log_entry()
        await fake_service.add_log_entry("test-app", log_entry)

        # Check method call was logged
        assert len(fake_service.method_calls) == 1
        assert fake_service.method_calls[0]["method"] == "add_log_entry"

        # Verify log was added by checking logs contain app_name
        app_logs = [
            log
            for log_id, log in fake_service.logs.items()
            if log.app_name == "test-app"
        ]
        assert len(app_logs) > 0

    @pytest.mark.asyncio
    async def test_get_logs_with_filters(self, fake_service):
        """Test fake log retrieval with filters."""
        # Add logs with different levels
        await fake_service.add_log_entry(
            "test-app", self.create_test_log_entry(level=LogLevel.INFO)
        )
        await fake_service.add_log_entry(
            "test-app", self.create_test_log_entry(level=LogLevel.ERROR)
        )

        # Filter by ERROR level
        query_params = LogQueryParams(
            start_time=None,
            end_time=None,
            level=LogLevel.ERROR,
            source=None,
            app_name="test-app",
            message_contains=None,
            request_id=None,
            session_id=None,
            user_id=None,
        )
        response = await fake_service.get_logs(query_params)

        assert len(response.entries) == 1
        assert response.entries[0].level == LogLevel.ERROR

    @pytest.mark.asyncio
    async def test_clear_logs(self, fake_service):
        """Test fake log clearing."""
        # Add some logs
        for i in range(3):
            await fake_service.add_log_entry("test-app", self.create_test_log_entry())

        # Create a valid LogClearRequest
        request = LogClearRequest(app_name="test-app")
        response = await fake_service.clear_logs(request)

        assert response.cleared_count == 3
        # Verify logs are cleared
        app_logs = [
            log
            for log_id, log in fake_service.logs.items()
            if log.app_name == "test-app"
        ]
        assert len(app_logs) == 0

    @pytest.mark.asyncio
    async def test_stream_logs(self, fake_service):
        """Test fake log streaming."""
        # Add some logs
        await fake_service.add_log_entry(
            "test-app", self.create_test_log_entry(message="Stream test")
        )

        # Stream logs using get_log_stream instead of stream_logs
        query_params = LogQueryParams(app_name="test-app")
        streamed_logs = []
        async for log_entry in fake_service.get_log_stream(query_params):
            streamed_logs.append(log_entry)
            break  # Just get the first one

        assert len(streamed_logs) == 1
        assert "Stream test" in streamed_logs[0].message

    @pytest.mark.asyncio
    async def test_reset(self, fake_service):
        """Test resetting fake service."""
        # Add some data
        await fake_service.add_log_entry("test-app", self.create_test_log_entry())

        fake_service.reset()
        assert len(fake_service.logs) == 0
        assert len(fake_service.method_calls) == 0
