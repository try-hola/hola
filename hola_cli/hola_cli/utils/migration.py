"""
Migration utility for Hola CLI configuration.
Handles migration from legacy config format to new format.
"""
import os
from pathlib import Path
import json
from typing import Dict, Any, Optional
import shutil

from ..config.settings import CliSettings, ServerConnection, get_settings_path

def get_legacy_config_path() -> Path:
    """Get the legacy configuration file path."""
    return Path.home() / ".hola" / "config.json"

def migrate_legacy_config() -> Optional[CliSettings]:
    """
    Migrate from the legacy config.json to the new settings.json format.
    
    Returns:
        CliSettings object if migration was performed, None if no legacy config exists
    """
    legacy_path = get_legacy_config_path()
    if not legacy_path.exists():
        return None
    
    try:
        # Load legacy config
        with open(legacy_path, "r") as f:
            legacy_data = json.load(f)
        
        # Create new settings object
        settings = CliSettings()
        
        # Map fields from legacy config to new settings
        if "servers" in legacy_data:
            for server_name, server_info in legacy_data["servers"].items():
                settings.servers[server_name] = ServerConnection(
                    url=server_info.get("url", ""),
                    api_key=server_info.get("api_key", "")
                )
        
        # Map current_server to default_server
        if "current_server" in legacy_data and legacy_data["current_server"]:
            settings.default_server = legacy_data["current_server"]
            
        # Copy other settings
        if "output_format" in legacy_data:
            settings.output_format = legacy_data["output_format"]
        
        if "log_level" in legacy_data:
            settings.log_level = legacy_data["log_level"]
        
        # Backup the old config
        backup_path = legacy_path.with_suffix(".json.bak")
        shutil.copy2(legacy_path, backup_path)
        
        # Return the migrated settings
        return settings
    except Exception as e:
        print(f"Error migrating legacy configuration: {e}")
        return None
