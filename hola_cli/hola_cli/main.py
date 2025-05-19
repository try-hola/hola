"""
Hola CLI application entry point.

This module serves as the main entry point for the Hola CLI application,
defining the command structure and registering all subcommands.
"""
import typer
from rich.console import Console
from hola_shared.logger import get_logger
from .config.settings import get_settings
from .utils.version import get_cli_version
from .utils.logging import setup_cli_logging
from .commands import hello
from .commands.servers import servers

# Initialize CLI logging first thing
setup_cli_logging()
logger = get_logger(__name__)
console = Console()

app = typer.Typer(
    name="hola",
    help="Hola CLI for managing applications",
    add_completion=True,
)

@app.callback()
def callback():
    """
    Hola CLI for managing applications.
    
    This callback runs before any command and can be used for global initialization.
    """
    logger.debug("Starting Hola CLI")
    pass

@app.command("version")
def version():
    """
    Show the CLI version.
    
    Displays the current version of the Hola CLI application.
    """
    from .utils.logging import log_command_start, log_command_success
    
    log_command_start(logger, "version")
    cli_version = get_cli_version()
    console.print(f"Hola CLI version: {cli_version}")
    log_command_success(logger, "version", {"version": cli_version})

app.add_typer(hello.hello_commands, name="hello")
app.add_typer(servers, name="servers")

if __name__ == "__main__":
    app()