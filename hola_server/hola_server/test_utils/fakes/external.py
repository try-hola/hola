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

    This class provides an in-memory storage system for testing purposes.
    It simulates CRUD operations on collections and items without persisting data to disk.
    """

    def __init__(self):
        """
        Initialize an empty in-memory storage.

        Attributes:
            data (Dict[str, Dict[str, Any]]): A dictionary to store collections and their items.
        """
        self.data: Dict[str, Dict[str, Any]] = {}

    async def read(self, collection: str, id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve an item from a specified collection.

        Args:
            collection (str): The name of the collection.
            id (str): The unique identifier of the item.

        Returns:
            Optional[Dict[str, Any]]: The item if found, otherwise None.
        """
        if collection not in self.data:
            return None
        return self.data[collection].get(id)

    async def write(self, collection: str, id: str, data: Dict[str, Any]) -> None:
        """
        Add or update an item in a specified collection.

        Args:
            collection (str): The name of the collection.
            id (str): The unique identifier of the item.
            data (Dict[str, Any]): The data to store for the item.
        """
        if collection not in self.data:
            self.data[collection] = {}
        self.data[collection][id] = data

    async def delete(self, collection: str, id: str) -> bool:
        """
        Remove an item from a specified collection.

        Args:
            collection (str): The name of the collection.
            id (str): The unique identifier of the item.

        Returns:
            bool: True if the item was successfully deleted, False otherwise.
        """
        if collection not in self.data or id not in self.data[collection]:
            return False
        del self.data[collection][id]
        return True

    async def list(self, collection: str) -> List[Dict[str, Any]]:
        """
        List all items in a specified collection.

        Args:
            collection (str): The name of the collection.

        Returns:
            List[Dict[str, Any]]: A list of all items in the collection.
        """
        if collection not in self.data:
            return []
        return list(self.data[collection].values())


class FakeFileSystem:
    """
    A fake file system implementation for testing.

    This class provides an in-memory file system for testing purposes.
    It simulates file operations such as reading, writing, checking existence, and deletion.
    """

    def __init__(self):
        """
        Initialize an empty in-memory file system.

        Attributes:
            files (Dict[str, bytes]): A dictionary to store file paths and their content.
        """
        self.files: Dict[str, bytes] = {}

    def read_file(self, path: str) -> bytes:
        """
        Read the content of a file from the fake file system.

        Args:
            path (str): The path of the file to read.

        Returns:
            bytes: The content of the file.

        Raises:
            FileNotFoundError: If the file does not exist.
        """
        if path not in self.files:
            raise FileNotFoundError(f"File not found: {path}")
        return self.files[path]

    def write_file(self, path: str, content: bytes) -> None:
        """
        Write content to a file in the fake file system.

        Args:
            path (str): The path of the file to write.
            content (bytes): The content to write to the file.
        """
        self.files[path] = content

    def exists(self, path: str) -> bool:
        """
        Check if a file exists in the fake file system.

        Args:
            path (str): The path of the file to check.

        Returns:
            bool: True if the file exists, False otherwise.
        """
        return path in self.files

    def delete_file(self, path: str) -> None:
        """
        Delete a file from the fake file system.

        Args:
            path (str): The path of the file to delete.
        """
        if path in self.files:
            del self.files[path]
