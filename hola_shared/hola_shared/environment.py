"""Environment variable support for Hola components."""
import os
from pathlib import Path
from typing import Optional, Dict, Any, TypeVar, List, Type, cast, Union
from functools import lru_cache

T = TypeVar('T')

def load_env_file(path: Optional[str] = None) -> Dict[str, str]:
    """
    Load environment variables from a .env file.
    
    Args:
        path: Optional path to a .env file. If not provided,
              looks in the current directory for a .env file.
              
    Returns:
        Dictionary of environment variables loaded from the file
    """
    env_path = Path(path) if path else Path(".env")
    
    if not env_path.exists():
        return {}
        
    result = {}
    with open(env_path, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
                
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
            
    return result


def validate_required_env(required_vars: list[str]) -> Dict[str, str]:
    """
    Validate that required environment variables are set.
    
    Args:
        required_vars: List of required environment variable names without the HOLA_ prefix
        
    Returns:
        Dictionary of validated environment variables
        
    Raises:
        ValueError: If any required environment variable is missing
    """
    missing = []
    variables = {}
    
    for var in required_vars:
        value = Environment.get(var)
        if value is None:
            missing.append(f"HOLA_{var}")
        else:
            variables[var] = value
            
    if missing:
        raise ValueError(f"Missing required environment variables: {', '.join(missing)}")
        
    return variables


class Environment:
    """Helper class for accessing environment variables with defaults."""

    @staticmethod
    def get(key: str, default: Optional[str] = None) -> Optional[str]:
        """Get environment variable with optional default."""
        return os.environ.get(f"HOLA_{key.upper()}", default)
        
    @staticmethod
    def get_bool(key: str, default: bool = False) -> bool:
        """Get boolean environment variable."""
        value = Environment.get(key)
        if value is None:
            return default
        return value.lower() in ("true", "1", "yes", "y", "t")
    
    @staticmethod
    def get_int(key: str, default: Optional[int] = None) -> Optional[int]:
        """Get integer environment variable."""
        value = Environment.get(key)
        if value is None:
            return default
        try:
            return int(value)
        except ValueError:
            return default
            
    @staticmethod
    def get_list(key: str, default: Optional[List[str]] = None, delimiter: str = ",") -> List[str]:
        """Get a list from a comma-separated environment variable."""
        value = Environment.get(key)
        if value is None:
            return default or []
        return [item.strip() for item in value.split(delimiter) if item.strip()]

@lru_cache()
def get_environment() -> Environment:
    """Return cached environment instance."""
    return Environment()