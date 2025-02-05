from typing import List, Optional, Any, Dict
import logging


class LogMessage:
    def __init__(self, level: int, message: str, args: tuple, kwargs: Dict[str, Any]):
        self.level = level
        self.levelname = logging.getLevelName(level)
        self.message = message
        self.args = args
        self.kwargs = kwargs

    def __repr__(self) -> str:
        return f"LogMessage(level={self.levelname}, message='{self.message}')"


class FakeLogger:
    def __init__(self, name: str = "fake_logger"):
        self.name = name
        self.messages: List[LogMessage] = []

    def _log(self, level: int, message: str, *args: Any, **kwargs: Any) -> None:
        self.messages.append(LogMessage(level, message, args, kwargs))

    def debug(self, message: str, *args: Any, **kwargs: Any) -> None:
        """Log a debug message."""
        self._log(logging.DEBUG, message, *args, **kwargs)

    def info(self, message: str, *args: Any, **kwargs: Any) -> None:
        """Log an info message."""
        self._log(logging.INFO, message, *args, **kwargs)

    def warning(self, message: str, *args: Any, **kwargs: Any) -> None:
        """Log a warning message."""
        self._log(logging.WARNING, message, *args, **kwargs)

    def error(self, message: str, *args: Any, **kwargs: Any) -> None:
        """Log an error message."""
        self._log(logging.ERROR, message, *args, **kwargs)

    def critical(self, message: str, *args: Any, **kwargs: Any) -> None:
        """Log a critical message."""
        self._log(logging.CRITICAL, message, *args, **kwargs)

    def exception(
        self, message: str, *args: Any, exc_info: bool = True, **kwargs: Any
    ) -> None:
        """Log an error message with exception information."""
        # The standard logging.exception automatically sets exc_info=True
        # We just need to pass it through if it's explicitly provided
        if exc_info:
            kwargs["exc_info"] = exc_info
        self._log(logging.ERROR, message, *args, **kwargs)

    def log(self, level: int, message: str, *args: Any, **kwargs: Any) -> None:
        """Log a message with the given level."""
        self._log(level, message, *args, **kwargs)

    def get_messages(self, level: Optional[str] = None) -> List[LogMessage]:
        """Retrieve logged messages, optionally filtered by level."""
        if level:
            level_int = logging.getLevelName(level.upper())
            if isinstance(
                level_int, str
            ):  # getLevelName returns level string if not found
                raise ValueError(f"Invalid log level: {level}")
            return [msg for msg in self.messages if msg.level == level_int]
        return self.messages

    def reset(self) -> None:
        """Clear all logged messages."""
        self.messages = []

    def has_message(self, message_substring: str, level: Optional[str] = None) -> bool:
        """Check if a message containing the substring was logged at the specified level."""
        messages_to_check = self.get_messages(level)
        for msg in messages_to_check:
            if message_substring in msg.message:
                return True
        return False

    @property
    def record_tuples(self) -> List[tuple[str, int, str]]:
        """Returns a list of (logger_name, level, message) tuples."""
        return [
            (self.name, msg.level, msg.message % msg.args if msg.args else msg.message)
            for msg in self.messages
        ]

    # Add other logging methods as needed to comply with the Logger interface
    # For example: isEnabledFor, getEffectiveLevel, setLevel, addHandler, removeHandler
    def isEnabledFor(self, level: int) -> bool:
        # Fake logger is always enabled for all levels for capturing purposes
        return True

    def getEffectiveLevel(self) -> int:
        # Return a default effective level, e.g., DEBUG
        return logging.DEBUG

    def setLevel(self, level: int | str) -> None:
        # This method could be implemented if level filtering at source is needed
        pass

    def addHandler(self, hdlr: logging.Handler) -> None:
        # Not typically needed for a fake logger focused on message capture
        pass

    def removeHandler(self, hdlr: logging.Handler) -> None:
        # Not typically needed for a fake logger focused on message capture
        pass
