"""
Hello commands module for Hola CLI.

This module provides commands for testing API connectivity and server health checks.
"""

import typer
from rich.console import Console
from rich.panel import Panel
from hola_shared.errors import (
    HolaException,
    ServiceException,
    AuthenticationException,
    ConfigurationException,
    format_exception,
)
from hola_shared.logger import get_logger
from ..services.hello_service import HelloService
from ..config.context import get_current_server
from ..utils.formatting import format_output
from ..utils.logging import (
    log_command_start,
    log_command_success,
    log_command_error,
    console,
    error_console,
)

hello_commands = typer.Typer(help="Hello commands for testing connectivity")
logger = get_logger(__name__)


@hello_commands.command("greet")
def greet(
    name: str = typer.Argument("World", help="Name to greet"),
    output: str = typer.Option(
        "text", "--output", "-o", help="Output format (text, json)"
    ),
    server: str = typer.Option(None, "--server", "-s", help="Target server"),
):
    """
    Send a greeting to the API and get response.

    This command sends a greeting to the server API and displays the response,
    testing the connectivity and basic functionality of the API server.

    Args:
        name: Name to include in the greeting message
        output: Output format (text or json)
        server: Target server name or URL
    """
    log_command_start(logger, "hello.greet", name=name, output=output, server=server)

    try:
        # Get server context
        server_context = get_current_server(server)
        logger.debug(f"Using server: {server_context.name} ({server_context.url})")

        # Call API via service
        service = HelloService(server_context)
        logger.debug(f"Sending greeting to server for name: {name}")
        result = service.hello(name)

        # Format output
        formatted = format_output(result.data, output)
        console.print(formatted)

        # Log success
        log_command_success(logger, "hello.greet")
    except ConfigurationException as e:
        # Configuration error (like missing or invalid server)
        log_command_error(logger, "hello.greet", e)

        error_console.print(
            Panel.fit(
                f"[bold red]Configuration Error:[/] {e.message}",
                title="Error",
                border_style="red",
            )
        )
        if e.details and "help" in e.details:
            error_console.print(f"[bold yellow]Hint:[/] {e.details['help']}")
        elif e.details:
            error_console.print("[dim]Details:[/]")
            error_console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except AuthenticationException as e:
        # Authentication error (like invalid API key)
        log_command_error(logger, "hello.greet", e)

        error_console.print(
            Panel.fit(
                f"[bold red]Authentication Error:[/] {e.message}",
                title="Error",
                border_style="red",
            )
        )
        error_console.print("[bold yellow]Hint:[/] Check your API key configuration")
        if e.details:
            error_console.print("[dim]Details:[/]")
            error_console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except ServiceException as e:
        # Service communication error
        log_command_error(logger, "hello.greet", e)

        error_console.print(
            Panel.fit(
                f"[bold red]Service Error:[/] {e.message}",
                title=f"Error with {e.details.get('service_name', 'API')}",
                border_style="red",
            )
        )
        if e.details:
            error_console.print("[dim]Details:[/]")
            error_console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except HolaException as e:
        # Other Hola-specific exceptions
        log_command_error(logger, "hello.greet", e)

        error_console.print(
            Panel.fit(
                f"[bold red]Error ({e.code}):[/] {e.message}",
                title="Error",
                border_style="red",
            )
        )
        if e.details:
            error_console.print("[dim]Details:[/]")
            error_console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except Exception as e:
        # Unexpected exception
        log_command_error(logger, "hello.greet", e)

        # Convert generic exceptions to our format
        error = format_exception(e)
        error_console.print(
            Panel.fit(
                f"[bold red]Unexpected Error:[/] {error.message}",
                title="Error",
                border_style="red",
            )
        )
        if error.details:
            error_console.print("[dim]Details:[/]")
            error_console.print_json(data=error.details)
        raise typer.Exit(code=1)
