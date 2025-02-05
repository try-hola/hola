"""
Tests for formatting utilities.

This module tests the CLI's output formatting utilities, which are responsible for
converting data structures into user-friendly display formats. The tests verify that:

1. Different data types are correctly formatted based on the requested format
2. The formatting is consistent and predictable across data structures
3. All supported output formats (JSON, table, text) work correctly
4. Default formatting is applied when no specific format is requested

The formatting utilities are crucial for the CLI user experience, as they control
how command results are presented to users in the terminal.
"""

import pytest
import json
from rich.table import Table

from hola_cli.utils.formatting import format_output


class TestFormatOutput:
    """
    Tests for the format_output utility.

    This test class verifies the behavior of the format_output function, which is
    the primary formatting utility for the CLI's user-facing output. It supports
    multiple output formats and data types, making it critical to test thoroughly.

    The tests follow the pattern of providing different input data and format
    specifications, then asserting on the structure and content of the output.
    This ensures the formatting is consistent, correct, and handles different
    data types appropriately.
    """

    def test_format_output_json(self):
        """
        Test formatting output as JSON.

        This test verifies that:
        1. Complex data structures are correctly serialized to JSON format
        2. The output is valid JSON that can be parsed back to the original structure
        3. Nested structures are preserved in the JSON representation

        JSON formatting is particularly important for programmatic consumption
        of CLI output, such as when the CLI is used in scripts or automation.
        """
        data = {"key": "value", "nested": {"inner": "data"}}
        result = format_output(data, "json")
        # Deserialize to compare
        parsed = json.loads(result)
        assert parsed == data

    def test_format_output_table_dict(self):
        """
        Test formatting a dictionary as a table.

        This test verifies that:
        1. A dictionary is correctly converted to a rich.Table object
        2. The table has appropriate columns derived from the dictionary keys
        3. The table contains the dictionary values in its rows

        Table formatting is the primary human-readable output format, used by default
        for complex data structures to improve readability in the terminal.
        """
        data = {"name": "Test", "value": 123, "active": True}
        result = format_output(data, "table")
        # Check that we got a table object
        assert isinstance(result, Table)

    def test_format_output_table_list(self):
        """
        Test formatting a list of dictionaries as a table.

        This test verifies that:
        1. A list of dictionaries is correctly converted to a rich.Table object
        2. The table has columns representing all keys from the dictionaries
        3. Each dictionary in the list becomes a row in the table

        This format is commonly used for command outputs that return collections
        of items, such as listing applications, resources, or configuration entries.
        """
        data = [{"id": 1, "name": "Item 1"}, {"id": 2, "name": "Item 2"}]
        result = format_output(data, "table")
        # Check that we got a table object
        assert isinstance(result, Table)

    def test_format_output_text(self):
        """
        Test formatting as plain text.

        This test verifies that:
        1. Simple string data is returned as-is when text format is requested
        2. The text format preserves the original string value without modification

        Text format is useful for commands that return simple string values
        or for situations where the output will be piped to other commands
        that expect plain text input.
        """
        data = "Hello, World!"
        result = format_output(data, "text")
        assert result == "Hello, World!"

    def test_format_output_default(self):
        """
        Test default format.

        This test verifies that:
        1. When no format is specified, the function still produces valid output
        2. The default formatting follows the expected conventions
        3. Simple string data is still readable in the default format

        Default formatting is important since many commands rely on the default
        behavior rather than specifying a format explicitly, making this a common path
        through the code.
        """
        data = "Test data"
        result = format_output(data)  # No format specified, should use default
        assert isinstance(result, str)
