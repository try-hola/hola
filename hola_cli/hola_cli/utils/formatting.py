"""
Output formatting utilities for Hola CLI.

This module provides functions for formatting command output in various formats,
such as plain text, tables, and JSON, providing a consistent user experience.
"""

from typing import Any, List, Dict
import json
from rich.table import Table
from rich.console import Console

console = Console()


def format_output(data: Any, format_type: str = "table", style: str = "") -> Any:
    """
    Format output based on format type.

    This function is the primary interface for all user-facing output in the CLI.
    It handles multiple output formats and styles to provide a consistent user
    experience throughout the application. All command modules should use this
    function for their output rather than printing directly to the console.

    The function supports different output formats:
    - "table": For tabular data (lists of dictionaries)
    - "json": For structured data output in JSON format
    - "text": For simple text messages

    And different styles:
    - "info": For informational messages (blue)
    - "success": For success messages (green)
    - "warning": For warning messages (yellow)
    - "error": For error messages (red)

    Args:
        data: The data to format (string, list, dictionary, or other object)
        format_type: The desired format ("json", "table", or "text")
        style: Optional style to apply ("info", "success", "warning", "error")

    Returns:
        Any: Formatted output, which is either printed directly or returned
             depending on the format type
    """
    # Handle string data with style
    if isinstance(data, str) and style:
        if style == "info":
            console.print(f"[blue]{data}[/blue]")
        elif style == "success":
            console.print(f"[green]{data}[/green]")
        elif style == "warning":
            console.print(f"[yellow]{data}[/yellow]")
        elif style == "error":
            console.print(f"[red]{data}[/red]")
        else:
            console.print(data)
        return data

    # Handle regular formatting
    if format_type == "json":
        output = json.dumps(data, indent=2)
        console.print(output)
        return output
    elif format_type == "table":
        if isinstance(data, list) and data and isinstance(data[0], dict):
            table = create_table_from_list(data)
            console.print(table)
            return table
        elif isinstance(data, dict):
            table = create_table_from_dict(data)
            console.print(table)
            return table
        else:
            console.print(str(data))
            return str(data)
    else:
        console.print(str(data))
        return str(data)


def create_table_from_list(data: List[Any]) -> Table:
    """
    Convert a list into a Rich Table object.

    Args:
        data: The list to format as a table

    Returns:
        A Rich Table object representing the list
    """
    table = Table()
    table.add_column("Index", style="dim")
    table.add_column("Value")

    for index, value in enumerate(data):
        table.add_row(str(index), str(value))

    return table


def create_table_from_dict(data: Dict[str, Any]) -> Table:
    """
    Convert a dictionary into a Rich Table object.

    Args:
        data: The dictionary to format as a table

    Returns:
        A Rich Table object representing the dictionary
    """
    table = Table()
    table.add_column("Key", style="bold")
    table.add_column("Value")

    for key, value in data.items():
        table.add_row(str(key), str(value))

    return table
