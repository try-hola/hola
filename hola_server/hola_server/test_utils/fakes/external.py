"""
Fake implementations of external dependencies for testing.
These are used to replace real implementations in tests.
"""

from typing import Dict, Any, Optional, List
from pathlib import Path
import json


class FakeStorage:
    """
    A fake storage implementation for testing.
    Stores all data in memory rather than on disk.
    """

    def __init__(self):
        """Initialize an empty in-memory storage."""
        self.data: Dict[str, Dict[str, Any]] = {}

    async def read(self, collection: str, id: str) -> Optional[Dict[str, Any]]:
        """Read an item from storage."""
        if collection not in self.data:
            return None
        return self.data[collection].get(id)

    async def write(self, collection: str, id: str, data: Dict[str, Any]) -> None:
        """Write an item to storage."""
        if collection not in self.data:
            self.data[collection] = {}
        self.data[collection][id] = data

    async def delete(self, collection: str, id: str) -> bool:
        """Delete an item from storage."""
        if collection not in self.data or id not in self.data[collection]:
            return False
        del self.data[collection][id]
        return True

    async def list(self, collection: str) -> List[Dict[str, Any]]:
        """List all items in a collection."""
        if collection not in self.data:
            return []
        return list(self.data[collection].values())


class FakeFileSystem:
    """
    A fake file system implementation for testing.
    Stores all files in memory rather than on disk.
    """

    # NOTE (Refactor 2025-05-29): This FakeFileSystem is currently not directly used by
    # FakeFileStorage. FakeFileStorage implements its own in-memory async logic.
    # If FakeFileSystem were to be used by an async component in the future,
    # its methods would need to be made `async def` or called via `asyncio.to_thread`.
    # For now, its synchronous interface is maintained as it's isolated.

    def __init__(self):
        """Initialize an empty in-memory file system."""
        self.files: Dict[str, bytes] = {}

    def read_file(self, path: str) -> bytes:
        """Read a file from the fake file system."""
        if path not in self.files:
            raise FileNotFoundError(f"File not found: {path}")
        return self.files[path]

    def write_file(self, path: str, content: bytes) -> None:
        """Write a file to the fake file system."""
        self.files[path] = content

    def exists(self, path: str) -> bool:
        """Check if a file exists in the fake file system."""
        return path in self.files

    def delete_file(self, path: str) -> None:
        """Delete a file from the fake file system."""
        if path in self.files:
            del self.files[path]
