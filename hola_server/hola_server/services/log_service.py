"""Application log management service.

This module provides business logic for collecting, storing, and querying
application logs with filtering and search capabilities.
"""

import json
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any, AsyncGenerator
from datetime import datetime, timezone, timedelta
from hola_shared.models.logs import (
    LogEntry, LogLevel, LogSource, LogQueryParams, LogResponse, LogSummary,
    LogCreateRequest, LogClearRequest, LogClearResponse
)
from hola_shared.errors import ValidationException, ServiceException
from hola_shared.logger import get_logger
from ..config.context import ServerContext
from ..utils.logging import log_request_start, log_request_end

logger = get_logger(__name__)


class LogService:
    """Service for managing application logs.
    
    Provides business logic for log collection, storage, querying,
    and management with filtering and search capabilities.
    """
    
    def __init__(self, context: ServerContext):
        """Initialize the log service.
        
        Args:
            context: Server context containing settings and dependencies
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
        
        Args:
            params: Query parameters for filtering logs
            
        Returns:
            LogResponse with matching log entries and metadata
        """
        try:
            logger.debug(f"Querying logs with params: {params.model_dump()}")
            
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
            
            return LogResponse(
                entries=page_logs,
                total_count=total_count,
                has_more=has_more,
                query_params=params,
                summary=summary
            )
            
        except Exception as e:
            logger.error(f"Failed to query logs: {str(e)}")
            raise ServiceException("LogService", f"Failed to query logs: {str(e)}")
    
    async def add_log_entry(self, app_name: str, request: LogCreateRequest | LogEntry) -> None:
        """Add a new log entry.
        
        Args:
            app_name: Application name for the log entry
            request: Log creation request with log details or a LogEntry
        """
        try:
            logger.debug(f"Adding log entry for app: {app_name}")
            
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
                    stack_trace=request.stack_trace
                )
            
            # Add to memory storage
            self._logs.append(log_entry)
            
            # Maintain max logs limit
            if len(self._logs) > self._max_logs:
                # Remove oldest logs
                self._logs = self._logs[-self._max_logs:]
            
            # In real implementation, also persist to file or database
            await self._persist_log_entry(log_entry)
            
            logger.debug(f"Log entry added: {log_entry.id}")
            
        except Exception as e:
            logger.error(f"Failed to add log entry: {str(e)}")
            raise ServiceException("LogService", f"Failed to add log entry: {str(e)}")
    
    async def clear_logs(self, request: LogClearRequest) -> LogClearResponse:
        """Clear logs with optional filtering.
        
        Args:
            request: Log clearing request with filtering options
            
        Returns:
            LogClearResponse with number of cleared logs
        """
        try:
            logger.info(f"Clearing logs with filters: {request.model_dump()}")
            
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
            
            logger.info(f"Cleared {cleared_count} log entries")
            
            return LogClearResponse(
                cleared_count=cleared_count,
                message=f"Successfully cleared {cleared_count} log entries"
            )
            
        except Exception as e:
            logger.error(f"Failed to clear logs: {str(e)}")
            raise ServiceException("LogService", f"Failed to clear logs: {str(e)}")
    
    async def get_log_stream(self, params: LogQueryParams) -> AsyncGenerator[LogEntry, None]:
        """Stream logs in real-time.
        
        Args:
            params: Query parameters for filtering logs
            
        Yields:
            LogEntry objects as they are added
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
            app_name: Application name to filter logs by
            
        Yields:
            LogEntry objects for the specified app
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
            user_id=None
        )
        async for log_entry in self.get_log_stream(params):
            yield log_entry
    
    async def get_log_summary(self, app_name: str, hours: int = 24) -> LogSummary:
        """Get log summary for an app within a time window.
        
        Args:
            app_name: Application name to get logs for
            hours: Number of hours to look back
            
        Returns:
            LogSummary with statistics about the logs
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
                user_id=None
            )
            
            filtered_logs = self._filter_logs(query_params)
            
            if not filtered_logs:
                return LogSummary(
                    total_entries=0,
                    entries_by_level={},
                    entries_by_source={},
                    earliest_entry=None,
                    latest_entry=None,
                    size_bytes=0
                )
            
            return self._generate_log_summary(filtered_logs)
            
        except Exception as e:
            logger.error(f"Failed to get log summary: {str(e)}")
            raise ServiceException("LogService", f"Failed to get log summary: {str(e)}")
    
    def _filter_logs(self, params: LogQueryParams) -> List[LogEntry]:
        """Filter logs based on query parameters.
        
        Args:
            params: Query parameters
            
        Returns:
            List of filtered log entries
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
            
            if params.message_contains and params.message_contains.lower() not in log_entry.message.lower():
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
            logs: List of log entries
            
        Returns:
            LogSummary with statistics
        """
        if not logs:
            return LogSummary(
                total_entries=0,
                entries_by_level={},
                entries_by_source={},
                earliest_entry=None,
                latest_entry=None,
                size_bytes=0
            )
        
        # Count entries by level
        entries_by_level = {}
        for level in LogLevel:
            entries_by_level[level.value] = sum(1 for log in logs if log.level == level)
        
        # Count entries by source
        entries_by_source = {}
        for source in LogSource:
            entries_by_source[source.value] = sum(1 for log in logs if log.source == source)
        
        # Find earliest and latest entries
        sorted_logs = sorted(logs, key=lambda log: log.timestamp)
        earliest_entry = sorted_logs[0].timestamp if sorted_logs else None
        latest_entry = sorted_logs[-1].timestamp if sorted_logs else None
        
        # Estimate size (rough calculation)
        size_bytes = sum(len(log.message.encode('utf-8')) for log in logs)
        
        return LogSummary(
            total_entries=len(logs),
            entries_by_level=entries_by_level,
            entries_by_source=entries_by_source,
            earliest_entry=earliest_entry,
            latest_entry=latest_entry,
            size_bytes=size_bytes
        )
    
    async def _persist_log_entry(self, log_entry: LogEntry) -> None:
        """Persist log entry to storage.
        
        Args:
            log_entry: Log entry to persist
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
