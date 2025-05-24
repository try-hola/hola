
import os
from typing import Dict, Optional, Any

class FakeEnvironment:
    def __init__(self, initial_vars: Optional[Dict[str, str]] = None):
        """Initialize with a copy of initial_vars or an empty dict."""
        self.vars: Dict[str, str] = (initial_vars or {}).copy()
        self._original_vars: Dict[str, str] = {}

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get an environment variable value."""
        return self.vars.get(key, default)

    def set(self, key: str, value: str) -> None:
        """Set an environment variable value."""
        self.vars[key] = value

    def update(self, vars_dict: Dict[str, str]) -> None:
        """Update multiple environment variables."""
        self.vars.update(vars_dict)

    def delete(self, key: str) -> None:
        """Delete an environment variable if it exists."""
        if key in self.vars:
            del self.vars[key]

    def reset(self) -> None:
        """Clear all environment variables set in this instance, restoring originals if managed by context."""
        self.vars.clear()
        # If used as a context manager, this would restore os.environ to its original state
        # For standalone use, it just clears the internal dictionary.

    def __enter__(self) -> 'FakeEnvironment':
        """Context manager entry: store current os.environ and apply fake vars."""
        self._original_vars = os.environ.copy()
        os.environ.clear()
        os.environ.update(self.vars)
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Context manager exit: restore original os.environ."""
        os.environ.clear()
        os.environ.update(self._original_vars)
        self._original_vars.clear() # Clear original vars after restoring

    # Allow dict-like access
    def __getitem__(self, key: str) -> str:
        return self.vars[key]

    def __setitem__(self, key: str, value: str) -> None:
        self.vars[key] = value

    def __delitem__(self, key: str) -> None:
        del self.vars[key]

    def __contains__(self, key: str) -> bool:
        return key in self.vars
