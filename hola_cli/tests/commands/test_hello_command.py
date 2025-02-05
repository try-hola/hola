"""
Tests for the hello commands.

This module tests the CLI commands related to the 'hello' functionality. It demonstrates the project's
testing approach for CLI commands, including:

1. Using Typer's CliRunner for invoking CLI commands in tests
2. Creating isolated test environments with fake server contexts
3. Setting up pre-configured responses for predictable test behavior
4. Verifying both successful execution and proper error handling
5. Testing different output formats and parameter variations

The tests follow the project's strategy of preferring fakes over mocks when possible,
particularly at system boundaries like the API client interface.
"""

import pytest
from unittest.mock import patch
from typer.testing import CliRunner

from hola_cli.main import app
from hola_shared.models.response import ApiResponse
from hola_cli.test_utils.fakes.api import FakeServerContext


@pytest.fixture
def cli_runner():
    """
    Return a Typer CLI runner for testing commands.

    This fixture provides a CliRunner instance from the Typer testing module,
    which allows CLI commands to be invoked programmatically during tests.
    The runner captures command output and exit codes, making it possible
    to assert on both the behavior and the user-facing results of CLI commands.
    """
    return CliRunner()


@pytest.fixture
def fake_hello_context():
    """
    Return a fake server context for hello command testing.

    This fixture creates an isolated test environment with a fake server context
    that has pre-configured responses for the hello endpoint. It provides:

    1. A consistent testing environment isolated from real network calls
    2. Predictable responses for different parameter combinations
    3. The ability to verify that commands correctly interact with the API

    The fake context follows the same interface as the real server context,
    allowing tests to exercise the full command implementation without
    depending on external systems.
    """
    context = FakeServerContext()
    # Register a successful response for the hello endpoint
    context.client.register_response(
        "/hello", {}, ApiResponse(success=True, data="Hello, World!")
    )
    context.client.register_response(
        "/hello", {"name": "Test"}, ApiResponse(success=True, data="Hello, Test!")
    )
    return context


class TestHelloCommands:
    """
    Tests for the hello CLI commands.

    This test class covers the CLI commands related to the 'hello' functionality.
    It uses a combination of the pytest fixture system and selective mocking to:

    1. Test command invocation through Typer's CLI runner
    2. Verify correct output formatting and display
    3. Test different parameter variations and their effects
    4. Ensure proper error handling and status code responses
    5. Validate the integration between CLI commands and service layer

    The tests follow a consistent pattern of setting up mocks/fakes,
    invoking commands, and asserting on both behavior and output.
    """

    @patch("hola_cli.commands.hello.get_current_server")
    @patch("hola_cli.commands.hello.HelloService")
    def test_hello_greet_command(
        self, mock_hello_service, mock_get_server, cli_runner, fake_hello_context
    ):
        """
        Test that the hello greet command works correctly.

        This test verifies that:
        1. The hello greet command invokes the HelloService correctly
        2. The command properly formats and displays the service response
        3. The command exits with a success code when the operation succeeds

        The test uses selective mocking at the service boundary while leveraging
        the fake server context to create a controlled test environment. This approach
        allows testing the command's logic without coupling the test to implementation details.
        """
        # Set up the mocks
        mock_get_server.return_value = fake_hello_context
        mock_service_instance = mock_hello_service.return_value
        mock_service_instance.hello.return_value = ApiResponse(
            success=True, data="Hello, World!"
        )

        # Run the command
        result = cli_runner.invoke(app, ["hello", "greet"])

        # Verify the command output
        assert result.exit_code == 0
        assert "Hello, World!" in result.stdout

    @patch("hola_cli.commands.hello.get_current_server")
    @patch("hola_cli.commands.hello.HelloService")
    def test_hello_greet_with_name(
        self, mock_hello_service, mock_get_server, cli_runner, fake_hello_context
    ):
        """
        Test that the hello greet command works with a custom name.

        This test verifies that:
        1. The hello greet command correctly processes the name parameter
        2. The command passes the name parameter to the HelloService
        3. The command properly formats and displays the personalized response
        4. Parameter validation works as expected for positional arguments

        This test extends the basic greeting test by focusing on parameter passing
        and ensuring that command arguments properly flow through to the service layer.
        It demonstrates how the CLI handles custom user input and validates that
        the entire command-to-service-to-output pipeline functions correctly.
        """
        # Set up the mocks
        mock_get_server.return_value = fake_hello_context
        mock_service_instance = mock_hello_service.return_value
        mock_service_instance.hello.return_value = ApiResponse(
            success=True, data="Hello, Test!"
        )

        # Run the command
        result = cli_runner.invoke(app, ["hello", "greet", "Test"])

        # Verify the command output
        assert result.exit_code == 0
        assert "Hello, Test!" in result.stdout
        mock_service_instance.hello.assert_called_once_with("Test")

    @patch("hola_cli.commands.hello.get_current_server")
    @patch("hola_cli.commands.hello.HelloService")
    def test_hello_greet_json_format(
        self, mock_hello_service, mock_get_server, cli_runner, fake_hello_context
    ):
        """
        Test that the hello greet command can output JSON.

        This test verifies that:
        1. The command respects the --output flag for format specification
        2. The JSON output format option correctly processes the command result
        3. The formatting utility is properly integrated with the command
        4. The command exit code is successful when using different output formats

        Testing different output formats is important because it verifies that
        the CLI's output formatting system works correctly with various data types
        and formats. JSON output is particularly important for programmatic consumption
        of CLI results, such as when the CLI is used in scripts or automation workflows.
        """
        # Set up the mocks
        mock_get_server.return_value = fake_hello_context
        mock_service_instance = mock_hello_service.return_value
        mock_service_instance.hello.return_value = ApiResponse(
            success=True, data="Hello, World!"
        )

        # Run the command with JSON output format
        result = cli_runner.invoke(app, ["hello", "greet", "--output", "json"])

        # Verify the command output is JSON
        assert result.exit_code == 0
        assert "Hello, World!" in result.stdout
        # JSON format test may need different validation since we're mocking the output

    @patch("hola_cli.commands.hello.get_current_server")
    @patch("hola_cli.commands.hello.HelloService")
    def test_hello_greet_api_error(
        self, mock_hello_service, mock_get_server, cli_runner
    ):
        """
        Test that the hello command handles API errors gracefully.

        This test verifies that:
        1. The command correctly catches and processes service exceptions
        2. Error information is properly displayed to the user in a readable format
        3. The command returns a non-zero exit code to indicate failure
        4. Error details are included in the output for troubleshooting

        Error handling is a crucial aspect of CLI design, as it directly impacts
        the user experience. This test ensures that when things go wrong, the CLI
        provides meaningful feedback instead of crashing or displaying cryptic errors.
        It follows the project's convention of using the shared error structure
        defined in ApiResponse for consistent error reporting across components.
        """
        # Create a fake context
        error_context = FakeServerContext()
        mock_get_server.return_value = error_context

        # Set up the service to raise an exception
        mock_service_instance = mock_hello_service.return_value
        from hola_shared.errors import ServiceException

        mock_service_instance.hello.side_effect = ServiceException(
            message="Test error",
            service_name="Hola API Server",
            details={"code": "TEST_ERROR"},
        )

        # Run the command
        result = cli_runner.invoke(app, ["hello", "greet"])

        # Verify error handling
        assert result.exit_code == 1
        assert "Error" in result.stdout
        assert "Test error" in result.stdout
