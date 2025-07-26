"""Application log management service.

This module provides business logic for collecting, storing, and querying
application logs with filtering and search capabilities. It supports comprehensive
log management including storage, rotation, querying with advanced filters, and
statistical analysis for monitoring and debugging.

The service handles logs from various sources and severity levels, maintaining both
in-memory access for quick retrieval and persistent storage for long-term archiving
and analysis.

Attributes:
    context (ServerContext): Server context containing settings and dependencies.
    settings (Settings): Application settings.
    logs_path (Path): Path to the log storage directory.
    _logs (List[LogEntry]): In-memory storage for log entries.
    _max_logs (int): Maximum number of logs to keep in memory.
"""

import json
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any, AsyncGenerator
from datetime import datetime, timezone, timedelta
from hola.models.logs import (
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
from hola.models.errors import ValidationException, ServiceException
from hola.utils.logging import get_logger
from ..config.context import ServerContext
from ..utils.service_logging import (
    log_service_operation_start,
    log_service_operation_end,
    log_service_error,
    log_service_warning,
)

logger = get_logger(__name__)


class LogService:
    """Service for managing application logs.

    Provides business logic for log collection, storage, querying,
    and management with filtering and search capabilities. This service
    handles the complete lifecycle of log entries including creation,
    persistence, querying with advanced filtering options, and lifecycle
    management such as log rotation and cleanup.

    The service supports multiple log sources, severity levels, and
    contextual data to enable comprehensive application monitoring and
    debugging capabilities.
    """

    def __init__(self, context: ServerContext):
        """Initialize the log service.

        Args:
            context (ServerContext): Server context containing settings and dependencies.
        """
        self.context = context
        self.settings = context.settings

        # Initialize log storage
        self.logs_path = Path(self.settings.data_path) / "logs"
        self.logs_path.mkdir(parents=True, exist_ok=True)

        # In-memory log storage (in real implementation, use database or file-based storage)
        self._logs: List[LogEntry] = []
        self._max_logs = 10000  # Maximum number of logs to keep in memory

        logger.debug("LogService initialized")

    async def get_logs(self, params: LogQueryParams) -> LogResponse:
        """Query logs with filtering and pagination.

        Retrieves log entries that match the specified filter criteria including
        time range, log level, source, and content filters. The results are
        paginated based on offset and limit parameters, with optional sorting
        and summary statistics.

        Args:
            params (LogQueryParams): Query parameters for filtering logs including
                time range, application name, log level, message content filters,
                and pagination options.

        Returns:
            LogResponse: Matching log entries, pagination metadata, summary statistics,
                and the original query parameters used.

        Raises:
            ServiceException: If an error occurs during log retrieval or processing.
        """
        start_time = log_service_operation_start(
            logger,
            "get_logs",
            params.request_id if hasattr(params, "request_id") else None,
            app_name=params.app_name,
            level=params.level,
            source=params.source,
            limit=params.limit,
            offset=params.offset,
        )

        try:
            # Filter logs based on query parameters
            filtered_logs = self._filter_logs(params)

            # Sort logs
            if params.sort_order == "desc":
                filtered_logs.sort(key=lambda log: log.timestamp, reverse=True)
            else:
                filtered_logs.sort(key=lambda log: log.timestamp)

            # Apply pagination
            total_count = len(filtered_logs)
            start_idx = params.offset
            end_idx = min(start_idx + params.limit, total_count)
            page_logs = filtered_logs[start_idx:end_idx]

            # Check if there are more logs
            has_more = end_idx < total_count

            # Generate summary if requested or for first page
            summary = None
            if params.offset == 0:
                summary = self._generate_log_summary(filtered_logs)

            result = LogResponse(
                entries=page_logs,
                total_count=total_count,
                has_more=has_more,
                query_params=params,
                summary=summary,
            )

            log_service_operation_end(
                logger,
                "get_logs",
                start_time,
                params.request_id if hasattr(params, "request_id") else None,
                result,
            )

            return result

        except Exception as e:
            log_service_error(
                logger,
                "get_logs",
                e,
                params.request_id if hasattr(params, "request_id") else None,
                app_name=params.app_name,
                level=params.level,
                source=params.source,
            )
            raise ServiceException("LogService", f"Failed to query logs: {str(e)}")

    async def add_log_entry(
        self, app_name: str, request: LogCreateRequest | LogEntry
    ) -> None:
        """Add a new log entry.

        Args:
            app_name (str): Application name for the log entry.
            request (LogCreateRequest | LogEntry): Log creation request with log details or a LogEntry.
        """
        request_id = getattr(request, "request_id", None)
        start_time = log_service_operation_start(
            logger,
            "add_log_entry",
            request_id,
            app_name=app_name,
            level=getattr(request, "level", None),
            source=getattr(request, "source", None),
        )

        try:
            # Handle either LogCreateRequest or LogEntry
            if isinstance(request, LogEntry):
                # If we received a LogEntry directly, use it
                log_entry = request
            else:
                # Create log entry from request
                log_entry = LogEntry(
                    id=str(uuid.uuid4()),
                    timestamp=datetime.now(timezone.utc),
                    level=request.level,
                    source=request.source,
                    app_name=app_name,
                    message=request.message,
                    context=request.context,
                    request_id=request.request_id,
                    session_id=request.session_id,
                    user_id=request.user_id,
                    module=request.module,
                    function=request.function,
                    line_number=request.line_number,
                    exception_type=request.exception_type,
                    exception_message=request.exception_message,
                    stack_trace=request.stack_trace,
                )

            # Add to memory storage
            self._logs.append(log_entry)

            # Maintain max logs limit
            if len(self._logs) > self._max_logs:
                # Remove oldest logs
                self._logs = self._logs[-self._max_logs :]

            # In real implementation, also persist to file or database
            await self._persist_log_entry(log_entry)

            log_service_operation_end(
                logger,
                "add_log_entry",
                start_time,
                request_id,
                {"log_id": log_entry.id},
            )

        except Exception as e:
            log_service_error(logger, "add_log_entry", e, request_id, app_name=app_name)
            raise ServiceException("LogService", f"Failed to add log entry: {str(e)}")

    async def clear_logs(self, request: LogClearRequest) -> LogClearResponse:
        """Clear logs with optional filtering.

        Args:
            request (LogClearRequest): Log clearing request with filtering options.

        Returns:
            LogClearResponse: Number of cleared logs.
        """
        start_time = log_service_operation_start(
            logger,
            "clear_logs",
            getattr(request, "request_id", None),
            app_name=request.app_name,
            before_time=request.before_time,
        )

        try:
            initial_count = len(self._logs)

            # Filter logs to keep (inverse of what to clear)
            logs_to_keep = []
            cleared_count = 0

            for log_entry in self._logs:
                should_clear = True

                # Apply filters
                if request.app_name and log_entry.app_name != request.app_name:
                    should_clear = False

                if request.before_time and log_entry.timestamp > request.before_time:
                    should_clear = False

                if request.level and log_entry.level != request.level:
                    should_clear = False

                if request.source and log_entry.source != request.source:
                    should_clear = False

                if should_clear:
                    cleared_count += 1
                else:
                    logs_to_keep.append(log_entry)

            # Update logs list
            self._logs = logs_to_keep

            result = LogClearResponse(
                cleared_count=cleared_count,
                message=f"Successfully cleared {cleared_count} log entries",
            )

            log_service_operation_end(
                logger,
                "clear_logs",
                start_time,
                getattr(request, "request_id", None),
                {"cleared_count": cleared_count},
            )

            return result

        except Exception as e:
            log_service_error(
                logger,
                "clear_logs",
                e,
                getattr(request, "request_id", None),
                app_name=request.app_name,
            )
            raise ServiceException("LogService", f"Failed to clear logs: {str(e)}")

    async def get_log_stream(
        self, params: LogQueryParams
    ) -> AsyncGenerator[LogEntry, None]:
        """Stream logs in real-time.

        Args:
            params (LogQueryParams): Query parameters for filtering logs.

        Yields:
            LogEntry: Log entries as they are added.
        """
        try:
            logger.debug("Starting log stream")

            # Get current logs matching the filter
            existing_logs = self._filter_logs(params)

            # Yield recent logs first (last 100)
            recent_logs = existing_logs[-100:] if existing_logs else []
            for log_entry in recent_logs:
                yield log_entry

            # In a real implementation, this would use a pub/sub mechanism
            # to stream new logs as they arrive. For now, this is a placeholder.

        except Exception as e:
            logger.error(f"Failed to stream logs: {str(e)}")
            raise ServiceException("LogService", f"Failed to stream logs: {str(e)}")

    async def stream_logs(self, app_name: str) -> AsyncGenerator[LogEntry, None]:
        """Alias for get_log_stream with app_name filter for backward compatibility.

        Args:
            app_name (str): Application name to filter logs by.

        Yields:
            LogEntry: Log entries for the specified app.
        """
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

    async def get_log_summary(self, app_name: str, hours: int = 24) -> LogSummary:
        """Get log summary for an app within a time window.

        Args:
            app_name (str): Application name to get logs for.
            hours (int, optional): Number of hours to look back. Defaults to 24.

        Returns:
            LogSummary: Statistics about the logs.
        """
        try:
            logger.debug(f"Getting log summary for app {app_name} over {hours} hours")

            # Get logs for the specified time window
            start_time = datetime.now(timezone.utc) - timedelta(hours=hours)

            query_params = LogQueryParams(
                start_time=start_time,
                end_time=None,
                level=None,
                source=None,
                app_name=app_name,
                message_contains=None,
                request_id=None,
                session_id=None,
                user_id=None,
            )

            filtered_logs = self._filter_logs(query_params)

            if not filtered_logs:
                return LogSummary(
                    total_entries=0,
                    entries_by_level={},
                    entries_by_source={},
                    earliest_entry=None,
                    latest_entry=None,
                    size_bytes=0,
                )

            return self._generate_log_summary(filtered_logs)

        except Exception as e:
            logger.error(f"Failed to get log summary: {str(e)}")
            raise ServiceException("LogService", f"Failed to get log summary: {str(e)}")

    def _filter_logs(self, params: LogQueryParams) -> List[LogEntry]:
        """Filter logs based on query parameters.

        Applies multiple filter criteria to the log entries including time range,
        content filters (message text, levels, sources), and context filters
        (request ID, session ID, user ID). All filters are combined with AND logic,
        meaning all conditions must be satisfied for a log entry to be included.

        Args:
            params (LogQueryParams): Query parameters containing filter criteria.

        Returns:
            List[LogEntry]: Filtered log entries that match all specified criteria.
        """
        filtered_logs = []

        for log_entry in self._logs:
            # Apply time range filters
            if params.start_time and log_entry.timestamp < params.start_time:
                continue

            if params.end_time and log_entry.timestamp > params.end_time:
                continue

            # Apply content filters
            if params.level and log_entry.level != params.level:
                continue

            if params.source and log_entry.source != params.source:
                continue

            if params.app_name and log_entry.app_name != params.app_name:
                continue

            if (
                params.message_contains
                and params.message_contains.lower() not in log_entry.message.lower()
            ):
                continue

            if params.request_id and log_entry.request_id != params.request_id:
                continue

            if params.session_id and log_entry.session_id != params.session_id:
                continue

            if params.user_id and log_entry.user_id != params.user_id:
                continue

            filtered_logs.append(log_entry)

        return filtered_logs

    def _generate_log_summary(self, logs: List[LogEntry]) -> LogSummary:
        """Generate summary statistics for logs.

        Args:
            logs (List[LogEntry]): List of log entries.

        Returns:
            LogSummary: Summary statistics.
        """
        if not logs:
            return LogSummary(
                total_entries=0,
                entries_by_level={},
                entries_by_source={},
                earliest_entry=None,
                latest_entry=None,
                size_bytes=0,
            )

        # Count entries by level
        entries_by_level = {}
        for level in LogLevel:
            entries_by_level[level.value] = sum(1 for log in logs if log.level == level)

        # Count entries by source
        entries_by_source = {}
        for source in LogSource:
            entries_by_source[source.value] = sum(
                1 for log in logs if log.source == source
            )

        # Find earliest and latest entries
        sorted_logs = sorted(logs, key=lambda log: log.timestamp)
        earliest_entry = sorted_logs[0].timestamp if sorted_logs else None
        latest_entry = sorted_logs[-1].timestamp if sorted_logs else None

        # Estimate size (rough calculation)
        size_bytes = sum(len(log.message.encode("utf-8")) for log in logs)

        return LogSummary(
            total_entries=len(logs),
            entries_by_level=entries_by_level,
            entries_by_source=entries_by_source,
            earliest_entry=earliest_entry,
            latest_entry=latest_entry,
            size_bytes=size_bytes,
        )

    async def _persist_log_entry(self, log_entry: LogEntry) -> None:
        """Persist log entry to storage.

        Args:
            log_entry (LogEntry): Log entry to persist.
        """
        try:
            # In a real implementation, this would write to a file or database
            # For now, we'll create a simple file-based approach

            # Create app-specific log directory
            app_log_dir = self.logs_path / (log_entry.app_name or "system")
            app_log_dir.mkdir(parents=True, exist_ok=True)

            # Create daily log file
            log_date = log_entry.timestamp.strftime("%Y-%m-%d")
            log_file = app_log_dir / f"{log_date}.jsonl"

            # Append log entry as JSON line
            with log_file.open("a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry.model_dump(), default=str) + "\n")

        except Exception as e:
            # Log persistence failures shouldn't break the main operation
            logger.warning(f"Failed to persist log entry: {str(e)}")
