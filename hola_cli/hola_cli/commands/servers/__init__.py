"""Server commands package.

This package provides CLI commands for managing server instances.
"""
import typer
from .commands import app as server_commands

# Create a single command module for export
servers = typer.Typer(name="servers", help="Manage server instances")
servers.add_typer(server_commands)
