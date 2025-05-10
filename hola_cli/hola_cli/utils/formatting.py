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

def format_output(data: Any, format_type: str = "table") -> Any:
    """
    Format output based on format type.
    
    Args:
        data: The data to format
        format_type: The desired format ("json", "table", or "text")
    
    Returns:
        Formatted output as a string
    """
    if format_type == "json":
        return json.dumps(data, indent=2)
    elif format_type == "table":
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return create_table_from_list(data)
        elif isinstance(data, dict):
            return create_table_from_dict(data)
        else:
            return str(data)
    else:
        return str(data)

def create_table_from_list(data: List[Any]) -> str:
    """
    Convert a list into a formatted table string.
    
    Args:
        data: The list to format as a table
        
    Returns:
        A string representation of the list formatted as a table
    """
    table = Table()
    table.add_column("Index", style="dim")
    table.add_column("Value")
    
    for index, value in enumerate(data):
        table.add_row(str(index), str(value))
    
    console = Console(record=True)
    console.print(table)
    return console.export_text()

def create_table_from_dict(data: Dict[str, Any]) -> str:
    """
    Convert a dictionary into a formatted table string.
    
    Args:
        data: The dictionary to format as a table
        
    Returns:
        A string representation of the dictionary formatted as a table
    """
    table = Table()
    table.add_column("Key", style="bold")
    table.add_column("Value")
    
    for key, value in data.items():
        table.add_row(str(key), str(value))
    
    console = Console(record=True)
    console.print(table)
    return console.export_text()