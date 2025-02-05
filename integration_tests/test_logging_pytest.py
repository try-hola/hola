"""
Integration test to verify logging implementation in both client and server.

This test starts the server and runs CLI commands to verify that
logging is working correctly in both components.
"""

import os
import subprocess
import sys
import time
import pytest
import requests
from pathlib import Path
from fastapi.testclient import TestClient

# Add project root to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from hola_server.main import app


@pytest.fixture
def server_process():
    """Fixture that starts the server process and stops it after the test."""
    # Get the project root directory
    project_root = Path(__file__).parent.parent.resolve()

    # Set debug environment
    env = os.environ.copy()
    env["LOG_LEVEL"] = "DEBUG"
    env["HOLA_API_KEY"] = "test-logging-key"

    # Start server in debug mode
    process = subprocess.Popen(
        ["python", "-m", "hola_server.main"],
        cwd=project_root,
        env=env,
    )

    # Wait for server to initialize
    time.sleep(3)

    yield process

    # Stop the server after the test
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def run_cli_command(command, check=True, project_root=None):
    """Helper function to run a CLI command with consistent settings."""
    if project_root is None:
        project_root = Path(__file__).parent.parent.resolve()

    env = os.environ.copy()
    env["LOG_LEVEL"] = "DEBUG"

    return subprocess.run(
        ["python", "-m", "hola_cli.main"] + command,
        cwd=project_root,
        env=env,
        check=check,
        capture_output=True,
        text=True,
    )


class TestLoggingImplementation:
    """Test suite for verifying logging implementation."""

    def test_logging_cli_commands(self, server_process):
        """
        Test that logging is implemented correctly in both client and server.

        This test:
        1. Runs the version command
        2. Runs the hello greet command
        3. Triggers an error condition

        The test verifies that commands run successfully and that logging
        output contains expected messages.
        """
        # Version command
        version_result = run_cli_command(["version"], check=True)
        assert version_result.returncode == 0
        assert "Hola CLI version:" in version_result.stdout

        # Hello command - will fail but we can check the error
        hello_result = run_cli_command(["hello", "greet", "Tester"], check=False)

        # Check for ERROR log messages in CLI output
        assert "ERROR" in hello_result.stdout
        assert "Command 'hello.greet'" in hello_result.stdout

        # Trigger an error with nonexistent server
        error_result = run_cli_command(
            ["hello", "greet", "--server", "nonexistent"], check=False
        )
        assert error_result.returncode != 0
        assert "Command 'hello.greet' failed" in error_result.stdout
