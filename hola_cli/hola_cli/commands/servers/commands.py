"""Server commands group.

This module provides the server command group for managing servers.
"""

import asyncio
from typing import Optional, List, Dict, Any
import typer
from rich.table import Table
from rich.console import Console

from hola_shared.models.providers import ServerStatus
from ...providers.server_manager import ServerManager, get_server_manager
from ...providers.providers import get_provider_registry, get_available_provider_types
from ...utils.formatting import format_output

app = typer.Typer(help="Manage servers")
console = Console()


@app.command("list")
def list_servers():
    """
    List all registered servers.

    Displays a table of all servers managed by the CLI, including
    their ID, name, provider type, status, and creation timestamp. If no
    servers are found, displays a helpful message suggesting how to
    create one.
    """
    server_manager = get_server_manager()
    servers = server_manager.get_servers()

    if not servers:
        format_output(
            "No servers found. Use 'hola servers create' to create one.", style="info"
        )
        return

    table = Table(title="Servers")
    table.add_column("ID", style="cyan")
    table.add_column("Name", style="green")
    table.add_column("Provider", style="magenta")
    table.add_column("Status", style="yellow")
    table.add_column("Created At")

    for server in servers:
        table.add_row(
            server.id,
            server.name,
            server.provider_type,
            server.status.value,
            server.created_at,
        )

    console.print(table)


@app.command("providers")
def list_providers():
    """List available server providers."""

    async def _list_providers():
        provider_registry = get_provider_registry()
        available_providers = await provider_registry.get_available_providers()

        if not available_providers:
            format_output(
                "No server providers are available on this system.", style="warning"
            )
            return

        table = Table(title="Available Server Providers")
        table.add_column("Type", style="cyan")
        table.add_column("Name", style="green")

        for provider in available_providers:
            table.add_row(
                provider.type,
                provider.display_name,
            )

        console.print(table)

    asyncio.run(_list_providers())


@app.command("create")
def create_server(
    name: str = typer.Option(..., "--name", "-n", help="Name for the server"),
    provider: str = typer.Option(..., "--provider", "-p", help="Provider type to use"),
    port: int = typer.Option(8000, "--port", help="Port to expose"),
    image: str = typer.Option(
        "python:3.10-slim", "--image", help="Docker image to use"
    ),
    env_vars: List[str] = typer.Option(
        [], "--env", "-e", help="Environment variables in KEY=VALUE format"
    ),
):
    """Create a new server."""
    # Parse environment variables
    env = {}
    for env_var in env_vars:
        if "=" not in env_var:
            format_output(
                f"Invalid environment variable format: {env_var}. Use KEY=VALUE format.",
                style="error",
            )
            raise typer.Exit(1)
        key, value = env_var.split("=", 1)
        env[key] = value

    # Create server options
    options = {
        "port": port,
        "image": image,
        "env": env,
    }

    # Create the server
    async def _create_server():
        try:
            # Check if provider is available
            available_providers = await get_available_provider_types()
            if provider not in available_providers:
                format_output(
                    f"Provider '{provider}' is not available. "
                    f"Available providers: {', '.join(available_providers)}",
                    style="error",
                )
                raise typer.Exit(1)

            # Create the server
            format_output(
                f"Creating server '{name}' with provider '{provider}'...", style="info"
            )
            server_manager = get_server_manager()
            server = await server_manager.create_server(provider, name, options)

            format_output(
                f"Server '{name}' created successfully with ID: {server.id}",
                style="success",
            )
            format_output(
                f"Use 'hola servers start {server.id}' to start the server.",
                style="info",
            )

        except Exception as e:
            format_output(f"Failed to create server: {str(e)}", style="error")
            raise typer.Exit(1)

    asyncio.run(_create_server())


@app.command("start")
def start_server(
    server_id: str = typer.Argument(..., help="ID of the server to start"),
):
    """Start a server."""

    async def _start_server():
        try:
            server_manager = get_server_manager()

            # Check if server exists
            server = server_manager.get_server(server_id)
            if not server:
                format_output(f"Server with ID '{server_id}' not found.", style="error")
                raise typer.Exit(1)

            format_output(
                f"Starting server '{server.name}' ({server_id})...", style="info"
            )

            # Start the server
            updated_server = await server_manager.start_server(server_id)

            if updated_server and updated_server.status == ServerStatus.RUNNING:
                format_output(
                    f"Server '{server.name}' started successfully.", style="success"
                )
            elif updated_server:
                format_output(
                    f"Server status after start attempt: {updated_server.status.value}",
                    style="warning",
                )
                if updated_server.error:
                    format_output(f"Error: {updated_server.error}", style="error")
            else:
                format_output(
                    f"Failed to start server: No response from provider", style="error"
                )

        except Exception as e:
            format_output(f"Failed to start server: {str(e)}", style="error")
            raise typer.Exit(1)

    asyncio.run(_start_server())


@app.command("stop")
def stop_server(
    server_id: str = typer.Argument(..., help="ID of the server to stop"),
):
    """Stop a server."""

    async def _stop_server():
        try:
            server_manager = get_server_manager()

            # Check if server exists
            server = server_manager.get_server(server_id)
            if not server:
                format_output(f"Server with ID '{server_id}' not found.", style="error")
                raise typer.Exit(1)

            format_output(
                f"Stopping server '{server.name}' ({server_id})...", style="info"
            )

            # Stop the server
            updated_server = await server_manager.stop_server(server_id)

            if updated_server.status == ServerStatus.STOPPED:
                format_output(
                    f"Server '{server.name}' stopped successfully.", style="success"
                )
            else:
                format_output(
                    f"Server status after stop attempt: {updated_server.status.value}",
                    style="warning",
                )
                if updated_server.error:
                    format_output(f"Error: {updated_server.error}", style="error")

        except Exception as e:
            format_output(f"Failed to stop server: {str(e)}", style="error")
            raise typer.Exit(1)

    asyncio.run(_stop_server())


@app.command("info")
def server_info(
    server_id: str = typer.Argument(..., help="ID of the server"),
):
    """Get detailed information about a server."""

    async def _server_info():
        try:
            server_manager = get_server_manager()

            # Check if server exists
            server = server_manager.get_server(server_id)
            if not server:
                format_output(f"Server with ID '{server_id}' not found.", style="error")
                raise typer.Exit(1)

            # Refresh server info
            updated_server = await server_manager.refresh_server(server_id)

            # Display info
            console.print(f"[bold cyan]Server Information:[/]")
            console.print(f"  [bold]ID:[/] {updated_server.id}")
            console.print(f"  [bold]Name:[/] {updated_server.name}")
            console.print(f"  [bold]Provider:[/] {updated_server.provider_type}")
            console.print(f"  [bold]Status:[/] {updated_server.status.value}")
            console.print(f"  [bold]Created At:[/] {updated_server.created_at}")

            if updated_server.started_at:
                console.print(f"  [bold]Started At:[/] {updated_server.started_at}")

            if updated_server.url:
                console.print(f"  [bold]URL:[/] {updated_server.url}")

            if updated_server.error:
                console.print(f"  [bold red]Error:[/] {updated_server.error}")

            # Display context info
            console.print("\n[bold cyan]Provider Context:[/]")
            for key, value in updated_server.context.items():
                if key != "provider" and key != "error":
                    console.print(f"  [bold]{key}:[/] {value}")

        except Exception as e:
            format_output(f"Failed to get server info: {str(e)}", style="error")
            raise typer.Exit(1)

    asyncio.run(_server_info())


@app.command("delete")
def delete_server(
    server_id: str = typer.Argument(..., help="ID of the server to delete"),
    force: bool = typer.Option(
        False, "--force", "-f", help="Delete without confirmation"
    ),
):
    """Delete a server (record only, does not stop or remove the server)."""
    server_manager = get_server_manager()

    # Check if server exists
    server = server_manager.get_server(server_id)
    if not server:
        format_output(f"Server with ID '{server_id}' not found.", style="error")
        raise typer.Exit(1)

    # Confirm deletion
    if not force:
        confirm = typer.confirm(
            f"Are you sure you want to delete server '{server.name}' ({server_id})? "
            f"This will only delete the record, not stop or remove the actual server."
        )
        if not confirm:
            format_output("Deletion cancelled.", style="info")
            return

    # Delete the server record
    server_manager.remove_server(server_id)
    format_output(
        f"Server record for '{server.name}' deleted successfully.", style="success"
    )
