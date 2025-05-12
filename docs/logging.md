# Hola Logging System

This document provides an overview of the logging infrastructure for the Hola project.

## Overview

Hola uses a layered approach to logging:

1. **Shared Layer**: Base logging functionality in `hola_shared.logger`
2. **Component-Specific Layer**: Extended logging in `hola_cli.utils.logging` and `hola_server.utils.logging`
3. **Application Layer**: Actual logging calls within the application code

This design ensures consistency while allowing each component to implement logging patterns specific to its needs.

## Shared Logging

The shared logging module (`hola_shared.logger`) provides:

- Basic logging configuration
- Common logger retrieval functions
- Environment-based log level settings

```python
from hola_shared.logger import get_logger, configure_logging

# Configure logging based on settings
configure_logging(settings)

# Get a logger for a module
logger = get_logger(__name__)
```

## CLI Logging

CLI-specific logging (`hola_cli.utils.logging`) extends the shared layer with:

- Command execution logging
- Separation of user output and logs
- Error handling specific to CLI commands

```python
from ..utils.logging import log_command_start, log_command_success, log_command_error

# Log command execution
log_command_start(logger, "command.name", arg1="value1")
try:
    # Command execution
    result = do_something()
    log_command_success(logger, "command.name", result)
except Exception as e:
    log_command_error(logger, "command.name", e)
```

## Server Logging

Server-specific logging (`hola_server.utils.logging`) extends the shared layer with:

- HTTP request/response logging
- API endpoint timing
- Middleware for automatic request tracking

```python
from ..utils.logging import log_request_start, log_request_end, log_api_error

# Log request processing
log_request_start(logger, "request-id", "GET", "/api/path")
try:
    # Request handling
    result = process_request()
    log_request_end(logger, "request-id", "GET", "/api/path", 200, 150.5)
except Exception as e:
    log_api_error(logger, e, "request-id")
```

## Configuration

Log levels can be configured:
1. In settings files: `CliSettings.log_level` or equivalent server setting
2. Via environment variable: `LOG_LEVEL=DEBUG`

Standard Python log levels are supported:
- DEBUG
- INFO
- WARNING
- ERROR
- CRITICAL

## Testing the Logging System

Integration tests are provided to verify the logging implementation:

```fish
poetry run pytest integration_tests/test_logging.py -v
```

This test runs both CLI and server components with DEBUG logging enabled to demonstrate how logging functions in each component, verifying:

1. Standard output and log messages are correctly routed
2. Command execution logs show appropriate start/success/error information
3. Error conditions are properly logged

## Best Practices

1. Use the component-specific logging utilities rather than direct calls to the shared layer
2. Separate user-facing output from logs
3. Include appropriate context with each log (command name, request ID, etc.)
4. Use debug logs for detailed tracing and info/warning/error for significant events
5. Don't log sensitive information (API keys, passwords, etc.)
