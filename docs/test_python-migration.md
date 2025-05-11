"""
Integration tests that verify server-client interaction by launching a live server
and running CLI commands against it.

These tests validate the end-to-end functionality of the Hola system.
"""
import os
import sys
import time
import pytest
import subprocess
import multiprocessing
import requests
from pathlib import Path
from fastapi.testclient import TestClient
from typing import Tuple, Generator, List

# Add project root to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from hola_server.main import app
from hola_cli.config.settings import CliSettings, ServerConnection
from hola_cli.main import app as cli_app
from hola_shared.models.response import ApiResponse

# Test constants
TEST_SERVER_PORT = 8787
TEST_SERVER_URL = f"http://localhost:{TEST_SERVER_PORT}"
TEST_API_KEY = "test-integration-key"


def run_server(port: int, api_key: str) -> None:
    """Run the FastAPI server in a separate process for integration testing."""
    # Set environment variables for the server
    os.environ["HOLA_API_KEY"] = api_key
    os.environ["HOLA_PORT"] = str(port)
    os.environ["HOLA_HOST"] = "127.0.0.1"
    os.environ["HOLA_TESTING"] = "true"
    
    # Import uvicorn here to avoid importing it in the main test process
    import uvicorn
    
    # Start the server
    uvicorn.run(
        "hola_server.main:app",
        host="127.0.0.1",
        port=port,
        log_level="error",
        reload=False
    )


@pytest.fixture(scope="session")
def server_process() -> Generator[multiprocessing.Process, None, None]:
    """Start a FastAPI server in a separate process and yield the process."""
    # Create and start the server process
    proc = multiprocessing.Process(
        target=run_server, 
        args=(TEST_SERVER_PORT, TEST_API_KEY)
    )
    proc.start()
    
    # Wait for server to start
    max_retries = 30
    retry_delay = 0.1
    for _ in range(max_retries):
        try:
            response = requests.get(f"{TEST_SERVER_URL}/health")
            if response.status_code == 200:
                break
        except requests.RequestException:
            pass
        time.sleep(retry_delay)
    else:
        pytest.fail("Server did not start properly")
        
    # Yield the process for test execution
    yield proc
    
    # Cleanup: Terminate the server process
    proc.terminate()
    proc.join(timeout=5)
    if proc.is_alive():
        proc.kill()


@pytest.fixture(scope="session")
def test_cli_config(tmp_path_factory) -> Generator[Tuple[Path, CliSettings], None, None]:
    """
    Create a temporary CLI configuration for testing that points to the test server.
    Returns the config directory and the settings object.
    """
    # Create temp directory for this test session
    config_dir = tmp_path_factory.mktemp("hola_cli_config")
    settings_file = config_dir / "settings.json"
    
    # Create test settings
    settings = CliSettings(
        servers={
            "test-server": ServerConnection(
                url=TEST_SERVER_URL,
                api_key=TEST_API_KEY
            )
        },
        default_server="test-server",
        output_format="table"
    )
    
    # Write settings to file
    settings_file.parent.mkdir(exist_ok=True, parents=True)
    with open(settings_file, 'w') as f:
        import json
        json.dump(settings.dict(), f, indent=2)
    
    yield config_dir, settings


@pytest.fixture
def run_cli_command(monkeypatch, test_cli_config):
    """
    Fixture to run CLI commands against the test server.
    Sets up the environment to use the test configuration.
    """
    config_dir, _ = test_cli_config
    
    def _run_command(command: List[str], expect_error: bool = False) -> str:
        """
        Run a CLI command and return its output.
        
        Args:
            command: List of command parts (e.g. ["hello", "greet", "--name", "Test"])
            expect_error: Whether to expect an error exit code
            
        Returns:
            Command output as string
        """
        # Set up environment for CLI
        monkeypatch.setenv("XDG_CONFIG_HOME", str(config_dir.parent))
        
        # Build the complete command
        full_command = [sys.executable, "-m", "hola_cli.main"] + command
        
        # Run the command
        result = subprocess.run(
            full_command,
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        
        # Check exit code
        if expect_error:
            assert result.returncode != 0, "Command succeeded when it was expected to fail"
        else:
            assert result.returncode == 0, f"Command failed: {result.stderr}"
            
        return result.stdout
        
    return _run_command


class TestHelloIntegration:
    """Integration tests for the Hello feature."""
    
    def test_hello_endpoint_direct(self, server_process):
        """Test the hello endpoint directly via HTTP."""
        response = requests.get(
            f"{TEST_SERVER_URL}/hello/",
            headers={"X-API-Key": TEST_API_KEY}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == "Hello, World!"
        
    def test_hello_with_name_direct(self, server_process):
        """Test the hello endpoint with a custom name via HTTP."""
        response = requests.get(
            f"{TEST_SERVER_URL}/hello/?name=Integration",
            headers={"X-API-Key": TEST_API_KEY}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == "Hello, Integration!"
        
    def test_cli_hello_command(self, server_process, run_cli_command):
        """Test the CLI hello command against the live server."""
        output = run_cli_command(["hello", "greet"])
        assert "Hello, World!" in output
        
    def test_cli_hello_with_name(self, server_process, run_cli_command):
        """Test the CLI hello command with a custom name."""
        output = run_cli_command(["hello", "greet", "IntegrationTest"])
        assert "Hello, IntegrationTest!" in output
        
    def test_cli_hello_json_output(self, server_process, run_cli_command):
        """Test the CLI hello command with JSON output format."""
        output = run_cli_command(["hello", "greet", "--output", "json"])
        # Output should be valid JSON
        import json
        data = json.loads(output)
        assert "Hello, World!" == data


class TestServerStatusIntegration:
    """Integration tests for the Server Status feature."""
    
    def test_server_status_endpoint(self, server_process):
        """Test the server status endpoint directly via HTTP."""
        response = requests.get(
            f"{TEST_SERVER_URL}/server/status",
            headers={"X-API-Key": TEST_API_KEY}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert "version" in data["data"]
        assert "uptime_seconds" in data["data"]
        
    def test_cli_server_status_command(self, server_process, run_cli_command):
        """Test the CLI server status command against the live server."""
        output = run_cli_command(["server", "status"])
        assert "version" in output
        assert "uptime_seconds" in output


class TestAppListingIntegration:
    """Integration tests for the App Listing feature."""
    
    def test_list_apps_endpoint(self, server_process):
        """Test the list apps endpoint directly via HTTP."""
        response = requests.get(
            f"{TEST_SERVER_URL}/apps/",
            headers={"X-API-Key": TEST_API_KEY}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        # The data should be a list, even if empty for a new server
        assert isinstance(data["data"], list)
        
    def test_cli_list_apps_command(self, server_process, run_cli_command):
        """Test the CLI list apps command against the live server."""
        output = run_cli_command(["app", "list"])
        # The command should run without error, even if the list is empty
        assert output


class TestConfigIntegration:
    """Integration tests for the Config management feature."""
    
    def test_list_config_groups_endpoint(self, server_process):
        """Test the list config groups endpoint directly via HTTP."""
        response = requests.get(
            f"{TEST_SERVER_URL}/config/groups",
            headers={"X-API-Key": TEST_API_KEY}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert isinstance(data["data"], list)
        
    def test_cli_list_config_command(self, server_process, run_cli_command):
        """Test the CLI list config command against the live server."""
        output = run_cli_command(["config", "list"])
        # Command should run without error, even if no config groups exist
        assert output


if __name__ == "__main__":
    # This allows running the tests directly with Python
    pytest.main(["-xvs", __file__])