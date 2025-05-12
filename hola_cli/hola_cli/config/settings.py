"""
CLI settings management for Hola.
Handles loading, saving, and accessing user settings.
"""
import os
import json
from pathlib import Path
from typing import Dict, Optional
from pydantic import BaseModel
from functools import lru_cache
from hola_shared.environment import Environment  # Import from shared package

class ServerConnection(BaseModel):
    """Server connection details for API communication."""
    url: str
    api_key: str

class CliSettings(BaseModel):
    """CLI settings model for Hola."""
    servers: Dict[str, ServerConnection] = {}
    default_server: Optional[str] = None  # Renamed from current_server for clarity
    output_format: str = "table"
    log_level: str = "INFO"
    editor: Optional[str] = None

def get_config_dir() -> Path:
    """
    Get the configuration directory for Hola CLI.
    Creates the directory if it doesn't exist.
    
    Returns:
        Path to the configuration directory
    """
    # Use XDG_CONFIG_HOME if set, otherwise use ~/.config
    xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
    if xdg_config_home:
        config_dir = Path(xdg_config_home) / "hola"
    else:
        config_dir = Path.home() / ".config" / "hola"
        
    # Create directory if it doesn't exist
    config_dir.mkdir(parents=True, exist_ok=True)
    
    return config_dir

def get_settings_path() -> Path:
    """
    Get the path to the settings file.
    
    Returns:
        Path to the settings file
    """
    return get_config_dir() / "settings.json"

def load_settings(check_legacy: bool = True) -> CliSettings:
    """
    Load settings from the configuration file.
    If the file doesn't exist, check for legacy config and migrate if available.
    If no config exists, return default settings.
    
    Args:
        check_legacy: Whether to check for and migrate legacy config
        
    Returns:
        CliSettings object with user configuration
    """
    settings_path = get_settings_path()
    
    # If settings file exists, load it
    if settings_path.exists():
        try:
            with open(settings_path, "r") as f:
                data = json.load(f)
            return CliSettings.model_validate(data)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"Error loading settings: {e}")
            # Fall back to default settings if file is invalid
            return CliSettings()
    
    # If no settings file but check_legacy is True, try to migrate
    if check_legacy:
        try:
            # Import here to avoid circular imports
            from ..utils.migration import migrate_legacy_config
            migrated_settings = migrate_legacy_config()
            
            if migrated_settings:
                # Save the migrated settings
                save_settings(migrated_settings)
                return migrated_settings
        except ImportError:
            # If migration module not available, continue with default settings
            pass
    
    # Return default settings if no config exists
    return CliSettings()

@lru_cache()
def get_settings() -> CliSettings:
    """
    Get the current settings, cached for performance.
    
    Returns:
        Current CLI settings
    """
    return load_settings()

def save_settings(settings: CliSettings) -> None:
    """
    Save settings to the configuration file.
    
    Args:
        settings: CliSettings object to save
    """
    settings_path = get_settings_path()
    
    with open(settings_path, "w") as f:
        json.dump(settings.dict(), f, indent=2)
