"""
Hello commands module for Hola CLI.

This module provides commands for testing API connectivity and server health checks.
"""
import typer
from rich.console import Console
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
    except Exception as e:
        console.print(f"[bold red]Error:[/] {str(e)}")
        raise typer.Exit(code=1)