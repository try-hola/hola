"""
Tests for the hello API endpoints.
"""
import pytest
from fastapi.testclient import TestClient


class TestHelloEndpoint:
    """Tests for the /hello endpoint."""
    
    def test_hello_endpoint_default(self, client: TestClient, base_headers):
        """Test that the hello endpoint works with default parameters."""
        response = client.get("/hello/", headers=base_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == "Hello, World!"
        assert data["error"] is None
    
    def test_hello_endpoint_with_name(self, client: TestClient, base_headers):
        """Test that the hello endpoint works with a custom name."""
        response = client.get("/hello/?name=Test", headers=base_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["data"] == "Hello, Test!"
        assert data["error"] is None
    
    def test_hello_endpoint_without_auth(self, client: TestClient):
        """Test that the hello endpoint works without authentication for now."""
        response = client.get("/hello/")
        assert response.status_code == 200  # OK since auth is postponed
        data = response.json()
        assert data["success"] is True
        assert data["data"] == "Hello, World!"
        assert data["error"] is None
