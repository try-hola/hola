"""Fake log service implementation for testing.

Attributes:
    method_calls (List[Dict[str, Any]]): Tracks method calls for assertions during testing.
    _failure_modes (Dict[str, bool]): Simulates failures for specific methods during testing.
    logs (Dict[str, LogEntry]): Stores log entries, organized by log ID.
"""

from typing import Dict, List, Optional, Any, AsyncGenerator
from datetime import datetime, timezone
import uuid
import re

from hola_shared.models.logs import (
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


class FakeLogService:
    """Fake implementation of log service for testing.

    Provides in-memory log storage and querying for testing.
    """

    def __init__(self):
        """Initialize the fake log service."""
        self.method_calls: List[Dict[str, Any]] = []
        self._failure_modes: Dict[str, bool] = {}

        # Structure: {log_id: LogEntry}
        self.logs: Dict[str, LogEntry] = {}

    def set_failure_mode(self, method_name: str, should_fail: bool = True):
        """Configure a method to fail when called.

        Args:
            method_name: Name of the method that should fail
            should_fail: Whether the method should fail (default: True)
        """
        self._failure_modes[method_name] = should_fail

    def register_log(self, log: LogEntry):
        """Register a predefined log entry in the system.

        Args:
            log: Log entry to add
        """
        self.logs[log.id] = log

    def has_logs(self, app_name: str) -> bool:
        """Check if logs exist for a specific app.

        Args:
            app_name: Application name to check

        Returns:
            True if logs exist for the app, False otherwise
        """
        return any(log.app_name == app_name for log in self.logs.values())

    def reset(self):
        """Reset the fake service state."""
        self.method_calls = []
        self._failure_modes = {}
        self.logs = {}

    async def add_log_entry(
        self, app_name: Optional[str], entry: LogCreateRequest
    ) -> LogEntry:
        """Add a new log entry."""
        self.method_calls.append(
            {
                "method": "add_log_entry",
                "app_name": app_name,
                "entry": entry,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("add_log_entry", False):
            raise Exception(f"Simulated failure in add_log_entry for {app_name}")

        log_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        log_entry = LogEntry(
            id=log_id,
            timestamp=now,
            level=entry.level,
            source=entry.source,
            app_name=app_name,
            message=entry.message,
            context=entry.context or {},
            request_id=entry.request_id,
            session_id=entry.session_id,
            user_id=entry.user_id,
            module=entry.module,
            function=entry.function,
            line_number=entry.line_number,
            exception_type=entry.exception_type,
            exception_message=entry.exception_message,
            stack_trace=entry.stack_trace,
        )

        self.logs[log_id] = log_entry
        return log_entry

    async def get_logs(self, params: LogQueryParams) -> LogResponse:
        """Query logs based on filter parameters."""
        self.method_calls.append(
            {
                "method": "get_logs",
                "params": params,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_logs", False):
            raise Exception("Simulated failure in get_logs")

        # Apply filters
        filtered_logs = list(self.logs.values())

        # Filter by time range
        if params.start_time:
            filtered_logs = [
                log for log in filtered_logs if log.timestamp >= params.start_time
            ]
        if params.end_time:
            filtered_logs = [
                log for log in filtered_logs if log.timestamp <= params.end_time
            ]

        # Filter by level
        if params.level:
            filtered_logs = [log for log in filtered_logs if log.level == params.level]

        # Filter by source
        if params.source:
            filtered_logs = [
                log for log in filtered_logs if log.source == params.source
            ]

        # Filter by app name
        if params.app_name:
            filtered_logs = [
                log for log in filtered_logs if log.app_name == params.app_name
            ]

        # Filter by message content
        if params.message_contains:
            pattern = re.compile(params.message_contains, re.IGNORECASE)
            filtered_logs = [
                log for log in filtered_logs if pattern.search(log.message)
            ]

        # Filter by request_id, session_id, user_id
        if params.request_id:
            filtered_logs = [
                log for log in filtered_logs if log.request_id == params.request_id
            ]
        if params.session_id:
            filtered_logs = [
                log for log in filtered_logs if log.session_id == params.session_id
            ]
        if params.user_id:
            filtered_logs = [
                log for log in filtered_logs if log.user_id == params.user_id
            ]

        # Sort by timestamp
        sort_reverse = params.sort_order == "desc"
        filtered_logs.sort(key=lambda x: x.timestamp, reverse=sort_reverse)

        # Count by level
        level_counts = {}
        for level in LogLevel:
            level_counts[level.value] = sum(
                1 for log in filtered_logs if log.level == level
            )

        # Count by source
        source_counts = {}
        for source in LogSource:
            source_counts[source.value] = sum(
                1 for log in filtered_logs if log.source == source
            )

        # Calculate summary
        total_count = len(filtered_logs)
        earliest = (
            min((log.timestamp for log in filtered_logs), default=None)
            if filtered_logs
            else None
        )
        latest = (
            max((log.timestamp for log in filtered_logs), default=None)
            if filtered_logs
            else None
        )

        summary = LogSummary(
            total_entries=total_count,
            entries_by_level=level_counts,
            entries_by_source=source_counts,
            earliest_entry=earliest,
            latest_entry=latest,
            size_bytes=total_count
            * 500,  # Mock average size of 500 bytes per log entry
        )

        # Apply pagination
        paginated_logs = filtered_logs[params.offset : params.offset + params.limit]
        has_more = len(filtered_logs) > params.offset + params.limit

        return LogResponse(
            entries=paginated_logs,
            total_count=total_count,
            has_more=has_more,
            query_params=params,
            summary=summary,
        )

    async def clear_logs(self, request: LogClearRequest) -> LogClearResponse:
        """Clear logs based on filter parameters."""
        self.method_calls.append(
            {
                "method": "clear_logs",
                "request": request,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("clear_logs", False):
            raise Exception("Simulated failure in clear_logs")

        # Count logs before clearing
        log_count = len(self.logs)

        # Apply filters to determine which logs to remove
        to_remove = []
        for log_id, log in self.logs.items():
            should_remove = True

            # Filter by app name
            if request.app_name and log.app_name != request.app_name:
                should_remove = False

            # Filter by time range
            if request.before_time and log.timestamp > request.before_time:
                should_remove = False

            # Filter by level
            if request.level and log.level != request.level:
                should_remove = False

            # Filter by source
            if request.source and log.source != request.source:
                should_remove = False

            if should_remove:
                to_remove.append(log_id)

        # Remove filtered logs
        for log_id in to_remove:
            del self.logs[log_id]

        return LogClearResponse(
            cleared_count=len(to_remove),
            message=f"Successfully cleared {len(to_remove)} log entries",
        )

    async def get_log_stream(
        self, params: LogQueryParams
    ) -> AsyncGenerator[LogEntry, None]:
        """Stream logs in real-time based on filter parameters."""
        self.method_calls.append(
            {
                "method": "get_log_stream",
                "params": params,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("get_log_stream", False):
            raise Exception("Simulated failure in get_log_stream")

        # For testing, we just yield all filtered logs at once
        # In real implementation, this would be a continuous stream
        logs_response = await self.get_logs(params)
        for entry in logs_response.entries:
            yield entry

    async def stream_logs(self, app_name: str) -> AsyncGenerator[LogEntry, None]:
        """Stream logs for a specific app.

        Args:
            app_name: Application name to filter logs by

        Yields:
            LogEntry objects for the specified app
        """
        self.method_calls.append(
            {
                "method": "stream_logs",
                "app_name": app_name,
                "timestamp": datetime.now(timezone.utc),
            }
        )

        if self._failure_modes.get("stream_logs", False):
            raise Exception("Simulated failure in stream_logs")

        params = LogQueryParams(
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

        async for log_entry in self.get_log_stream(params):
            yield log_entry
