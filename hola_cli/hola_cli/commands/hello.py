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
    format_exception
)
from ..services.hello_service import HelloService
from ..config.context import get_current_server
from ..utils.formatting import format_output

hello_commands = typer.Typer(help="Hello commands for testing connectivity")
console = Console()

@hello_commands.command("greet")
def greet(
    name: str = typer.Argument("World", help="Name to greet"),
    output: str = typer.Option("text", "--output", "-o", help="Output format (text, json)"),
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
    try:
        # Get server context
        server_context = get_current_server(server)
        
        # Call API via service
        service = HelloService(server_context)
        result = service.hello(name)
        
        # Format output
        formatted = format_output(result.data, output)
        console.print(formatted)
    except ConfigurationException as e:
        # Configuration error (like missing or invalid server)
        console.print(Panel.fit(
            f"[bold red]Configuration Error:[/] {e.message}",
            title="Error",
            border_style="red"
        ))
        if e.details and "help" in e.details:
            console.print(f"[bold yellow]Hint:[/] {e.details['help']}")
        elif e.details:
            console.print("[dim]Details:[/]")
            console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except AuthenticationException as e:
        # Authentication error (like invalid API key)
        console.print(Panel.fit(
            f"[bold red]Authentication Error:[/] {e.message}",
            title="Error",
            border_style="red"
        ))
        console.print("[bold yellow]Hint:[/] Check your API key configuration")
        if e.details:
            console.print("[dim]Details:[/]")
            console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except ServiceException as e:
        # Service communication error
        console.print(Panel.fit(
            f"[bold red]Service Error:[/] {e.message}",
            title=f"Error with {e.details.get('service_name', 'API')}",
            border_style="red"
        ))
        if e.details:
            console.print("[dim]Details:[/]")
            console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except HolaException as e:
        # Other Hola-specific exceptions
        console.print(Panel.fit(
            f"[bold red]Error ({e.code}):[/] {e.message}",
            title="Error",
            border_style="red"
        ))
        if e.details:
            console.print("[dim]Details:[/]")
            console.print_json(data=e.details)
        raise typer.Exit(code=1)
    except Exception as e:
        # Convert generic exceptions to our format
        error = format_exception(e)
        console.print(Panel.fit(
            f"[bold red]Unexpected Error:[/] {error.message}",
            title="Error",
            border_style="red"
        ))
        if error.details:
            console.print("[dim]Details:[/]")
            console.print_json(data=error.details)
        raise typer.Exit(code=1)