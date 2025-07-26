"""
Integration tests for the Hola server functionality.
"""
import json
import pytest
import requests
from pathlib import Path
from typing import Dict, Any
from fastapi.testclient import TestClient

# Add the parent directory to Python path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

from hola.main import app

# Test constants
TEST_SERVER_PORT = 8787
TEST_SERVER_URL = f"http://localhost:{TEST_SERVER_PORT}"


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


class TestServerAPI:
    """Test the server API endpoints."""

    def test_health_check(self, client):
        """Test the health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"

    def test_server_info(self, client):
        """Test the server info endpoint."""
        response = client.get("/api/server/info")
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "version" in data["data"]

    def test_apps_list(self, client):
        """Test listing applications."""
        response = client.get("/api/applications")
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert isinstance(data["data"], list)

    def test_hello_endpoint(self, client):
        """Test the hello endpoint."""
        response = client.get("/api/hello")
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        assert "message" in data["data"]


class TestServerSystemInfo:
    """Test server system information endpoints."""

    def test_system_info(self, client):
        """Test system information endpoint."""
        response = client.get("/api/system/info")
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        system_info = data["data"]
        
        # Check for expected system info fields
        expected_fields = ["cpu_count", "memory_total", "disk_total"]
        for field in expected_fields:
            assert field in system_info, f"Missing {field} in system info"

    def test_system_health(self, client):
        """Test system health endpoint."""
        response = client.get("/api/system/health")
        assert response.status_code == 200
        data = response.json()
        assert "data" in data
        health_info = data["data"]
        
        # Check for expected health fields
        expected_fields = ["cpu_percent", "memory_percent", "disk_percent"]
        for field in expected_fields:
            assert field in health_info, f"Missing {field} in health info"
