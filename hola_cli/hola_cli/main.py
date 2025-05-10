"""
Hola CLI application entry point.

This module serves as the main entry point for the Hola CLI application,
defining the command structure and registering all subcommands.
"""
import typer
from rich.console import Console
from .utils.version import get_cli_version
from .commands import hello

app = typer.Typer(
    name="hola",
    help="Hola CLI for managing applications",
    add_completion=True,
)

console = Console()

@app.callback()
def callback():
    """
    Hola CLI for managing applications.
    
    This callback runs before any command and can be used for global initialization.
    """
    pass

@app.command("version")
def version():
    """
    Show the CLI version.
    
    Displays the current version of the Hola CLI application.
    """
    console.print(f"Hola CLI version: {get_cli_version()}")

app.add_typer(hello.hello_commands, name="hello")

if __name__ == "__main__":
    app()